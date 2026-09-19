'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_UUID = 'bbee4fb1-c9b5-4fde-9346-8ee1357142c7';

class MockComponent {
  constructor() { this.node = null; }
}
class MockValueType {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  clone() { return new MockValueType(this.x, this.y, this.z); }
}
class ProbeComponent extends MockComponent {
  constructor() {
    super();
    this.count = 17;
    this.title = 'ready';
    this.offset = new MockValueType(3, 4, 5);
    this.steps = [1, 2];
    this.unsupported = { nested: 1 };
    this.transient = 4;
  }
}
class MockButton extends MockComponent { constructor() { super(); this.clickEvents = []; } }
class MockCanvas extends MockComponent {}
class MockUITransform extends MockComponent {}
class MockSprite extends MockComponent {}
class MockBrokenSprite extends MockComponent {}
class MockCamera extends MockComponent {}
class ReferenceComponent extends MockComponent { constructor() { super(); this.link = null; } }
class NonComponent {}
class MockNode {
  constructor(name, uuid) {
    this.name = name;
    this.uuid = uuid;
    this.children = [];
    this.components = [];
    this._objFlags = 0;
    this.parent = null;
  }
  addComponent(Cls) {
    if (Cls === MockUITransform && this.components.some((item) => item instanceof Cls)) {
      throw new Error('UITransform already exists');
    }
    if ((Cls === MockSprite || Cls === MockBrokenSprite) && !this.components.some((item) => item instanceof MockUITransform)) {
      this.addComponent(MockUITransform);
    }
    if (Cls === MockBrokenSprite) throw new Error('Sprite construction failed');
    const component = new Cls();
    component.node = this;
    this.components.push(component);
    return component;
  }
  removeComponent(component) {
    this.components.splice(this.components.indexOf(component), 1);
    component.node = null;
  }
}

function createSceneMethods(registeredClass = ProbeComponent) {
  const scene = new MockNode('Scene', 'scene-uuid');
  const target = new MockNode('Target', 'target-uuid');
  target.parent = scene;
  scene.children.push(target);
  const scriptPath = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(scriptPath);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), {
    Editor: {
      App: { path: '' },
      Utils: { UUID: { compressUUID: () => 'script-class-id' } },
    },
    module: { paths: [] },
    exports,
    require: (id) => id === 'cc'
      ? {
          Node: MockNode,
          Component: MockComponent,
          ValueType: MockValueType,
          Vec3: MockValueType,
          Quat: class MockQuat {},
          Color: class MockColor {},
          Button: MockButton,
          Canvas: MockCanvas,
          UITransform: MockUITransform,
          Camera: MockCamera,
          CCClass: {
            attr: (Cls, key) => Cls === ProbeComponent ? ({
              count: { default: 17 },
              title: { default: 'ready' },
              offset: { default: () => new MockValueType(3, 4, 5) },
              steps: { default: () => [1, 2] },
              unsupported: { default: { nested: 1 } },
              transient: { default: 4, serializable: false },
              hidden: { default: 4, visible: false },
            }[key] || {}) : {},
            getDefault: (value) => typeof value === 'function' ? value() : value,
          },
          CCObjectFlags: { DontSave: 8 },
          director: { getScene: () => scene },
          js: {
            getClassById: () => registeredClass,
            getClassName: (Cls) => Cls.name,
            getClassByName: (name) => ({
              'cc.UITransform': MockUITransform,
              'cc.Sprite': MockSprite,
              'cc.BrokenSprite': MockBrokenSprite,
              'cc.NonComponent': NonComponent,
            }[name] || null),
          },
        }
      : localRequire(id),
    console,
    setTimeout,
  }, { filename: scriptPath });
  return { scene, target, methods: exports.methods };
}

test('detectNodeType uses component identity and reports mixed roles explicitly', async () => {
  const { target, methods } = createSceneMethods();
  target.name = 'Camera';
  const plain = await methods.detectNodeType({ uuid: target.uuid });
  assert.equal(plain.type, 'plain');
  assert.deepEqual(Array.from(plain.candidates), ['plain']);
  assert.equal(plain.matchedRules[0].id, 'no-recognized-camera-or-ui-component');

  target.addComponent(MockUITransform);
  const ui = await methods.detectNodeType({ path: 'Camera' });
  assert.equal(ui.type, 'ui');
  assert.equal(ui.ambiguous, false);
  assert.deepEqual(Array.from(ui.matchedRules[0].components), ['MockUITransform']);

  target.addComponent(MockCamera);
  const mixed = await methods.detectNodeType({ uuid: target.uuid, path: 'Camera' });
  assert.equal(mixed.type, 'ambiguous');
  assert.deepEqual(Array.from(mixed.candidates), ['camera', 'ui']);
  assert.equal(mixed.ambiguous, true);
  assert.match(mixed.ambiguity, /coexist/);
  assert.deepEqual(Array.from(mixed.matchedRules, (rule) => rule.id), ['camera-component', 'ui-component']);

  target.components.splice(0, 1);
  const camera = await methods.detectNodeType({ uuid: target.uuid });
  assert.equal(camera.type, 'camera');
  assert.equal(camera.ambiguity, null);
});

