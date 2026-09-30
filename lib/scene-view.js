'use strict';

const DEFAULT_SETTLE_TIMEOUT_MS = 2000;
const DEFAULT_SETTLE_INTERVAL_MS = 50;

const FIELDS = [
  { key: 'gizmoTool', query: 'query-gizmo-tool-name', set: 'change-gizmo-tool', values: ['position', 'rotation', 'scale', 'rect'] },
  { key: 'pivot', query: 'query-gizmo-pivot', set: 'change-gizmo-pivot', values: ['pivot', 'center'] },
  { key: 'coordinate', query: 'query-gizmo-coordinate', set: 'change-gizmo-coordinate', values: ['local', 'global'] },
  { key: 'is2D', query: 'query-is2D', set: 'change-is2D', type: 'boolean' },
  { key: 'gridVisible', query: 'query-is-grid-visible', set: 'set-grid-visible', type: 'boolean' },
  { key: 'iconGizmo3D', query: 'query-is-icon-gizmo-3d', set: 'set-icon-gizmo-3d', type: 'boolean' },
  { key: 'iconGizmoSize', query: 'query-icon-gizmo-size', set: 'set-icon-gizmo-size', type: 'number' },
];

function defaultRequest(channel, method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable in this Cocos extension host.');
  }
  return Editor.Message.request(channel, method, ...args);
}

function defaultGetSelection() {
  if (!global.Editor || !Editor.Selection || typeof Editor.Selection.getSelected !== 'function') {
    throw new Error('Editor.Selection.getSelected is unavailable in this Cocos extension host.');
  }
  return Editor.Selection.getSelected('node');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function querySceneViewState(options = {}) {
  const request = options.request || defaultRequest;
  try {
    const values = await Promise.all([
      ...FIELDS.map((field) => request('scene', field.query)),
      request('scene', 'query-gizmo-view-mode'),
    ]);
    return {
      backend: 'creator-native-scene-view',
      ...Object.fromEntries(FIELDS.map((field, index) => [field.key, values[index]])),
      gizmoViewMode: values[FIELDS.length],
      limitations: [
        'Creator 3.8.8 exposes gizmo view mode as query-only; no public setter is registered.',
        'Focus-camera and align-view-with-node have no public observer-camera readback, so their effects are not exposed as verified narrow tools.',
      ],
    };
  } catch (error) {
    throw new Error(`Creator native scene-view messages are unavailable: ${error.message}`);
  }
}

function validateSceneViewPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scene view settings are required.');
  }
  const fieldsByKey = new Map(FIELDS.map((field) => [field.key, field]));
  const keys = Object.keys(value);
  if (!keys.length) throw new Error('At least one scene view setting is required.');
  const unknown = keys.filter((key) => !fieldsByKey.has(key));
  if (unknown.length) throw new Error(`Unknown scene view setting: ${unknown.join(', ')}.`);

  const patch = {};
  for (const key of keys) {
    const field = fieldsByKey.get(key);
    const setting = value[key];
    if (field.values && !field.values.includes(setting)) {
      throw new Error(`${key} must be one of: ${field.values.join(', ')}.`);
    }
    if (field.type === 'boolean' && typeof setting !== 'boolean') {
      throw new Error(`${key} must be a boolean.`);
    }
    if (field.type === 'number' && (typeof setting !== 'number' || !Number.isFinite(setting))) {
      throw new Error(`${key} must be a finite number.`);
    }
    patch[key] = setting;
  }
  return patch;
}

async function waitForField(field, expected, options) {
  const request = options.request || defaultRequest;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : DEFAULT_SETTLE_TIMEOUT_MS;
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(1, options.intervalMs) : DEFAULT_SETTLE_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let actual;
  do {
    actual = await request('scene', field.query);
    if (Object.is(actual, expected)) return actual;
    if (Date.now() >= deadline) break;
    await delay(intervalMs);
  } while (true);
  throw new Error(`${field.key} did not settle to ${JSON.stringify(expected)} (actual ${JSON.stringify(actual)}).`);
}

async function setSceneViewState(value, options = {}) {
  const patch = validateSceneViewPatch(value);
  const request = options.request || defaultRequest;
  const before = await querySceneViewState(options);
  const applied = [];
  let after;
  try {
    for (const field of FIELDS) {
      if (!(field.key in patch) || Object.is(before[field.key], patch[field.key])) continue;
      applied.push(field);
      await request('scene', field.set, patch[field.key]);
      await waitForField(field, patch[field.key], options);
    }
    after = await querySceneViewState(options);
  } catch (error) {
    const rollbackErrors = [];
    for (const field of applied.reverse()) {
      try {
        await request('scene', field.set, before[field.key]);
        await waitForField(field, before[field.key], options);
      } catch (rollbackError) {
        rollbackErrors.push(`${field.key}: ${rollbackError.message}`);
      }
    }
    const suffix = rollbackErrors.length ? ` Rollback was incomplete (${rollbackErrors.join('; ')}).` : ' Applied settings were rolled back.';
    throw new Error(`Failed to update Creator scene view: ${error.message}${suffix}`);
  }
  return { ...after, changed: applied.map((field) => field.key) };
}

function nodeTransform(dump, uuid) {
  if (!dump || !dump.position || !dump.position.value || !dump.rotation || !dump.rotation.value) {
    throw new Error(`Creator did not return a complete transform for selected node '${uuid}'.`);
  }
  return {
    uuid,
    position: dump.position.value,
    rotation: dump.rotation.value,
  };
}

async function alignSelectedNodesWithSceneView(options = {}) {
  const request = options.request || defaultRequest;
  const getSelection = options.getSelection || defaultGetSelection;
  const selected = [...(getSelection() || [])];
  if (!Array.isArray(selected) || !selected.length) {
    throw new Error('Select at least one scene node before aligning it with the Scene view.');
  }
  const read = async () => Promise.all(selected.map(async (uuid) => nodeTransform(
    await request('scene', 'query-node', uuid),
    uuid
  )));
  const dirtyBefore = await request('scene', 'query-dirty');
  const before = await read();
  await request('scene', 'align-with-view');
  const after = await read();
  const dirtyAfter = await request('scene', 'query-dirty');
  return {
    backend: 'creator-native-scene-view',
    nodeUuids: selected,
    changed: after.some((item, index) => JSON.stringify(item) !== JSON.stringify(before[index])),
    dirty: dirtyAfter,
    dirtyBefore,
    dirtyAfter,
    dirtiedByOperation: dirtyBefore === false && dirtyAfter === true,
    before,
    after,
    needsSave: Boolean(dirtyAfter),
  };
}

module.exports = {
  FIELDS,
  alignSelectedNodesWithSceneView,
  querySceneViewState,
  setSceneViewState,
  validateSceneViewPatch,
};
