'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const subject = () => require('../lib/ui-viewport-scene');
const rect = { x: 0, y: 0, width: 100, height: 100 };
const quad = (x, y, w, h, z = 10) => [{ x, y, z }, { x: x + w, y, z }, { x: x + w, y: y + h, z }, { x, y: y + h, z }];
for (const [name, points, expected] of [
  ['inside', quad(10, 10, 20, 20), 'inside'], ['on boundary', quad(0, 0, 100, 100), 'inside'],
  ['partial', quad(80, 20, 50, 20), 'partial'], ['outside', quad(101, 20, 10, 20), 'outside'],
  ['viewport enclosed without an inside corner', quad(-20, -20, 140, 140), 'partial'],
  ['overlapping AABBs but disjoint polygons', [{ x: 90, y: 150, z: 10 }, { x: 150, y: 90, z: 10 }, { x: 160, y: 100, z: 10 }, { x: 100, y: 160, z: 10 }], 'outside'],
  ['behind camera', quad(10, 10, 20, 20, -10), 'outside'], ['past far plane', quad(10, 10, 20, 20, 101), 'outside'],
  ['crossing near plane', [{ x: 10, y: 10, z: 0 }, { x: 30, y: 10, z: 2 }, { x: 30, y: 30, z: 2 }, { x: 10, y: 30, z: 0 }], 'partial'],
]) test(`camera clipping: ${name}`, () => assert.equal(subject().classifyClipping(points, rect, 1, 100).status, expected));

