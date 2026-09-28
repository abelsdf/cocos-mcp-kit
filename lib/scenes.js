'use strict';

const path = require('path');
const fs = require('fs');
const { isDeepStrictEqual } = require('util');
const { resolveProjectFilePath, isPathInside } = require('./path-safety');
const { persistSerializedAsset } = require('./serialized-asset-persistence');

function normalizeSceneTarget(projectPath, target) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error('target is required.');
  }

  let relative = raw;
  if (relative.startsWith('db://assets/')) {
    relative = relative.slice('db://'.length);
  } else if (relative.startsWith('/assets/')) {
    relative = relative.slice(1);
  } else if (!relative.startsWith('assets/')) {
    relative = `assets/${relative}`;
  }

  if (!relative.endsWith('.scene')) {
    relative = `${relative}.scene`;
  }

  const filePath = resolveProjectFilePath(projectPath, relative);
  const assetsRoot = path.join(projectPath, 'assets');
  const relativeToAssets = path.relative(assetsRoot, filePath);
  if (relativeToAssets.startsWith('..') || path.isAbsolute(relativeToAssets)) {
    throw new Error('target must be inside the Cocos assets directory.');
  }

  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return {
    filePath,
    projectRelative,
    dbUrl: `db://${projectRelative}`,
    sceneName: path.basename(filePath, '.scene'),
  };
}

async function saveSceneContent(projectPath, options = {}) {
  const target = normalizeSceneTarget(projectPath, options.target);
  const content = String(options.content || '');
  if (!content) {
    throw new Error('content is required.');
  }

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed) || !parsed.some((entry) => entry && entry.__type__ === 'cc.SceneAsset')) {
    throw new Error('content must contain a serialized cc.SceneAsset.');
  }

  const result = await persistSerializedAsset(target, content, {
    kind: 'scene',
    overwrite: options.overwrite,
    request: options.request,
    queryInfo: options.queryInfo,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    settleDelayMs: options.settleDelayMs,
  });
  return { ...result, sceneName: target.sceneName };
}

const request = (channel, method, ...args) => {
  if (!global.Editor?.Message?.request) throw new Error('Editor.Message.request is unavailable.');
  return Editor.Message.request(channel, method, ...args);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function sceneObjects(content, uuid) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('Scene content must be JSON of at most 8 MiB.');
  const objects = JSON.parse(content);
  const assets = Array.isArray(objects) ? objects.filter(o => o?.__type__ === 'cc.SceneAsset') : [];
  const root = assets[0]?.scene && objects[assets[0].scene.__id__];
  if (assets.length !== 1 || root?.__type__ !== 'cc.Scene' || root._id !== uuid) throw new Error('Serialized scene identity does not match the saved asset.');
  // Native query-scene-json omits only the SceneAsset name, not the Scene name.
  assets[0]._name = '';
  return objects;
}

async function readSceneSource(projectPath, target) {
  const info = await request('asset-db', 'query-asset-info', target);
  if (!info || !info.uuid || ![info.uuid, info.url].includes(target) || info.type !== 'cc.SceneAsset' || info.imported !== true ||
      info.invalid === true || info.readonly === true || info.isDirectory === true ||
      typeof info.url !== 'string' || !info.url.startsWith('db://assets/') || !info.url.endsWith('.scene')) {
    throw new Error('Scene must resolve exactly to an imported, writable project .scene asset.');
  }
  const file = resolveProjectFilePath(projectPath, info.url.slice(5));
  const metaFile = resolveProjectFilePath(projectPath, `${file}.meta`);
  if (!isPathInside(path.join(projectPath, 'assets'), file) || `db://${path.relative(projectPath, file).replace(/\\/g, '/')}` !== info.url ||
      info.file && path.relative(file, resolveProjectFilePath(projectPath, info.file)) !== '' ||
      !fs.lstatSync(file).isFile() || fs.statSync(file).size > 8 * 1024 * 1024 || !fs.lstatSync(metaFile).isFile()) throw new Error('Scene source/meta paths must match project assets.');
  const content = fs.readFileSync(file, 'utf8'), meta = fs.readFileSync(metaFile, 'utf8');
  if (JSON.parse(meta).uuid !== info.uuid) throw new Error('Scene metadata UUID does not match asset-db.');
  return { uuid: info.uuid, url: info.url, content, meta, objects: sceneObjects(content, info.uuid) };
}

