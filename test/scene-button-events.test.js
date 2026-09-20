'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function createScene() {
  class Node {
    constructor(name, uuid, parent = null) {
      this.name = name;
      this.uuid = uuid;
      this.parent = parent;
      this.children = [];
      this.components = [];
      this._objFlags = 0;
      this.emitted = [];
      if (parent) parent.children.push(this);
    }
    getComponent(type) { return this.components.find((component) => component instanceof type) || null; }
    emit(eventName) { this.emitted.push(eventName); }
  }
  class EventHandler {
    static emitEvents(events, button) {
      for (const event of events) {
        const component = event.target.components.find((item) => item.constructor.name === event.component);
        component[event.handler](button, event.customEventData);
      }
    }
  }
  class Component { destroy() {} }
  Component.EventHandler = EventHandler;
  class Button {
    static EventType = { CLICK: 'click' };
    constructor() { this.clickEvents = []; }
  }
  class TestReceiver extends Component {
    constructor() { super(); this.calls = []; }
    onClick(_button, data) { this.calls.push(data); }
    onDestroy() {}
    get unsafe() { throw new Error('Getter must not run while validating a Button event'); }
  }
  const scene = new Node('Scene', 'scene');
  const buttonNode = new Node('Button', 'button', scene);
  const secondButtonNode = new Node('Button2', 'button2', scene);
  const targetNode = new Node('Receiver', 'receiver', scene);
  const button = new Button();
  button.node = buttonNode;
  const secondButton = new Button();
  secondButton.node = secondButtonNode;
  const receiver = new TestReceiver();
  buttonNode.components.push(button);
  secondButtonNode.components.push(secondButton);
  targetNode.components.push(receiver);
  const sceneFile = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(sceneFile);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(sceneFile, 'utf8'), {
    Editor: { App: { path: '' } }, module: { paths: [] }, exports,
    require: (id) => id === 'cc' ? {
      Button, Component, EventHandler,
      Prefab: { _utils: {
        TargetInfo: class TargetInfo {},
        PropertyOverrideInfo: class PropertyOverrideInfo {},
      } },
      js: { getClassById: (classId) => classId === 'receiver-class-id' ? TestReceiver : null,
        getClassName: (type) => type.name },
      CCObjectFlags: { DontSave: 8 }, director: { getScene: () => scene },
    } : localRequire(id),
    console,
  }, { filename: sceneFile });
  return { methods: exports.methods, button, buttonNode, secondButton, receiver, targetNode };
}

test('button binding can be listed, invoked, and unbound by its exact signature', async () => {
  const { methods, button, receiver, buttonNode } = createScene();
  const options = {
    path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver',
    handler: 'onClick', customEventData: 'first',
  };
  const bound = await methods.bindButtonClickEvent(options);
  assert.equal(bound.bound, true);
  assert.equal((await methods.bindButtonClickEvent(options)).duplicate, true);
  const listed = await methods.listButtonClickEvents({ path: 'Button' });
  assert.equal(listed.clickEventCount, 1);
  assert.equal(listed.clickEvents[0].index, 0);
  assert.equal(listed.clickEvents[0].targetUuid, 'receiver');

  await methods.simulateButtonClick({ path: 'Button' });
  assert.equal(receiver.calls.length, 1);
  assert.equal(receiver.calls[0], 'first');
  assert.equal(buttonNode.emitted.includes('click'), true);

  const removed = await methods.unbindButtonClickEvent({
    path: 'Button', eventIndex: listed.clickEvents[0].index, expectedEvent: listed.clickEvents[0],
  });
  assert.equal(removed.unbound, true);
  assert.equal(removed.clickEventCount, 0);
  assert.equal(button.clickEvents.length, 0);
  await methods.simulateButtonClick({ path: 'Button' });
  assert.equal(receiver.calls.length, 1);
});

