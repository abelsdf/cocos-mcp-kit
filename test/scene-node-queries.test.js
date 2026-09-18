'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

let nextId = 1;
class MockNode {
  constructor(name, uuid) {
    this.name = name;
    this.uuid = uuid || `new-${nextId++}`;
    this.children = [];
    this.components = [];
    this.active = true;
    this.layer = 1;
    this.position = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0, w: 1 };
    this.scale = { x: 1, y: 1, z: 1 };
    this._objFlags = 0;
    this._parent = null;
  }

  get parent() { return this._parent; }
  set parent(value) {
    if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1);
    this._parent = value;
    if (value) value.children.push(this);
  }

  getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }
}

function sceneMethods() {
  const scene = new MockNode('Scene', 'scene');
  const add = (parent, name, uuid) => {
    const node = new MockNode(name, uuid);
    node.parent = parent;
    return node;
  };
  const first = add(scene, 'Canvas', 'canvas-a');
  add(first, 'Button', 'button-a');
  const second = add(scene, 'Canvas', 'canvas-b');
  add(second, 'Button', 'button-b');
  const camera = add(scene, 'Camera', 'camera');

  const sceneFile = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(sceneFile);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(sceneFile, 'utf8'), {
    Editor: { App: { path: '' } },
    module: { paths: [] },
    exports,
    require: (id) => id === 'cc'
      ? { Node: MockNode, CCObjectFlags: { DontSave: 8 }, director: { getScene: () => scene } }
      : localRequire(id),
    console,
  }, { filename: sceneFile });
  return { scene, first, second, camera, methods: exports.methods };
}

test('scene hierarchy reports count and depth truncation', async () => {
  const { methods } = sceneMethods();
  const limited = await methods.getHierarchy({ maxDepth: 4, maxNodes: 2 });
  assert.equal(limited.returnedNodes, 2);
  assert.equal(limited.truncated, true);
  assert.equal(limited.truncationReasons.includes('maxNodes'), true);

  const shallow = await methods.getSceneInfo({ maxDepth: 1, maxNodes: 10 });
  assert.equal(shallow.returnedNodes, 3);
  assert.equal(shallow.truncationReasons.includes('maxDepth'), true);
});

test('scene queries return unique UUID targets and bounded search results', async () => {
  const { methods, second } = sceneMethods();
  await assert.rejects(() => methods.getHierarchy({ rootPath: 'Canvas' }), /Candidates:.*canvas-a.*canvas-b/);
  const subtree = await methods.getHierarchy({ rootUuid: second.uuid, maxDepth: 4 });
  assert.equal(subtree.uuid, second.uuid);
  assert.equal(subtree.returnedNodes, 2);
  assert.equal(subtree.truncated, false);

  const found = await methods.findNodes({ name: 'Button', maxResults: 1 });
  assert.equal(found.count, 2);
  assert.equal(found.returnedCount, 1);
  assert.equal(found.truncated, true);
  await assert.rejects(() => methods.getHierarchy({ maxNodes: 0 }), /maxNodes must be an integer/);
  await assert.rejects(() => methods.findNodes({ maxResults: 501 }), /maxResults must be an integer/);
});

test('ambiguous or stale selectors cannot change another node', async () => {
  const { methods, scene, second, camera } = sceneMethods();
  await assert.rejects(() => methods.inspectNode({ name: 'Button' }), /Candidates:.*button-a.*button-b/);
  await assert.rejects(() => methods.deleteNode({ uuid: 'missing', name: 'Camera' }), /not found/);
  assert.equal(camera.parent, scene);

  await assert.rejects(() => methods.createNode({ name: 'New', parentPath: 'Canvas' }), /Candidates:.*canvas-a.*canvas-b/);
  assert.equal(second.children.length, 1);
  const created = await methods.createNode({ name: 'New', parentUuid: second.uuid });
  assert.equal(created.created, true);
  assert.equal(second.children.length, 2);
});

test('Creator DontSave helper roots are excluded from scene queries and node targets', async () => {
  const { scene, methods } = sceneMethods();
  const helper = new MockNode('Editor Scene Foreground', 'editor-helper');
  helper._objFlags = 8 | 1024;
  helper.parent = scene;
  const hiddenChild = new MockNode('Button', 'editor-button');
  hiddenChild.parent = helper;

  const info = await methods.getSceneInfo({ maxDepth: 2 });
  assert.equal(info.childCount, 3);
  assert.equal(info.returnedNodes, 5);
  assert.equal(info.nodes.some((node) => node.name === helper.name), false);

  const hierarchy = await methods.getHierarchy({ maxDepth: 2 });
  assert.equal(hierarchy.nodes.length, 3);
  const found = await methods.findNodes({ name: 'Button' });
  assert.equal(found.count, 2);
  assert.equal(found.nodes.some((node) => node.uuid === hiddenChild.uuid), false);
  await assert.rejects(() => methods.inspectNode({ uuid: helper.uuid }), /not found/);
  await assert.rejects(() => methods.createNode({ name: 'Oops', parentUuid: helper.uuid }), /Parent not found/);
});
