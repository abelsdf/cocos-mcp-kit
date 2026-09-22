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
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'root-file', instance: null },
    { __type__: 'cc.Label', node: { __id__: 1 }, __prefab: { __id__: 4 }, _id: 'source-component', _string: 'saved', user: { _id: 'retained' } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'component-file' },
  ];
}
function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-test-'));
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
    mode: 'prefab', current: 'asset', dirty: false, ready: true, multi: false, calls: [], contexts: 0, roots: 0,
    sceneJson: copy(scene), preview: prefab(),
    root: { sceneUuid: 'edit-scene', linkedAncestor: false,
      node: { uuid: 'root', name: 'Source', path: 'Wrapper/Source', parentUuid: 'wrapper' },
      nodes: [{ uuid: 'root', name: 'Source', parentUuid: 'wrapper', childUuids: [], nested: false,
        prefab: { rootUuid: 'root', assetUuid: 'asset', fileId: 'root-file', instanceId: '' },
        components: [{ uuid: 'component', type: 'cc.Label', prefab: { fileId: 'component-file' } }] }],
    },
  };
  state.sceneJson[0]._name=''; state.preview[0]._name='';state.preview[1]._id='';state.preview[3]._id='';
  const previous=global.Editor;
  global.Editor={App:{version:'3.8.8'},Message:{request:async(channel,method,...args)=>{
    state.calls.push(`${channel}:${method}`);
    if(method===state.failedMessage)throw new Error(state.errorMessage||'Read query unavailable');
    if(method==='query-ready')return state.assetReady!==false;
    if(method==='query-asset-info'){
      if(args[0]==='asset')return state.asset;
      if(args[0]==='origin')return state.scene;
      if(state.lookupError)throw new Error('Reference lookup unavailable');
      return null;
    }
    if(method==='query-url')return null;
    assert.equal(channel,'scene');
    if(method==='query-is-ready')return state.ready;
    if(method==='query-scene-mode'){state.contexts+=1;if(state.contexts===2&&state.drift)state.drift();return state.mode;}
    if(method==='query-current-scene')return state.current;
    if(method==='query-dirty')return state.dirty;
    if(method==='multi-is-multi-edit-mode')return state.multi;
    if(method==='multi-scene-query')return state.tabs||[{uuid:state.current,type:state.mode==='prefab'?'prefab':'scene',dirty:state.dirty,url:state.mode==='prefab'?state.asset?.url:state.scene?.url}];
    if(method==='query-scene-json')return state.rawScene===undefined?JSON.stringify(state.sceneJson):state.rawScene;
    if(method==='getdata-prefab'){assert.deepEqual(args,['root']);const p=copy(state.preview);if(state.roots>1&&state.latePreview)state.latePreview(p);return state.rawPreview===undefined?JSON.stringify(p):state.rawPreview;}
    assert.fail(`Mutating or unsupported request is forbidden: ${channel}:${method}`);
  }}};
  t.after(()=>{if(previous===undefined)delete global.Editor;else global.Editor=previous;fs.rmSync(projectPath,{recursive:true,force:true});});
  const registry=createToolRegistry({getRuntimeContext:()=>({projectPath,config:{toolProfile:'full'}}),interactionLog:{add(){}},runtimeLog:{add(){}},
    sceneBridge:{call:async(method,args)=>{assert.equal(method,'getPrefabEditingState');assert.deepEqual(args,{prefabUuid:'asset'});state.roots+=1;if(state.rootError)throw new Error('Unverifiable root or outgoing scene reference');const r=copy(state.root);if(state.roots>1&&state.lateRoot)state.lateRoot(r);return r;}}});
  assert.ok(registry.listTools().some(tool=>tool.name==='test_prefab_edit_mode'),'Diagnostic tool must exist before testing behavior');
  return {state,file,sceneFile,registry,run:async(args={prefabUuid:'asset'})=>(await registry.callToolDetailed('test_prefab_edit_mode',args)).value.data};
}
const step=(report,name)=>report.checks.find(check=>check.name===name);
function untested(report){assert.equal(report.readOnly,true);assert.deepEqual(report.mutationTests,{enter:'not_run',save:'not_run',exit:'not_run'});}