async function sceneContext(allowDirty = false) {
  const result = {};
  for (const [key, method] of Object.entries({ ready: 'query-is-ready', mode: 'query-scene-mode', uuid: 'query-current-scene',
    dirty: 'query-dirty', multi: 'multi-is-multi-edit-mode', tabs: 'multi-scene-query' })) result[key] = await request('scene', method);
  if (result.ready !== true || result.mode !== 'general' || typeof result.uuid !== 'string' || !result.uuid || typeof result.dirty !== 'boolean' || !allowDirty && result.dirty || result.multi !== false ||
      !Array.isArray(result.tabs) || result.tabs.length !== 1 || result.tabs[0]?.uuid !== result.uuid || result.tabs[0].dirty !== result.dirty || result.tabs[0].type !== 'scene') {
    throw new Error('Switching requires one ready, saved, clean scene; prefab, dirty and multi-scene states are refused. Save explicitly first.');
  }
  return result;
}

async function captureScene(projectPath, expectedSceneUuid) {
  if (await request('asset-db', 'query-ready') !== true) throw new Error('Asset database must be ready.');
  const context = await sceneContext();
  if (expectedSceneUuid !== undefined && context.uuid !== expectedSceneUuid) throw new Error('Current scene differs from expectedSceneUuid.');
  const source = await readSceneSource(projectPath, context.uuid);
  if (context.tabs[0].url !== source.url || !isDeepStrictEqual(source.objects, sceneObjects(await request('scene', 'query-scene-json'), source.uuid))) {
    throw new Error('Current scene has unsaved serialized changes or mismatched identity, even if dirty=false. Save explicitly before switching.');
  }
  if (!isDeepStrictEqual(context, await sceneContext())) throw new Error('Scene context changed during preflight.');
  return { context, source };
}

async function openSceneSafely(projectPath, options = {}, original) {
  if (Object.keys(options).some(k => !['target', 'expectedSceneUuid'].includes(k)) || typeof options.target !== 'string' || !options.target.trim() ||
      options.expectedSceneUuid !== undefined && (typeof options.expectedSceneUuid !== 'string' || !options.expectedSceneUuid.trim())) throw new Error('Expected a scene target and optional exact expectedSceneUuid.');
  let target = options.target.trim().replace(/\\/g, '/');
  if (target.startsWith('/assets/')) target = target.slice(1);
  if (target.startsWith('assets/')) target = `db://${target}`;
  else if (path.isAbsolute(target)) target = `db://${path.relative(projectPath, resolveProjectFilePath(projectPath, target)).replace(/\\/g, '/')}`;
  const before = original || await captureScene(projectPath, options.expectedSceneUuid);
  const destination = await readSceneSource(projectPath, target);
  if (!isDeepStrictEqual(before, await captureScene(projectPath, before.context.uuid)) ||
      !isDeepStrictEqual(destination, await readSceneSource(projectPath, destination.uuid))) throw new Error('Scene or source changed before switching.');
  const alreadyOpen = before.context.uuid === destination.uuid;
  let requested = false;
  try {
    if (!alreadyOpen) {
      requested = true;
      await request('asset-db', 'open-asset', destination.uuid);
      for (let attempt = 0; ; attempt++) {
        const ready = await request('scene', 'query-is-ready');
        const uuid = await request('scene', 'query-current-scene');
        if (ready === true && uuid === destination.uuid) break;
        if (attempt >= 20 || uuid && ![before.context.uuid, destination.uuid].includes(uuid)) throw new Error('Requested scene did not become ready.');
        await delay(100);
      }
    }
    const verify = async () => {
      const context = await sceneContext(true);
      if (context.uuid !== destination.uuid || context.tabs[0].url !== destination.url) throw new Error('Opened scene identity differs from requested target.');
      const live = sceneObjects(await request('scene', 'query-scene-json'), destination.uuid);
      if (!isDeepStrictEqual(destination, await readSceneSource(projectPath, destination.uuid)) || !isDeepStrictEqual(before.source, await readSceneSource(projectPath, before.source.uuid))) throw new Error('Scene source or original scene changed during entry.');
      return { context, live };
    };
    const first = await verify(); await delay(400); const after = await verify();
    if (!isDeepStrictEqual(first, after)) throw new Error('Opened scene changed during verification.');
    const contentMatchesSource = isDeepStrictEqual(destination.objects, after.live);
    return { uuid: destination.uuid, url: destination.url, opened: true, verified: true, alreadyOpen,
      contentMatchesSource, needsSave: after.context.dirty || !contentMatchesSource,
      previousScene: { uuid: before.source.uuid, url: before.source.url }, method: requested ? 'asset-db:open-asset' : null };
  } catch (error) {
    if (!requested) throw error;
    throw new Error(`${error.message} Scene may already have opened; inspect before retrying. No automatic save, discard, retry or rollback was attempted.`, { cause: error });
  }
}

