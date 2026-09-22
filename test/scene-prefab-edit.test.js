'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  class Node {
    constructor(name, parent = null) {
      Object.assign(this, { name, uuid: name, parent, children: [], components: [], _objFlags: 0, active: true, layer: 1,
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
      if (parent) parent.children.push(this);
    }
  }
  const scene = new Node('Scene');
  const wrapper = new Node('Wrapper', scene); wrapper._objFlags = 512;
  const root = new Node('Root', wrapper);
  root._prefab = { root, asset: { uuid: 'asset' }, fileId: 'root-file', instance: null };
  const file = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(file);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports, console,
    require: id => id === 'cc' ? { Node, director: { getScene: () => scene }, CCObjectFlags: { DontSave: 8 },
      js: { getClassName: value => value.constructor.name } } : localRequire(id),
  }, { filename: file });
  return { Node, scene, wrapper, root, methods: exports.methods };
}
test('edit root query discovers the source root under a hidden editor wrapper without mutation', () => {
  const f = fixture(); const state = f.methods.getPrefabEditingState({ prefabUuid: 'asset' });
  assert.equal(state.node.uuid, 'Root');
  assert.equal(state.nodes[0].prefab.instanceId, '');
  assert.equal(f.wrapper._objFlags, 512);
});
test('edit root query refuses missing, instance-only and ambiguous roots', () => {
  const f = fixture();
  assert.throws(() => f.methods.getPrefabEditingState({ prefabUuid: 'missing' }), /root|found/i);
  f.root._prefab.instance = { fileId: 'linked' };
  assert.throws(() => f.methods.getPrefabEditingState({ prefabUuid: 'asset' }), /root|found/i);
  f.root._prefab.instance = null;
  const duplicate = new f.Node('Duplicate', f.wrapper);
  duplicate._prefab = { root: duplicate, asset: { uuid: 'asset' }, fileId: 'duplicate' };
  assert.throws(() => f.methods.getPrefabEditingState({ prefabUuid: 'asset' }), /root|multiple|ambiguous/i);
});
test('edit root query ignores DontSave editor helpers', () => {
  const f = fixture(); const helper = new f.Node('Helper', f.scene);
  helper._objFlags = 8; helper._prefab = { root: helper, asset: { uuid: 'asset' } };
  assert.equal(f.methods.getPrefabEditingState({ prefabUuid: 'asset' }).node.uuid, 'Root');
});
test('edit root query refuses incomplete scans', () => {
  const f = fixture();
  for (let index = 0; index < 5000; index += 1) new f.Node(`Extra${index}`, f.scene);
  assert.throws(() => f.methods.getPrefabEditingState({ prefabUuid: 'asset' }), /5000|limit/i);
});