test('detectNodeType reuses strict node resolution and rejects scene root', async () => {
  const { scene, target, methods } = createSceneMethods();
  await assert.rejects(() => methods.detectNodeType({}), /Target scene node was not found/);
  await assert.rejects(() => methods.detectNodeType({ uuid: scene.uuid }), /Target scene node was not found/);
  await assert.rejects(() => methods.detectNodeType({ uuid: 'stale', name: target.name }), /Target scene node was not found/);
  const duplicate = new MockNode(target.name, 'duplicate-uuid');
  duplicate.parent = scene;
  scene.children.push(duplicate);
  await assert.rejects(() => methods.detectNodeType({ name: target.name }), /Candidates:/);
});

test('addComponent verifies class and target, and reports engine-added dependencies', async () => {
  const { scene, target, methods } = createSceneMethods();
  const added = await methods.addComponent({ uuid: target.uuid, componentName: 'cc.Sprite' });
  assert.equal(added.added, true);
  assert.equal(added.nodeUuid, target.uuid);
  assert.equal(added.index, 1);
  assert.deepEqual(Array.from(added.addedComponents, (item) => [item.name, item.index, item.requested]), [
    ['MockUITransform', 0, false],
    ['MockSprite', 1, true],
  ]);
  assert.equal(target.components[1].node, target);
  for (const componentName of ['', 'missing', 'cc.NonComponent']) {
    await assert.rejects(() => methods.addComponent({ uuid: target.uuid, componentName }), /componentName|not found|not a Cocos Component/);
  }
  await assert.rejects(() => methods.addComponent({ uuid: scene.uuid, componentName: 'cc.Sprite' }), /Target scene node/);
  await assert.rejects(() => methods.addComponent({ uuid: 'stale', componentName: 'cc.Sprite' }), /Target scene node/);
  await assert.rejects(() => methods.addComponent({ uuid: target.uuid, componentName: 'cc.UITransform' }), /already exists/);
  assert.equal(target.components.length, 2);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.addComponent({ uuid: target.uuid, componentName: 'cc.Sprite' }), /linked prefab/);
  assert.equal(target.components.length, 2);
});

test('addComponent removes only dependencies introduced by a failed attachment', async () => {
  const { target, methods } = createSceneMethods();
  const existing = target.addComponent(ProbeComponent);
  await assert.rejects(() => methods.addComponent({ uuid: target.uuid, componentName: 'cc.BrokenSprite' }), /construction failed/);
  assert.deepEqual(target.components, [existing]);
  assert.equal(existing.node, target);
});

test('attachScriptComponent matches script identity and avoids duplicate components', async () => {
  const { methods, target } = createSceneMethods();
  const attached = await methods.attachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID });
  assert.equal(attached.attached, true);
  assert.equal(attached.classId, 'script-class-id');
  assert.equal(attached.className, 'ProbeComponent');
  assert.equal(attached.componentIndex, 0);
  assert.equal(target.components[0].node, target);
  const repeated = await methods.attachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID });
  assert.equal(repeated.attached, false);
  assert.equal(repeated.alreadyPresent, true);
  assert.equal(target.components.length, 1);
});

test('attachScriptComponent rejects missing classes, non-components, linked prefabs and invalid targets', async () => {
  const missing = createSceneMethods(null);
  await assert.rejects(
    () => missing.methods.attachScriptComponent({ uuid: missing.target.uuid, scriptUuid: SCRIPT_UUID, waitForCompileMs: 0 }),
    /not registered/
  );
  const nonComponent = createSceneMethods(NonComponent);
  await assert.rejects(
    () => nonComponent.methods.attachScriptComponent({ uuid: nonComponent.target.uuid, scriptUuid: SCRIPT_UUID }),
    /does not register a Cocos Component/
  );
  const { scene, target, methods } = createSceneMethods();
  for (const scriptUuid of ['', 'not-a-uuid']) {
    await assert.rejects(() => methods.attachScriptComponent({ uuid: target.uuid, scriptUuid }), /scriptUuid/);
  }
  await assert.rejects(
    () => methods.attachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID, waitForCompileMs: 10001 }),
    /waitForCompileMs/
  );
  await assert.rejects(() => methods.attachScriptComponent({ uuid: scene.uuid, scriptUuid: SCRIPT_UUID }), /Target scene node/);
  await assert.rejects(() => methods.attachScriptComponent({ uuid: 'stale', scriptUuid: SCRIPT_UUID }), /Target scene node/);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.attachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID }), /linked prefab/);
  assert.equal(target.components.length, 0);
});

