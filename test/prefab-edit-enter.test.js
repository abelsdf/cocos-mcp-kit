'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

const copy = value => JSON.parse(JSON.stringify(value));
function prefab() {
  return [
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _parent: null, _children: [], _components: [{ __id__: 3 }], _prefab: { __id__: 2 }, _id: 'source-node', _lpos: { x: 1, y: 2, z: 3 } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file', instance: null, nestedPrefabInstanceRoots: null, targetOverrides: null },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 4 }, _id: 'source-component', _string: 'source text', custom: { _id: 'user-value' } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-enter-'));
  fs.mkdirSync(path.join(projectPath, 'assets'));
  const file = path.join(projectPath, 'assets', 'Source.prefab');
  const sceneFile = path.join(projectPath, 'assets', 'Origin.scene');
  const scene = [{ __type__: 'cc.SceneAsset', _name: 'Origin', scene: { __id__: 1 } }, { __type__: 'cc.Scene', _name: 'Origin', _id: 'scene', _children: [], _parent: null }];
  fs.writeFileSync(file, JSON.stringify(prefab())); fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'asset' }));
  fs.writeFileSync(sceneFile, JSON.stringify(scene)); fs.writeFileSync(`${sceneFile}.meta`, JSON.stringify({ uuid: 'scene' }));
  const state = {
    asset: { uuid: 'asset', url: 'db://assets/Source.prefab', type: 'cc.Prefab', imported: true, file },
    scene: { uuid: 'scene', url: 'db://assets/Origin.scene', type: 'cc.SceneAsset', imported: true, file: sceneFile },
    mode: 'general', current: 'scene', dirty: false, ready: true, multi: false, opens: 0, contexts: 0, rootReads: 0,
    sceneJson: copy(scene), preview: prefab(),
    root: { sceneUuid: 'edit-scene', linkedAncestor: false,
      node: { uuid: 'root', name: 'Source', path: 'Wrapper/Source', parentUuid: 'wrapper' },
      nodes: [{ uuid: 'root', name: 'Source', parentUuid: 'wrapper', childUuids: [], nested: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: 'root-file', instanceId: '' },
        components: [{ uuid: 'component', type: 'cc.Label', prefab: { fileId: 'component-file' } }] }],
    },
  };
  state.sceneJson[0]._name = ''; state.preview[0]._name = ''; state.preview[1]._id = ''; state.preview[3]._id = '';
  delete state.preview[2].instance; delete state.preview[2].nestedPrefabInstanceRoots;
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    if (method === 'query-ready') return state.ready;
    if (method === 'query-asset-info') {
      if (state.lookupError) throw new Error('asset lookup failed');
      if (['asset','db://assets/Source.prefab'].includes(args[0]) || state.alias) return state.asset;
      if (['scene','db://assets/Origin.scene'].includes(args[0])) return state.scene;
      return null;
    }
    if (method === 'query-url') return null;
    if (method === 'open-asset') {
      assert.equal(channel, 'asset-db'); assert.deepEqual(args, ['asset']); state.opens += 1;
      if (!state.noOpen) { state.mode = 'prefab'; state.current = 'asset'; }
      if (state.afterOpen) state.afterOpen();
      if (state.openError) throw new Error('open IPC disconnected');
      return state.openResult;
    }
    assert.equal(channel, 'scene', 'No save, close, discard, alternate open or direct-write fallback');
    if (method === 'query-is-ready') return state.ready;
    if (method === 'query-scene-mode') {
      state.contexts += 1;
      if (!state.opens && state.contexts === 2 && state.recheckChange) state.recheckChange();
      return state.mode;
    }
    if (method === 'query-current-scene') return state.current;
    if (method === 'query-dirty') return state.dirty;
    if (method === 'multi-is-multi-edit-mode') return state.multi;
    if (method === 'multi-scene-query') return state.tabs || [{ uuid: state.current, type: state.mode === 'prefab' ? 'prefab' : 'scene', dirty: state.dirty, url: state.mode === 'prefab' ? state.asset.url : state.scene?.url }];
    if (method === 'query-scene-json') return state.rawScene === undefined ? JSON.stringify(state.sceneJson) : state.rawScene;
    if (method === 'getdata-prefab') {
      assert.deepEqual(args, ['root']);
      if (state.previewError) throw new Error('prefab preview unavailable');
      const value = copy(state.preview);
      if (state.rootReads > 1 && state.latePreview) state.latePreview(value);
      return JSON.stringify(value);
    }
    throw new Error(`Unexpected native request: ${method}`);
  } } };
  t.after(() => { if (previous === undefined) delete global.Editor; else global.Editor = previous; fs.rmSync(projectPath, { recursive: true, force: true }); });
  t.mock.method(global, 'setTimeout', (callback, _delay, ...args) => setImmediate(callback, ...args));
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath, config: { toolProfile: 'full' } }), interactionLog: { add() {} }, runtimeLog: { add() {} },
    sceneBridge: { call: async (method, args) => {
      assert.equal(method, 'getPrefabEditingState'); assert.deepEqual(args, { prefabUuid: 'asset' }); state.rootReads += 1;
      if (state.rootError) throw new Error('prefab edit root missing');
      const value = copy(state.root); if (state.rootReads > 1 && state.lateRoot) state.lateRoot(value); return value;
    } },
  });
  return { state, file, sceneFile, registry, run: (args = { target: 'assets/Source.prefab' }) => registry.callToolDetailed('enter_prefab_edit_mode', args) };
}

