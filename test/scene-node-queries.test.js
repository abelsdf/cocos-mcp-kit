'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

let nextId = 1;
class MockQuat {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  static fromEuler(out, x, y, z) {
    assert.equal(x, 0);
    assert.equal(y, 0);
    out.x = 0; out.y = 0;
    out.z = Math.sin(z * Math.PI / 360);
    out.w = Math.cos(z * Math.PI / 360);
    return out;
  }
}
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

  get worldPosition() {
    const parentPosition = this.parent ? this.parent.worldPosition : { x: 0, y: 0, z: 0 };
    return {
      x: parentPosition.x + this.position.x,
      y: parentPosition.y + this.position.y,
      z: parentPosition.z + this.position.z,
    };
  }

  setParent(parent, keepWorldTransform = false) {
    const worldPosition = this.worldPosition;
    this.parent = parent;
    if (keepWorldTransform) {
      const parentPosition = parent.worldPosition;
      this.position = {
        x: worldPosition.x - parentPosition.x,
        y: worldPosition.y - parentPosition.y,
        z: worldPosition.z - parentPosition.z,
      };
    }
  }

  getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }

  setSiblingIndex(index) {
    if (!this.parent) throw new Error('Node has no parent');
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    siblings.splice(Math.min(index, siblings.length), 0, this);
  }

  removeFromParent() { this.parent = null; }
  destroy() { this.destroyed = true; }
  setPosition(x, y, z) { this.position = { x, y, z }; }
  setRotation(x, y, z, w) { this.rotation = { x, y, z, w }; }
  setRotationFromEuler(x, y, z) { this.rotation = MockQuat.fromEuler(new MockQuat(), x, y, z); }
  setScale(x, y, z) { this.scale = { x, y, z }; }
}

