'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

const copy = value => JSON.parse(JSON.stringify(value));
function serialized() {
  return [
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _parent: null, _children: [{ __id__: 2 }], _components: [{ __id__: 4 }], _prefab: { __id__: 3 },
      _id: 'source-root-id', _active: true, _lpos: { x: 1, y: 2, z: 3 }, _lrot: { x: 0, y: 0, z: 0, w: 1 }, _euler: { x: 0, y: 0, z: 0 }, _lscale: { x: 1, y: 1, z: 1 } },
    { __type__: 'cc.Node', _name: 'Child', _parent: { __id__: 1 }, _children: [], _components: [], _prefab: { __id__: 6 }, _id: 'source-child-id', _lpos: { x: 0, y: 0, z: 0 } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file', instance: null, nestedPrefabInstanceRoots: null, targetOverrides: null },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 5 }, _id: 'source-component-id', _string: 'source text', target: { __id__: 2 }, settings: { _id: 'user-data' } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'child-file', instance: null, nestedPrefabInstanceRoots: null },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-revert-'));
  fs.mkdirSync(path.join(projectPath, 'assets'));
  const file = path.join(projectPath, 'assets', 'Source.prefab');
  fs.writeFileSync(file, JSON.stringify(serialized()));
  fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'asset' }));
  const state = {
    ready: true, reads: 0, previews: 0, writes: 0, result: true,
    asset: { uuid: 'asset', url: 'db://assets/Source.prefab', file, type: 'cc.Prefab', imported: true },
    scene: { uuid: 'scene', type: 'cc.SceneAsset', imported: true },
    before: serialized(), after: serialized(),
    snapshot: {
      sceneUuid: 'scene', node: { uuid: 'root', name: 'Instance', path: 'Canvas/Instance', parentUuid: 'parent' }, linkedAncestor: false,
      nodes: ['root', 'child'].map((uuid, i) => ({ uuid, name: i ? 'RenamedChild' : 'Instance', parentUuid: i ? 'root' : 'parent', childUuids: i ? [] : ['child'], nested: false,
        position: i ? { x: 70, y: 80, z: 90 } : { x: 9, y: 8, z: 7 }, rotation: { x: 0, y: 0, z: 0.5, w: 0.866 }, scale: { x: 2, y: 3, z: 4 }, active: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: `${uuid}-file`, instanceId: i ? '' : 'instance' },
        components: i ? [] : [{ uuid: 'component', type: 'cc.Label', prefab: { fileId: 'component-file' } }],
      })),
    },
  };
  for (const data of [state.before, state.after]) {
    data[0]._name = ''; data[1]._name = 'Instance';
    data[1]._lpos = copy(state.snapshot.nodes[0].position); data[1]._lrot = copy(state.snapshot.nodes[0].rotation); data[1]._euler = { x: 0, y: 0, z: 60 };
    for (const i of [1, 2, 4]) data[i]._id = '';
    delete data[3].instance; delete data[3].nestedPrefabInstanceRoots;
  }
  state.before[1]._active = false; state.before[1]._lscale = { x: 2, y: 3, z: 4 };
  state.before[2]._name = 'RenamedChild'; state.before[2]._lpos = { x: 70, y: 80, z: 90 };
  state.before[4]._string = 'override'; state.before[4].target = { __id__: 1 };
  const previousEditor = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    if (method === 'query-ready' || method === 'query-is-ready') return state.ready;
    if (method === 'query-asset-info') {
      if (state.lookupError) throw new Error('asset query failed');
      return args[0] === 'scene' ? state.scene : args[0] === 'asset' ? state.asset : null;
    }
    if (method === 'query-url') return null;
    assert.equal(channel, 'scene'); assert.deepEqual(args, ['root']);
    if (method === 'getdata-prefab') {
      state.previews += 1;
      if (state.previewError || state.writes && state.afterPreviewError) throw new Error('preview unavailable');
      const value = copy(state.writes ? state.after : state.before);
      if (!state.writes && state.previews > 1 && state.previewChange) state.previewChange(value);
      if (state.writes && state.settleChange && state.previews > 3) state.settleChange(value);
      return state.rawPreview === undefined ? JSON.stringify(value) : state.rawPreview;
    }
    assert.equal(method, 'restore-prefab', 'Only one verified restore message; no guessed messages, save, apply or retry');
    state.writes += 1;
    if (state.writeError) throw new Error('IPC disconnected');
    if (state.afterWrite) state.afterWrite();
    return state.result;
  } } };
  t.after(() => {
    if (previousEditor === undefined) delete global.Editor; else global.Editor = previousEditor;
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
  t.mock.method(global, 'setTimeout', (callback, _delay, ...args) => setImmediate(callback, ...args));
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath, config: { toolProfile: 'full' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {} },
    sceneBridge: { call: async (method, args) => {
      assert.equal(method, 'getPrefabApplyState');
      assert.deepEqual(args, state.reads ? { uuid: 'root' } : state.selectors || { path: 'Canvas/Instance' });
      state.reads += 1;
      if (state.readError || state.writes && state.afterReadError) throw new Error('scene check failed');
      const value = copy(state.snapshot);
      if (state.writes) {
        value.nodes[0].active = true; value.nodes[0].scale = { x: 1, y: 1, z: 1 };
        value.nodes[1].name = 'Child'; value.nodes[1].position = { x: 0, y: 0, z: 0 };
        if (state.afterChange) state.afterChange(value);
      } else if (state.reads > 1 && state.recheckChange) state.recheckChange(value);
      if (state.reads === 2 && state.recheckFile) state.recheckFile();
      return value;
    } },
  });
  return { state, file, run: (args = { path: 'Canvas/Instance' }) => registry.callToolDetailed('revert_prefab_instance', args) };
}