test('edit entry opens once and verifies native mode, root content, source and origin scene without saving', async t => {
  const f = fixture(t); const before = fs.readFileSync(f.file, 'utf8');
  const { value } = await f.run();
  assert.equal(value.data.entered, true); assert.equal(value.data.verified, true); assert.equal(value.data.alreadyOpen, false);
  assert.equal(value.data.mode, 'prefab'); assert.equal(value.data.prefabUuid, 'asset'); assert.equal(value.data.node.uuid, 'root');
  assert.equal(value.data.needsSave, false); assert.equal(value.data.previousScene.uuid, 'scene');
  assert.equal(value.data.nodeCount, 1); assert.equal(value.data.componentCount, 1);
  assert.equal(f.state.opens, 1); assert.equal(f.state.rootReads, 2); assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});
test('edit entry is a full-only idempotent mode-changing tool', t => {
  const f = fixture(t); const tool = f.registry.listTools().find(tool => tool.name === 'enter_prefab_edit_mode');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.idempotentHint, true);
});
for (const target of ['asset','db://assets/Source.prefab']) {
  test(`edit entry accepts exact ${target}`, async t => { const f = fixture(t); assert.equal((await f.run({target})).value.data.verified, true); });
}

test('edit entry converts a contained absolute source file to its exact db URL', async t => {
  const f = fixture(t); assert.equal((await f.run({ target: f.file })).value.data.verified, true);
});

