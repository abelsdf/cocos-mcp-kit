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
  class Component {}
  class Asset { constructor() { this.uuid = 'asset-reference'; } }
  class Color { get r() { throw new Error('Color getter must not be evaluated'); } }
  Color.__values__ = ['r'];
  class Probe extends Component {}
  Probe.__values__ = ['node', '__prefab', 'target', 'label', 'asset', 'events'];
  const scene = new Node('Scene');
  const root = new Node('Root', scene);
  const child = new Node('Child', root);
  root._prefab = { root, asset: { uuid: 'prefab' }, fileId: 'root-file', instance: { fileId: 'instance', mountedChildren: [], mountedComponents: [], removedComponents: [] } };
  child._prefab = { root, asset: root._prefab.asset, fileId: 'child-file' };
  const component = Object.assign(new Probe(), { node: root, uuid: 'component', __prefab: { fileId: 'component-file' }, target: child, label: null, asset: new Asset(), events: [{ target: root }] });
  root.components.push(component);
  const file = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(file);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports, console,
    require: id => id === 'cc' ? { Node, Component, Asset, Color, director: { getScene: () => scene }, CCObjectFlags: { DontSave: 8 }, js: { getClassName: value => value.constructor.name } } : localRequire(id),
  }, { filename: file });
  return { Node, Component, Probe, Color, scene, root, child, component, methods: exports.methods };
}
test('apply preflight permits internal node/component and imported asset references without mutation', () => {
  const f = fixture();
  f.component.label = f.component;
  const state = f.methods.getPrefabApplyState({ uuid: 'Root' });
  assert.equal(state.node.uuid, 'Root');
  assert.equal(state.nodes.length, 2);
  assert.equal(f.component.target, f.child);
  assert.equal(f.root._prefab.instance.fileId, 'instance');
});
for (const field of ['target', 'label', 'events']) {
  test(`apply preflight rejects external references in ${field}`, () => {
    const f = fixture();
    const outside = new f.Node('Outside', f.scene);
    const external = Object.assign(new f.Component(), { node: outside });
    f.component[field] = field === 'target' ? outside : field === 'label' ? external : [{ target: outside }];
    assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /external|outside/i);
  });
}
for (const field of ['mountedChildren', 'mountedComponents', 'removedComponents']) {
  test(`apply preflight rejects pending ${field}`, () => {
    const f = fixture();
    f.root._prefab.instance[field].push({});
    assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /structure|mounted|removed/i);
  });
}
test('apply reference preflight refuses accessors instead of invoking them', () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.component, 'target', { get() { reads += 1; return f.child; } });
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /accessor|getter/i);
  assert.equal(reads, 0);
});
test('apply reference checks skip exact engine numeric value types without invoking their accessors', () => {
  const f = fixture();
  f.component.events = [new f.Color()];
  assert.equal(f.methods.getPrefabApplyState({ uuid: 'Root' }).node.uuid, 'Root');
});
test('apply does not exempt custom subclasses of engine value types from reference checks', () => {
  const f = fixture();
  class CustomColor extends f.Color {}
  f.component.events = [new CustomColor()];
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /accessor|getter/i);
});
test('apply reference preflight refuses missing serialization metadata', () => {
  const f = fixture();
  delete f.Probe.__values__;
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /serializ|metadata/i);
});
test('apply reference preflight does not scan nonserialized runtime fields', () => {
  const f = fixture();
  f.component.runtimeOnly = f.scene;
  assert.equal(f.methods.getPrefabApplyState({ uuid: 'Root' }).node.uuid, 'Root');
});
test('apply refuses opaque containers instead of missing references in their internal storage', () => {
  const f = fixture();
  f.component.events = new Map([['external', f.scene]]);
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /serializ|metadata|opaque/i);
});
test('apply refuses nested custom serializers without invoking them', () => {
  const f = fixture();
  f.component.events = { _serialize() { throw new Error('must not run'); } };
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /serializ/i);
});
test('apply checks value metadata without evaluating a custom constructor accessor', () => {
  const f = fixture();
  let reads = 0;
  f.component.events = Object.defineProperty({}, 'constructor', { get() { reads += 1; return Object; } });
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /accessor|getter/i);
  assert.equal(reads, 0);
});
test('apply refuses unsaved asset references and incomplete deep scans', () => {
  const f = fixture();
  f.component.asset.uuid = '';
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /asset/i);
  f.component.asset.uuid = 'asset';
  f.component.events = Array.from({ length: 100001 }, () => null);
  assert.throws(() => f.methods.getPrefabApplyState({ uuid: 'Root' }), /100000|limit/i);
});
