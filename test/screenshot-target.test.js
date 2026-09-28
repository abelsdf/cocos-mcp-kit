'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const electron = require('../lib/electron-tools');
const { selectCaptureWindow, panelRegionScript } = require('../lib/screenshot-target');
function window(id, extra = {}) { return { id, isVisible:()=>true, isMinimized:()=>false, getTitle:()=>`Project ${id}`, webContents:{getURL:()=> 'file:///creator/windows/main.html'}, ...extra }; }
test('screenshot window selection never falls back or picks an ambiguous window', t => {
  const a=window(1), b=window(2);t.mock.method(electron,'getAllWindows',()=>[a,b]);
  assert.throws(()=>selectCaptureWindow({}),/unique/);assert.equal(selectCaptureWindow({windowId:2}),b);
  assert.equal(selectCaptureWindow({titleContains:'Project 1'}),a);assert.throws(()=>selectCaptureWindow({titleContains:'missing'}),/unique/);
  assert.throws(()=>selectCaptureWindow({windowId:3}),/unique/);assert.throws(()=>selectCaptureWindow({windowKind:'preview'}),/Game View/);
});
test('hidden, minimized and worker windows cannot supply a screenshot', t => {
  t.mock.method(electron,'getAllWindows',()=>[window(1,{isVisible:()=>false}),window(2,{isMinimized:()=>true}),window(3,{webContents:{getURL:()=> 'file:///worker.html'}})]);
  assert.throws(()=>selectCaptureWindow({}),/unique/);
});
function dom({kind='scene', count=1, hidden=false, clip=false}={}) {
  const rect=(x,y,width,height)=>({left:x,top:y,right:x+width,bottom:y+height,width,height});
  const view={tagName:'WEBVIEW',getAttribute:()=>`packages://scene/static/template/3d-webview.html?url=C:%5Capp%5Cbuiltin%5Cscene%5Cdist%5Cscript%5C3d%5Cpreload%5Cweb%5C${kind==='game'?'preview':'preload'}.js`,getBoundingClientRect:()=>rect(20.5,50.5,1200,700),querySelectorAll:()=>[],getRootNode:()=>({})};
  const frame={tagName:'PANEL-FRAME',getAttribute:()=> 'scene',getBoundingClientRect:()=>rect(20,30,500,400),querySelectorAll:()=>[view],getRootNode:()=>({})};view.parentElement=frame;
  if(clip) frame.parentElement={getBoundingClientRect:()=>rect(0,0,450,380),clip:true,getRootNode:()=>({})};
  const document={querySelectorAll:()=> Array.from({length:count},()=>frame)};
  return {document,window:{innerWidth:1000,innerHeight:800,getComputedStyle:e=>({display:hidden?'none':'block',visibility:'visible',opacity:'1',overflowX:e.clip?'hidden':'visible',overflowY:e.clip?'hidden':'visible'})}};
}
test('panel crop uses exact panel and view source, clips to the visible viewport',()=>{
  const r=vm.runInNewContext(panelRegionScript('scene'),dom());assert.equal(r.x,21);assert.equal(r.y,51);assert.equal(r.width,499);assert.equal(r.height,379);assert.equal(r.source,'scene');assert.equal(r.clipped,true);
  const clipped=vm.runInNewContext(panelRegionScript('scene'),dom({clip:true}));assert.equal(clipped.width,429);assert.equal(clipped.height,329);
});
test('wrong view, missing/hidden/ambiguous panel never falls back to an arbitrary canvas',()=>{
  for(const fixture of [dom({kind:'game'}),dom({count:0}),dom({count:2}),dom({hidden:true})])assert.throws(()=>vm.runInNewContext(panelRegionScript('scene'),fixture));
  assert.equal(vm.runInNewContext(panelRegionScript('game'),dom({kind:'game'})).source,'game');
});