function instantiateNode(source) {
  const copy = new MockNode(source.name);
  copy.active = source.active;
  copy.layer = source.layer;
  copy.position = { ...source.position };
  copy.rotation = { ...source.rotation };
  copy.scale = { ...source.scale };
  copy.components = source.components.map((component) => ({ ...component }));
  for (const child of source.children) instantiateNode(child).parent = copy;
  return copy;
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
      ? { Node: MockNode, Quat: MockQuat, instantiate: instantiateNode, CCObjectFlags: { DontSave: 8 }, director: { getScene: () => scene } }
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

test('moveNode preserves world position by default and local position when requested', async () => {
  const { methods, scene, first, second } = sceneMethods();
  first.position = { x: 100, y: 0, z: 0 };
  second.position = { x: 300, y: 0, z: 0 };
  const button = first.children[0];
  button.position = { x: 25, y: 0, z: 0 };

  const worldMove = await methods.moveNode({ uuid: button.uuid, parentUuid: second.uuid });
  assert.equal(worldMove.moved, true);
  assert.equal(worldMove.previousPath, 'Canvas/Button');
  assert.equal(worldMove.path, 'Canvas/Button');
  assert.equal(worldMove.keepWorldTransform, true);
  assert.equal(button.parent, second);
  assert.equal(button.worldPosition.x, 125);
  assert.equal(button.position.x, -175);

  const localMove = await methods.moveNode({ uuid: button.uuid, parentUuid: first.uuid, keepWorldTransform: false });
  assert.equal(localMove.moved, true);
  assert.equal(button.position.x, -175);
  assert.equal(button.worldPosition.x, -75);
  const noOp = await methods.moveNode({ uuid: button.uuid, parentUuid: first.uuid });
  assert.equal(noOp.moved, false);
  const rootMove = await methods.moveNode({ uuid: button.uuid, parentPath: '/' });
  assert.equal(rootMove.parentUuid, scene.uuid);
  assert.equal(button.parent, scene);
});

test('resetNodeTransform resets selected local fields and reports the before and after values', async () => {
  const { methods, first } = sceneMethods();
  first.setPosition(25, -4, 2);
  first.setRotation(0, 0, 0.5, Math.sqrt(0.75));
  first.setScale(2, 3, 1);
  const selected = await methods.resetNodeTransform({ uuid: first.uuid, fields: ['position', 'scale'] });
  assert.equal(selected.reset, true);
  assert.equal(selected.nodeUuid, first.uuid);
  assert.deepEqual(Array.from(selected.changedFields), ['position', 'scale']);
  assert.deepEqual(first.position, { x: 0, y: 0, z: 0 });
  assert.deepEqual(first.scale, { x: 1, y: 1, z: 1 });
  assert.equal(first.rotation.z, 0.5);
  assert.equal(selected.before.position.x, 25);
  const remaining = await methods.resetNodeTransform({ uuid: first.uuid });
  assert.deepEqual(Array.from(remaining.changedFields), ['rotation']);
  assert.deepEqual(first.rotation, { x: 0, y: 0, z: 0, w: 1 });
});

test('resetNodeTransform rejects invalid fields, linked prefabs and rolls back failed setters', async () => {
  const { methods, scene, first } = sceneMethods();
  first.setPosition(8, 9, 10);
  first.setScale(2, 2, 2);
  for (const fields of [[], ['position', 'position'], ['active'], 'position']) {
    await assert.rejects(() => methods.resetNodeTransform({ uuid: first.uuid, fields }), /fields must be/);
  }
  await assert.rejects(() => methods.resetNodeTransform({ uuid: scene.uuid }), /Target scene node/);
  await assert.rejects(() => methods.resetNodeTransform({ uuid: 'stale' }), /Target scene node/);
  first._prefab = { instance: {} };
  await assert.rejects(() => methods.resetNodeTransform({ uuid: first.uuid }), /linked prefab/);
  first._prefab = null;
  assert.deepEqual(first.position, { x: 8, y: 9, z: 10 });
  let failed = false;
  first.setScale = (x, y, z) => {
    if (!failed) { failed = true; throw new Error('scale failure'); }
    MockNode.prototype.setScale.call(first, x, y, z);
  };
  await assert.rejects(() => methods.resetNodeTransform({ uuid: first.uuid }), /scale failure/);
  assert.deepEqual(first.position, { x: 8, y: 9, z: 10 });
  assert.deepEqual(first.scale, { x: 2, y: 2, z: 2 });
});

test('batchModifyNodes applies ordered complete fields, including zero scale and rotation', async () => {
  const { methods, first, camera } = sceneMethods();
  const report = await methods.batchModifyNodes({ changes: [
    { uuid: first.uuid, position: { x: 4, y: -2, z: 0 }, scale: { x: 0, y: 2, z: 1 }, active: false },
    { uuid: camera.uuid, eulerAngles: { x: 0, y: 0, z: 90 } },
  ] });
  assert.equal(report.completed, true);
  assert.equal(report.allSucceeded, true);
  assert.equal(report.attempted, 2);
  assert.equal(report.succeeded, 2);
  assert.deepEqual(first.position, { x: 4, y: -2, z: 0 });
  assert.deepEqual(first.scale, { x: 0, y: 2, z: 1 });
  assert.equal(first.active, false);
  assert.ok(Math.abs(camera.rotation.z - Math.SQRT1_2) < 1e-5);
  assert.equal(report.results[0].before.active, true);
  assert.equal(report.results[0].after.scale.x, 0);
});

test('batchModifyNodes stop and continue policies report failed indices without undoing prior successes', async () => {
  const stopped = sceneMethods();
  const changes = [
    { uuid: stopped.first.uuid, position: { x: 8, y: 0, z: 0 } },
    { uuid: 'stale', active: false },
    { uuid: stopped.camera.uuid, active: false },
  ];
  const stopReport = await stopped.methods.batchModifyNodes({ changes });
  assert.equal(stopReport.completed, false);
  assert.equal(stopReport.succeeded, 1);
  assert.equal(stopReport.failed, 1);
  assert.equal(stopReport.stoppedAtIndex, 1);
  assert.equal(stopReport.results[1].status, 'failed');
  assert.equal(stopped.first.position.x, 8);
  assert.equal(stopped.camera.active, true);

  const continued = sceneMethods();
  changes[0].uuid = continued.first.uuid;
  changes[2].uuid = continued.camera.uuid;
  const continueReport = await continued.methods.batchModifyNodes({ changes, onError: 'continue' });
  assert.equal(continueReport.completed, true);
  assert.equal(continueReport.allSucceeded, false);
  assert.equal(continueReport.succeeded, 2);
  assert.equal(continueReport.failed, 1);
  assert.equal(continued.camera.active, false);
});

test('batchModifyNodes validates each step and rolls back a setter failure', async () => {
  const { methods, scene, first, camera } = sceneMethods();
  for (const options of [
    { changes: [] }, { changes: [{}], onError: 'skip' },
    { changes: Array.from({ length: 51 }, () => ({})) },
  ]) await assert.rejects(() => methods.batchModifyNodes(options));

  first.setPosition(3, 4, 5);
  first.setScale(2, 2, 2);
  let failed = false;
  first.setScale = (x, y, z) => {
    if (!failed) { failed = true; throw new Error('scale failure'); }
    MockNode.prototype.setScale.call(first, x, y, z);
  };
  const report = await methods.batchModifyNodes({ onError: 'continue', changes: [
    { uuid: first.uuid, position: { x: 9, y: 9, z: 9 }, scale: { x: 4, y: 4, z: 4 } },
    { name: 'Button', active: false },
    { uuid: scene.uuid, active: false },
    { uuid: camera.uuid, position: { x: 1, y: 2 } },
    { uuid: camera.uuid, active: false, unsupported: 1 },
    { uuid: camera.uuid, active: false },
  ] });
  assert.equal(report.failed, 5);
  assert.equal(report.succeeded, 1);
  assert.equal(report.results[0].rollbackStatus, 'restored');
  assert.match(report.results[0].error, /scale failure/);
  assert.match(report.results[1].error, /Candidates:/);
  assert.equal(report.results[1].rollbackStatus, 'not-needed');
  assert.deepEqual(first.position, { x: 3, y: 4, z: 5 });
  assert.deepEqual(first.scale, { x: 2, y: 2, z: 2 });
  assert.equal(camera.active, false);

  first._prefab = { instance: {} };
  const linked = await methods.batchModifyNodes({ changes: [{ uuid: first.uuid, active: false }] });
  assert.match(linked.results[0].error, /linked prefab/);
  assert.equal(first.active, true);
});

test('batchModifyNodes reports a failed rollback instead of claiming restoration', async () => {
  const { methods, first } = sceneMethods();
  let positionCalls = 0;
  first.setPosition = (x, y, z) => {
    positionCalls += 1;
    if (positionCalls === 2) throw new Error('restore position blocked');
    MockNode.prototype.setPosition.call(first, x, y, z);
  };
  first.setScale = () => { throw new Error('apply scale blocked'); };
  const report = await methods.batchModifyNodes({ changes: [{
    uuid: first.uuid,
    position: { x: 9, y: 0, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  }] });
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].rollbackStatus, 'failed');
  assert.match(report.results[0].error, /Step rollback failed: position: restore position blocked/);
  assert.equal(first.position.x, 9);
});

