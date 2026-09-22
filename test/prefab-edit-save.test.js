'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
function prefab() {
  return [
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _parent: null, _children: [{ __id__: 2 }], _components: [{ __id__: 4 }], _prefab: { __id__: 3 }, _id: 'root-runtime' },
    { __type__: 'cc.Node', _name: 'Child', _parent: { __id__: 1 }, _children: [], _components: [], _prefab: { __id__: 6 }, _id: 'child-runtime' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file', instance: null },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 5 }, _id: 'label-runtime', _string: 'old', user: { _id: 'keep' } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'child-file' },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-edit-save-'));
  fs.mkdirSync(path.join(projectPath, 'assets'));
  const file = path.join(projectPath, 'assets', 'Source.prefab');
  const sceneFile = path.join(projectPath, 'assets', 'Origin.scene');
  const scene = [{ __type__: 'cc.SceneAsset', _name: 'Origin', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _name: 'Origin', _id: 'origin', _children: [], _parent: null }];
  fs.writeFileSync(file, JSON.stringify(prefab())); fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'asset' }));
  fs.writeFileSync(sceneFile, JSON.stringify(scene)); fs.writeFileSync(`${sceneFile}.meta`, JSON.stringify({ uuid: 'origin' }));
  const state = {
    asset: { uuid: 'asset', url: 'db://assets/Source.prefab', file, type: 'cc.Prefab', imported: true },
    scene: { uuid: 'origin', url: 'db://assets/Origin.scene', file: sceneFile, type: 'cc.SceneAsset', imported: true },
    mode: 'prefab', current: 'asset', ready: true, dirty: true, multi: false,
    writes: 0, roots: 0, previews: 0, contexts: 0, sourceReadsAfterSave: 0, result: true,
    preview: prefab(), sceneJson: copy(scene),
    root: { sceneUuid: 'edit-scene', node: { uuid: 'root', name: 'Source', path: 'Wrapper/Source', parentUuid: 'wrapper' },
      linkedAncestor: false, nodes: ['root','child'].map((uuid,index) => ({ uuid, name: index ? 'Child' : 'Source',
        parentUuid: index ? 'root' : 'wrapper', childUuids: index ? [] : ['child'], nested: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: `${uuid}-file`, instanceId: '' },
        components: index ? [] : [{ uuid: 'label', type: 'cc.Label', prefab: { fileId: 'component-file' } }],
      })),
    },
  };
  state.sceneJson[0]._name = ''; state.preview[0]._name = ''; state.preview[4]._string = 'new';
  for (const index of [1,2,4]) state.preview[index]._id = '';
  const writeSource = () => {
    const saved = copy(state.preview); saved[0]._name = 'Source';
    if (state.savedChange) state.savedChange(saved);
    fs.writeFileSync(file, JSON.stringify(saved));
  };
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    if (method === 'query-ready') return state.assetReady === undefined ? state.ready : state.assetReady;
    if (method === 'query-asset-info') {
      if (state.lookupError) throw new Error('asset lookup failed');
      if (args[0] === 'asset') {
        if (state.writes) {
          state.sourceReadsAfterSave += 1;
          if (state.sourceReadsAfterSave === state.delayedWrite) writeSource();
          if (state.sourceReadsAfterSave === 2 && state.lateFile) state.lateFile();
          if (state.sourceReadsAfterSave <= state.importQueries) return { ...state.asset, imported: false };
        }
        return state.asset;
      }
      if (args[0] === 'origin') return state.scene;
      return null;
    }
    if (method === 'query-url') return null;
    assert.equal(channel, 'scene');
    if (method === 'query-is-ready') return state.ready;
    if (method === 'query-scene-mode') { state.contexts += 1; return state.mode; }
    if (method === 'query-current-scene') return state.current;
    if (method === 'query-dirty') return state.dirty;
    if (method === 'multi-is-multi-edit-mode') return state.multi;
    if (method === 'multi-scene-query') return state.tabs || [{ uuid: state.current, type: 'prefab', url: state.asset.url, dirty: state.dirty }];
    if (method === 'query-scene-json') return state.rawScene === undefined ? JSON.stringify(state.sceneJson) : state.rawScene;
    if (method === 'getdata-prefab') {
      assert.deepEqual(args, ['root']); state.previews += 1;
      if (state.previewError) throw new Error('preview unavailable');
      const value = copy(state.preview);
      if (!state.writes && state.previews > 1 && state.preflightPreview) state.preflightPreview(value);
      if (state.writes && state.afterPreview) state.afterPreview(value);
      return state.rawPreview === undefined ? JSON.stringify(value) : state.rawPreview;
    }
    assert.equal(method, 'save-scene', 'No open, alternate save, apply, snapshot, close, retry or direct-write fallback');
    assert.deepEqual(args, []); state.writes += 1;
    if (state.saveError) throw new Error('save IPC disconnected');
    if (!state.noWrite && !state.delayedWrite) writeSource();
    if (!state.keepDirty) state.dirty = false;
    if (state.afterSave) state.afterSave();
    return state.result;
  } } };
  t.after(() => { if (previous === undefined) delete global.Editor; else global.Editor = previous; fs.rmSync(projectPath, { recursive: true, force: true }); });
  t.mock.method(global, 'setTimeout', (callback, _delay, ...args) => setImmediate(callback, ...args));
  const registry = createToolRegistry({ getRuntimeContext: () => ({ projectPath, config: { toolProfile: 'full' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {} },
    sceneBridge: { call: async (method,args) => {
      assert.equal(method, 'getPrefabEditingState'); assert.deepEqual(args, { prefabUuid: 'asset' }); state.roots += 1;
      if (state.rootError) throw new Error('root unavailable');
      const value = copy(state.root);
      if (!state.writes && state.roots > 1 && state.recheck) state.recheck(value);
      if (state.writes && state.afterRoot) state.afterRoot(value);
      return value;
    } },
  });
  const options = { prefabUuid: 'asset', expectedSourceHash: hash(fs.readFileSync(file)) };
  return { state, file, sceneFile, registry, options,
    run: (args = options) => registry.callToolDetailed('save_prefab_edit_mode', args) };
}

test('edit save persists properties once and verifies source identity, edit state and retained origin', async t => {
  const f = fixture(t); const scene = fs.readFileSync(f.sceneFile, 'utf8');
  const { value } = await f.run();
  assert.equal(value.data.saved, true); assert.equal(value.data.verified, true); assert.equal(value.data.sourceChanged, true);
  assert.equal(value.data.alreadySaved, false); assert.equal(value.data.needsSave, false); assert.equal(value.data.mode, 'prefab');
  assert.equal(value.data.method, 'scene:save-scene'); assert.equal(value.data.prefabUuid, 'asset');
  assert.equal(value.data.path, 'Wrapper/Source'); assert.equal(value.refs.some(ref => ref.path === '[object Object]'), false);
  assert.equal(value.data.sourceHash, hash(fs.readFileSync(f.file))); assert.equal(value.data.previousScene.uuid, 'origin');
  assert.equal(f.state.writes, 1); assert.equal(fs.readFileSync(f.sceneFile,'utf8'), scene);
  assert.equal(JSON.parse(fs.readFileSync(f.file))[4]._string, 'new');
});

test('edit save persists untracked changes even when dirty is false', async t => {
  const f = fixture(t); f.state.dirty = false;
  assert.equal((await f.run()).value.data.sourceChanged, true); assert.equal(f.state.writes, 1);
});

test('clean already-saved prefab is verified without a native write', async t => {
  const f = fixture(t); f.state.dirty = false; f.state.preview[4]._string = 'old';
  const before = fs.readFileSync(f.file,'utf8');
  const { value } = await f.run(); assert.equal(value.data.alreadySaved, true); assert.equal(value.data.sourceChanged, false);
  assert.equal(value.data.method, null); assert.equal(f.state.writes, 0); assert.equal(fs.readFileSync(f.file,'utf8'), before);
});

test('dirty but semantically unchanged prefab still requests save to clear dirty', async t => {
  const f = fixture(t); f.state.preview[4]._string = 'old';
  const { value } = await f.run(); assert.equal(value.data.alreadySaved, false); assert.equal(value.data.sourceChanged, false); assert.equal(f.state.writes, 1);
});

for (const result of [false, undefined, 'asset']) {
  test(`edit save verifies actual data rather than native return ${result}`, async t => {
    const f = fixture(t); f.state.result = result; assert.equal((await f.run()).value.data.verified, true); assert.equal(f.state.writes, 1);
  });
}
test('edit save waits for delayed persistence without another write', async t => {
  const f = fixture(t); f.state.delayedWrite = 3; assert.equal((await f.run()).value.data.verified, true); assert.equal(f.state.writes, 1);
});
test('edit save waits for temporary reimport even when asset-db is ready', async t => {
  const f = fixture(t); f.state.importQueries = 2;
  assert.equal((await f.run()).value.data.verified, true); assert.equal(f.state.writes, 1);
});
test('edit save bounds reimport polling without requesting another write', async t => {
  const f = fixture(t); f.state.importQueries = 100;
  await assert.rejects(f.run(), /may already|inspect.*retry/i); assert.equal(f.state.writes, 1); assert.equal(f.state.sourceReadsAfterSave, 11);
});
test('edit save does not treat changed identity during reimport as a transient import', async t => {
  const f = fixture(t); f.state.importQueries = 100; f.state.afterSave = () => { f.state.asset.uuid = 'replacement'; };
  await assert.rejects(f.run(), /may already|inspect.*retry/i); assert.equal(f.state.writes, 1); assert.equal(f.state.sourceReadsAfterSave, 1);
});
test('edit save accepts the new hash for a no-op repeat and rejects the old hash', async t => {
  const f = fixture(t); const { value } = await f.run();
  await assert.rejects(f.run(), /hash|changed/i); assert.equal(f.state.writes, 1);
  assert.equal((await f.run({ ...f.options, expectedSourceHash: value.data.sourceHash })).value.data.alreadySaved, true);
  assert.equal(f.state.writes, 1);
});
test('edit save is a full-profile source-writing operation', t => {
  const f = fixture(t); const tool = f.registry.listTools().find(tool => tool.name === 'save_prefab_edit_mode');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.destructiveHint, true);
});