test('button binding rejects inherited, lifecycle, accessor and ambiguous handlers', async () => {
  const { methods, button, targetNode, receiver } = createScene();
  const base = { path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver' };
  for (const handler of ['destroy', 'toString', 'onDestroy', 'unsafe']) {
    await assert.rejects(() => methods.bindButtonClickEvent({ ...base, handler }),
      /missing, inherited from the engine, or reserved/);
  }
  assert.equal(button.clickEvents.length, 0);
  targetNode.components.push(new receiver.constructor());
  await assert.rejects(() => methods.bindButtonClickEvent({ ...base, handler: 'onClick' }),
    /cannot select an individual instance/);
  assert.equal(button.clickEvents.length, 0);
});

test('button binding validates event names and literal custom data before changing the Button', async () => {
  const { methods, button } = createScene();
  const base = { path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver', handler: 'onClick' };
  for (const change of [
    { handler: 'onClick.extra' },
    { handler: {} },
    { componentName: 'TestReceiver extra' },
    { customEventData: { value: 1 } },
    { customEventData: null },
    { customEventData: 'x'.repeat(1025) },
    { replace: 'true' },
    { replace: null },
  ]) {
    await assert.rejects(() => methods.bindButtonClickEvent({ ...base, ...change }));
  }
  assert.equal(button.clickEvents.length, 0);
  const bound = await methods.bindButtonClickEvent({ ...base, customEventData: '' });
  assert.equal(bound.event.customEventData, '');
});

test('batch button binding continues after an invalid step and reports ordered partial results', async () => {
  const { methods, button, secondButton } = createScene();
  const base = { path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver', handler: 'onClick' };
  const report = await methods.batchBindButtonClickEvents({ onError: 'continue', bindings: [
    { ...base, customEventData: 'first' },
    { ...base, customEventData: 'first' },
    { ...base, handler: 'onDestroy' },
    { ...base, path: 'Button2', customEventData: 'second' },
  ] });
  assert.deepEqual(Array.from(report.results, (item) => item.status), ['bound', 'duplicate', 'failed', 'bound']);
  assert.deepEqual(Array.from(report.results, (item) => item.index), [0, 1, 2, 3]);
  assert.equal(report.completed, true);
  assert.equal(report.allSucceeded, false);
  assert.equal(report.bound, 2);
  assert.equal(report.duplicates, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.stoppedAtIndex, null);
  assert.equal(report.results[0].event.customEventData, 'first');
  assert.equal(report.results[1].buttonUuid, 'button');
  assert.equal(report.results[2].error.includes('reserved'), true);
  assert.equal(typeof report.results[3].durationMs, 'number');
  assert.equal(button.clickEvents.length, 1);
  assert.equal(secondButton.clickEvents.length, 1);
  assert.equal(secondButton.clickEvents[0].customEventData, 'second');
});

test('batch button binding stops at the first failure while retaining previous bindings', async () => {
  const { methods, button, secondButton } = createScene();
  const base = { path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver', handler: 'onClick' };
  const report = await methods.batchBindButtonClickEvents({ bindings: [
    { ...base, customEventData: 'kept' },
    { ...base, targetPath: 'Missing' },
    { ...base, path: 'Button2' },
  ] });
  assert.deepEqual(Array.from(report.results, (item) => item.status), ['bound', 'failed']);
  assert.equal(report.completed, false);
  assert.equal(report.attempted, 2);
  assert.equal(report.stoppedAtIndex, 1);
  assert.equal(button.clickEvents.length, 1);
  assert.equal(secondButton.clickEvents.length, 0);
});

test('batch button binding validates size, policy and each step selector before mutation', async () => {
  const { methods, button } = createScene();
  const base = { path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver', handler: 'onClick' };
  for (const options of [
    { bindings: [] },
    { bindings: Array.from({ length: 51 }, () => base) },
    { bindings: [base], onError: 'ignore' },
  ]) await assert.rejects(() => methods.batchBindButtonClickEvents(options));
  const report = await methods.batchBindButtonClickEvents({ onError: 'continue', bindings: [
    { ...base, uuid: 'button' },
    { ...base, targetPath: '' },
    { ...base, extra: true },
    { ...base, customEventData: { invalid: true } },
    { ...base, customEventData: 'valid' },
  ] });
  assert.deepEqual(Array.from(report.results, (item) => item.status),
    ['failed', 'failed', 'failed', 'failed', 'bound']);
  assert.equal(button.clickEvents.length, 1);
  assert.equal(button.clickEvents[0].customEventData, 'valid');
});

test('stale or incomplete event signatures do not remove a binding', async () => {
  const { methods, button } = createScene();
  await methods.bindButtonClickEvent({
    path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver',
    handler: 'onClick', customEventData: 'current',
  });
  const listed = await methods.listButtonClickEvents({ path: 'Button' });
  const expectedEvent = listed.clickEvents[0];
  await assert.rejects(
    () => methods.unbindButtonClickEvent({
      path: 'Button', eventIndex: 0, expectedEvent: { ...expectedEvent, customEventData: 'stale' },
    }),
    /has changed/
  );
  await assert.rejects(
    () => methods.unbindButtonClickEvent({ path: 'Button', eventIndex: 0, expectedEvent: { handler: 'onClick' } }),
    /expectedEvent must include/
  );
  await assert.rejects(
    () => methods.unbindButtonClickEvent({ path: 'Button', eventIndex: 1, expectedEvent }),
    /eventIndex must identify/
  );
  assert.equal(button.clickEvents.length, 1);
});

test('serialized component IDs still list and deduplicate by component name', async () => {
  const { methods, button } = createScene();
  const options = {
    path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver',
    handler: 'onClick', customEventData: 'persisted',
  };
  await methods.bindButtonClickEvent(options);
  button.clickEvents[0].component = '';
  button.clickEvents[0]._componentId = 'receiver-class-id';
  const listed = await methods.listButtonClickEvents({ path: 'Button' });
  assert.equal(listed.clickEvents[0].component, 'TestReceiver');
  const duplicate = await methods.bindButtonClickEvent(options);
  assert.equal(duplicate.duplicate, true);
  assert.equal(button.clickEvents.length, 1);
  const removed = await methods.unbindButtonClickEvent({
    path: 'Button', eventIndex: 0, expectedEvent: listed.clickEvents[0],
  });
  assert.equal(removed.unbound, true);
});

test('prefab instance click event changes record a reusable property override', async () => {
  const { methods, button, buttonNode } = createScene();
  const instance = {
    propertyOverrides: [],
    findPropertyOverride(localID, propertyPath) {
      return this.propertyOverrides.find((item) =>
        item.targetInfo?.localID?.[0] === localID[0] &&
        item.propertyPath?.[0] === propertyPath[0]) || null;
    },
  };
  buttonNode._prefab = { asset: { uuid: 'prefab-asset' }, instance };
  button.__prefab = { fileId: 'button-file-id' };
  buttonNode.components.push({ constructor: { name: 'TestReceiver' }, onClick() {} });

  const options = {
    path: 'Button', targetPath: 'Button', componentName: 'TestReceiver',
    handler: 'onClick', customEventData: 'instance',
  };
  await methods.bindButtonClickEvent(options);
  assert.equal(instance.propertyOverrides.length, 1);
  const override = instance.propertyOverrides[0];
  assert.deepEqual(Array.from(override.targetInfo.localID), ['button-file-id']);
  assert.deepEqual(Array.from(override.propertyPath), ['clickEvents']);
  assert.equal(override.value.length, 1);

  const listed = await methods.listButtonClickEvents({ path: 'Button' });
  await methods.unbindButtonClickEvent({ path: 'Button', eventIndex: 0, expectedEvent: listed.clickEvents[0] });
  assert.equal(instance.propertyOverrides.length, 1);
  assert.equal(override.value.length, 0);
  assert.equal(button.clickEvents.length, 0);
});

test('unsupported prefab instance metadata rejects binding without changing the Button', async () => {
  const { methods, button, buttonNode } = createScene();
  buttonNode._prefab = { asset: { uuid: 'prefab-asset' }, instance: { propertyOverrides: [] } };
  await assert.rejects(() => methods.bindButtonClickEvent({
    path: 'Button', targetPath: 'Receiver', componentName: 'TestReceiver',
    handler: 'onClick',
  }), /prefab override metadata is unavailable/);
  assert.equal(button.clickEvents.length, 0);
});
