'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

const copy = value => JSON.parse(JSON.stringify(value));
function snapshot() {
  const nodes = ['root', 'child', 'nested', 'nested-child'].map((uuid, index) => ({
    uuid, name: uuid, parentUuid: ['parent', 'root', 'root', 'nested'][index],
    childUuids: index === 0 ? ['child', 'nested'] : index === 2 ? ['nested-child'] : [],
    active: true, layer: 33554432, position: { x: index, y: -2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
    nested: false,
    prefab: { rootUuid: 'root', assetUuid: 'outer-asset',
      fileId: `${uuid}-file`, instanceId: index === 0 ? 'root-instance' : '' },
    components: [{ uuid: `${uuid}-component`, type: 'cc.Sprite', prefab: { fileId: `${uuid}-component-file` } }],
  }));
  return { sceneUuid: 'scene', node: { uuid: 'root', name: 'root', path: 'Canvas/root', parentUuid: 'parent' }, linkedAncestor: false, nodes };
}

function fixture(t) {
  const state = { before: snapshot(), result: true, writes: 0, reads: 0, ready: true,
    sceneInfo: { uuid: 'scene', type: 'cc.SceneAsset', imported: true } };
  const calls = [];
  const previousEditor = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    calls.push({ channel, method, args });
    if (method === 'query-ready' || method === 'query-is-ready') return state.ready;
    if (method === 'query-asset-info') return state.sceneInfo;
    assert.equal(channel, 'scene');
    assert.equal(method, 'unlink-prefab', 'No manual metadata, relink or retry fallback is permitted');
    assert.deepEqual(args, ['root']);
    state.writes += 1;
    if (state.writeError) throw new Error(state.writeError);
    state.after = copy(state.before);
    for (const node of state.after.nodes) {
      node.prefab = null;
      for (const component of node.components) component.prefab = null;
    }
    if (state.afterChange) state.afterChange(state.after);
    return state.result;
  } } };
  t.after(() => { if (previousEditor === undefined) delete global.Editor; else global.Editor = previousEditor; });
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath: process.cwd(), config: { toolProfile: 'full' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {} },
    sceneBridge: { call: async (method, args) => {
      assert.equal(method, 'getPrefabUnlinkState');
      calls.push({ channel: 'bridge', method, args });
      state.reads += 1;
      if (state.readError || state.writes && state.afterReadError) throw new Error(state.readError || state.afterReadError);
      const value = copy(state.writes ? state.after : state.before);
      if (state.reads === 2 && state.recheckChange) state.recheckChange(value);
      return value;
    } },
  });
  return { state, calls, registry, run: (args = { path: 'Canvas/root' }) => registry.callToolDetailed('unlink_prefab_instance', args) };
}

test('unlink is a full-profile tool and verifies one native unlink without replacing the hierarchy', async (t) => {
  const f = fixture(t);
  const tool = f.registry.listTools().find(tool => tool.name === 'unlink_prefab_instance');
  assert.ok(tool);
  assert.ok(tool.inputSchema.properties.uuid);
  const { value } = await f.run({ path: 'Canvas/root', uuid: 'root' });
  assert.equal(value.ok, true);
  assert.equal(value.data.unlinked, true);
  assert.equal(value.data.verified, true);
  assert.equal(value.data.needsSave, true);
  assert.equal(value.data.method, 'scene:unlink-prefab');
  assert.equal(value.data.prefabUuid, 'outer-asset');
  assert.equal(value.data.node.uuid, 'root');
  assert.equal(value.data.nodeCount, 4);
  assert.equal(value.data.componentCount, 4);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.reads, 3);
});

for (const args of [{}, { uuid: '' }, { name: ' ' }, { path: 2 }, { uuid: false }, { path: 'Canvas/root', recursive: true }]) {
  test(`unlink rejects invalid selectors before querying or writing: ${JSON.stringify(args)}`, async (t) => {
    const f = fixture(t);
    await assert.rejects(f.run(args), /selector|uuid|path|name|recursive/);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.reads, 0);
  });
}