for (const args of [{}, {prefabUuid:''}, {prefabUuid:42}, {prefabUuid:'asset'},
  {prefabUuid:'asset',expectedSourceHash:'bad'}, {prefabUuid:'asset',expectedSourceHash:false},
  {prefabUuid:'asset',expectedSourceHash:'0'.repeat(64),force:true}, {prefabUuid:'asset',expectedSourceHash:'0'.repeat(64),exit:true}]) {
  test(`edit save rejects invalid arguments before contacting Creator: ${JSON.stringify(args)}`, async t => {
    const f = fixture(t); await assert.rejects(f.run(args), /UUID|hash|option|required/i); assert.equal(f.state.contexts, 0); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  s=>{s.ready=false;}, s=>{s.assetReady=false;}, s=>{s.mode='general';}, s=>{s.current='other';},
  s=>{s.multi=true;}, s=>{s.dirty=undefined;}, s=>{s.tabs=[];}, s=>{s.tabs=[{},{}];},
  s=>{s.tabs=[null];}, s=>{s.tabs=[{uuid:'asset',type:'prefab',url:'db://assets/Source.prefab',dirty:false}];},
]) {
  test(`edit save rejects unsupported context before writing: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /ready|mode|prefab|scene|tab|dirty/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  s=>{s.asset.uuid='replacement';}, s=>{s.asset.imported=false;}, s=>{s.asset.readonly=true;}, s=>{s.asset.invalid=true;},
  s=>{s.asset.url='db://internal/Source.prefab';}, s=>{s.asset.type='cc.SceneAsset';}, s=>{s.asset.file=path.join(path.dirname(s.asset.file),'Wrong.prefab');},
  s=>{s.scene=null;}, s=>{s.scene.imported=false;}, s=>{s.scene.type='cc.Prefab';}, s=>{s.lookupError=true;},
]) {
  test(`edit save rejects invalid source or origin identity: ${change}`, async t => {
    const f = fixture(t); change(f.state); await assert.rejects(f.run(), /asset|source|prefab|scene|path|file|identity/i); assert.equal(f.state.writes, 0);
  });
}
for (const which of ['file','sceneFile']) {
  test(`edit save rejects a changed ${which} metadata UUID`, async t => {
    const f = fixture(t); fs.writeFileSync(`${f[which]}.meta`,JSON.stringify({uuid:'other'}));
    await assert.rejects(f.run(), /UUID|metadata/i); assert.equal(f.state.writes, 0);
  });
}
test('edit save refuses a source modified since the caller captured its hash', async t => {
  const f = fixture(t); fs.appendFileSync(f.file,' '); await assert.rejects(f.run(), /hash|changed/i); assert.equal(f.state.writes, 0);
});
for (const change of [
  f=>{f.state.rootError=true;}, f=>{f.state.root.node.name='Renamed';}, f=>{f.state.root.nodes[0].prefab.instanceId='instance';},
  f=>{f.state.root.nodes[0].prefab.fileId='other';}, f=>{f.state.root.nodes[1].nested=true;},
  f=>{f.state.preview[6].fileId='changed-structure';}, f=>{f.state.preview[3].instance={__id__:5};},
  f=>{f.state.preview[4].asset={__uuid__:'missing'};}, f=>{f.state.preview[4].assets=Array.from({length:5001},(_,i)=>({__uuid__:`missing-${i}`}));},
  f=>{f.state.rawPreview='broken json';}, f=>{f.state.rawPreview={};}, f=>{f.state.previewError=true;},
  f=>{f.state.rawScene='broken json';}, f=>{f.state.rawScene={};}, f=>{f.state.sceneJson[1]._id='missing';},
  f=>{f.state.sceneJson[1]._name='unsaved origin';},
]) {
  test(`edit save preflight rejects unsupported content: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /root|structure|identity|nested|reference|limit|JSON|serializ|preview|source|origin|scene|prefab/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  f=>{f.state.recheck=r=>{r.nodes[0].name='changed';};}, f=>{f.state.recheck=()=>{f.state.dirty=false;};},
  f=>{f.state.recheck=()=>fs.appendFileSync(f.file,' ');}, f=>{f.state.recheck=()=>fs.appendFileSync(`${f.file}.meta`,' ');},
  f=>{f.state.recheck=()=>fs.appendFileSync(f.sceneFile,' ');}, f=>{f.state.recheck=()=>{f.state.sceneJson[1]._name='changed';};},
  f=>{f.state.preflightPreview=p=>{p[4]._string='changed';};},
]) {
  test(`edit save detects concurrent preflight changes: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /changed|preflight|origin|dirty/i); assert.equal(f.state.writes, 0);
  });
}
for (const change of [
  f=>{f.state.noWrite=true;}, f=>{f.state.saveError=true;}, f=>{f.state.keepDirty=true;},
  f=>{f.state.afterSave=()=>{f.state.mode='general';};}, f=>{f.state.afterSave=()=>{f.state.current='other';};},
  f=>{f.state.savedChange=s=>{s[4]._string='wrong';};}, f=>{f.state.savedChange=s=>{s[4].user._id='lost';};},
  f=>{f.state.savedChange=s=>{s[1]._name='wrong';};}, f=>{f.state.afterRoot=r=>{r.node.uuid='replacement';};},
  f=>{f.state.afterPreview=p=>{p[4]._string='drift';};}, f=>{f.state.afterSave=()=>fs.appendFileSync(`${f.file}.meta`,' ');},
  f=>{f.state.afterSave=()=>fs.appendFileSync(f.sceneFile,' ');}, f=>{f.state.afterSave=()=>fs.appendFileSync(`${f.sceneFile}.meta`,' ');},
  f=>{f.state.afterSave=()=>{f.state.sceneJson[1]._name='origin changed';};}, f=>{f.state.lateFile=()=>fs.appendFileSync(f.file,' ');},
]) {
  test(`edit save reports uncertain writes without retry, exit or rollback: ${change}`, async t => {
    const f = fixture(t); change(f); await assert.rejects(f.run(), /may already|inspect.*retry/i); assert.equal(f.state.writes, 1);
  });
}
