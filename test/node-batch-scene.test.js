'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const SCRIPT_UUID = '12345678-1234-1234-1234-123456789abc';

function batch() {
  return { schemaVersion: 1, roots: ['panel'], nodes: [
    { id: 'panel', parentId: null, name: 'Panel', components: [{ id: 'ui', type: 'cc.UITransform' }, { id: 'button', type: 'cc.Button', properties: { interactable: false } }] },
    { id: 'label', parentId: 'panel', name: 'Caption', components: [{ id: 'labelUi', type: 'cc.UITransform' }, { id: 'text', type: 'cc.Label', properties: { string: 'Batch' } }] },
  ], references: [{ from: { nodeId: 'panel', componentId: 'button', property: 'target' }, to: { kind: 'node', id: 'label' } }] };
}

function fixture() {
  const modulePath = path.resolve(__dirname, '../lib/node-batch-scene.js');
  assert.ok(fs.existsSync(modulePath), 'Batch scene implementation must exist before behavior tests');
  let id = 0; const control = {}; const all = [];
  class Node {
    constructor(name) { if (control.failName === name) throw new Error('Injected creation failure'); Object.assign(this, { name, uuid: `node-${++id}`, children: [], components: [], active: true, layer: 33554432, valid: true, _parent: null, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, _objFlags: 0 }); all.push(this); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    setPosition(x, y, z) { if (!control.ignorePosition) this.position = { x: x + (control.positionOffset || 0), y, z }; }
    setRotation(value) { if (!control.ignoreRotation) this.rotation = { x: value.x, y: value.y, z: value.z, w: value.w }; }
    setScale(x, y, z) { if (!control.ignoreScale) this.scale = { x, y, z }; }
    get parent() { return this._parent; }
    set parent(value) { if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1); this._parent = value; if (value) value.children.push(this); }
    getComponent(type) { return this.components.find(c => c instanceof type); }
    addComponent(type) { if (control.failComponent === type) throw new Error('Injected component failure'); const c = new type(); c.node = this; c.uuid = `component-${++id}`; this.components.push(c); control.onAdd?.(this, c); return c; }
    removeFromParent() { this.parent = null; }
    destroy() { if (control.failDestroy === this.name) throw new Error('Injected cleanup failure'); this.valid = false; for (const c of this.children.slice()) { c.removeFromParent(); c.destroy(); } }
  }
  class Component { constructor() { this.enabled = true; this.valid = true; } get enabledInHierarchy() { return this.enabled && this.node.activeInHierarchy; } }
  class UITransform extends Component { constructor() { super(); this.contentSize = { width: 100, height: 100 }; this.anchorPoint = { x: 0.5, y: 0.5 }; } }
  class Label extends Component { constructor() { super(); this.string = ''; this.color = { r: 255, g: 255, b: 255, a: 255 }; } }
  class Sprite extends Component { constructor() { super(); this.spriteFrame = null; this.sizeMode = 0; } }
  class Button extends Component { constructor() { super(); this.target = null; this.interactable = true; this.clickEvents = []; } }
  class Controller extends Component { constructor() { super(); if (control.failScript) throw new Error('Script constructor failed'); this.hits = 0; } onAction() { this.hits++; } }
  class EventHandler { set handler(value) { if (control.failEvent) throw new Error('Event binding failed'); this.method = value; } get handler() { return this.method; } }
  class ProgressBar extends Component { constructor() { super(); this.barSprite = null; this.progress = 1; } }
  class Canvas extends Component {} class Layout extends Component {} class Asset {} class SpriteFrame extends Asset {}
  class Camera extends Component { constructor() { super(); this.visibility = 33554432; this.targetTexture = null; } }
  class Quat { constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
  const cc = { Node, Component, UITransform, Label, Sprite, Button, ProgressBar, Canvas, Camera, Layout, Asset, SpriteFrame, Controller, EventHandler, Quat,
    js: { getClassName: cls => cls.name, getClassByName: name => name === 'Controller' ? Controller : null },
    isValid: n => Boolean(n?.valid), CCObjectFlags: { DontSave: 8 } };
  const scene = new Node('Scene'); scene.uuid = 'scene';
  const parent = new Node('Canvas'); parent.parent = scene; parent.addComponent(Canvas);
  const existing = new Node('Existing'); existing.parent = parent;
  const asset = new SpriteFrame(); asset.uuid = 'frame';
  let current = scene;
  const { createNodeBatchMethods } = require(modulePath);
  const methods = createNodeBatchMethods({ cc, getScene: () => current,
    findNode: ({ uuid }) => all.find(n => n.uuid === uuid && n.valid),
    hasLinkedPrefabAncestor: node => Boolean(node.linked),
    resolveScriptClass: uuid => uuid === SCRIPT_UUID && !control.unregistered ? Controller : null,
    getEventHandlerComponentName: event => event.component,
    resolveButtonEventMethod: (object, name) => {
      if (['constructor', 'onLoad', 'update', 'destroy'].includes(name)) return null;
      for (let p = object; p && p !== Component.prototype; p = Object.getPrototypeOf(p)) {
        const descriptor = Object.getOwnPropertyDescriptor(p, name);
        if (descriptor) return typeof descriptor.value === 'function' ? descriptor.value : null;
      }
      return null;
    },
    convertEditableComponentValue: async ({ kind }, value) => {
      if (['number', 'boolean', 'string'].includes(kind) && typeof value !== kind) throw new Error('Invalid property value');
      return value;
    },
    componentRuntimeValue: value => value,
    loadAssetByUuid: async uuid => { if (control.driftOnLoad) control.driftOnLoad(); if (uuid !== 'frame') throw new Error('Asset load failed'); return control.wrongAsset ? new Asset() : asset; },
  });
  const args = { sceneUuid: 'scene', parentUuid: parent.uuid, batch: batch() };
  const execute = async (options = args) => {
    const expected = await methods.preflightNodeBatch(options);
    return methods.createNodeBatch({ ...options, expected, assets: [{ id: 'frame', uuid: 'frame', type: 'cc.SpriteFrame' }, { id: SCRIPT_UUID, uuid: SCRIPT_UUID, type: 'cc.Script' }] });
  };
  return { methods, args, execute, scene, parent, existing, all, control, cc, asset, switchScene: () => { current = new Node('Other'); } };
}

function addScriptEvent(f) {
  f.args.batch.nodes[1].components.push({ id: 'controller', type: 'script', scriptUuid: SCRIPT_UUID });
  f.args.batch.events = [{ buttonComponentId: 'button', targetComponentId: 'controller', handler: 'onAction', customEventData: 'resume' }];
}
test('batch preflights script identity without construction and binds real EventHandler targets before activation', async () => {
  const f = fixture(); addScriptEvent(f); f.control.failScript = true;
  const before = f.all.length; const preflight = await f.methods.preflightNodeBatch(f.args);
  assert.equal(f.all.length, before); assert.deepEqual(preflight.assetReferences, [{ id: SCRIPT_UUID, type: 'cc.Script' }]);
  f.control.failScript = false; const r = await f.execute(); assert.equal(r.created, true); assert.equal(r.eventCount, 1);
  const root = f.parent.children.at(-1), target = root.children[0], event = root.getComponent(f.cc.Button).clickEvents[0];
  assert.equal(event.target, target); assert.equal(event.component, 'Controller'); assert.equal(event.handler, 'onAction'); assert.equal(event.customEventData, 'resume');
  assert.equal(target.getComponent(f.cc.Controller).hits, 0, 'building never invokes an event');
  assert.equal(r.scriptEffects, 'not_audited');
});
test('multiple ordered events and repeated script assets on distinct nodes keep exact new targets', async () => {
  const f = fixture(); addScriptEvent(f);
  f.args.batch.nodes[0].components.push({ id: 'secondController', type: 'script', scriptUuid: SCRIPT_UUID });
  f.args.batch.events.push({ buttonComponentId: 'button', targetComponentId: 'secondController', handler: 'onAction' });
  const r = await f.execute(); assert.equal(r.created, true); assert.equal(r.eventCount, 2);
  const root = f.parent.children.at(-1); const events = root.getComponent(f.cc.Button).clickEvents;
  assert.deepEqual(events.map(e => e.target), [root.children[0], root]); assert.deepEqual(events.map(e => e.customEventData), ['resume', '']);
});
test('event readback failure does not leave created UI or execute callbacks', async () => {
  const f = fixture(); addScriptEvent(f);
  f.control.onAdd = (node, c) => { if (c instanceof f.cc.Button) Object.defineProperty(c, 'clickEvents', { get: () => [], set() {} }); };
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.phase, 'verify'); assert.equal(r.cleanup.status, 'complete');
  assert.deepEqual(f.parent.children, [f.existing]);
});
test('a script cannot add undeclared dependencies or acquire existing children during failure cleanup', async () => {
  const f = fixture(); addScriptEvent(f);
  f.control.onAdd = (node, c) => { if (c instanceof f.cc.Controller) { node.addComponent(f.cc.ProgressBar); f.existing.parent = node; } };
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'partial');
  assert.equal(f.existing.valid, true); assert.equal(f.existing.parent.name, 'Caption'); assert.equal(r.scriptEffects, 'not_audited');
});
test('script class changes during async asset preparation are rejected before any new nodes', async () => {
  const f = fixture(); addScriptEvent(f); addAssetReference(f); f.control.driftOnLoad = () => { f.control.unregistered = true; };
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'not_needed'); assert.deepEqual(f.parent.children, [f.existing]);
});
for (const change of [
  f => { f.control.unregistered = true; }, f => { f.args.batch.events[0].handler = 'missing'; },
  f => { f.args.batch.events[0].handler = 'onLoad'; }, f => { f.args.batch.events[0].handler = 'destroy'; },
  f => { f.args.batch.nodes[1].components.push({ id: 'duplicateScript', type: 'script', scriptUuid: SCRIPT_UUID }); },
  f => { f.args.batch.nodes[1].components.at(-1).properties = { hits: 7 }; },
  f => { f.args.batch.events[0].targetComponentId = 'text'; }, f => { f.args.batch.events[0].buttonComponentId = 'text'; },
]) test(`script/event live preflight refuses without new nodes: ${change}`, async () => {
  const f = fixture(); addScriptEvent(f); change(f); const before = f.all.length;
  await assert.rejects(f.methods.preflightNodeBatch(f.args)); assert.equal(f.all.length, before);
});
for (const cause of ['constructor', 'event', 'method shadow']) test(`script/event failure cleans only new nodes: ${cause}`, async () => {
  const f = fixture(); addScriptEvent(f);
  if (cause === 'constructor') f.control.failScript = true;
  else if (cause === 'event') f.control.failEvent = true;
  else f.control.onAdd = (node, c) => { if (c instanceof f.cc.Controller) c.onAction = null; };
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'complete');
  assert.deepEqual(f.parent.children, [f.existing]); assert.equal(r.scriptEffects, 'not_audited');
});

