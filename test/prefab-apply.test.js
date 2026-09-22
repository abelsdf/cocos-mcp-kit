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
    { __type__: 'cc.Node', _name: 'Source', _parent: null, _children: [{ __id__: 2 }], _components: [{ __id__: 4 }], _prefab: { __id__: 3 } },
    { __type__: 'cc.Node', _name: 'Child', _parent: { __id__: 1 }, _children: [], _components: [], _prefab: { __id__: 6 } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file' },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 5 }, _string: 'old' },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'child-file' },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-apply-'));
  fs.mkdirSync(path.join(projectPath, 'assets'));
  const file = path.join(projectPath, 'assets', 'Source.prefab');
  fs.writeFileSync(file, JSON.stringify(serialized()));
  fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'asset' }));
  const state = {
    ready: true, reads: 0, previews: 0, writes: 0, result: false,
    asset: { uuid: 'asset', url: 'db://assets/Source.prefab', file, type: 'cc.Prefab', imported: true, readonly: false },
    scene: { uuid: 'scene', type: 'cc.SceneAsset', imported: true },
    preview: serialized(),
    snapshot: {
      sceneUuid: 'scene', node: { uuid: 'root', name: 'Instance', path: 'Canvas/Instance', parentUuid: 'parent' },
      linkedAncestor: false,
      nodes: ['root', 'child'].map((uuid, index) => ({ uuid, name: index ? 'Child' : 'Instance', nested: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: `${uuid}-file`, instanceId: index ? '' : 'instance' },
        components: index ? [] : [{ uuid: 'component', type: 'cc.Label', prefab: { fileId: 'component-file' } }],
      })),
    },
  };
  state.preview[0]._name = '';
  state.preview[1]._name = 'Instance';
  state.preview[4]._string = 'new';
  const previousEditor = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    if (method === 'query-ready' || method === 'query-is-ready') return state.ready;
    if (method === 'query-asset-info') {
      if (state.lookupError) throw new Error('asset query failed');
      if (args[0] === 'scene') return state.scene;
      if (args[0] === 'asset' || args[0] === state.asset.url) return state.asset;
      return null;
    }
    if (method === 'query-url') return null;
    assert.equal(channel, 'scene');
    assert.deepEqual(args, ['root']);
    if (method === 'getdata-prefab') {
      state.previews += 1;
      if (state.previewError) throw new Error('preview unavailable');
      const value = copy(state.preview);
      if (state.previews > 1 && state.previewChange) state.previewChange(value);
      return state.rawPreview === undefined ? JSON.stringify(value) : state.rawPreview;
    }
    assert.equal(method, 'apply-prefab', 'No save, revert, retry or disk-write fallback is allowed');
    state.writes += 1;
    if (state.writeError) throw new Error('IPC disconnected');
    if (!state.noWrite) {
      const value = copy(state.preview);
      value[0]._name = value[1]._name = 'Source';
      if (state.savedChange) state.savedChange(value);
      fs.writeFileSync(file, JSON.stringify(value));
    }
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
      state.reads += 1;
      if (state.readError || state.writes && state.afterReadError) throw new Error('scene check failed');
      const result = copy(state.snapshot);
      if (state.reads > 1 && !state.writes && state.recheckChange) state.recheckChange(result);
      if (state.writes && state.afterChange) state.afterChange(result);
      if (state.reads === 2 && state.recheckFile) state.recheckFile();
      return result;
    } },
  });
  return { state, file, projectPath, run: (args = { path: 'Canvas/Instance' }) => registry.callToolDetailed('apply_prefab_instance', args) };
}

test('apply verifies disk and identity even when native result is false, without renaming the asset', async t => {
  const f = fixture(t);
  const { value } = await f.run({ uuid: 'root', path: 'Canvas/Instance' });
  assert.equal(value.ok, true);
  assert.equal(value.data.applied, true);
  assert.equal(value.data.verified, true);
  assert.equal(value.data.needsSave, true);
  assert.equal(value.data.result, false);
  assert.equal(value.data.prefabUuid, 'asset');
  assert.equal(value.data.path, 'Canvas/Instance');
  assert.equal(value.refs.some(ref => ref.path === '[object Object]'), false);
  assert.equal(value.data.sourceChanged, true);
  assert.equal(f.state.writes, 1);
  const saved = JSON.parse(fs.readFileSync(f.file));
  assert.equal(saved[1]._name, 'Source');
  assert.equal(saved[4]._string, 'new');
});

