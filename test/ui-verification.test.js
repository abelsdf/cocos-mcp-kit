'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const validation=require('../lib/ui-validation'),screenshots=require('../lib/screenshots');
const {verifyUI}=require('../lib/ui-verification');
function fixture(t){
  const state={scene:'scene',json:'saved content',validations:0,captures:0};
  t.mock.method(validation,'validateUI',async()=>{state.validations++;return{passed:!state.invalid,complete:true,visualValidation:'not_run'};});
  t.mock.method(screenshots,'capturePanelScreenshot',async()=>{state.captures++;if(state.error)throw Error('Panel unavailable');if(state.drift)state.json='changed';return{dataUri:'data:image/png;base64,YQ==',source:'scene',filePath:'capture.png'};});
  const original=global.Editor;t.after(()=>{if(original===undefined)delete global.Editor;else global.Editor=original;});
  global.Editor={Message:{request:async(_channel,method)=>({'query-is-ready':true,'query-scene-mode':state.mode||'general','multi-is-multi-edit-mode':false,'query-current-scene':state.scene,'query-scene-json':state.json}[method])}};
  return{state,run:extra=>verifyUI('project',{}, {sceneUuid:'scene',nodeUuids:['node'],waitMs:0,...extra})};
}
test('verification defaults to structure only and never invents a visual verdict',async t=>{const f=fixture(t),r=await f.run();assert.equal(r.report.completed,true);assert.equal(r.report.structure.passed,true);assert.equal(r.report.screenshot.status,'not_requested');assert.equal(r.report.visualValidation,'not_run');assert.equal(f.state.captures,0);});
test('requested image is separated from metadata, including when structure fails',async t=>{const f=fixture(t);f.state.invalid=true;const r=await f.run({screenshot:'scene'});assert.equal(r.report.structure.passed,false);assert.equal(r.report.screenshot.status,'captured');assert.ok(r.image);assert.equal(JSON.stringify(r.report).includes('base64'),false);});
test('capture failure retains structural evidence but cannot complete the workflow',async t=>{const f=fixture(t);f.state.error=true;const r=await f.run({screenshot:'scene'});assert.equal(r.report.completed,false);assert.equal(r.report.structure.passed,true);assert.equal(r.report.screenshot.status,'failed');assert.equal(r.image,undefined);});
test('scene mutation during capture withholds image and rejects stale evidence',async t=>{const f=fixture(t);f.state.drift=true;await assert.rejects(f.run({screenshot:'scene'}),/changed/);});
test('wrong scene is rejected before structure or capture',async t=>{const f=fixture(t);f.state.scene='other';await assert.rejects(f.run(),/matching/);assert.equal(f.state.validations,0);});
test('preview mode never relaxes edit-structure guards or reuses old structure',async t=>{const f=fixture(t);f.state.mode='preview';const r=await f.run({screenshot:'game'});assert.equal(r.report.structure.status,'not_checked');assert.equal(r.report.structure.passed,false);assert.equal(f.state.validations,0);assert.equal(r.report.screenshot.status,'captured');assert.ok(r.image);await assert.rejects(f.run({screenshot:'scene'}),/general scene/);});
for(const extra of [{waitMs:-1},{waitMs:2001},{screenshot:'desktop'},{surprise:true},{windowId:0},{titleContains:''},{windowId:1}])test('invalid verification options '+JSON.stringify(extra),async t=>{const f=fixture(t);await assert.rejects(f.run(extra));assert.equal(f.state.validations,0);});