test('diagnostics inspect the current saved prefab without mutating, saving or switching',async t=>{
  const f=fixture(t);const before=[f.file,`${f.file}.meta`,f.sceneFile,`${f.sceneFile}.meta`].map(p=>fs.readFileSync(p,'utf8'));
  const r=await f.run();untested(r);assert.equal(r.complete,true);assert.equal(r.readChecksPassed,true);assert.equal(r.observationsStable,true);
  assert.equal(r.editorVersion,'3.8.8');assert.equal(r.prefab.uuid,'asset');assert.equal(r.prefab.nodeCount,1);assert.equal(r.prefab.componentCount,1);
  assert.equal(r.originScene.uuid,'origin');assert.equal(r.originScene.matchesSavedContent,true);assert.equal(r.editing.sourceMatchesLive,true);
  assert.equal(r.editing.structureMatchesSource,true);assert.equal(r.editing.hasUnsavedChanges,false);assert.equal(r.editing.path,'Wrapper/Source');
  assert.equal(r.checks.length,8);assert.equal(f.state.roots,2);
  assert.deepEqual([f.file,`${f.file}.meta`,f.sceneFile,`${f.sceneFile}.meta`].map(p=>fs.readFileSync(p,'utf8')),before);
  const output=JSON.stringify(r);assert.equal(output.includes('"__type__"'),false);assert.equal(output.includes('"user"'),false);
});
for(const dirty of [false,true]){
  test(`diagnostics report changed properties without saving or discarding, dirty=${dirty}`,async t=>{
    const f=fixture(t);f.state.dirty=dirty;f.state.preview[3]._string='unsaved';const r=await f.run();untested(r);
    assert.equal(r.complete,true);assert.equal(r.readChecksPassed,true);assert.equal(r.context.dirty,dirty);assert.equal(r.editing.sourceMatchesLive,false);assert.equal(r.editing.hasUnsavedChanges,true);assert.equal(r.editing.structureMatchesSource,true);
    assert.equal(JSON.parse(fs.readFileSync(f.file))[3]._string,'saved');assert.equal(f.state.preview[3]._string,'unsaved');
  });
}
test('a dirty flag alone still reports unsaved state',async t=>{const f=fixture(t);f.state.dirty=true;const r=await f.run();assert.equal(r.editing.sourceMatchesLive,true);assert.equal(r.editing.hasUnsavedChanges,true);});
test('diagnostics distinguish supported serialization from changed structure',async t=>{const f=fixture(t);f.state.preview[4].fileId='new-component';const r=await f.run();assert.equal(r.editing.structureMatchesSource,false);assert.equal(r.editing.hasUnsavedChanges,true);untested(r);});
for(const mode of ['general','other-prefab']){
  test(`an unopened target stays unopened in ${mode}`,async t=>{
    const f=fixture(t);f.state.mode=mode==='general'?'general':'prefab';f.state.current=mode==='general'?'origin':'other';
    const r=await f.run();untested(r);assert.equal(r.complete,false);assert.equal(r.readChecksPassed,true);assert.equal(r.observationsStable,true);assert.equal(r.editing,null);
    assert.equal(step(r,'editingRoot').status,'not_checked');assert.equal(step(r,'liveReferences').status,'not_checked');assert.equal(f.state.roots,0);
  });
}
test('unsaved origin content is reported without discarding it',async t=>{const f=fixture(t);f.state.sceneJson[1]._name='unsaved';const r=await f.run();assert.equal(r.originScene.matchesSavedContent,false);assert.equal(r.observationsStable,true);assert.equal(f.state.sceneJson[1]._name,'unsaved');untested(r);});
test('already-open diagnosis is repeatable without recording a snapshot',async t=>{const f=fixture(t);assert.deepEqual(await f.run(),await f.run());});
test('diagnostics have full-only read-only idempotent annotations',t=>{const f=fixture(t);const tool=f.registry.listTools().find(x=>x.name==='test_prefab_edit_mode');assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.idempotentHint,true);assert.deepEqual(tool.inputSchema.required,['prefabUuid']);});
for(const args of [{},{prefabUuid:''},{prefabUuid:false},{prefabUuid:'asset',save:true},{prefabUuid:'asset',parentUuid:'parent'},{prefabUuid:'asset',target:'assets/Source.prefab'}]){
  test(`invalid diagnostic input is rejected before queries: ${JSON.stringify(args)}`,async t=>{const f=fixture(t);await assert.rejects(f.run(args),/UUID|required|option/i);assert.equal(f.state.calls.length,0);});
}
for(const change of [s=>{s.ready=false;},s=>{s.multi=true;},s=>{s.mode='animation';},s=>{s.current='';},s=>{s.dirty=undefined;},s=>{s.tabs=[null];},s=>{s.tabs=[{},{}];},s=>{s.failedMessage='query-scene-mode';}]){
  test(`unsupported editor context is a reported failure: ${change}`,async t=>{const f=fixture(t);change(f.state);const r=await f.run();untested(r);assert.equal(r.readChecksPassed,false);assert.equal(step(r,'editorContext').status,'failed');assert.equal(r.complete,false);assert.equal(r.editing,null);});
}
test('unready asset database does not probe source data or open a target',async t=>{const f=fixture(t);f.state.assetReady=false;const r=await f.run();assert.equal(step(r,'assetDatabase').status,'failed');assert.equal(step(r,'sourcePrefab').status,'not_checked');assert.equal(f.state.calls.some(s=>s.endsWith('query-asset-info')),false);});
for(const change of [s=>{s.asset=null;},s=>{s.asset.uuid='wrong';},s=>{s.asset.readonly=true;},s=>{s.asset.imported=false;},s=>{s.asset.type='cc.SceneAsset';},s=>{s.asset.url='db://internal/Source.prefab';},s=>{s.asset.file=path.join(path.dirname(s.asset.file),'Wrong.prefab');}]){
  test(`unsupported source is diagnostic data, not successful support: ${change}`,async t=>{const f=fixture(t);change(f.state);const r=await f.run();assert.equal(step(r,'sourcePrefab').status,'failed');assert.equal(r.prefab,null);assert.equal(r.readChecksPassed,false);assert.equal(f.state.roots,0);});
}
for(const which of ['file','sceneFile']){
  test(`wrong ${which} metadata is reported`,async t=>{const f=fixture(t);fs.writeFileSync(`${f[which]}.meta`,JSON.stringify({uuid:'wrong'}));const r=await f.run();assert.equal(step(r,which==='file'?'sourcePrefab':'originScene').status,'failed');untested(r);});
}
for(const change of [f=>{f.state.rawScene='broken';},f=>{f.state.scene=null;},f=>{f.state.mode='general';f.state.current='origin';f.state.sceneJson[1]._id='other';}]){
  test(`unverifiable origin is not reported as checked: ${change}`,async t=>{const f=fixture(t);change(f);const r=await f.run();assert.equal(step(r,'originScene').status,'failed');assert.equal(r.originScene,null);assert.equal(r.observationsStable,null);});
}
for(const change of [f=>{f.state.rootError=true;},f=>{f.state.root.nodes[0].nested=true;},f=>{f.state.root.node.name='renamed';},f=>{f.state.rawPreview={};},f=>{f.state.rawPreview='broken';}]){
  test(`unsupported live content does not trigger a fallback: ${change}`,async t=>{const f=fixture(t);change(f);const r=await f.run();assert.equal(step(r,'editingRoot').status,'failed');assert.equal(r.editing,null);assert.equal(r.observationsStable,null);untested(r);});
}
test('nested source is reported unsupported without opening it',async t=>{const f=fixture(t);const p=prefab();p[2].instance={__id__:4};fs.writeFileSync(f.file,JSON.stringify(p));const r=await f.run();assert.equal(step(r,'sourcePrefab').status,'failed');assert.equal(f.state.roots,0);});
for(const where of ['source','live']){
  test(`missing ${where} references have bounded diagnostics`,async t=>{const f=fixture(t);if(where==='source'){const p=prefab();p[3].ref={__uuid__:'missing'};fs.writeFileSync(f.file,JSON.stringify(p));}else f.state.preview[3].ref={__uuid__:'missing'};const r=await f.run();assert.equal(step(r,where==='source'?'sourceReferences':'liveReferences').status,'failed');assert.equal((where==='source'?r.prefab:r.editing).references.missingCount,1);untested(r);});
}
test('reference lookup failures are not called missing resources',async t=>{const f=fixture(t);f.state.preview[3].ref={__uuid__:'broken'};f.state.lookupError=true;const r=await f.run();assert.equal(r.editing.references.lookupErrorCount,1);assert.equal(r.editing.references.missingCount,0);assert.equal(step(r,'liveReferences').status,'failed');});
test('incomplete reference scans are not reported as complete',async t=>{const f=fixture(t);f.state.preview[3].refs=Array.from({length:5001},()=>({__uuid__:'missing'}));const r=await f.run();assert.equal(r.editing.references.complete,false);assert.equal(r.editing.references.totalReferenceCount,5001);assert.equal(r.complete,false);});
for(const change of [f=>{f.state.drift=()=>{f.state.dirty=true;};},f=>{f.state.drift=()=>fs.appendFileSync(f.file,' ');},f=>{f.state.drift=()=>fs.appendFileSync(f.sceneFile,' ');},f=>{f.state.drift=()=>{f.state.sceneJson[1]._name='drift';};},f=>{f.state.latePreview=p=>{p[3]._string='late';};},f=>{f.state.lateRoot=r=>{r.nodes[0].components[0].uuid='new';};}]){
  test(`concurrent change invalidates the observations: ${change}`,async t=>{const f=fixture(t);change(f);const r=await f.run();assert.equal(step(r,'stability').status,'failed');assert.equal(r.observationsStable,false);assert.equal(r.complete,false);untested(r);});
}
test('unavailable editor returns failures and never invents a version or support',async t=>{const f=fixture(t);delete global.Editor;const r=await f.run();assert.equal(r.editorVersion,null);assert.equal(r.readChecksPassed,false);assert.equal(r.complete,false);assert.equal(r.observationsStable,null);untested(r);});
test('native query errors are bounded in the report',async t=>{const f=fixture(t);f.state.failedMessage='query-ready';f.state.errorMessage='x'.repeat(5000);const r=await f.run();assert.ok(step(r,'assetDatabase').error.length<=500);});