test('preflight checks the actual target without constructing nodes', async () => {
  const f = fixture(); const count = f.all.length;
  const result = await f.methods.preflightNodeBatch(f.args);
  assert.equal(result.sceneUuid, 'scene'); assert.equal(result.parentUuid, f.parent.uuid); assert.equal(f.all.length, count);
});
test('creates parent-first nodes, explicit components and real internal identities', async () => {
  const f = fixture(); const r = await f.execute();
  assert.equal(r.created, true); assert.equal(r.verified, true); assert.equal(r.needsSave, true); assert.equal(r.undo.recorded, false);
  const root = f.parent.children.find(n => n.name === 'Panel'); const child = root.children[0];
  assert.equal(root.getComponent(f.cc.Button).target, child); assert.equal(child.getComponent(f.cc.Label).string, 'Batch');
  assert.equal(r.identities.nodes.panel, root.uuid); assert.equal(r.identities.components.text, child.getComponent(f.cc.Label).uuid);
  assert.equal(f.existing.parent, f.parent); assert.equal(f.existing.valid, true);
});
test('creates and verifies node transforms, inactive state and component enabled state', async () => {
  const f = fixture();
  Object.assign(f.args.batch.nodes[0], {
    active: false,
    position: { x: 4, y: 5, z: 6 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 2, y: 3, z: 4 },
  });
  f.args.batch.nodes[0].components[0].enabled = false;
  const r = await f.execute();
  assert.equal(r.created, true);
  const root = f.parent.children.at(-1);
  assert.equal(root.active, false);
  assert.deepEqual(root.position, { x: 4, y: 5, z: 6 });
  assert.deepEqual(root.rotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(root.scale, { x: 2, y: 3, z: 4 });
  assert.equal(root.getComponent(f.cc.UITransform).enabled, false);
});
test('position readback accepts bounded engine float noise but still rejects material drift', async () => {
  const accepted = fixture(); accepted.args.batch.nodes[0].position = { x: 4, y: 5, z: 6 };
  accepted.control.positionOffset = 1e-7;
  assert.equal((await accepted.execute()).created, true);
  const rejected = fixture(); rejected.args.batch.nodes[0].position = { x: 4, y: 5, z: 6 };
  rejected.control.positionOffset = 1e-3;
  const result = await rejected.execute();
  assert.equal(result.created, false); assert.equal(result.phase, 'verify'); assert.equal(result.cleanup.status, 'complete');
});
for (const change of [
  f => { f.args.sceneUuid = 'wrong'; }, f => { f.args.parentUuid = 'missing'; },
  f => { f.parent.linked = true; }, f => { f.parent._objFlags = 8; },
  f => { f.parent.addComponent(f.cc.Layout).enabled = true; },
  f => { f.existing.name = 'Panel'; },
  f => { f.args.batch.nodes[1].components[1].type = 'UserScript'; },
  f => { f.args.batch.nodes[1].components[1].properties.badField = true; },
  f => { f.args.batch.nodes[1].components[1].properties.string = 12; },
  f => { f.args.batch.nodes[1].components.shift(); },
  f => { f.args.batch.nodes[0].components.push({ id: 'duplicate', type: 'cc.Button' }); },
  f => { f.args.batch.nodes.push({ ...f.args.batch.nodes[1], id: 'sameName', components: [] }); },
  f => { f.parent.components = []; },
  f => { f.args.batch.references[0].to = { kind: 'external', id: 'existing' }; f.args.batch.externalPolicy = 'resolve'; },
  f => { f.args.batch.references[0].to = { kind: 'component', id: 'text' }; },
  f => { f.args.batch.externalPolicy = 'clear'; f.args.batch.references[0].to = { kind: 'external', id: f.existing.uuid }; },
  f => { f.args.batch.references = []; f.args.batch.nodes[0].components[1].properties.target = null; },
]) {
  test(`unsafe live preflight refuses before any creation: ${change}`, async () => {
    const f = fixture(); change(f); const count = f.all.length;
    await assert.rejects(f.methods.preflightNodeBatch(f.args)); assert.equal(f.all.length, count); assert.equal(f.existing.valid, true);
  });
}
test('plain nodes can be created without a Canvas', async () => {
  const f = fixture(); f.parent.components = []; f.args.batch.nodes.forEach(n => { n.components = []; }); f.args.batch.references = [];
  assert.equal((await f.execute()).created, true);
});
test('external clear binds null without resolving or editing the external target', async () => {
  const f = fixture(); f.args.batch.externalPolicy = 'clear';
  f.args.batch.nodes[1].components[1] = { id: 'sprite', type: 'cc.Sprite' };
  f.args.batch.references = [{ from: { nodeId: 'label', componentId: 'sprite', property: 'spriteFrame' }, to: { kind: 'external', id: 'old-frame' } }];
  assert.equal((await f.execute()).created, true); assert.equal(f.parent.children.at(-1).children[0].getComponent(f.cc.Sprite).spriteFrame, null); assert.equal(f.existing.valid, true);
});
function addAssetReference(f) {
  f.args.batch.nodes[1].components[1] = { id: 'sprite', type: 'cc.Sprite' };
  f.args.batch.references.push({ from: { nodeId: 'label', componentId: 'sprite', property: 'spriteFrame' }, to: { kind: 'asset', id: 'frame' } });
}
test('loads and binds a verified asset before creating nodes', async () => {
  const f = fixture(); addAssetReference(f); const r = await f.execute(); assert.equal(r.created, true);
  assert.equal(f.parent.children.at(-1).children[0].getComponent(f.cc.Sprite).spriteFrame, f.asset);
});
test('asset type failure leaves the scene untouched', async () => {
  const f = fixture(); addAssetReference(f); f.control.wrongAsset = true; const count = f.all.length;
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'not_needed'); assert.equal(f.all.length, count);
});
test('rechecks target after asynchronous asset loading', async () => {
  const f = fixture(); addAssetReference(f); f.control.driftOnLoad = () => { f.existing.name = 'Panel'; };
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'not_needed'); assert.equal(f.parent.children.length, 1);
});
for (const phase of ['creation', 'component']) {
  test(`failure during ${phase} removes only the new batch`, async () => {
    const f = fixture(); if (phase === 'creation') f.control.failName = 'Caption'; else f.control.failComponent = f.cc.Label;
    const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'complete');
    assert.deepEqual(f.parent.children, [f.existing]); assert.equal(f.existing.valid, true);
  });
}
test('partial cleanup reports retained node UUIDs and requires manual review', async () => {
  const f = fixture(); f.control.failName = 'Caption'; f.control.failDestroy = 'Panel';
  const r = await f.execute(); assert.equal(r.created, false); assert.equal(r.cleanup.status, 'partial'); assert.equal(r.cleanup.requiresManualReview, true);
  assert.equal(r.cleanup.remainingNodeIds.length, 1); assert.equal(f.existing.valid, true);
});
test('a changed target between preflight and execution never creates', async () => {
  const f = fixture(); const expected = await f.methods.preflightNodeBatch(f.args); f.parent.layer = 1;
  const r = await f.methods.createNodeBatch({ ...f.args, expected, assets: [] }); assert.equal(r.created, false); assert.equal(f.parent.children.length, 1);
});