for (const args of [{}, { uuid: '' }, { name: ' ' }, { path: false }, { uuid: 'root', recursive: true }]) {
  test(`apply refuses invalid selector before writes: ${JSON.stringify(args)}`, async t => {
    const f = fixture(t);
    await assert.rejects(f.run(args), /selector|uuid|name|path|recursive/);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.reads, 0);
  });
}
for (const change of [
  s => { s.snapshot.nodes[0].prefab = null; },
  s => { s.snapshot.nodes[0].prefab.rootUuid = 'other'; },
  s => { s.snapshot.nodes[0].prefab.instanceId = ''; },
  s => { s.snapshot.linkedAncestor = true; },
  s => { s.snapshot.nodes[1].nested = true; },
  s => { s.snapshot.nodes[1].prefab.rootUuid = 'other'; },
  s => { s.scene = null; },
  s => { s.scene.type = 'cc.Prefab'; },
  s => { s.scene.imported = false; },
  s => { s.ready = false; },
]) {
  test(`apply refuses invalid instance or scene state: ${change}`, async t => {
    const f = fixture(t); change(f.state);
    await assert.rejects(f.run(), /root|nested|ancestor|saved scene|ready/i);
    assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  s => { s.asset.uuid = 'replacement'; },
  s => { s.asset.readonly = true; },
  s => { s.asset.imported = false; },
  s => { s.asset.invalid = true; },
  s => { s.asset.type = 'cc.SceneAsset'; },
  s => { s.asset.url = 'db://internal/Source.prefab'; },
  s => { s.asset.url = 'db://assets/../Source.prefab'; },
  s => { s.asset.file = path.join(path.dirname(s.asset.file), 'Wrong.prefab'); },
]) {
  test(`apply refuses invalid source asset identity: ${change}`, async t => {
    const f = fixture(t); change(f.state);
    await assert.rejects(f.run(), /asset|prefab|file|path|project/i);
    assert.equal(f.state.writes, 0);
  });
}
test('apply checks metadata UUID before the native write', async t => {
  const f = fixture(t);
  fs.writeFileSync(`${f.file}.meta`, JSON.stringify({ uuid: 'different' }));
  await assert.rejects(f.run(), /metadata|UUID/i);
  assert.equal(f.state.writes, 0);
});
for (const change of [
  s => { s.rawPreview = 'invalid json'; },
  s => { s.rawPreview = {}; },
  s => { s.preview[4].node = { __id__: 99 }; },
  s => { s.preview[6].fileId = 'new-child-identity'; },
  s => { s.preview[4]._spriteFrame = { __uuid__: 'missing' }; },
  s => { s.preview[4].assets = Array.from({ length: 5001 }, () => ({ __uuid__: 'missing' })); },
]) {
  test(`apply refuses malformed, changed-structure or unresolved preview: ${change}`, async t => {
    const f = fixture(t); change(f.state);
    await assert.rejects(f.run(), /JSON|serializ|preview|metadata|structure|reference/i);
    assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  f => { f.state.recheckChange = s => { s.sceneUuid = 'other'; }; },
  f => { f.state.previewChange = s => { s[4]._string = 'concurrent'; }; },
  f => { f.state.recheckFile = () => fs.appendFileSync(f.file, ' '); },
]) {
  test(`apply rechecks scene, payload and source against concurrent edits: ${change}`, async t => {
    const f = fixture(t); change(f);
    await assert.rejects(f.run(), /changed|preflight|before/i);
    assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  s => { s.noWrite = true; s.result = true; },
  s => { s.savedChange = value => { value[4]._string = 'wrong'; }; },
  s => { s.afterChange = value => { value.nodes[0].prefab.assetUuid = 'wrong'; }; },
  s => { s.afterReadError = true; },
  s => { s.writeError = true; },
  s => { s.afterWrite = () => { s.asset.uuid = 'changed'; }; },
]) {
  test(`apply does not report success for a partial or uncertain write: ${change}`, async t => {
    const f = fixture(t); change(f.state);
    await assert.rejects(f.run(), /inspect.*retry|may already|not confirm/i);
    assert.equal(f.state.writes, 1);
  });
}
test('apply detects an already matching source without requiring a file hash change', async t => {
  const f = fixture(t);
  const content = copy(f.state.preview);
  content[0]._name = content[1]._name = 'Source';
  fs.writeFileSync(f.file, JSON.stringify(content));
  const { value } = await f.run();
  assert.equal(value.data.sourceChanged, false);
  assert.equal(value.data.verified, true);
  assert.equal(f.state.writes, 1);
});

test('apply accepts native empty targetOverrides normalization without changing component data', async t => {
  const f = fixture(t);
  f.state.preview[3].targetOverrides = null;
  f.state.savedChange = value => { value[3].targetOverrides = []; };
  const { value } = await f.run();
  assert.equal(value.data.verified, true);
  assert.equal(f.state.writes, 1);
});

for (const savedChange of [
  value => { value[3].targetOverrides = [{ unexpected: true }]; },
  value => { value[4].userValue = []; },
]) {
  test(`apply preserves nonempty overrides and user null/array distinctions: ${savedChange}`, async t => {
    const f = fixture(t);
    f.state.preview[3].targetOverrides = null;
    f.state.preview[4].userValue = null;
    f.state.savedChange = savedChange;
    await assert.rejects(f.run(), /not confirmed.*inspect/i);
    assert.equal(f.state.writes, 1);
  });
}