test('revert verifies source values, preserved root placement and stable identities through one native restore', async t => {
  const f = fixture(t); const source = fs.readFileSync(f.file, 'utf8');
  const { value } = await f.run();
  assert.equal(value.ok, true); assert.equal(value.data.reverted, true); assert.equal(value.data.verified, true);
  assert.equal(value.data.method, 'scene:restore-prefab'); assert.equal(value.data.needsSave, true);
  assert.equal(value.data.instanceChanged, true); assert.equal(value.data.sourceUnchanged, true);
  assert.equal(value.data.uuid, 'root'); assert.equal(value.data.path, 'Canvas/Instance');
  assert.equal(value.data.nodeCount, 2); assert.equal(value.data.componentCount, 1);
  assert.equal(value.refs.some(ref => ref.path === '[object Object]'), false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), source); assert.equal(f.state.writes, 1);
});
test('revert accepts multiple matching selectors and reports already restored values', async t => {
  const f = fixture(t); f.state.before = copy(f.state.after);
  f.state.selectors = { uuid: 'root', name: 'Instance' };
  const { value } = await f.run(f.state.selectors);
  assert.equal(value.data.instanceChanged, false); assert.equal(value.data.verified, true); assert.equal(f.state.writes, 1);
});
for (const args of [{}, { uuid: '' }, { name: ' ' }, { path: false }, { uuid: 'root', recursive: true }]) {
  test(`revert rejects invalid selector before any scene call: ${JSON.stringify(args)}`, async t => {
    const f = fixture(t); await assert.rejects(f.run(args), /selector|uuid|name|path|recursive/);
    assert.equal(f.state.writes, 0); assert.equal(f.state.reads, 0);
  });
}
for (const change of [
  s => { s.ready = false; }, s => { s.snapshot.nodes[0].prefab = null; },
  s => { s.snapshot.nodes[0].prefab.rootUuid = 'other'; }, s => { s.snapshot.nodes[0].prefab.instanceId = ''; },
  s => { s.snapshot.linkedAncestor = true; }, s => { s.snapshot.nodes[1].nested = true; },
  s => { s.snapshot.nodes[1].prefab = null; }, s => { s.snapshot.nodes[1].prefab.assetUuid = 'other'; },
  s => { s.scene = null; }, s => { s.scene.type = 'cc.Prefab'; }, s => { s.scene.imported = false; },
  s => { s.readError = true; },
]) {
  test(`revert rejects unsupported instance, scene or shared reference preflight: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /ready|root|nested|ancestor|structure|saved scene|check/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  s => { s.asset.uuid = 'wrong'; }, s => { s.asset.imported = false; }, s => { s.asset.readonly = true; },
  s => { s.asset.type = 'cc.SceneAsset'; }, s => { s.asset.url = 'db://internal/Source.prefab'; },
  s => { s.asset.file = path.join(path.dirname(s.asset.file), 'Wrong.prefab'); },
]) {
  test(`revert rejects unverifiable source identity: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /asset|prefab|file|path/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  data => { data[4].target = { __id__: 999 }; }, data => { data[4].image = { __uuid__: 'missing' }; },
  data => { data[3].instance = { __id__: 5 }; }, data => { data[3].nestedPrefabInstanceRoots = [{ __id__: 2 }]; },
  data => { data[4].images = Array.from({ length: 5001 }, () => ({ __uuid__: 'missing' })); },
]) {
  test(`revert refuses malformed, nested or unresolved source before restore: ${change}`, async t => {
    const f = fixture(t); const data = serialized(); change(data); fs.writeFileSync(f.file, JSON.stringify(data));
    await assert.rejects(f.run(), /metadata|reference|nested|structure/i); assert.equal(f.state.writes, 0);
  });
}
test('revert checks source metadata UUID', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.file}.meta`, JSON.stringify({ uuid: 'other' }));
  await assert.rejects(f.run(), /metadata|UUID/i); assert.equal(f.state.writes, 0);
});
for (const change of [
  s => { s.before[6].fileId = 'new-file'; }, s => { s.before[4].__type__ = 'cc.Sprite'; },
  s => { s.rawPreview = 'not json'; }, s => { s.rawPreview = {}; }, s => { s.previewError = true; },
]) {
  test(`revert refuses structure changes and invalid preview: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /structure|JSON|preview/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  f => { f.state.recheckChange = s => { s.sceneUuid = 'other'; }; },
  f => { f.state.previewChange = data => { data[4]._string = 'concurrent'; }; },
  f => { f.state.recheckFile = () => fs.appendFileSync(f.file, ' '); },
]) {
  test(`revert refuses concurrent preflight changes: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /changed|preflight/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  f => { f.state.result = false; }, f => { f.state.writeError = true; },
  f => { f.state.after = copy(f.state.before); }, f => { f.state.after[4]._string = 'wrong'; },
  f => { f.state.after[4].target = null; }, f => { f.state.after[4].settings._id = 'changed-user-data'; },
  f => { f.state.after[3].targetOverrides = [{ extra: true }]; },
  f => { f.state.afterChange = s => { s.nodes[0].position.x = 0; }; },
  f => { f.state.afterChange = s => { s.nodes[0].rotation.w = 1; }; },
  f => { f.state.afterChange = s => { s.node.name = 'renamed'; }; },
  f => { f.state.afterChange = s => { s.nodes[1].uuid = 'replacement'; }; },
  f => { f.state.afterChange = s => { s.nodes[0].components[0].uuid = 'replacement'; }; },
  f => { f.state.afterChange = s => { s.nodes[0].prefab.instanceId = 'replacement'; }; },
  f => { f.state.afterReadError = true; }, f => { f.state.afterPreviewError = true; },
  f => { f.state.afterWrite = () => fs.appendFileSync(f.file, ' '); },
  f => { f.state.afterWrite = () => fs.appendFileSync(`${f.file}.meta`, ' '); },
  f => { f.state.settleChange = data => { data[4]._string = 'late-change'; }; },
]) {
  test(`revert never retries or reports success after an uncertain result: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /may already.*inspect|inspect.*retry/i); assert.equal(f.state.writes, 1);
  });
}
test('revert accepts only the observed empty metadata normalization', async t => {
  const f = fixture(t); f.state.after[3].targetOverrides = [];
  assert.equal((await f.run()).value.data.verified, true);
});

test('revert preserves root placement using the preview root pointer, not the source object index', async t => {
  const f = fixture(t);
  const remap = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, '__id__')) value.__id__ = value.__id__ === 1 ? 2 : value.__id__ === 2 ? 1 : value.__id__;
    for (const child of Object.values(value)) remap(child);
  };
  remap(f.state.before);
  [f.state.before[1], f.state.before[2]] = [f.state.before[2], f.state.before[1]];
  assert.equal((await f.run()).value.data.verified, true);
});