test('moveNode rejects ambiguous targets, cycles, invalid modes, and linked prefab hierarchies', async () => {
  const { methods, scene, first, second } = sceneMethods();
  const button = first.children[0];
  await assert.rejects(() => methods.moveNode({ name: 'Button', parentUuid: second.uuid }), /Candidates:.*button-a.*button-b/);
  await assert.rejects(() => methods.moveNode({ uuid: button.uuid, parentName: 'Canvas' }), /Candidates:.*canvas-a.*canvas-b/);
  await assert.rejects(() => methods.moveNode({ uuid: first.uuid, parentUuid: button.uuid }), /descendants/);
  await assert.rejects(() => methods.moveNode({ uuid: first.uuid, parentUuid: first.uuid }), /descendants/);
  await assert.rejects(() => methods.moveNode({ uuid: scene.uuid, parentUuid: first.uuid }), /scene root/);
  await assert.rejects(() => methods.moveNode({ uuid: button.uuid, parentPath: '/', keepWorldTransform: 'false' }), /boolean/);
  assert.equal(first.parent, scene);
  assert.equal(button.parent, first);

  first._prefab = { instance: {} };
  await assert.rejects(() => methods.moveNode({ uuid: button.uuid, parentUuid: second.uuid }), /linked prefab/);
  await assert.rejects(() => methods.moveNode({ uuid: second.uuid, parentUuid: first.uuid }), /linked prefab/);
  assert.equal(button.parent, first);
  assert.equal(second.parent, scene);

  first._prefab = { fileId: 'linked-file-id' };
  await assert.rejects(() => methods.moveNode({ uuid: button.uuid, parentUuid: second.uuid }), /linked prefab/);
});

test('reorderNode changes visible sibling order while ignoring editor-only helper nodes', async () => {
  const { methods, scene, first, second, camera } = sceneMethods();
  const helper = new MockNode('Editor Helper', 'editor-helper');
  helper._objFlags = 8;
  helper.parent = scene;
  helper.setSiblingIndex(1);
  assert.deepEqual(scene.children.map((node) => node.uuid), ['canvas-a', 'editor-helper', 'canvas-b', 'camera']);

  const moved = await methods.reorderNode({ uuid: camera.uuid, parentPath: '/', index: 0 });
  assert.equal(moved.reordered, true);
  assert.equal(moved.previousIndex, 2);
  assert.equal(moved.index, 0);
  assert.deepEqual(moved.siblingUuids, ['camera', 'canvas-a', 'canvas-b']);
  assert.deepEqual(scene.children.map((node) => node.uuid), ['camera', 'canvas-a', 'editor-helper', 'canvas-b']);

  const last = await methods.reorderNode({ uuid: camera.uuid, parentUuid: scene.uuid, index: 2 });
  assert.equal(last.reordered, true);
  assert.deepEqual(last.siblingUuids, ['canvas-a', 'canvas-b', 'camera']);
  assert.equal(camera.parent, scene);
  assert.equal(first.parent, scene);
  assert.equal(second.parent, scene);
  const noOp = await methods.reorderNode({ uuid: camera.uuid, index: 2 });
  assert.equal(noOp.reordered, false);
});