test('internal component bindings use the newly created Sprite identity', async () => {
  const f = fixture(); f.args.batch.nodes[1].components[1] = { id: 'sprite', type: 'cc.Sprite' };
  f.args.batch.nodes[0].components.push({ id: 'bar', type: 'cc.ProgressBar', properties: { progress: 0.4 } });
  f.args.batch.references.push({ from: { nodeId: 'panel', componentId: 'bar', property: 'barSprite' }, to: { kind: 'component', id: 'sprite' } });
  const result = await f.execute(); assert.equal(result.created, true);
  const root = f.parent.children.at(-1); assert.equal(root.getComponent(f.cc.ProgressBar).barSprite, root.children[0].getComponent(f.cc.Sprite));
});

test('property readback mismatch cleans up all new nodes', async () => {
  const f = fixture(); f.control.onAdd = (node, component) => {
    if (component instanceof f.cc.Label) Object.defineProperty(component, 'string', { get: () => 'Wrong', set() {} });
  };
  const result = await f.execute(); assert.equal(result.created, false); assert.equal(result.phase, 'verify');
  assert.equal(result.cleanup.status, 'complete'); assert.deepEqual(f.parent.children, [f.existing]);
});

test('cleanup never recursively destroys an adopted existing descendant', async () => {
  const f = fixture(); f.control.onAdd = node => { if (node.name === 'Caption') f.existing.parent = node; };
  f.control.failComponent = f.cc.Label;
  const result = await f.execute(); assert.equal(result.cleanup.status, 'partial'); assert.equal(result.cleanup.remainingNodeIds.length, 2);
  assert.equal(f.existing.valid, true); assert.equal(result.cleanup.requiresManualReview, true); assert.equal(result.needsSave, null);
});

