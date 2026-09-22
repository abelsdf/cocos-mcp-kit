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
    { __type__: 'cc.Node', _name: 'Source', _parent: null, _children: [], _components: [{ __id__: 3 }], _prefab: { __id__: 2 }, _id: 'source-node' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file', instance: null, targetOverrides: null },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 4 }, _id: 'source-component', _string: 'saved', user: { _id: 'keep' } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-exit-'));
  fs.mkdirSync(path.join(projectPath, 'assets'));
  const file = path.join(projectPath, 'assets', 'Source.prefab');
  const sceneFile = path.join(projectPath, 'assets', 'Origin.scene');
  const scene = [{ __type__: 'cc.SceneAsset', _name: 'Origin', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _name: 'Origin', _id: 'origin', _children: [], _parent: null }];
  fs.writeFileSync(file, JSON.stringify(prefab())); fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'asset' }));
  fs.writeFileSync(sceneFile, JSON.stringify(scene)); fs.writeFileSync(`${sceneFile}.meta`, JSON.stringify({ uuid: 'origin' }));
  const state = {
    asset: { uuid: 'asset', url: 'db://assets/Source.prefab', type: 'cc.Prefab', imported: true, file },
    scene: { uuid: 'origin', url: 'db://assets/Origin.scene', type: 'cc.SceneAsset', imported: true, file: sceneFile },
    mode: 'prefab', current: 'asset', dirty: false, ready: true, multi: false, closes: 0, contexts: 0, roots: 0,
    postContexts: 0, postSourceReads: 0, sceneReads: 0, result: true, sceneJson: copy(scene), preview: prefab(),
    root: { sceneUuid: 'edit-scene', linkedAncestor: false,
      node: { uuid: 'root', name: 'Source', path: 'Wrapper/Source', parentUuid: 'wrapper' },
      nodes: [{ uuid: 'root', name: 'Source', parentUuid: 'wrapper', childUuids: [], nested: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: 'root-file', instanceId: '' },
        components: [{ uuid: 'component', type: 'cc.Label', prefab: { fileId: 'component-file' } }] }],
    },
  };
  state.sceneJson[0]._name = ''; state.preview[0]._name = ''; state.preview[1]._id = ''; state.preview[3]._id = '';
  delete state.preview[2].instance; delete state.preview[2].targetOverrides;
  const previous = global.Editor;
  const finish = () => { state.mode = 'general'; state.current = 'origin'; };
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    if (method === 'query-ready') return state.assetReady !== false;
    if (method === 'query-asset-info') {
      if (state.lookupError) throw new Error('asset lookup failed');
      if (args[0] === 'asset') {
        if (state.closes && ++state.postSourceReads === 2 && state.lateChange) state.lateChange();
        return state.asset;
      }
      if (args[0] === 'origin') return state.scene;
      return null;
    }
    if (method === 'query-url') return null;
    assert.equal(channel, 'scene');
    if (method === 'query-is-ready') return state.ready;
    if (method === 'query-scene-mode') {
      state.contexts += 1;
      if (!state.closes && state.contexts === 2 && state.preflight) state.preflight();
      if (state.closes && ++state.postContexts === state.delayedClose) finish();
      return state.mode;
    }
    if (method === 'query-current-scene') return state.current;
    if (method === 'query-dirty') return state.dirty;
    if (method === 'multi-is-multi-edit-mode') return state.multi;
    if (method === 'multi-scene-query') return state.tabs || [{ uuid: state.current, type: state.mode === 'prefab' ? 'prefab' : 'scene',
      url: state.mode === 'prefab' ? state.asset?.url : state.scene?.url, dirty: state.dirty }];
    if (method === 'query-scene-json') {
      state.sceneReads += 1;
      return state.rawScene === undefined ? JSON.stringify(state.sceneJson) : state.rawScene;
    }
    if (method === 'getdata-prefab') {
      assert.deepEqual(args, ['root']);
      if (state.previewError) throw new Error('prefab preview unavailable');
      const value = copy(state.preview); if (state.roots > 1 && state.latePreview) state.latePreview(value);
      return state.rawPreview === undefined ? JSON.stringify(value) : state.rawPreview;
    }
    assert.equal(method, 'close-scene', 'No save, discard, alternate open, snapshot or repeated close is allowed');
    assert.deepEqual(args, []); state.closes += 1;
    if (!state.noClose && !state.delayedClose) finish();
    if (state.afterClose) state.afterClose();
    if (state.closeError) throw new Error('close IPC disconnected');
    return state.result;
  } } };
  t.after(() => { if (previous === undefined) delete global.Editor; else global.Editor = previous; fs.rmSync(projectPath, { recursive: true, force: true }); });
  t.mock.method(global, 'setTimeout', (callback, _delay, ...args) => setImmediate(callback, ...args));
  const registry = createToolRegistry({ getRuntimeContext: () => ({ projectPath, config: { toolProfile: 'full' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {} },
    sceneBridge: { call: async (method, args) => {
      assert.equal(method, 'getPrefabEditingState'); assert.deepEqual(args, { prefabUuid: 'asset' }); state.roots += 1;
      if (state.rootError) throw new Error('prefab root unavailable');
      const value = copy(state.root); if (state.roots > 1 && state.lateRoot) state.lateRoot(value); return value;
    } },
  });
  assert.ok(registry.listTools().some(tool => tool.name === 'exit_prefab_edit_mode'), 'Exit tool must exist before testing its behavior');
  return { state, file, sceneFile, registry, run: (args = { prefabUuid: 'asset', returnSceneUuid: 'origin' }) => registry.callToolDetailed('exit_prefab_edit_mode', args) };
}

test('exit closes once and verifies exact origin mode, content and unchanged source files', async t => {
  const f = fixture(t); const source = fs.readFileSync(f.file, 'utf8'); const scene = fs.readFileSync(f.sceneFile, 'utf8');
  const { value } = await f.run();
  assert.equal(value.data.exited, true); assert.equal(value.data.verified, true); assert.equal(value.data.alreadyExited, false);
  assert.equal(value.data.mode, 'general'); assert.equal(value.data.sceneUuid, 'origin'); assert.equal(value.data.sceneUrl, 'db://assets/Origin.scene');
  assert.equal(value.data.prefabUuid, 'asset'); assert.equal(value.data.sourceUnchanged, true); assert.equal(value.data.needsSave, false);
  assert.equal(value.data.method, 'scene:close-scene'); assert.equal(f.state.closes, 1); assert.equal(f.state.roots, 2);
  assert.equal(fs.readFileSync(f.file, 'utf8'), source); assert.equal(fs.readFileSync(f.sceneFile, 'utf8'), scene);
});
test('exit reports the restored origin dirty state without saving it', async t => {
  const f = fixture(t); f.state.afterClose = () => { f.state.dirty = true; };
  assert.equal((await f.run()).value.data.needsSave, true); assert.equal(f.state.closes, 1);
});
for (const result of [false, undefined, 'opaque-result']) {
  test(`exit verifies actual context rather than native result ${result}`, async t => {
    const f = fixture(t); f.state.result = result; assert.equal((await f.run()).value.data.verified, true); assert.equal(f.state.closes, 1);
  });
}
test('exit waits for a delayed mode transition without another close', async t => {
  const f = fixture(t); f.state.delayedClose = 3;
  assert.equal((await f.run()).value.data.exited, true); assert.equal(f.state.closes, 1);
});
for (const dirty of [false, true]) {
  test(`exit repeated in the explicit origin is a no-op, dirty=${dirty}`, async t => {
    const f = fixture(t); f.state.mode = 'general'; f.state.current = 'origin'; f.state.dirty = dirty;
    const { value } = await f.run(); assert.equal(value.data.alreadyExited, true); assert.equal(value.data.method, null);
    assert.equal(value.data.needsSave, dirty); assert.equal(f.state.closes, 0); assert.equal(f.state.roots, 0);
  });
}
test('a second exit never closes the origin scene', async t => {
  const f = fixture(t); await f.run(); assert.equal((await f.run()).value.data.alreadyExited, true); assert.equal(f.state.closes, 1);
});
test('exit is a full-profile, non-destructive idempotent mode-changing tool', t => {
  const f = fixture(t); const tool = f.registry.listTools().find(tool => tool.name === 'exit_prefab_edit_mode');
  assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.destructiveHint, false); assert.equal(tool.annotations.idempotentHint, true);
  assert.deepEqual(tool.inputSchema.required, ['prefabUuid', 'returnSceneUuid']);
});
for (const args of [{}, { prefabUuid: 'asset' }, { prefabUuid: '', returnSceneUuid: 'origin' },
  { prefabUuid: false, returnSceneUuid: 'origin' }, { prefabUuid: 'asset', returnSceneUuid: '' }, { prefabUuid: 'asset', returnSceneUuid: 42 },
  { prefabUuid: 'asset', returnSceneUuid: 'origin', force: true }, { prefabUuid: 'asset', returnSceneUuid: 'origin', save: true },
  { prefabUuid: 'asset', returnSceneUuid: 'origin', discard: true }]) {
  test(`exit refuses invalid options before contacting Creator: ${JSON.stringify(args)}`, async t => {
    const f = fixture(t); await assert.rejects(f.run(args), /UUID|required|option/i); assert.equal(f.state.contexts, 0); assert.equal(f.state.closes, 0);
  });
}
for (const change of [
  s=>{s.ready=false;}, s=>{s.assetReady=false;}, s=>{s.mode='animation';}, s=>{s.current='other';},
  s=>{s.mode='general';s.current='other';}, s=>{s.dirty=true;}, s=>{s.dirty=undefined;}, s=>{s.multi=true;},
  s=>{s.tabs=[];}, s=>{s.tabs=[{},{}];}, s=>{s.tabs=[null];}, s=>{s.tabs=[{uuid:'asset',type:'prefab',dirty:false}];},
  s=>{s.tabs=[{uuid:'asset',type:'prefab',url:s.asset.url,dirty:true}];},
]) {
  test(`exit rejects unsupported or dirty context: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /ready|mode|scene|prefab|dirty|tab/i); assert.equal(f.state.closes, 0);
  });
}
for (const change of [
  s=>{s.asset=null;}, s=>{s.asset.uuid='other';}, s=>{s.asset.imported=false;}, s=>{s.asset.readonly=true;}, s=>{s.asset.invalid=true;},
  s=>{s.asset.type='cc.SceneAsset';}, s=>{s.asset.url='db://internal/Source.prefab';}, s=>{s.asset.file=path.join(path.dirname(s.asset.file),'Wrong.prefab');},
  s=>{s.scene=null;}, s=>{s.scene.uuid='other';}, s=>{s.scene.imported=false;}, s=>{s.scene.type='cc.Prefab';},
  s=>{s.scene.url='db://assets/../Origin.scene';}, s=>{s.lookupError=true;},
]) {
  test(`exit rejects invalid asset or return scene identity: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /asset|source|file|scene|prefab|path/i); assert.equal(f.state.closes, 0);
  });
}
for (const which of ['file', 'sceneFile']) {
  test(`exit rejects wrong ${which} metadata`, async t => {
    const f = fixture(t); fs.writeFileSync(`${f[which]}.meta`, JSON.stringify({ uuid: 'other' }));
    await assert.rejects(f.run(), /UUID|metadata/i); assert.equal(f.state.closes, 0);
  });
}
for (const change of [
  f=>{f.state.preview[3]._string='unsaved';}, f=>{f.state.preview[3].user._id='changed-user';},
  f=>{f.state.rawPreview='broken';}, f=>{f.state.rawPreview={};}, f=>{f.state.previewError=true;}, f=>{f.state.rootError=true;},
  f=>{f.state.root.node.name='Renamed';}, f=>{f.state.root.nodes[0].prefab.fileId='other';}, f=>{f.state.root.nodes[0].nested=true;},
  f=>{f.state.root.nodes[0].prefab.instanceId='instance';}, f=>{f.state.root.linkedAncestor=true;},
  f=>{f.state.rawScene='broken';}, f=>{f.state.rawScene={};}, f=>{f.state.sceneJson[1]._id='other';}, f=>{f.state.sceneJson[1]._name='unsaved';},
  f=>{const p=prefab();p[3].asset={__uuid__:'missing'};fs.writeFileSync(f.file,JSON.stringify(p));},
  f=>{const p=prefab();p[2].instance={__id__:4};fs.writeFileSync(f.file,JSON.stringify(p));},
]) {
  test(`exit refuses unsaved or unverifiable content before closing: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /JSON|serializ|source|reference|nested|prefab|scene|root|content|identity|preview/i); assert.equal(f.state.closes, 0);
  });
}
test('already-exited origin with new unsaved content is not reported as verified', async t => {
  const f = fixture(t); f.state.mode='general'; f.state.current='origin'; f.state.sceneJson[1]._name='new edit';
  await assert.rejects(f.run(), /scene|content|unsaved/i); assert.equal(f.state.closes, 0);
});
for (const change of [
  f=>{f.state.preflight=()=>{f.state.dirty=true;};}, f=>{f.state.preflight=()=>{f.state.current='other';};},
  f=>{f.state.preflight=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.preflight=()=>fs.appendFileSync(`${f.file}.meta`,' ');},
  f=>{f.state.preflight=()=>fs.appendFileSync(f.sceneFile,' ');}, f=>{f.state.preflight=()=>{f.state.sceneJson[1]._name='changed';};},
  f=>{f.state.latePreview=p=>{p[3]._string='late';};}, f=>{f.state.lateRoot=r=>{r.nodes[0].components[0].uuid='replacement';};},
]) {
  test(`exit detects concurrent preflight changes: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /changed|dirty|context|prefab|content|scene/i); assert.equal(f.state.closes, 0);
  });
}
for (const change of [
  f=>{f.state.noClose=true;}, f=>{f.state.closeError=true;}, f=>{f.state.afterClose=()=>{f.state.current='other';};},
  f=>{f.state.afterClose=()=>{f.state.mode='animation';};}, f=>{f.state.afterClose=()=>{f.state.multi=true;};},
  f=>{f.state.afterClose=()=>{f.state.tabs=[];};}, f=>{f.state.afterClose=()=>{f.state.sceneJson[1]._name='lost';};},
  f=>{f.state.afterClose=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.afterClose=()=>fs.appendFileSync(`${f.file}.meta`,' ');},
  f=>{f.state.afterClose=()=>fs.appendFileSync(f.sceneFile,' ');}, f=>{f.state.afterClose=()=>fs.appendFileSync(`${f.sceneFile}.meta`,' ');},
  f=>{f.state.lateChange=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.lateChange=()=>{f.state.sceneJson[1]._name='late';};},
]) {
  test(`exit reports uncertain state without retry, save, discard or reopen: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /may already|inspect.*retry/i); assert.equal(f.state.closes, 1);
  });
}