test('detachScriptComponent removes only the script identified by UUID and is idempotent', async () => {
  const { methods, target } = createSceneMethods();
  target.addComponent(ReferenceComponent);
  const script = target.addComponent(ProbeComponent);
  const removed = await methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID });
  assert.equal(removed.removed, true);
  assert.equal(removed.componentIndex, 1);
  assert.equal(removed.checkedReferences, true);
  assert.equal(script.node, null);
  assert.equal(target.components.length, 1);
  assert.equal(target.components[0].constructor, ReferenceComponent);
  const repeated = await methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID });
  assert.equal(repeated.removed, false);
  assert.equal(repeated.notPresent, true);
});

test('detachScriptComponent waits until Creator finishes a deferred removal', async () => {
  const { methods, target } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  const removeImmediately = target.removeComponent.bind(target);
  target.removeComponent = (component) => setTimeout(() => removeImmediately(component), 20);
  const result = await methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID });
  assert.equal(result.removed, true);
  assert.equal(target.components.includes(script), false);
});

test('detachScriptComponent blocks active-scene Button events and component references', async () => {
  const { scene, target, methods } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  const buttonNode = new MockNode('ButtonNode', 'button-uuid');
  buttonNode.parent = scene;
  scene.children.push(buttonNode);
  const button = buttonNode.addComponent(MockButton);
  button.clickEvents = [{ target, component: 'ProbeComponent', handler: 'onClick' }];
  await assert.rejects(
    () => methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID }),
    /ButtonNode:MockButton\.clickEvents\[0\]/
  );
  assert.equal(target.components.includes(script), true);
  button.clickEvents = [];
  const reference = buttonNode.addComponent(ReferenceComponent);
  reference.link = { nested: [script] };
  await assert.rejects(
    () => methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID }),
    /ButtonNode:ReferenceComponent\.link\.nested\[0\]/
  );
  assert.equal(target.components.includes(script), true);
  reference.link = null;
  assert.equal((await methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID })).removed, true);
});

test('detachScriptComponent rejects invalid targets and linked prefab nodes before removal', async () => {
  const missing = createSceneMethods(null);
  await assert.rejects(
    () => missing.methods.detachScriptComponent({ uuid: missing.target.uuid, scriptUuid: SCRIPT_UUID }),
    /registered Cocos Component/
  );
  const { scene, target, methods } = createSceneMethods();
  target.addComponent(ProbeComponent);
  await assert.rejects(() => methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: 'bad' }), /scriptUuid/);
  await assert.rejects(() => methods.detachScriptComponent({ uuid: scene.uuid, scriptUuid: SCRIPT_UUID }), /Target scene node/);
  await assert.rejects(() => methods.detachScriptComponent({ uuid: 'stale', scriptUuid: SCRIPT_UUID }), /Target scene node/);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.detachScriptComponent({ uuid: target.uuid, scriptUuid: SCRIPT_UUID }), /linked prefab/);
  assert.equal(target.components.length, 1);
});

test('resetComponentPropertyToDefault restores declared scalar, ValueType and array defaults', async () => {
  const { methods, target } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  script.count = 42;
  script.offset = new MockValueType(9, 8, 7);
  script.steps = [7, 8];
  const count = await methods.resetComponentPropertyToDefault({ uuid: target.uuid, componentName: 'ProbeComponent', propertyName: 'count' });
  assert.equal(count.reset, true);
  assert.equal(count.before, 42);
  assert.equal(count.value, 17);
  assert.equal(script.count, 17);
  const offset = await methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'offset' });
  assert.equal(offset.reset, true);
  assert.deepEqual([script.offset.x, script.offset.y, script.offset.z], [3, 4, 5]);
  const steps = await methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'steps' });
  assert.equal(steps.reset, true);
  assert.deepEqual(Array.from(script.steps), [1, 2]);
  const again = await methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'count' });
  assert.equal(again.reset, false);
  assert.equal(again.alreadyDefault, true);
});

test('resetComponentPropertyToDefault rejects missing metadata, unsafe fields, mismatched selectors and linked prefabs', async () => {
  const { methods, target } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  script.count = 42;
  for (const propertyName of ['offset.x', '_private', '__proto__']) {
    await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName }), /public top-level/);
  }
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, propertyName: 'count' }), /componentName or index/);
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, componentName: 'Other', propertyName: 'count' }), /does not match/);
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'enabled' }), /No editable serialized/);
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'hidden' }), /No editable serialized/);
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'transient' }), /No editable serialized/);
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'unsupported' }), /not a supported/);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.resetComponentPropertyToDefault({ uuid: target.uuid, index: 0, propertyName: 'count' }), /linked prefab/);
  assert.equal(script.count, 42);
});
