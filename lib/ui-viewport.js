'use strict';

const { isDeepStrictEqual } = require('node:util');
const { validateViewportOptions } = require('./ui-viewport-scene');

async function projectResolution() {
  try {
    const result = { available: true };
    for (const key of ['width', 'height', 'fitWidth', 'fitHeight']) {
      result[key] = await Editor.Profile.getProject('project', `general.designResolution.${key}`);
    }
    if (![result.width, result.height].every(n => Number.isFinite(n) && n > 0) ||
        typeof result.fitWidth !== 'boolean' || typeof result.fitHeight !== 'boolean') throw new Error('Invalid or missing native design resolution.');
    return { ...result, source: 'Editor.Profile.getProject' };
  } catch (error) {
    return { available: false, reason: 'project_resolution_unavailable', error: String(error.message || error).slice(0, 300) };
  }
}
async function assertScene(sceneUuid) {
  const [ready, mode, multi, current] = await Promise.all(['query-is-ready', 'query-scene-mode', 'multi-is-multi-edit-mode', 'query-current-scene']
    .map(method => Editor.Message.request('scene', method)));
  if (ready !== true || mode !== 'general' || multi !== false || current !== sceneUuid) throw new Error('Viewport requires the matching ready scene outside prefab/multi-scene editing.');
}
async function getUIViewport(sceneBridge, options) {
  validateViewportOptions(options);
  const input = { sceneUuid: options.sceneUuid, nodeUuids: options.nodeUuids.slice() };
  await assertScene(input.sceneUuid);
  const before = await projectResolution();
  const snapshot = await sceneBridge.call('getUIViewport', input);
  const after = await projectResolution();
  await assertScene(input.sceneUuid);
  if (!snapshot || snapshot.sceneUuid !== input.sceneUuid || !Array.isArray(snapshot.nodes) ||
      !isDeepStrictEqual(snapshot.nodes.map(node => node.nodeUuid), input.nodeUuids)) throw new Error('Viewport response identities do not match the requested scene/nodes.');
  const resolution = isDeepStrictEqual(before, after) ? after : { available: false, reason: 'changed_during_query' };
  return { ...snapshot, projectDesignResolution: resolution, complete: snapshot.complete === true && resolution.available,
    warnings: [...(snapshot.warnings || []), 'Project design resolution is configuration, not the camera render-buffer size or device screen size.'] };
}

// Read-only enrichment is separate from mutation success and native Undo.
// A missing/failed viewport never retries, cleans up, saves or undoes a write.
async function attachUIViewport(sceneBridge, result) {
  let viewport;
  if (result.uncertain) viewport = { complete: false, reason: 'mutation_uncertain' };
  else {
    const nodeUuids = [...new Set(result.identities?.nodes ? Object.values(result.identities.nodes)
      : result.nodeUuid ? [result.nodeUuid] : (result.results || []).map(step => step.nodeUuid).filter(Boolean))];
    if (!result.sceneUuid || !nodeUuids.length) viewport = { complete: false, reason: 'no_target_identities' };
    else {
      try { viewport = await getUIViewport(sceneBridge, { sceneUuid: result.sceneUuid, nodeUuids }); }
      catch (error) { viewport = { complete: false, reason: 'query_failed', error: String(error.message || error).slice(0, 500) }; }
    }
  }
  return { ...result, viewport };
}

module.exports = { getUIViewport, attachUIViewport };
