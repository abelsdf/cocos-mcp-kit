'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  alignSelectedNodesWithSceneView,
  querySceneViewState,
  setSceneViewState,
} = require('../lib/scene-view');

function createHarness() {
  const state = {
    gizmoTool: 'position',
    pivot: 'pivot',
    coordinate: 'local',
    is2D: true,
    gridVisible: true,
    iconGizmo3D: false,
    iconGizmoSize: 2,
    gizmoViewMode: 'select',
    dirty: false,
  };
  const queryFields = {
    'query-gizmo-tool-name': 'gizmoTool',
    'query-gizmo-pivot': 'pivot',
    'query-gizmo-coordinate': 'coordinate',
    'query-is2D': 'is2D',
    'query-is-grid-visible': 'gridVisible',
    'query-is-icon-gizmo-3d': 'iconGizmo3D',
    'query-icon-gizmo-size': 'iconGizmoSize',
    'query-gizmo-view-mode': 'gizmoViewMode',
  };
  const setFields = {
    'change-gizmo-tool': 'gizmoTool',
    'change-gizmo-pivot': 'pivot',
    'change-gizmo-coordinate': 'coordinate',
    'change-is2D': 'is2D',
    'set-grid-visible': 'gridVisible',
    'set-icon-gizmo-3d': 'iconGizmo3D',
    'set-icon-gizmo-size': 'iconGizmoSize',
  };
  const calls = [];
  let failOn = null;
  const nodes = new Map([
    ['camera', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } }],
  ]);

  const request = async (channel, method, ...args) => {
    calls.push([channel, method, ...args]);
    assert.equal(channel, 'scene');
    if (method === failOn) {
      failOn = null;
      throw new Error('native failure');
    }
    if (queryFields[method]) return state[queryFields[method]];
    if (setFields[method]) {
      state[setFields[method]] = args[0];
      return undefined;
    }
    if (method === 'query-node') {
      const value = nodes.get(args[0]);
      return value && {
        position: { value: { ...value.position } },
        rotation: { value: { ...value.rotation } },
      };
    }
    if (method === 'align-with-view') {
      nodes.set('camera', {
        position: { x: 10, y: 20, z: 30 },
        rotation: { x: 4, y: 5, z: 6 },
      });
      state.dirty = true;
      return undefined;
    }
    if (method === 'query-dirty') return state.dirty;
    throw new Error(`Unexpected message: ${method}`);
  };

  return {
    calls,
    nodes,
    request,
    set failOn(value) { failOn = value; },
    state,
  };
}

test('querySceneViewState reads the verified Creator public state surface', async () => {
  const harness = createHarness();
  const result = await querySceneViewState({ request: harness.request });

  assert.equal(result.backend, 'creator-native-scene-view');
  assert.equal(result.gizmoTool, 'position');
  assert.equal(result.pivot, 'pivot');
  assert.equal(result.coordinate, 'local');
  assert.equal(result.is2D, true);
  assert.equal(result.gridVisible, true);
  assert.equal(result.iconGizmo3D, false);
  assert.equal(result.iconGizmoSize, 2);
  assert.equal(result.gizmoViewMode, 'select');
  assert.match(result.limitations[0], /query-only/);
  assert.match(result.limitations[1], /no public observer-camera readback/);
});

test('setSceneViewState applies only requested changes and reads them back', async () => {
  const harness = createHarness();
  const result = await setSceneViewState({
    gizmoTool: 'rotation',
    pivot: 'center',
    coordinate: 'global',
    is2D: false,
    gridVisible: false,
    iconGizmo3D: true,
    iconGizmoSize: 3,
  }, { request: harness.request, timeoutMs: 20, intervalMs: 1 });

  assert.deepEqual(result.changed, [
    'gizmoTool', 'pivot', 'coordinate', 'is2D', 'gridVisible', 'iconGizmo3D', 'iconGizmoSize',
  ]);
  assert.equal(result.gizmoTool, 'rotation');
  assert.equal(result.pivot, 'center');
  assert.equal(result.coordinate, 'global');
  assert.equal(result.is2D, false);
  assert.equal(result.gridVisible, false);
  assert.equal(result.iconGizmo3D, true);
  assert.equal(result.iconGizmoSize, 3);
});

test('setSceneViewState rolls back earlier native changes after a partial failure', async () => {
  const harness = createHarness();
  harness.failOn = 'change-gizmo-pivot';

  await assert.rejects(() => setSceneViewState(
    { gizmoTool: 'scale', pivot: 'center' },
    { request: harness.request, timeoutMs: 20, intervalMs: 1 }
  ), /Applied settings were rolled back/);
  assert.equal(harness.state.gizmoTool, 'position');
  assert.equal(harness.state.pivot, 'pivot');
});

test('scene view validation rejects ambiguous settings before native messages', async () => {
  const harness = createHarness();
  await assert.rejects(() => setSceneViewState({}, { request: harness.request }), /At least one/);
  await assert.rejects(() => setSceneViewState({ gizmoTool: 'move' }, { request: harness.request }), /must be one of/);
  await assert.rejects(() => setSceneViewState({ is2D: 1 }, { request: harness.request }), /boolean/);
  await assert.rejects(() => setSceneViewState({ iconGizmoSize: Number.NaN }, { request: harness.request }), /finite/);
  await assert.rejects(() => setSceneViewState({ camera: true }, { request: harness.request }), /Unknown/);
  assert.equal(harness.calls.length, 0);
});

test('alignSelectedNodesWithSceneView verifies selected node transforms and dirty state', async () => {
  const harness = createHarness();
  const result = await alignSelectedNodesWithSceneView({
    request: harness.request,
    getSelection: () => ['camera'],
  });

  assert.equal(result.changed, true);
  assert.equal(result.dirty, true);
  assert.equal(result.dirtyBefore, false);
  assert.equal(result.dirtyAfter, true);
  assert.equal(result.dirtiedByOperation, true);
  assert.equal(result.needsSave, true);
  assert.deepEqual(result.before[0].position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(result.after[0].position, { x: 10, y: 20, z: 30 });
  assert.equal(harness.calls.filter(([, method]) => method === 'align-with-view').length, 1);
});

test('alignSelectedNodesWithSceneView refuses an empty or unreadable selection', async () => {
  const harness = createHarness();
  await assert.rejects(() => alignSelectedNodesWithSceneView({
    request: harness.request,
    getSelection: () => [],
  }), /Select at least one/);
  await assert.rejects(() => alignSelectedNodesWithSceneView({
    request: harness.request,
    getSelection: () => ['missing'],
  }), /complete transform/);
  assert.equal(harness.calls.some(([, method]) => method === 'align-with-view'), false);
});