test('cleanup refuses a created node moved under an unrelated existing node', async () => {
  const f = fixture(); f.control.onAdd = node => { if (node.name === 'Caption') node.parent = f.existing; };
  f.control.failComponent = f.cc.Label;
  const result = await f.execute(); assert.equal(result.cleanup.status, 'partial'); assert.equal(result.cleanup.remainingNodeIds.length, 1);
  assert.equal(f.existing.valid, true); assert.equal(f.existing.children[0].valid, true);
});

test('scene changes while loading assets cause no batch writes', async () => {
  const f = fixture(); addAssetReference(f); f.control.driftOnLoad = f.switchScene;
  const result = await f.execute(); assert.equal(result.created, false); assert.equal(result.cleanup.status, 'not_needed');
  assert.deepEqual(f.parent.children, [f.existing]);
});

function uiFixture() {
  const f = fixture(); f.args.batch.ui = true; f.parent.addComponent(f.cc.UITransform);
  const cameraNode = new f.cc.Node('Camera'); cameraNode.parent = f.scene;
  f.camera = cameraNode.addComponent(f.cc.Camera);
  f.parent.getComponent(f.cc.Canvas).cameraComponent = f.camera;
  f.args.batch.nodes[0].position = { x: 25, y: -45, z: 0 };
  f.args.batch.nodes[1].components[1].properties = { overflow: 1, fontSize: 24, lineHeight: 30, string: 'Fixed size' };
  return f;
}
test('UI batch creates local positions and fixed label settings with validated Canvas/Camera context', async () => {
  const f = uiFixture(); const before = await f.methods.preflightNodeBatch(f.args);
  assert.equal(before.uiContext.canvasUuid, f.parent.uuid); assert.equal(before.uiContext.cameraUuid, f.camera.uuid);
  const result = await f.execute(); assert.equal(result.created, true);
  assert.deepEqual(f.parent.children.at(-1).position, { x: 25, y: -45, z: 0 });
  assert.equal(f.parent.children.at(-1).children[0].getComponent(f.cc.Label).overflow, 1);
  assert.deepEqual(result.uiContext, before.uiContext);
});
for (const change of [
  f => { f.parent.getComponent(f.cc.Canvas).cameraComponent = null; },
  f => { f.camera.visibility = 1; }, f => { f.camera.enabled = false; },
  f => { f.parent.layer = 33554433; }, f => { f.parent.layer = 0; },
  f => { f.camera.node.active = false; }, f => { f.camera.node.parent = null; },
  f => { f.camera.node._objFlags = 8; }, f => { f.camera.targetTexture = {}; },
  f => { f.parent.getComponent(f.cc.Canvas).enabled = false; }, f => { f.parent.active = false; },
  f => { f.parent.components = f.parent.components.filter(c => !(c instanceof f.cc.UITransform)); },
  f => { f.args.batch.nodes[1].components = []; },
  f => { f.args.batch.nodes[1].components[1].properties.overflow = 0; },
  f => { f.args.batch.nodes[1].components[1].properties.fontSize = -1; },
  f => { f.args.batch.nodes[1].components[1].properties.lineHeight = '20'; },
]) test(`UI batch refuses unsupported rendering/size context before writes: ${change}`, async () => {
  const f = uiFixture(); change(f); const count = f.all.length;
  await assert.rejects(f.methods.preflightNodeBatch(f.args)); assert.equal(f.all.length, count);
});
test('UI camera context drift after asset loading is refused before creating nodes', async () => {
  const f = uiFixture(); addAssetReference(f); f.args.batch.nodes[1].components[1].properties = { sizeMode: 0 };
  f.control.driftOnLoad = () => { f.camera.visibility = 1; };
  const result = await f.execute(); assert.equal(result.created, false);
  assert.equal(result.cleanup.status, 'not_needed'); assert.deepEqual(f.parent.children, [f.existing]);
});
test('UI camera context drift during creation cleans up only its new nodes', async () => {
  const f = uiFixture(); f.control.onAdd = () => { f.camera.enabled = false; };
  const result = await f.execute(); assert.equal(result.created, false);
  assert.equal(result.cleanup.status, 'complete'); assert.deepEqual(f.parent.children, [f.existing]);
});
test('a local position readback mismatch cleans up the batch', async () => {
  const f = uiFixture(); f.control.ignorePosition = true;
  const result = await f.execute(); assert.equal(result.created, false); assert.equal(result.phase, 'verify');
  assert.equal(result.cleanup.status, 'complete'); assert.deepEqual(f.parent.children, [f.existing]);
});