test('reorderNode rejects stale or ambiguous parents, invalid indices, and prefab nodes without mutation', async () => {
  const { methods, scene, first, second, camera } = sceneMethods();
  const initial = scene.children.map((node) => node.uuid);
  await assert.rejects(() => methods.reorderNode({ name: 'Canvas', index: 0 }), /Candidates:.*canvas-a.*canvas-b/);
  await assert.rejects(() => methods.reorderNode({ uuid: camera.uuid, parentUuid: first.uuid, index: 0 }), /no longer under/);
  await assert.rejects(() => methods.reorderNode({ uuid: camera.uuid, parentName: 'Canvas', index: 0 }), /Candidates:.*canvas-a.*canvas-b/);
  await assert.rejects(() => methods.reorderNode({ uuid: scene.uuid, index: 0 }), /scene root/);
  for (const index of [-1, 3, 1.5, '1', undefined]) {
    await assert.rejects(() => methods.reorderNode({ uuid: camera.uuid, index }), /index must be an integer/);
  }
  assert.deepEqual(scene.children.map((node) => node.uuid), initial);

  first._prefab = { instance: {} };
  await assert.rejects(() => methods.reorderNode({ uuid: first.children[0].uuid, index: 0 }), /linked prefab/);
  await assert.rejects(() => methods.reorderNode({ uuid: first.uuid, index: 0 }), /linked prefab/);
  assert.deepEqual(scene.children.map((node) => node.uuid), initial);
});

test('duplicateNode clones an ordinary subtree next to its source with fresh identities', async () => {
  const { methods, scene, first } = sceneMethods();
  first.position = { x: 45, y: 2, z: 0 };
  first.children[0].components.push({ kind: 'example' });
  const copy = await methods.duplicateNode({ uuid: first.uuid });
  assert.equal(copy.duplicated, true);
  assert.equal(copy.name, 'Canvas Copy');
  assert.equal(copy.clonedNodes, 2);
  assert.equal(copy.siblingIndex, 1);
  assert.notEqual(copy.uuid, first.uuid);
  assert.equal(scene.children[1].uuid, copy.uuid);
  assert.equal(scene.children[1].position.x, 45);
  assert.equal(scene.children[1].children[0].components[0].kind, 'example');
  assert.notEqual(scene.children[1].children[0].uuid, first.children[0].uuid);

  const secondCopy = await methods.duplicateNode({ uuid: first.uuid });
  assert.equal(secondCopy.name, 'Canvas Copy 2');
  assert.equal(scene.children[1].uuid, secondCopy.uuid);
  assert.equal(scene.children[2].uuid, copy.uuid);
});

test('duplicateNode rejects unsafe sources and invalid names before changing the scene', async () => {
  const { methods, scene, first, second } = sceneMethods();
  const original = scene.children.map((node) => node.uuid);
  await assert.rejects(() => methods.duplicateNode({ name: 'Canvas' }), /Candidates:.*canvas-a.*canvas-b/);
  await assert.rejects(() => methods.duplicateNode({ uuid: scene.uuid }), /scene root/);
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid, newName: '' }), /cannot be empty/);
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid, newName: 'Camera' }), /already exists/);
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid, newName: 'bad\/name' }), /path separator/);
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid, newName: 4 }), /must be a string/);
  assert.deepEqual(scene.children.map((node) => node.uuid), original);

  first._prefab = { instance: {} };
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid }), /linked prefab/);
  first._prefab = null;
  first.children[0]._prefab = { fileId: 'nested-prefab-node' };
  await assert.rejects(() => methods.duplicateNode({ uuid: first.uuid }), /linked prefab/);
  first.children[0]._prefab = null;
  const helper = new MockNode('Helper', 'hidden');
  helper._objFlags = 8;
  helper.parent = second;
  await assert.rejects(() => methods.duplicateNode({ uuid: second.uuid }), /editor-only nodes/);
  assert.deepEqual(scene.children.map((node) => node.uuid), original);
});

test('duplicateNode removes a partially attached clone when insertion fails', async () => {
  const { methods, scene, camera } = sceneMethods();
  const original = scene.children.map((node) => node.uuid);
  const setSiblingIndex = MockNode.prototype.setSiblingIndex;
  MockNode.prototype.setSiblingIndex = function (index) {
    if (this.name === 'Broken Copy') throw new Error('Injected insertion failure');
    return setSiblingIndex.call(this, index);
  };
  try {
    await assert.rejects(
      () => methods.duplicateNode({ uuid: camera.uuid, newName: 'Broken Copy' }),
      /Injected insertion failure/
    );
    assert.deepEqual(scene.children.map((node) => node.uuid), original);
  } finally {
    MockNode.prototype.setSiblingIndex = setSiblingIndex;
  }
});
