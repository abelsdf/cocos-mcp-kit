'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

function fixture(size = { width: 1280, height: 720 }, fail = false) {
  const created = [];
  class Node {
    constructor(name) { this.name = name; this.uuid = `id-${created.length}`; this.children = []; this.components = []; created.push(this); }
    set parent(p) { this._parent = p; p.children.push(this); }
    get parent() { return this._parent; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); return c; }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    destroy() { this.destroyed = true; }
  }
  class Scene extends Node {}
  class UITransform { setContentSize(width, height) { this.width = width; this.height = height; } }
  class Canvas {}
  class Camera { static ProjectionType = { ORTHO: 1 }; }
  class SceneAsset {}
  const current = new Scene('Existing');
  const file = path.resolve(__dirname, '../scene.js'), requireLocal = createRequire(file), exports = {};
  let serialized;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports, console,
    cce: { Utils: { serialize: asset => { serialized = asset.scene; if (fail) throw new Error('serialize failed'); return '[]'; } } },
    require: id => id === 'cc' ? { Node, Scene, SceneAsset, UITransform, Canvas, Camera, view: { getDesignResolutionSize: () => size },
      Layers: { Enum: { UI_2D: 33554432 } }, director: { getScene: () => current }, js: {},
      Prefab: { _utils: { TargetInfo: class {}, PropertyOverrideInfo: class {} } } } : requireLocal(id),
  }, { filename: file });
  return { methods: exports.methods, current, created, serialized: () => serialized, Canvas, Camera };
}

for (const [width, height] of [[1280, 720], [720, 1280]]) test(`UI scene serializes detached Canvas/Camera for ${width}x${height}`, async () => {
  const f = fixture({ width, height });
  const result = await f.methods.serializeScene({ mode: 'ui', sceneName: 'NewUI' });
  const root = f.serialized(), [canvas, camera] = root.children;
  assert.equal(f.current.children.length, 0); assert.equal(f.current.name, 'Existing'); assert.equal(f.current.destroyed, undefined);
  assert.equal(root.destroyed, true); assert.equal(root.name, 'NewUI');
  assert.equal(canvas.components[0].width, width); assert.equal(canvas.components[0].height, height);
  assert.equal(canvas.components[1].cameraComponent, camera.components[0]); assert.equal(canvas.components[1].alignCanvasWithScreen, false);
  assert.equal(camera.components[0].projection, 1); assert.equal(camera.components[0].orthoHeight, height / 2);
  assert.equal(camera.components[0].visibility, canvas.layer); assert.equal(camera.position.z, 1000);
  assert.equal(result.ui.parentUuid, canvas.uuid); assert.equal(result.ui.cameraUuid, camera.uuid);
});

test('invalid design resolution destroys temporary scene without touching current scene', async () => {
  const f = fixture({ width: NaN, height: 720 });
  await assert.rejects(() => f.methods.serializeScene({ mode: 'ui' }), /design resolution/);
  assert.equal(f.created[1].destroyed, true); assert.equal(f.current.children.length, 0);
});

test('serializer failure destroys only the temporary UI scene', async () => {
  const f = fixture(undefined, true);
  await assert.rejects(() => f.methods.serializeScene({ mode: 'ui' }), /serialize failed/);
  assert.equal(f.created[1].destroyed, true); assert.equal(f.current.destroyed, undefined);
});
