'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { validateNodeBatch, buildCleanupReport } = require('./node-batch-dto');
const { queryAssetUuid } = require('./asset-uuid');

const pending = new Set();
const uncertainHistory = new Set();

function reportUncertainHistory(projectKey, phase, error, result, undo) {
  uncertainHistory.add(projectKey);
  return { ...result, uncertain: true, phase,
    error: `${result.error ? `${result.error} ` : ''}${String(error.message || error).slice(0, 1000)} Undo history is uncertain. Manual review and a safe Creator restart are required before another batch. Reloading only the extension does not resolve the native recording.`,
    undo: { ...undo, recorded: null, requiresManualReview: true } };
}

async function readContext(sceneUuid) {
  const request = (channel, method) => Editor.Message.request(channel, method);
  if (await request('asset-db', 'query-ready') !== true || await request('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready before batch creation.');
  }
  const context = {
    mode: await request('scene', 'query-scene-mode'),
    uuid: await request('scene', 'query-current-scene'),
    dirty: await request('scene', 'query-dirty'),
    multi: await request('scene', 'multi-is-multi-edit-mode'),
    tabs: await request('scene', 'multi-scene-query'),
  };
  const tab = context.tabs?.[0];
  if (context.mode !== 'general' || context.uuid !== sceneUuid || typeof context.dirty !== 'boolean' ||
      context.multi !== false || !Array.isArray(context.tabs) || context.tabs.length !== 1 ||
      !tab || tab.uuid !== sceneUuid || tab.type !== 'scene' || tab.dirty !== context.dirty ||
      typeof tab.url !== 'string' || !tab.url.startsWith('db://assets/')) {
    throw new Error('Batch creation requires one matching saved scene, outside prefab and multi-scene editing.');
  }
  return context;
}

async function resolveAsset(projectPath, target, type) {
  const result = await queryAssetUuid(target, { projectPath });
  if (!result.complete || result.asset.type !== type || !result.asset.url.startsWith('db://assets/')) {
    throw new Error(`Batch asset must resolve to an imported project ${type}: ${target}`);
  }
  return result.asset;
}

async function createNodeBatch(projectPath, sceneBridge, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['sceneUuid', 'parentUuid', 'batch'].includes(key))) {
    throw new Error('Only sceneUuid, parentUuid and batch options are supported.');
  }
  for (const key of ['sceneUuid', 'parentUuid']) {
    if (typeof options[key] !== 'string' || !options[key].trim() || options[key] !== options[key].trim() || options[key].length > 256) {
      throw new Error(`An exact nonempty ${key} is required.`);
    }
  }
  const checked = validateNodeBatch(options.batch);
  if (!checked.valid) throw new Error(`Invalid node batch: ${checked.issues.map(i => `${i.path}: ${i.code}`).join('; ')}`);
  // Freeze the request across asynchronous validation, independently of its caller.
  const input = JSON.parse(JSON.stringify(options));
  const projectKey = path.resolve(projectPath);
  if (uncertainHistory.has(projectKey)) throw new Error('Undo history needs manual review and a safe Creator restart before another batch. Reloading only the extension does not resolve the native recording.');
  if (pending.has(projectKey)) throw new Error('A node batch is already in progress for this project.');
  pending.add(projectKey);
  try {
    const context = await readContext(input.sceneUuid);
    const scene = await resolveAsset(projectPath, input.sceneUuid, 'cc.SceneAsset');
    if (scene.uuid !== input.sceneUuid || scene.url !== context.tabs[0].url) throw new Error('Scene asset and editor tab identities differ.');
    const expected = await sceneBridge.call('preflightNodeBatch', input);
    const assets = [];
    const sources = new Map();
    for (const reference of expected.assetReferences) {
      if (sources.has(reference.id)) continue;
      const asset = await resolveAsset(projectPath, reference.id, reference.type);
      sources.set(reference.id, asset);
      assets.push({ id: reference.id, uuid: asset.uuid, type: asset.type });
    }
    if (!isDeepStrictEqual(scene, await resolveAsset(projectPath, input.sceneUuid, 'cc.SceneAsset'))) throw new Error('Scene asset identity changed before batch creation.');
    for (const [id, before] of sources) {
      if (!isDeepStrictEqual(before, await resolveAsset(projectPath, id, before.type))) throw new Error('Asset identity changed before batch creation.');
    }
    if (!isDeepStrictEqual(context, await readContext(input.sceneUuid))) throw new Error('Editor context changed before batch creation.');
    // The public recording messages were verified with this exact Creator
    // version. Keep the existing non-Undo path available on other versions.
    const version = global.Editor?.App?.version;
    const undo = version === '3.8.8'
      ? { supported: true, recorded: false, scope: 'target_parent', recordingId: null }
      : { supported: false, recorded: false, reason: 'unverified_creator_version', creatorVersion: version || null };
    if (undo.supported) {
      try {
        const id = await Editor.Message.request('scene', 'begin-recording', input.parentUuid);
        if (typeof id !== 'string' || !id.trim()) throw new Error('Creator did not return a recording identity.');
        undo.recordingId = id;
      } catch (error) {
        return reportUncertainHistory(projectKey, 'undo_begin', error,
          { created: false, verified: false, needsSave: null, cleanup: buildCleanupReport([]) }, undo);
      }
    }
    let result;
    try {
      result = await sceneBridge.call('createNodeBatch', { ...input, expected, assets });
    } catch (error) {
      // The scene process may still be writing. Never infer ownership or retry IPC.
      const failure = { created: false, verified: false, uncertain: true, needsSave: null, phase: 'transport',
        error: `${String(error.message || error).slice(0, 1000)} Inspect the scene before another batch; the write reply was lost.`,
        undo,
        cleanup: { status: 'not_attempted', remainingNodeIds: [], requiresManualReview: true } };
      // Cancelling while the scene call may still be running is not a safe
      // recovery. Retain the known handle and quarantine further batch writes.
      return undo.supported ? reportUncertainHistory(projectKey, 'transport', error, failure, undo) : failure;
    }
    if (!undo.supported) return { ...result, undo };
    try {
      await readContext(input.sceneUuid);
      const success = result.created === true && result.verified === true;
      const reply = await Editor.Message.request('scene', success ? 'end-recording' : 'cancel-recording', undo.recordingId);
      if (reply !== undefined && reply !== null) throw new Error('Unexpected recording finalization reply.');
      return { ...result, undo: { ...undo, recorded: success, cancelled: !success } };
    } catch (error) {
      // Creation/cleanup may already be complete. Preserve that evidence; do
      // not destroy nodes or blindly undo because recording finalization failed.
      return reportUncertainHistory(projectKey, 'undo_finalize', error, result, undo);
    }
  } finally { pending.delete(projectKey); }
}

module.exports = { createNodeBatch };
