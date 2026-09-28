'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createUIValidationMethods } = require('../lib/ui-validation-scene');
function fixture() {
  class UITransform { constructor() { this.contentSize = { width: 100, height: 50 }; this.anchorPoint = { x: 0.5, y: 0.5 }; } }
  class Sprite {} class Label {} class Button {} class Animation {}
  class Widget { static AlignMode = { ALWAYS: 0, ONCE: 1 }; }
  class Node {
    constructor(uuid, parent) { Object.assign(this, { uuid, name: uuid, parent, components: [] }); }
    getComponent(type) { return this.components.find(c => c instanceof type) || null; }
    add(type, props = {}) { const c = Object.assign(new type(), { uuid: type.name, node: this }, props); this.components.push(c); return c; }
  }
  const scene = new Node('scene'), node = new Node('node', scene), target = new Node('target', scene);
  const cc = { UITransform, Sprite, Label, Button, Animation, Widget, isValid: v => Boolean(v) && !v.invalid };
  const ui = node.add(UITransform); const receiver = { onAction() { throw Error('Must never execute callbacks'); } };
  const methods = createUIValidationMethods({ cc, getScene: () => scene, findNode: ({ uuid }) => uuid === 'node' ? node : null,
    getEventHandlerComponentName: e => e.component || (e._componentId === 'registered-id' ? 'Receiver' : ''),
    findComponent: (_n, { componentName }) => componentName === 'Receiver' ? receiver : null,
    resolveButtonEventMethod: (c, name) => Object.getOwnPropertyDescriptor(c, name)?.value,
  });
  return { cc, node, scene, target, ui, receiver, run: (nodeUuids = ['node']) => methods.inspectUIValidation({ sceneUuid: 'scene', nodeUuids }).nodes[0] };
}
test('valid scene UI inspection is deterministic and side-effect free', () => { const f = fixture(); assert.deepEqual(f.run(), f.run()); assert.equal(f.node.components.length, 1); });
test('missing node is explicit unavailable', () => { const f = fixture(); assert.equal(f.run(['missing']).unavailable, true); });
test('editor-only content is rejected', () => { const f = fixture(); f.node._objFlags = 8; assert.equal(f.run().unavailable, true); });
test('missing UI and invalid dimensions are findings', () => {
  const f = fixture(); f.ui.contentSize.width = 0; assert.equal(f.run().findings[0].code, 'invalid_ui_rectangle');
  f.node.components = []; assert.equal(f.run().findings[0].code, 'missing_ui_transform');
});
test('Sprite and custom Label references are collected without loading or modifying assets', () => {
  const f = fixture(); f.node.add(f.cc.Sprite, { spriteFrame: { _uuid: 'frame' } }); f.node.add(f.cc.Label, { useSystemFont: false, font: { _uuid: 'font' } });
  assert.equal(f.run().assets.length, 2); assert.equal(f.run().findings.length, 0);
});
test('system font does not require an asset; missing sprite is a finding', () => {
  const f = fixture(); f.node.add(f.cc.Label, { useSystemFont: true, font: null }); f.node.add(f.cc.Sprite, { spriteFrame: null });
  assert.equal(f.run().findings.length, 1); assert.equal(f.run().findings[0].rule, 'sprite_frame');
});
test('registered event IDs resolve without invoking handlers or accessor methods', () => {
  const f = fixture(), event = { target: f.target, _componentId: 'registered-id', handler: 'onAction' };
  f.node.add(f.cc.Button, { interactable: true, clickEvents: [event] }); assert.equal(f.run().findings.length, 0);
  Object.defineProperty(f.receiver, 'unsafe', { get() { throw Error('Getter must not execute'); } }); event.handler = 'unsafe'; assert.equal(f.run().findings[0].code, 'invalid_event');
});
test('missing event target, receiver and method are reported', () => {
  const f = fixture(); f.node.add(f.cc.Button, { clickEvents: [{ target: null }, { target: f.target, component: 'Missing' }, { target: f.target, component: 'Receiver', handler: 'missing' }] });
  assert.equal(f.run().findings.length, 3);
});
test('empty disabled button is intentional, interactive empty button warns about runtime listeners', () => {
  const f = fixture(), b = f.node.add(f.cc.Button, { clickEvents: [], interactable: false }); assert.equal(f.run().findings.length, 0);
  b.interactable = true; assert.equal(f.run().findings[0].code, 'no_serialized_events');
});
test('event scan cap reports unchecked tail', () => { const f = fixture(); f.node.add(f.cc.Button, { clickEvents: Array(33).fill(null) }); assert.equal(f.run().findings[0].status, 'not_checked'); assert.equal(f.run().findings.length, 33); });
test('ALWAYS plus ancestor animation reports potential conflict, not confirmed track conflict', () => {
  const f = fixture(); const w = f.node.add(f.cc.Widget, { enabledInHierarchy: true, alignMode: 0 }); f.scene.add(f.cc.Animation, { enabledInHierarchy: true, clips: [{}] });
  assert.equal(f.run().findings[0].code, 'potential_animation_conflict'); assert.equal(f.run().findings[0].status, 'not_checked');
  w.alignMode = 1; assert.equal(f.run().findings.length, 0);
});
