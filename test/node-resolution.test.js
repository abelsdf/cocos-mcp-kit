'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { nodePath, resolveNode } = require('../lib/node-resolution');

function makeTree() {
  const scene = { name: 'Scene', uuid: 'scene', parent: null, children: [] };
  const add = (parent, name, uuid) => {
    const node = { name, uuid, parent, children: [] };
    parent.children.push(node);
    return node;
  };
  const firstCanvas = add(scene, 'Canvas', 'canvas-a');
  const firstButton = add(firstCanvas, 'Button', 'button-a');
  const secondCanvas = add(scene, 'Canvas', 'canvas-b');
  const secondButton = add(secondCanvas, 'Button', 'button-b');
  const unique = add(scene, 'Camera', 'camera');
  return { scene, firstButton, secondButton, unique };
}

test('node selector refuses ambiguous names and paths with UUID candidates', () => {
  const { scene } = makeTree();
  for (const selector of [{ name: 'Button' }, { path: 'Canvas/Button' }]) {
    assert.throws(() => resolveNode(scene, selector), (error) => (
      error.code === 'AMBIGUOUS_NODE' &&
      error.candidates.length === 2 &&
      error.message.includes('button-a') &&
      error.message.includes('button-b')
    ));
  }
});

test('UUID narrows an ambiguous path and a stale UUID never falls back to a name', () => {
  const { scene, secondButton } = makeTree();
  assert.equal(resolveNode(scene, { uuid: 'button-b', path: 'Canvas/Button' }), secondButton);
  assert.equal(resolveNode(scene, { uuid: 'missing', name: 'Button' }), null);
  assert.equal(resolveNode(scene, { uuid: 'button-b', name: 'Camera' }), null);
});

test('unique names and scene-qualified paths resolve without changing node identity', () => {
  const { scene, unique } = makeTree();
  assert.equal(resolveNode(scene, { name: 'Camera' }), unique);
  assert.equal(resolveNode(scene, { path: 'Scene/Camera' }), unique);
  assert.equal(nodePath(scene, unique), 'Camera');
});

test('selector predicate omits hidden subtrees for both path and UUID lookup', () => {
  const { scene, secondButton } = makeTree();
  const hidden = { name: 'Canvas', uuid: 'hidden', parent: scene, children: [] };
  const hiddenButton = { name: 'Button', uuid: 'hidden-button', parent: hidden, children: [] };
  hidden.children.push(hiddenButton);
  scene.children.push(hidden);
  const includeNode = (node) => node !== hidden;
  assert.equal(resolveNode(scene, { uuid: 'hidden-button' }, { includeNode }), null);
  assert.equal(resolveNode(scene, { path: 'Canvas/Button', uuid: 'button-b' }, { includeNode }), secondButton);
});