test('edit entry refuses an absolute path outside the project before opening', async t => {
  const f = fixture(t); const outside = path.resolve(path.dirname(f.file), '../..', 'Outside.prefab');
  await assert.rejects(f.run({ target: outside }), /outside.*project/i); assert.equal(f.state.opens, 0);
});
test('entering the same clean prefab verifies without another open', async t => {
  const f = fixture(t); f.state.mode = 'prefab'; f.state.current = 'asset';
  const { value } = await f.run(); assert.equal(value.data.alreadyOpen, true); assert.equal(value.data.previousScene, null); assert.equal(f.state.opens, 0);
});
for (const args of [{}, { target: '' }, { target: false }, { target: 'asset', force: true }, { target: 'asset', save: true }]) {
  test(`edit entry refuses invalid options: ${JSON.stringify(args)}`, async t => {
    const f = fixture(t); await assert.rejects(f.run(args), /target|option|force|save/); assert.equal(f.state.opens, 0); assert.equal(f.state.contexts, 0);
  });
}
for (const change of [
  s=>{s.ready=false;}, s=>{s.mode='animation';}, s=>{s.dirty=true;}, s=>{s.dirty=undefined;}, s=>{s.multi=true;},
  s=>{s.tabs=[];}, s=>{s.tabs=[{},{}];}, s=>{s.tabs=[{uuid:'other',dirty:false,type:'scene'}];},
  s=>{s.tabs=[null];}, s=>{s.tabs=[{uuid:'scene',dirty:false,type:'scene'}];},
  s=>{s.mode='prefab';s.current='another-prefab';}, s=>{s.mode='prefab';s.current='asset';s.dirty=true;},
]) {
  test(`edit entry refuses unsupported or dirty editor context: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /ready|mode|dirty|saved|scene|prefab|tab/i); assert.equal(f.state.opens, 0);
  });
}
for (const change of [
  s=>{s.asset.uuid='replacement';}, s=>{s.asset.readonly=true;}, s=>{s.asset.imported=false;}, s=>{s.asset.invalid=true;},
  s=>{s.asset.type='cc.SceneAsset';}, s=>{s.asset.url='db://internal/Source.prefab';}, s=>{s.asset.file=path.join(path.dirname(s.asset.file),'Wrong.prefab');},
  s=>{s.scene=null;}, s=>{s.scene.type='cc.Prefab';}, s=>{s.scene.imported=false;}, s=>{s.scene.url='db://assets/../Origin.scene';},
]) {
  test(`edit entry rejects invalid source or original scene identity: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /asset|source|prefab|scene|file|path|UUID|identity/i); assert.equal(f.state.opens, 0);
  });
}
test('edit entry never accepts a guessed extension or alternate target', async t => {
  const f = fixture(t); f.state.alias = true; await assert.rejects(f.run({ target: 'db://assets/Source' }), /exact|target/i); assert.equal(f.state.opens, 0);
});
for (const which of ['file','sceneFile']) {
  test(`edit entry checks the ${which} metadata UUID`, async t => {
    const f = fixture(t); fs.writeFileSync(`${f[which]}.meta`, JSON.stringify({uuid:'wrong'}));
    await assert.rejects(f.run(), /metadata|UUID/i); assert.equal(f.state.opens, 0);
  });
}
for (const change of [
  f=>{f.state.sceneJson[1]._name='Unsaved rename';}, f=>{f.state.rawScene='not json';},
  f=>{f.state.sceneJson[1]._id='wrong-scene';}, f=>{f.state.rawScene={};},
  f=>{const data=prefab();data[3].asset={__uuid__:'missing'};fs.writeFileSync(f.file,JSON.stringify(data));},
  f=>{const data=prefab();data[2].instance={__id__:4};fs.writeFileSync(f.file,JSON.stringify(data));},
]) {
  test(`edit entry refuses unsaved serialization or unsupported prefab before opening: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /JSON|serializ|scene|reference|nested|prefab/i); assert.equal(f.state.opens, 0);
  });
}
for (const change of [
  f=>{f.state.recheckChange=()=>{f.state.dirty=true;};}, f=>{f.state.recheckChange=()=>{f.state.current='other';};},
  f=>{f.state.recheckChange=()=>{f.state.sceneJson[1]._name='concurrent';};},
  f=>{f.state.recheckChange=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.recheckChange=()=>fs.appendFileSync(f.sceneFile,' ');},
]) {
  test(`edit entry detects concurrent preflight changes: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /changed|dirty|scene|context|preflight/i); assert.equal(f.state.opens, 0);
  });
}
for (const change of [
  f=>{f.state.noOpen=true;}, f=>{f.state.openError=true;}, f=>{f.state.rootError=true;}, f=>{f.state.previewError=true;},
  f=>{f.state.root.nodes[0].prefab.assetUuid='other';}, f=>{f.state.root.nodes[0].prefab.instanceId='instance';},
  f=>{f.state.preview[3]._string='wrong';}, f=>{f.state.preview[3].custom._id='wrong-user-value';},
  f=>{f.state.afterOpen=()=>{f.state.dirty=true;};}, f=>{f.state.afterOpen=()=>{f.state.current='other';};},
  f=>{f.state.afterOpen=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.afterOpen=()=>fs.appendFileSync(f.sceneFile,' ');},
  f=>{f.state.afterOpen=()=>{f.state.sceneJson[1]._name='lost original';};},
  f=>{f.state.latePreview=data=>{data[3]._string='late';};}, f=>{f.state.lateRoot=data=>{data.node.uuid='replacement';};},
]) {
  test(`edit entry reports uncertain state without save, close or retry: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /may already|inspect.*retry/i); assert.equal(f.state.opens, 1);
  });
}
test('already open prefab with untracked property changes is refused without reopening', async t => {
  const f = fixture(t); f.state.mode='prefab'; f.state.current='asset'; f.state.preview[3]._string='unsaved';
  await assert.rejects(f.run(), /serializ|source|content|properties/i); assert.equal(f.state.opens, 0);
});

test('edit verification accepts an omitted empty PrefabInfo targetOverrides after native undo', async t => {
  const f = fixture(t); f.state.mode = 'prefab'; f.state.current = 'asset';
  delete f.state.preview[2].targetOverrides;
  assert.equal((await f.run()).value.data.alreadyOpen, true); assert.equal(f.state.opens, 0);
});

test('edit verification does not normalize similarly named user fields', async t => {
  const f = fixture(t); f.state.preview[3].custom.targetOverrides = null;
  await assert.rejects(f.run(), /may already|content|source/i); assert.equal(f.state.opens, 1);
});