test('UI batches accept a nested UI parent and retain the nearest Canvas identity', async () => {
  const f = uiFixture(); const outerCanvas = f.parent;
  const target = new f.cc.Node('NestedParent'); target.parent = outerCanvas; target.addComponent(f.cc.UITransform);
  f.args.parentUuid = target.uuid;
  const result = await f.execute(); assert.equal(result.created, true);
  assert.equal(result.uiContext.canvasUuid, outerCanvas.uuid); assert.equal(result.parentUuid, target.uuid);
  assert.deepEqual(target.children[0].position, { x: 25, y: -45, z: 0 });
});
test('nested Canvas context uses its own associated camera, not the outer Canvas camera', async () => {
  const f = uiFixture(); const nested = new f.cc.Node('NestedCanvas'); nested.parent = f.parent; nested.addComponent(f.cc.UITransform);
  const cameraNode = new f.cc.Node('NestedCamera'); cameraNode.parent = f.scene;
  const camera = cameraNode.addComponent(f.cc.Camera); nested.addComponent(f.cc.Canvas).cameraComponent = camera;
  f.args.parentUuid = nested.uuid; f.camera.enabled = false;
  const result = await f.execute(); assert.equal(result.created, true);
  assert.equal(result.uiContext.canvasUuid, nested.uuid); assert.equal(result.uiContext.cameraUuid, camera.uuid);
});