function fixture() {
  let counter = 0; const all = [];
  class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } static transformMat4(out, point, matrix) { return Object.assign(out, matrix.toLocal(point)); } }
  class Node {
    constructor(name, parent = null) { Object.assign(this, { name, uuid: `n${++counter}`, parent, active: true, layer: 33554432, components: [], position: new Vec3(), scale: new Vec3(1, 1, 1), angle: 0, valid: true }); all.push(this); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    get worldMatrix() { return { det: this.scale.x * this.scale.y * this.scale.z * (this.parent?.worldMatrix.det || 1) }; }
    world(p) { const a = this.angle * Math.PI / 180; const x = p.x * this.scale.x, y = p.y * this.scale.y; const q = new Vec3(x * Math.cos(a) - y * Math.sin(a) + this.position.x, x * Math.sin(a) + y * Math.cos(a) + this.position.y, p.z * this.scale.z + this.position.z); return this.parent ? this.parent.world(q) : q; }
    local(point) { const p = this.parent ? this.parent.local(point) : point; const a = -this.angle * Math.PI / 180, x = p.x - this.position.x, y = p.y - this.position.y; return new Vec3((x * Math.cos(a) - y * Math.sin(a)) / this.scale.x, (x * Math.sin(a) + y * Math.cos(a)) / this.scale.y, (p.z - this.position.z) / this.scale.z); }
    add(type) { const c = new type(); c.node = this; c.uuid = `c${++counter}`; this.components.push(c); return c; }
    getComponent(type) { return this.components.find(c => c instanceof type); }
  }
  class Component { constructor() { this.enabled = true; this.valid = true; } get enabledInHierarchy() { return this.enabled && this.node.activeInHierarchy; } }
  class UITransform extends Component {
    constructor() { super(); this.contentSize = { width: 100, height: 50 }; this.anchorPoint = { x: 0.5, y: 0.5 }; }
    convertToWorldSpaceAR(p) { return this.node.world(p); } convertToNodeSpaceAR(p) { return this.node.local(p); }
  }
  class Canvas extends Component { constructor() { super(); this.alignCanvasWithScreen = false; } }
  class Camera extends Component {
    static ProjectionType = { ORTHO: 0, PERSPECTIVE: 1 };
    constructor() { super(); Object.assign(this, { projection: 0, orthoHeight: 250, near: 1, far: 2000, rect: { x: 0, y: 0, width: 1, height: 1 }, visibility: 33554432, targetTexture: null }); }
    get camera() { return { width: 1000, height: 500, matView: { toLocal: p => this.node.local(p) }, update() {} }; }
    worldToScreen(p) { const q = this.node.local(p); return new Vec3(q.x + 500, q.y + 250, (-q.z - this.near) / (this.far - this.near)); }
    screenPointToRay(x, y) { const o = this.node.world(new Vec3(x - 500, y - 250, -this.near)); return { o, d: new Vec3(0, 0, -1) }; }
  }
  const cc = { Vec3, Node, UITransform, Canvas, Camera, Mat4: { determinant: m => m.det }, CCObjectFlags: { DontSave: 8 }, isValid: x => Boolean(x?.valid) };
  const scene = new Node('Scene'); scene.uuid = 'scene'; const canvasNode = new Node('Canvas', scene); const canvas = canvasNode.add(Canvas); canvasNode.add(UITransform).contentSize = { width: 1000, height: 500 };
  const cameraNode = new Node('Camera', scene); cameraNode.position.z = 1000; const camera = cameraNode.add(Camera); canvas.cameraComponent = camera;
  const node = new Node('Target', canvasNode); const ui = node.add(UITransform);
  const methods = subject().createUIViewportMethods({ cc, getScene: () => scene, findNode: ({ uuid }) => all.find(n => n.uuid === uuid && n.valid) });
  const args = { sceneUuid: 'scene', nodeUuids: [node.uuid] };
  return { methods, args, cc, all, scene, canvasNode, canvas, cameraNode, camera, node, ui, run: () => methods.getUIViewport(args) };
}
test('UI viewport distinguishes local/world/Canvas coordinates from actual edit-camera buffer pixels', () => {
  const f = fixture(); const r = f.run(); assert.equal(r.complete, true); assert.equal(r.scope, 'edit_scene_camera');
  const n = r.nodes[0]; assert.equal(n.clipping.status, 'inside');
  assert.deepEqual(n.bounds.local.aabb, { minX: -50, minY: -25, maxX: 50, maxY: 25 });
  assert.deepEqual(n.bounds.screen.aabb, { minX: 450, minY: 225, maxX: 550, maxY: 275 });
  assert.deepEqual(n.camera.renderSize, { width: 1000, height: 500 });
  assert.deepEqual(n.canvas.viewport.aabb, { minX: -500, minY: -250, maxX: 500, maxY: 250 });
  assert.equal(n.canvas.uuid, f.canvasNode.uuid); assert.equal(n.camera.uuid, f.camera.uuid);
});
test('anchored UI geometry follows ancestor rotation, translation and negative scale without including descendants', () => {
  const f = fixture(); f.ui.anchorPoint = { x: 0, y: 1 }; f.node.position = new f.cc.Vec3(30, 40, 0); f.canvasNode.position = new f.cc.Vec3(100, 50, 0); f.canvasNode.angle = 90; f.node.scale.x = -2;
  const child = new f.cc.Node('UnrelatedChild', f.node); child.position.x = 10000; child.add(f.cc.UITransform);
  const n = f.run().nodes[0]; assert.ok(Math.abs(n.bounds.world.aabb.minX - 60) < 1e-6); assert.ok(Math.abs(n.bounds.world.aabb.maxY - 80) < 1e-6);
  for (const [key, expected] of Object.entries({ minX: -170, minY: -10, maxX: 30, maxY: 40 })) assert.ok(Math.abs(n.bounds.canvas.aabb[key] - expected) < 1e-6);
});
test('node can be partially clipped even when its center is inside', () => {
  const f = fixture(); f.node.position.x = 490; const n = f.run().nodes[0]; assert.equal(n.clipping.status, 'partial');
});
for (const [name, mutate, reason] of [
  ['missing UI', f => { f.node.components = []; }, 'missing_ui_transform'],
  ['missing Canvas', f => { f.canvasNode.components = f.canvasNode.components.filter(c => !(c instanceof f.cc.Canvas)); }, 'missing_canvas'],
  ['missing camera', f => { f.canvas.cameraComponent = null; }, 'missing_camera'],
  ['inactive target', f => { f.node.active = false; }, 'inactive_target'],
  ['disabled Canvas', f => { f.canvas.enabled = false; }, 'inactive_canvas'],
  ['disabled camera', f => { f.camera.enabled = false; }, 'inactive_camera'],
  ['different camera scene', f => { f.cameraNode.parent = null; }, 'camera_outside_scene'],
  ['editor-only camera', f => { f.cameraNode._objFlags = 8; }, 'camera_outside_scene'],
  ['partial layer mask', f => { f.node.layer = 33554433; }, 'layer_not_visible'],
  ['render texture', f => { f.camera.targetTexture = {}; }, 'render_texture_unsupported'],
  ['perspective', f => { f.camera.projection = 1; }, 'perspective_unsupported'],
  ['zero scale', f => { f.node.scale.x = 0; }, 'degenerate_transform'],
  ['singular camera', f => { f.cameraNode.scale.z = 0; }, 'degenerate_transform'],
  ['bad near/far', f => { f.camera.far = 0; }, 'invalid_camera_geometry'],
  ['non-finite projection', f => { f.camera.worldToScreen = () => ({ x: NaN, y: 0, z: 0 }); }, 'non_finite_geometry'],
]) test(`explicit unavailable viewport: ${name}`, () => {
  const f = fixture(); mutate(f); const r = f.run(); assert.equal(r.complete, false); assert.equal(r.nodes[0].clipping.status, 'unavailable'); assert.equal(r.nodes[0].reason, reason);
});
test('querying does not create, destroy, save, change properties or include unrequested nodes', () => {
  const f = fixture(); const before = f.all.map(n => ({ uuid: n.uuid, position: { ...n.position }, scale: { ...n.scale }, active: n.active, components: n.components.length }));
  assert.equal(f.run().nodes.length, 1); assert.deepEqual(f.all.map(n => ({ uuid: n.uuid, position: { ...n.position }, scale: { ...n.scale }, active: n.active, components: n.components.length })), before);
});

