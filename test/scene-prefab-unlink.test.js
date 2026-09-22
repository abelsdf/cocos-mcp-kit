'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  class Node {
    constructor(name, uuid, parent = null) {
      Object.assign(this, { name, uuid, parent, children: [], components: [], _objFlags: 0, layer: 1, active: true,
        position: { x: 0, y: -2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 2, z: 1 } });
      if (parent) parent.children.push(this);
    }
  }
  const scene = new Node('Scene', 'scene');
  const root = new Node('Instance', 'root', scene);
  root._prefab = { root, asset: { uuid: 'asset' }, fileId: 'root-file', instance: { fileId: 'instance-id' } };
  const child = new Node('Child', 'child', root);
  child._prefab = { root, asset: root._prefab.asset, fileId: 'child-file' };
  child.components.push({ uuid: 'component', __prefab: { fileId: 'component-file' } });
  const file = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(file);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports, console,
    require: id => id === 'cc' ? { Node, director: { getScene: () => scene }, CCObjectFlags: { DontSave: 8 },
      js: { getClassName: () => 'cc.Sprite' } } : localRequire(id),
  }, { filename: file });
  return { Node, scene, root, child, methods: exports.methods };
}

test('unlink snapshot is read-only and captures node/transform/component/link identity', () => {
  const f = fixture();
  const result = f.methods.getPrefabUnlinkState({ uuid: 'root', path: 'Instance' });
  assert.equal(result.sceneUuid, 'scene');
  assert.equal(result.linkedAncestor, false);
  assert.equal(result.node.parentUuid, 'scene');
  assert.equal(result.nodes.length, 2);
  const root = JSON.parse(JSON.stringify(result.nodes[0]));
  assert.deepEqual(root.position, { x: 0, y: -2, z: 3 });
  assert.deepEqual(root.scale, { x: 1, y: 2, z: 1 });
  assert.deepEqual(root.prefab, { rootUuid: 'root', assetUuid: 'asset', fileId: 'root-file', instanceId: 'instance-id' });
  assert.equal(result.nodes[1].components[0].prefab.fileId, 'component-file');
  assert.equal(f.root._prefab.instance.fileId, 'instance-id');
});

test('unlink snapshot marks nested instance subtrees for rejection, including mounted plain nodes', () => {
  const f = fixture();
  const nested = new f.Node('Nested', 'nested', f.root);
  nested._prefab = { root: nested, asset: { uuid: 'inner' }, fileId: 'inner-file', instance: { fileId: 'inner-instance' } };
  new f.Node('Mounted', 'mounted', nested);
  const result = f.methods.getPrefabUnlinkState({ uuid: 'root' });
  assert.deepEqual(Array.from(result.nodes, row => row.nested), [false, false, true, true]);
  assert.equal(result.nodes[2].prefab.instanceId, 'inner-instance');
  assert.equal(f.methods.getPrefabUnlinkState({ uuid: 'nested' }).linkedAncestor, true);
});

test('unlink snapshot refuses scene roots, missing and mismatched targets', () => {
  const f = fixture();
  for (const args of [{ uuid: 'scene' }, { uuid: 'missing' }, { uuid: 'root', path: 'Instance/Child' }]) {
    assert.throws(() => f.methods.getPrefabUnlinkState(args), /Target.*found|scene root/i);
  }
});

test('unlink snapshot rejects ambiguous names and hidden subtree members', () => {
  const f = fixture();
  new f.Node('Instance', 'duplicate', f.scene);
  assert.throws(() => f.methods.getPrefabUnlinkState({ name: 'Instance' }), /matched 2/);
  f.child._objFlags = 8;
  assert.throws(() => f.methods.getPrefabUnlinkState({ uuid: 'root' }), /editor-only/i);
});

test('unlink snapshot refuses more than 5000 nodes instead of verifying a partial subtree', () => {
  const f = fixture();
  for (let index = 0; index < 4999; index += 1) new f.Node(`Extra${index}`, `extra-${index}`, f.root);
  assert.throws(() => f.methods.getPrefabUnlinkState({ uuid: 'root' }), /5000/);
});

test('unlink snapshot can verify ordinary nodes after the native operation', () => {
  const f = fixture();
  f.root._prefab = f.child._prefab = null;
  f.child.components[0].__prefab = null;
  const result = f.methods.getPrefabUnlinkState({ uuid: 'root' });
  assert.equal(result.nodes.every(row => row.prefab === null), true);
  assert.equal(result.nodes[1].components[0].prefab, null);
});
