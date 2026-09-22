'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const calls = [];
  const state = {
    asset: { uuid: 'prefab-uuid', url: 'db://assets/Panel.prefab', type: 'cc.Prefab', imported: true },
    scene: { uuid: 'scene-uuid', type: 'cc.SceneAsset', imported: true },
    parentUuid: 'parent-uuid', children: ['existing-child'], name: 'Panel', position: { x: 0, y: 0, z: 0 },
    createdUuid: 'new-node', created: false, removed: false, propertyResult: true,
  };
  function inspection() {
    if (state.inspectionError) throw new Error(state.inspectionError);
    return {
      sceneUuid: state.changedScene || 'scene-uuid',
      node: { uuid: state.createdUuid, parentUuid: state.actualParent || state.parentUuid,
        name: state.name, path: `Canvas/${state.name}`, position: state.position },
      prefab: { linked: true, asset: { uuid: 'prefab-uuid' }, rootUuid: state.createdUuid,
        fileId: 'prefab-file-id', instance: { fileId: 'instance-file-id' }, ...state.prefab },
    };
  }
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, payload) => {
    calls.push({ channel, method, payload });
    if (channel === 'asset-db') {
      if (method === 'query-ready') return true;
      if (method === 'query-asset-info') return payload === 'scene-uuid' ? state.scene : state.asset;
    }
    if (channel === 'scene') {
      if (method === 'query-is-ready') return state.ready !== false;
      if (method === 'create-node') {
        state.created = true;
        state.name = payload.name;
        if (state.createError) throw new Error(state.createError);
        return state.createdUuid;
      }
      if (method === 'set-property') {
        assert.equal(payload.path, 'position');
        assert.equal(payload.dump.type, 'cc.Vec3');
        if (state.propertyError) throw new Error(state.propertyError);
        if (!state.ignorePosition) state.position = payload.dump.value;
        return state.propertyResult;
      }
      if (method === 'remove-node') {
        assert.equal(payload.uuid, state.createdUuid);
        if (state.cleanupError) throw new Error(state.cleanupError);
        state.removed = !state.cleanupNoop;
        return;
      }
      if (method === 'query-node') return state.removed ? undefined : { uuid: { value: state.createdUuid } };
    }
    throw new Error(`Unexpected request ${channel}:${method}`);
  } } };
  t.after(() => { if (previous === undefined) delete global.Editor; else global.Editor = previous; });
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath: process.cwd(), config: { toolProfile: 'full' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {}, list: () => [] },
    sceneBridge: { call: async (method, payload) => {
      calls.push({ channel: 'bridge', method, payload });
      if (method === 'preparePrefabInstance') {
        if (state.prepareError) throw new Error(state.prepareError);
        return { sceneUuid: 'scene-uuid', parentUuid: state.parentUuid, childUuids: state.children,
          name: payload.name || 'Panel', position: payload.position || { x: 3, y: 4, z: 5 } };
      }
      if (method === 'getPrefabInstanceInfo') return inspection();
      throw new Error(`Unexpected scene bridge call: ${method}`);
    } },
  });
  return { state, calls, run: (args = {}, name = 'create_prefab_instance') => registry.callToolDetailed(name, { prefabUuid: 'prefab-uuid', ...args }) };
}

for (const name of ['create_prefab_instance', 'instantiate_prefab']) {
  test(`${name} creates once through the editor and verifies linkage and local placement`, async (t) => {
    const f = fixture(t);
    const { value } = await f.run({ prefabUuid: 'db://assets/Panel.prefab', parentUuid: 'parent-uuid',
      name: 'Placed', position: { x: 0, y: -12, z: 7 } }, name);
    assert.equal(value.ok, true);
    assert.equal(value.data.created, true);
    assert.equal(value.data.instantiated, true);
    assert.equal(value.data.linkedPrefab, true);
    assert.equal(value.data.verified, true);
    assert.equal(value.data.needsSave, true);
    assert.equal(value.data.creationMethod, 'scene:create-node');
    assert.equal(value.data.prefab.instance.fileId, 'instance-file-id');
    assert.deepEqual(value.data.node.position, { x: 0, y: -12, z: 7 });
    assert.equal(Object.values(value.data.verification).every(Boolean), true);
    const writes = f.calls.filter((call) => call.method === 'create-node');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].payload, { assetUuid: 'prefab-uuid', type: 'cc.Prefab', unlinkPrefab: false,
      parent: 'parent-uuid', name: 'Placed', nameIncrease: false, keepWorldTransform: false });
    assert.equal(f.calls.some((call) => call.method === 'instantiatePrefab'), false);
  });
}

test('omitted name and position use the source prefab defaults and an explicit scene-root parent', async (t) => {
  const f = fixture(t);
  f.state.parentUuid = 'scene-uuid';
  const { value } = await f.run();
  assert.equal(value.data.node.name, 'Panel');
  assert.deepEqual(value.data.node.position, { x: 3, y: 4, z: 5 });
  assert.equal(f.calls.find((call) => call.method === 'create-node').payload.parent, 'scene-uuid');
});