test('exports the supported DTO subset and remaps internal node and asset references on create', async () => {
  const f = fixture();
  const root = new f.cc.Node('TransferRoot'); root.parent = f.parent;
  root.setPosition(4, 5, 6); root.setScale(2, 3, 4); root.active = false;
  root.addComponent(f.cc.UITransform).enabled = false;
  const button = root.addComponent(f.cc.Button);
  const child = new f.cc.Node('Icon'); child.parent = root; child.addComponent(f.cc.UITransform);
  const sprite = child.addComponent(f.cc.Sprite); sprite.spriteFrame = f.asset; button.target = child;

  const exported = await f.methods.exportNodeBatch({ sceneUuid: 'scene', rootUuids: [root.uuid] });
  assert.equal(exported.batch.nodes.length, 2);
  assert.equal(exported.batch.ui, true);
  assert.equal(exported.batch.nodes[0].active, false);
  assert.deepEqual(exported.batch.nodes[0].scale, { x: 2, y: 3, z: 4 });
  assert.equal(exported.batch.nodes[0].components[0].enabled, false);
  assert.deepEqual(exported.batch.references.map(ref => ref.to.kind).sort(), ['asset', 'node']);

  const target = new f.cc.Node('TargetCanvas'); target.parent = f.scene; target.addComponent(f.cc.UITransform);
  const targetCanvas = target.addComponent(f.cc.Canvas);
  const cameraNode = new f.cc.Node('TargetCamera'); cameraNode.parent = f.scene;
  targetCanvas.cameraComponent = cameraNode.addComponent(f.cc.Camera);
  const options = { sceneUuid: 'scene', parentUuid: target.uuid, batch: exported.batch };
  const expected = await f.methods.preflightNodeBatch(options);
  const result = await f.methods.createNodeBatch({ ...options, expected,
    assets: [{ id: 'frame', uuid: 'frame', type: 'cc.SpriteFrame' }] });
  assert.equal(result.created, true);
  const copied = target.children[0], copiedChild = copied.children[0];
  assert.notEqual(copied.uuid, root.uuid);
  assert.equal(copied.getComponent(f.cc.Button).target, copiedChild);
  assert.equal(copiedChild.getComponent(f.cc.Sprite).spriteFrame, f.asset);
});

