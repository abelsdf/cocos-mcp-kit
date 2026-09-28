'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const electron=require('../lib/electron-tools'),preview=require('../lib/preview-runtime');
const {capturePanelScreenshot,captureEditorWindowScreenshot}=require('../lib/screenshots');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cocos-capture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const state={reads:0,captures:0,zoom:1,running:true};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');
  const w={id:1,isVisible:()=>!state.hidden,isMinimized:()=>false,getTitle:()=> 'Fixture',webContents:{getURL:()=> 'file:///creator/windows/main.html',getZoomFactor:()=>state.zoom},
    capturePage:async bounds=>{state.captures++;state.bounds=bounds;if(state.captureError)throw Error('Native capture failed');return{isEmpty:()=>Boolean(state.empty),toPNG:()=>state.badPng?Buffer.from('invalid'):png};}};
  t.mock.method(electron,'getAllWindows',()=>[w]);
  t.mock.method(electron,'executeJavaScript',async()=>{state.reads++;return{x:10,y:20,width:100,height:50,source:'scene',revision:state.drift?state.reads:0};});
  t.mock.method(preview,'controlPreviewToolbar',async command=>{assert.equal(command.action,'state');return{running:state.running,mode:'gameView',busy:false,toolbarSynchronized:true};});
  return{state,dir,png,run:(options={})=>capturePanelScreenshot(dir,{panel:'scene',...options})};
}
test('capture writes a new PNG with source/pixel metadata and zoom-adjusted crop',async t=>{
  const f=fixture(t);f.state.zoom=1.5;const r=await f.run({fileName:'valid.png'});
  assert.deepEqual(f.state.bounds,{x:15,y:30,width:150,height:75});assert.deepEqual(fs.readFileSync(r.filePath),f.png);
  assert.deepEqual(r.pixelSize,{width:1,height:1});assert.equal(r.visualValidation,'not_run');assert.equal(r.source,'creator_scene_view');assert.equal(r.windowId,1);
  await assert.rejects(f.run({fileName:'valid.png'}),/exists/);assert.equal(f.state.captures,1);
});
for(const name of ['../escape.png','x/y.png','x\\y.png','x.txt','CON.png',"x'.png",''])test('unsafe capture basename rejected '+name,async t=>{const f=fixture(t);await assert.rejects(f.run({fileName:name}),/basename/);assert.equal(f.state.captures,0);});
for(const prop of ['hidden','empty','badPng','drift','captureError'])test('failed capture leaves no PNG: '+prop,async t=>{const f=fixture(t);f.state[prop]=true;await assert.rejects(f.run());assert.deepEqual(fs.readdirSync(f.dir),[]);});
test('Game View requires a running synchronized preview, never starts one',async t=>{const f=fixture(t);f.state.running=false;await assert.rejects(f.run({panel:'game'}),/Start a stable Game View/);assert.equal(f.state.captures,0);});
test('editor capture uses the same strict identity and no panel crop',async t=>{const f=fixture(t);const r=await captureEditorWindowScreenshot(f.dir);assert.equal(r.source,'creator_editor_window');assert.equal(f.state.reads,0);assert.equal(f.state.bounds,undefined);});