test('public camera matrix refresh prevents mixed new metadata and stale projected bounds', () => {
  const f = fixture(); const cached = { x: 0, ortho: 250 }; let updates = 0;
  const render = { width: 1000, height: 500, matView: { toLocal: p => new f.cc.Vec3(p.x - cached.x, p.y, p.z - 1000) },
    update(force) { assert.equal(force, true); updates++; cached.x = f.cameraNode.position.x; cached.ortho = f.camera.orthoHeight; } };
  Object.defineProperty(f.camera, 'camera', { get: () => render });
  f.camera.worldToScreen = p => new f.cc.Vec3(500 + (p.x - cached.x) * 250 / cached.ortho, 250 + p.y * 250 / cached.ortho, 0.5);
  f.camera.screenPointToRay = (x, y) => ({ o: new f.cc.Vec3(cached.x + (x - 500) * cached.ortho / 250, (y - 250) * cached.ortho / 250, 999), d: new f.cc.Vec3(0, 0, -1) });
  f.cameraNode.position.x = 100; f.camera.orthoHeight = 500; f.node.position.x = 100;
  const r = f.run(); assert.equal(r.complete, true); assert.equal(updates, 1);
  assert.deepEqual(r.nodes[0].bounds.screen.aabb, { minX: 475, maxX: 525, minY: 237.5, maxY: 262.5 });
  assert.deepEqual(r.nodes[0].canvas.viewport.aabb, { minX: -900, maxX: 1100, minY: -500, maxY: 500 });
  assert.equal(f.cameraNode.position.x, 100); assert.equal(f.camera.orthoHeight, 500);
});

test('unavailable or failing matrix refresh never returns a complete projection', () => {
  for (const update of [undefined, () => { throw new Error('refresh failed'); }]) {
    const f = fixture(); const render = { ...f.camera.camera, update };
    Object.defineProperty(f.camera, 'camera', { get: () => render });
    const r = f.run(); assert.equal(r.complete, false); assert.equal(r.nodes[0].available, false);
    assert.equal(r.nodes[0].bounds.screen, undefined);
  }
});

test('zero render size and invalid viewport are unavailable instead of using design dimensions', () => {
  const f = fixture(); Object.defineProperty(f.camera, 'camera', { get: () => ({ width: 0, height: 0 }) });
  assert.equal(f.run().nodes[0].reason, 'invalid_camera_geometry');
  const second = fixture(); second.camera.rect.width = 0;
  assert.equal(second.run().nodes[0].reason, 'invalid_camera_geometry');
});
test('an edge-on Canvas plane is unavailable without inventing local viewport corners', () => {
  const f = fixture(); f.camera.screenPointToRay = () => ({ o: new f.cc.Vec3(0, 0, 10), d: new f.cc.Vec3(1, 0, 0) });
  const r = f.run(); assert.equal(r.complete, false); assert.equal(r.nodes[0].available, true);
  assert.equal(r.nodes[0].canvas.viewport.reason, 'canvas_plane_parallel_to_camera');
  assert.equal(r.nodes[0].canvas.viewport.corners, undefined);
});
test('nearest Canvas supplies its camera and missing association does not silently use another one', () => {
  const f = fixture(); const inner = new f.cc.Node('Inner', f.canvasNode); inner.add(f.cc.UITransform);
  const canvas = inner.add(f.cc.Canvas); f.node.parent = inner;
  assert.equal(f.run().nodes[0].reason, 'missing_camera');
  const cameraNode = new f.cc.Node('OtherCamera', f.scene); cameraNode.position.z = 1000; const camera = cameraNode.add(f.cc.Camera);
  canvas.cameraComponent = camera; f.camera.enabled = false;
  const r = f.run(); assert.equal(r.complete, true); assert.equal(r.nodes[0].camera.uuid, camera.uuid); assert.equal(r.nodes[0].canvas.uuid, inner.uuid);
});
test('missing IDs are partial results, but scene mismatch and malformed inputs fail', () => {
  const f = fixture(); f.args.nodeUuids.push('missing'); const r = f.run(); assert.equal(r.nodes[0].available, true); assert.equal(r.nodes[1].reason, 'node_not_found'); assert.equal(r.complete, false);
  f.args.sceneUuid = 'other'; assert.throws(f.run, /scene/i);
  for (const args of [{}, { sceneUuid: 'scene', nodeUuids: [] }, { sceneUuid: 'scene', nodeUuids: ['same', 'same'] }, { sceneUuid: 'scene', nodeUuids: Array(129).fill('n') }, { sceneUuid: 'scene', nodeUuids: ['n'], force: true }]) assert.throws(() => subject().validateViewportOptions(args));
});