test('export rejects external references by default and clear never makes an external Button target safe', async () => {
  const f = fixture();
  const root = new f.cc.Node('TransferRoot'); root.parent = f.parent; root.addComponent(f.cc.UITransform);
  const button = root.addComponent(f.cc.Button); button.target = f.existing;
  await assert.rejects(() => f.methods.exportNodeBatch({ sceneUuid: 'scene', rootUuids: [root.uuid] }), /external/i);
  await assert.rejects(() => f.methods.exportNodeBatch({ sceneUuid: 'scene', rootUuids: [root.uuid], externalPolicy: 'clear' }), /Button\.target/);
});

test('cut deletion refuses incoming references and deletes only an unchanged reviewed batch', async () => {
  const f = fixture();
  const root = new f.cc.Node('TransferRoot'); root.parent = f.parent;
  const child = new f.cc.Node('Child'); child.parent = root;
  const exported = await f.methods.exportNodeBatch({ sceneUuid: 'scene', rootUuids: [root.uuid] });
  const outsideButton = f.existing.addComponent(f.cc.Button); outsideButton.target = root;
  const refused = await f.methods.deleteNodeBatchRoots({ sceneUuid: 'scene', parentUuid: f.parent.uuid,
    rootUuids: [root.uuid], batch: exported.batch });
  assert.equal(refused.deleted, false); assert.match(refused.error, /referenced outside/i);
  outsideButton.target = null;
  const deleted = await f.methods.deleteNodeBatchRoots({ sceneUuid: 'scene', parentUuid: f.parent.uuid,
    rootUuids: [root.uuid], batch: exported.batch });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.nodeCount, 2);
  assert.equal(root.valid, false);
  assert.equal(f.existing.valid, true);
});
