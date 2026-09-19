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
class ProbeComponent extends MockComponent {}
class MockButton extends MockComponent { constructor() { super(); this.clickEvents = []; } }
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
          Button: MockButton,
          CCObjectFlags: { DontSave: 8 },
          director: { getScene: () => scene },
          js: {
            getClassById: () => registeredClass,
            getClassName: (Cls) => Cls.name,
          },
        }
      : localRequire(id),
    console,
    setTimeout,
  }, { filename: scriptPath });
  return { scene, target, methods: exports.methods };
}

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