for (const args of [
  { prefabUuid: '' }, { prefabUuid: 12 }, { parentPath: '' }, { parentUuid: 12 },
  { name: '' }, { name: false }, { position: null }, { position: [1, 2, 3] },
  { position: { x: 1, y: 2 } }, { position: { x: 1, y: 2, z: NaN } },
  { position: { x: 1, y: 2, z: '3' } }, { position: { x: 1, y: 2, z: 3, w: 0 } },
]) {
  test(`invalid prefab instance arguments are rejected before creation: ${JSON.stringify(args)}`, async (t) => {
    const f = fixture(t);
    await assert.rejects(f.run(args));
    assert.equal(f.state.created, false);
  });
}

for (const change of [{ type: 'cc.SpriteFrame' }, { imported: false }, { invalid: true }, { isDirectory: true }, { uuid: '' }]) {
  test(`prefab instance creation rejects unready or wrong assets: ${JSON.stringify(change)}`, async (t) => {
    const f = fixture(t);
    Object.assign(f.state.asset, change);
    await assert.rejects(f.run(), /Prefab|prefab|asset/i);
    assert.equal(f.state.created, false);
  });
}

for (const reason of ['parent not found', 'ambiguous parent', 'linked parent', 'UI prefab requires a Canvas']) {
  test(`scene preflight refuses ${reason} without creating a node`, async (t) => {
    const f = fixture(t);
    f.state.prepareError = reason;
    await assert.rejects(f.run(), new RegExp(reason));
    assert.equal(f.state.created, false);
  });
}

test('unsaved scenes and prefab-editing wrappers cannot be used as the active scene', async (t) => {
  const f = fixture(t);
  f.state.scene = null;
  await assert.rejects(f.run(), /saved scene|SceneAsset/i);
  assert.equal(f.state.created, false);
});

test('scene-not-ready refusal precedes creation', async (t) => {
  const f = fixture(t);
  f.state.ready = false;
  await assert.rejects(f.run(), /ready/i);
  assert.equal(f.state.created, false);
});

for (const outcome of ['error', 'missing-uuid']) {
  test(`uncertain native creation (${outcome}) never falls back or repeats the write`, async (t) => {
    const f = fixture(t);
    if (outcome === 'error') f.state.createError = 'message failed after possible creation';
    else f.state.createdUuid = '';
    await assert.rejects(f.run(), /inspect|hierarchy|UUID/i);
    assert.equal(f.calls.filter((call) => call.method === 'create-node').length, 1);
    assert.equal(f.calls.some((call) => ['instantiatePrefab', 'set-property', 'remove-node'].includes(call.method)), false);
  });
}

for (const prefab of [{ linked: false }, { asset: { uuid: 'wrong-asset' } },
  { rootUuid: 'another-root' }, { fileId: '' }, { instance: {} }]) {
  test(`invalid instance metadata is removed through the editor: ${JSON.stringify(prefab)}`, async (t) => {
    const f = fixture(t);
    f.state.prefab = prefab;
    await assert.rejects(f.run(), /verification.*removed/i);
    assert.equal(f.state.removed, true);
    assert.equal(f.calls.some((call) => call.method === 'set-property'), false);
    assert.equal(f.calls.filter((call) => call.method === 'remove-node').length, 1);
    assert.equal(f.calls.some((call) => call.method === 'query-node'), true);
  });
}

for (const [key, value] of [['createdUuid', 'existing-child'], ['actualParent', 'other-parent'], ['changedScene', 'other-scene']]) {
  test(`a returned node outside the creation scope is neither edited nor removed: ${key}`, async (t) => {
    const f = fixture(t);
    f.state[key] = value;
    await assert.rejects(f.run(), /verification|scope|existing/i);
    assert.equal(f.calls.some((call) => ['set-property', 'remove-node'].includes(call.method)), false);
  });
}

for (const [key, value] of [['propertyResult', false], ['propertyError', 'position rejected'], ['ignorePosition', true]]) {
  test(`local position failure cleans up the new instance: ${key}`, async (t) => {
    const f = fixture(t);
    f.state[key] = value;
    await assert.rejects(f.run(), /removed/i);
    assert.equal(f.state.removed, true);
  });
}

for (const [key, value] of [['cleanupError', 'remove failed'], ['cleanupNoop', true]]) {
  test(`cleanup failure is reported rather than claimed successful: ${key}`, async (t) => {
    const f = fixture(t);
    f.state.propertyError = 'position rejected';
    f.state[key] = value;
    await assert.rejects(f.run(), /cleanup.*failed|cleanup.*not confirmed/i);
    assert.equal(f.state.removed, false);
  });
}

test('inspection failure is not proof of ownership and does not delete an unknown node', async (t) => {
  const f = fixture(t);
  f.state.inspectionError = 'scene disconnected';
  await assert.rejects(f.run(), /scene disconnected/);
  assert.equal(f.calls.some((call) => call.method === 'remove-node'), false);
});
