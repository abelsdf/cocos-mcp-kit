'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  class UITransform {}
  class Canvas {}
  class Widget { constructor() { this.enabled = true; } }
  class Layout { constructor() { this.enabled = true; } }
  class Node {
    constructor(name, uuid, parent = null) {
      Object.assign(this, { name, uuid, parent, children: [], components: [], _objFlags: 0, position: { x: 3, y: -4, z: 5 } });
      if (parent) parent.children.push(this);
    }
    getComponent(type) { return this.components.find(component => component instanceof type) || null; }
  }
  class Prefab { constructor(data) { this.data = data; this.uuid = 'prefab'; } }
  const scene = new Node('Scene', 'scene');
  const canvas = new Node('Canvas', 'canvas', scene);
  canvas.components.push(new Canvas());
  const parent = new Node('Container', 'parent', canvas);
  const plainParent = new Node('Plain', 'plain', scene);
  const root = new Node('PrefabRoot', 'asset-root');
  root.components.push(new UITransform());
  const state = { activeScene: scene, asset: new Prefab(root), loads: 0 };
  const file = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(file);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports, console,
    require: (id) => id === 'cc' ? {
      Node, Prefab, UITransform, Canvas, Widget, Layout, Vec3: class {}, Quat: class {}, Color: class {},
      CCObjectFlags: { DontSave: 8 },
      director: { getScene: () => state.activeScene },
      instantiate: () => assert.fail('Preflight must not instantiate or change the scene'),
      assetManager: { loadAny: (uuid, callback) => {
        state.loads += 1;
        if (state.onLoad) state.onLoad();
        callback(state.loadError ? new Error(state.loadError) : null, state.asset);
      } },
    } : localRequire(id),
  }, { filename: file });
  return { Node, Canvas, Widget, Layout, scene, canvas, parent, plainParent, root, state, methods: exports.methods };
}

test('prefab preflight returns a read-only parent snapshot and template local defaults', async () => {
  const f = fixture();
  new f.Node('Existing', 'existing', f.parent);
  const context = await f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentPath: 'Canvas/Container', parentUuid: 'parent' });
  assert.deepEqual(JSON.parse(JSON.stringify(context)), {
    sceneUuid: 'scene', parentUuid: 'parent', childUuids: ['existing'], name: 'PrefabRoot', position: { x: 3, y: -4, z: 5 },
  });
  assert.equal(f.parent.children.length, 1);
  assert.equal(f.root.parent, null);
  assert.equal(f.root.name, 'PrefabRoot');
});

test('prefab preflight accepts an exact parent UUID, trims names and preserves zero coordinates', async () => {
  const f = fixture();
  const context = await f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent',
    name: ' Instance ', position: { x: 0, y: -7, z: 0 } });
  assert.equal(context.name, 'Instance');
  assert.deepEqual(JSON.parse(JSON.stringify(context.position)), { x: 0, y: -7, z: 0 });
  assert.deepEqual(f.root.position, { x: 3, y: -4, z: 5 });
});

test('prefab preflight refuses missing, conflicting and ambiguous parents', async () => {
  const f = fixture();
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'missing' }), /Parent not found/);
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent', parentPath: 'Plain' }), /Parent not found/);
  new f.Node('Container', 'duplicate', f.canvas);
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentPath: 'Canvas/Container' }), /matched 2 nodes/);
  assert.equal(f.state.loads, 0);
});

test('linked ancestors and editor-only nodes cannot become instance parents', async () => {
  const f = fixture();
  f.canvas._prefab = { asset: { uuid: 'linked' } };
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /linked prefab/);
  delete f.canvas._prefab;
  f.parent._objFlags = 8;
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /Parent not found/);
  assert.equal(f.state.loads, 0);
});

test('UI prefab preflight refuses automatic Canvas insertion and Canvas roots with editor-controlled placement', async () => {
  const f = fixture();
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'plain' }), /requires a Canvas/);
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab' }), /requires a Canvas/);
  f.root.components.push(new f.Canvas());
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab' }), /Canvas root/);
  assert.equal(f.scene.children.length, 2);
});

test('prefab preflight refuses an enabled root Widget that can replace the local position', async () => {
  const f = fixture();
  f.root.components.push(new f.Widget());
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /Widget/);
  assert.equal(f.parent.children.length, 0);
});

test('prefab preflight refuses an enabled parent Layout that can replace the local position', async () => {
  const f = fixture();
  f.parent.components.push(new f.Layout());
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /Layout/);
  assert.equal(f.parent.children.length, 0);
});

test('disabled Widget and Layout components do not own the instance position', async () => {
  const f = fixture();
  const widget = new f.Widget();
  const layout = new f.Layout();
  widget.enabled = layout.enabled = false;
  f.root.components.push(widget);
  f.parent.components.push(layout);
  const context = await f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' });
  assert.equal(context.parentUuid, 'parent');
});

test('ordinary non-UI prefabs can be instantiated at the scene root', async () => {
  const f = fixture();
  f.root.components = [];
  const context = await f.methods.preparePrefabInstance({ prefabUuid: 'prefab' });
  assert.equal(context.parentUuid, 'scene');
});

for (const change of ['scene', 'parent', 'prefab-parent']) {
  test(`prefab preflight detects ${change} changes during asynchronous loading`, async () => {
    const f = fixture();
    f.state.onLoad = () => {
      if (change === 'scene') f.state.activeScene = new f.Node('Other', 'other');
      if (change === 'parent') f.canvas.children = [];
      if (change === 'prefab-parent') f.parent._prefab = { instance: {} };
    };
    await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /changed while loading/);
  });
}

test('prefab preflight rejects load errors, wrong types and mismatched UUIDs without mutations', async () => {
  const f = fixture();
  f.state.loadError = 'import failed';
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /import failed/);
  delete f.state.loadError;
  f.state.asset.uuid = 'wrong';
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /not a Prefab/);
  f.state.asset = { uuid: 'prefab', data: f.root };
  await assert.rejects(f.methods.preparePrefabInstance({ prefabUuid: 'prefab', parentUuid: 'parent' }), /not a Prefab/);
  assert.equal(f.parent.children.length, 0);
});

test('prefab inspection reports the actual root, parent, scene and local position', async () => {
  const f = fixture();
  f.parent._prefab = { root: f.parent, asset: f.state.asset, fileId: 'root-file-id', instance: { fileId: 'instance-id' } };
  const info = await f.methods.getPrefabInstanceInfo({ uuid: 'parent' });
  assert.equal(info.sceneUuid, 'scene');
  assert.equal(info.node.parentUuid, 'canvas');
  assert.equal(info.prefab.rootUuid, 'parent');
  assert.equal(info.prefab.instance.fileId, 'instance-id');
  assert.deepEqual(JSON.parse(JSON.stringify(info.node.position)), f.parent.position);
});