async function createScene(projectPath, sceneBridge, options = {}) {
  const mode = options.mode === undefined ? 'empty' : options.mode;
  if (Object.keys(options).some(k => !['target', 'mode', 'sceneName', 'overwrite', 'openAfterCreate', 'expectedSceneUuid'].includes(k)) ||
      !['empty', 'current', 'ui'].includes(mode) || typeof options.target !== 'string' || !options.target.trim() ||
      ['overwrite', 'openAfterCreate'].some(k => options[k] !== undefined && typeof options[k] !== 'boolean') ||
      options.sceneName !== undefined && (typeof options.sceneName !== 'string' || !options.sceneName.trim()) ||
      mode === 'ui' && options.overwrite === true ||
      options.openAfterCreate === true && (typeof options.expectedSceneUuid !== 'string' || !options.expectedSceneUuid.trim()) ||
      options.openAfterCreate !== true && options.expectedSceneUuid !== undefined) throw new Error('Invalid create_scene options: ui cannot overwrite; openAfterCreate requires expectedSceneUuid.');
  const target = normalizeSceneTarget(projectPath, options.target);
  if (options.overwrite !== true && (fs.existsSync(target.filePath) || fs.existsSync(`${target.filePath}.meta`))) throw new Error('Target scene or metadata already exists.');
  const before = options.openAfterCreate === true ? await captureScene(projectPath, options.expectedSceneUuid) : null;
  if (before && path.relative(target.filePath, resolveProjectFilePath(projectPath, before.source.url.slice(5))) === '') throw new Error('Cannot overwrite the active scene during create/open.');
  const serialized = await sceneBridge.call('serializeScene', { mode, sceneName: options.sceneName || target.sceneName });
  if (before && !isDeepStrictEqual(before, await captureScene(projectPath, before.context.uuid))) throw new Error('Origin changed before scene creation.');
  const result = await saveSceneContent(projectPath, { target: target.projectRelative, content: serialized.content, overwrite: options.overwrite });
  let opened = null;
  if (before) {
    try { opened = await openSceneSafely(projectPath, { target: result.dbUrl, expectedSceneUuid: before.context.uuid }, before); }
    catch (error) { throw new Error(`Scene created at ${result.dbUrl}. ${error.message} The created asset was not deleted automatically.`, { cause: error }); }
  }
  return { ...result, mode: serialized.mode, source: serialized.source, scene: serialized.scene, ui: serialized.ui, opened };
}

module.exports = {
  createScene,
  openSceneSafely,
  normalizeSceneTarget,
  saveSceneContent,
};