for (const change of [
  before => { before.nodes[0].prefab = null; },
  before => { before.nodes[0].prefab.rootUuid = 'ancestor'; },
  before => { before.nodes[0].prefab.instanceId = ''; },
  before => { before.nodes[0].prefab.assetUuid = ''; },
  before => { before.linkedAncestor = true; },
  before => { before.nodes[2].nested = true; before.nodes[2].prefab.rootUuid = 'nested'; },
  before => { before.nodes[1].prefab.rootUuid = 'unknown-root'; },
]) {
  test(`unlink refuses non-root, malformed or still-nested targets (${change.toString()})`, async (t) => {
    const f = fixture(t);
    change(f.state.before);
    await assert.rejects(f.run(), /linked.*root|ancestor|nested/i);
    assert.equal(f.state.writes, 0);
  });
}

for (const sceneInfo of [null, { uuid: 'scene', type: 'cc.Prefab', imported: true },
  { uuid: 'other', type: 'cc.SceneAsset', imported: true }, { uuid: 'scene', type: 'cc.SceneAsset', imported: false }]) {
  test(`unlink refuses an unsaved or wrong scene context: ${JSON.stringify(sceneInfo)}`, async (t) => {
    const f = fixture(t);
    f.state.sceneInfo = sceneInfo;
    await assert.rejects(f.run(), /saved scene/);
    assert.equal(f.state.writes, 0);
  });
}

test('unlink refuses unready editor services without taking a snapshot', async (t) => {
  const f = fixture(t);
  f.state.ready = false;
  await assert.rejects(f.run(), /ready/);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.reads, 0);
});

for (const recheckChange of [s => { s.sceneUuid = 'changed'; }, s => { s.nodes[0].position.x = 9; },
  s => { s.nodes[2].prefab.instanceId = 'changed'; }]) {
  test(`unlink rechecks its exact context before writing (${recheckChange.toString()})`, async (t) => {
    const f = fixture(t);
    f.state.recheckChange = recheckChange;
    await assert.rejects(f.run(), /changed.*before|before.*changed/i);
    assert.equal(f.state.writes, 0);
  });
}

for (const result of [false, undefined, null, {}]) {
  test(`unlink does not equate an unconfirmed native result with success: ${String(result)}`, async (t) => {
    const f = fixture(t);
    f.state.result = result;
    await assert.rejects(f.run(), /not confirm|unconfirmed/i);
    assert.equal(f.state.writes, 1);
  });
}

test('unlink errors after a possible write never trigger a retry, relink or deletion', async (t) => {
  const f = fixture(t);
  f.state.writeError = 'IPC disconnected';
  await assert.rejects(f.run(), /IPC disconnected.*inspect/i);
  assert.equal(f.state.writes, 1);
});

for (const afterChange of [
  s => { s.nodes[0].prefab = snapshot().nodes[0].prefab; },
  s => { s.nodes[1].components[0].prefab = { fileId: 'leftover' }; },
  s => { s.nodes[2].prefab = snapshot().nodes[2].prefab; },
  s => { s.nodes[0].position.x = 10; },
  s => { s.nodes[1].components[0].uuid = 'replaced'; },
  s => { s.nodes.pop(); },
  s => { s.sceneUuid = 'other'; },
]) {
  test(`unlink verifies metadata removal and unchanged structure (${afterChange.toString()})`, async (t) => {
    const f = fixture(t);
    f.state.afterChange = afterChange;
    await assert.rejects(f.run(), /verification.*inspect/i);
    assert.equal(f.state.writes, 1);
  });
}

test('failed post-unlink inspection reports uncertainty instead of claiming success', async (t) => {
  const f = fixture(t);
  f.state.afterReadError = 'scene unavailable';
  await assert.rejects(f.run(), /scene unavailable.*inspect/i);
  assert.equal(f.state.writes, 1);
});

test('missing or ambiguous scene targets are rejected before the native write', async (t) => {
  const f = fixture(t);
  f.state.readError = 'Node selector matched 2 nodes';
  await assert.rejects(f.run(), /matched 2/);
  assert.equal(f.state.writes, 0);
});
