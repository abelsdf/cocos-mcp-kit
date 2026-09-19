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
    this.hidden = 5;
  }
}
ProbeComponent.__props__ = ['count', 'title', 'offset', 'steps', 'unsupported', 'transient', 'hidden'];
class MockButton extends MockComponent { constructor() { super(); this.clickEvents = []; } }
class MockCanvas extends MockComponent {}
class MockVec2 extends MockValueType { constructor(x, y) { super(x, y); delete this.z; } }
class MockSize extends MockValueType {
  constructor(width, height) { super(); delete this.x; delete this.y; delete this.z; this.width = width; this.height = height; }
}
class MockColor { constructor(r = 255, g = 255, b = 255, a = 255) { Object.assign(this, { r, g, b, a }); } }
class MockAsset { constructor(uuid, name = uuid) { Object.assign(this, { uuid, name }); } }
class MockSpriteFrame extends MockAsset {}
class MockUITransform extends MockComponent {
  constructor() { super(); this._anchorPoint = new MockVec2(0.5, 0.5); this._contentSize = new MockSize(20, 20); }
  get anchorPoint() { return this._anchorPoint; }
  set anchorPoint(value) { this._anchorPoint = value; }
  get contentSize() { return this._contentSize; }
  set contentSize(value) { this._contentSize = value; }
}
class MockSprite extends MockComponent {
  constructor() { super(); this._color = new MockColor(); this._spriteFrame = new MockSpriteFrame('frame-a'); }
  get color() { return this._color; }
  set color(value) { if (value.r === 13) throw new Error('Creator rejected color'); this._color = value; }
  get spriteFrame() { return this._spriteFrame; }
  set spriteFrame(value) { this._spriteFrame = value; }
}
class MockBrokenSprite extends MockComponent {}
MockSprite._requireComponent = MockUITransform;
class MockCamera extends MockComponent {}
class ReferenceComponent extends MockComponent { constructor() { super(); this.link = null; } }
ReferenceComponent.__props__ = ['link'];
class EditableRefs extends MockComponent {
  constructor() { super(); this.nodeLink = null; this.assetLink = null; this.componentLink = null; }
}
EditableRefs.__props__ = ['nodeLink', 'assetLink', 'componentLink'];
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
EditableRefs.__testAttrs__ = {
  nodeLink: { default: null, ctor: MockNode },
  assetLink: { default: null, ctor: MockAsset },
  componentLink: { default: null, ctor: MockSprite },
};

function createSceneMethods(registeredClass = ProbeComponent) {
  const scene = new MockNode('Scene', 'scene-uuid');
  const target = new MockNode('Target', 'target-uuid');
  target.parent = scene;
  scene.children.push(target);
  const scriptPath = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(scriptPath);
  const exports = {};
  const assets = new Map([
    ['frame-a', new MockSpriteFrame('frame-a')],
    ['frame-b', new MockSpriteFrame('frame-b')],
    ['wrong-asset', new MockAsset('wrong-asset')],
  ]);
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
          Vec2: MockVec2,
          Size: MockSize,
          Quat: class MockQuat {},
          Color: MockColor,
          Asset: MockAsset,
          SpriteFrame: MockSpriteFrame,
          Sprite: MockSprite,
          Button: MockButton,
          Canvas: MockCanvas,
          UITransform: MockUITransform,
          Camera: MockCamera,
          CCClass: {
            attr: (Cls, key) => Cls.__testAttrs__ ? Cls.__testAttrs__[key] || {} : Cls === ProbeComponent ? ({
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
          assetManager: { loadAny: (uuid, callback) => {
            const asset = assets.get(uuid);
            callback(asset ? null : new Error('Asset not found'), asset);
          } },
          director: { getScene: () => scene },
          js: {
            getClassById: () => registeredClass,
            getClassName: (Cls) => Cls.name,
            getClassId: (Cls) => Cls.name,
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
  return { scene, target, methods: exports.methods, assets };
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

test('available component types distinguish registered scripts and candidate failures', async () => {
  const { methods } = createSceneMethods();
  const result = await methods.listAvailableComponentTypes({
    scriptAssets: [
      { uuid: SCRIPT_UUID, url: 'db://assets/GameController.ts', imported: true },
      { uuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c8', url: 'db://assets/Invalid.ts', invalid: true },
      { uuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c9', url: 'db://assets/Pending.ts', imported: false },
    ],
    projectScriptCount: 4,
    projectScriptsTruncated: true,
    candidateNames: ['cc.Sprite', 'cc.NonComponent', 'cc.Missing', 'cc.Sprite'],
  });
  assert.equal(result.valueSource, 'live-class-registry-and-asset-db');
  assert.equal(result.projectScriptCount, 4);
  assert.equal(result.projectScriptsTruncated, true);
  assert.deepEqual(Array.from(result.projectScripts, (entry) => entry.status),
    ['attachable', 'invalid-asset', 'not-imported']);
  assert.equal(result.projectScripts[0].name, 'ProbeComponent');
  assert.deepEqual(Array.from(result.candidates, (entry) => entry.status),
    ['attachable', 'not-component', 'not-found']);
  assert.equal(result.candidates[0].query, 'cc.Sprite');
  assert.match(result.attachabilityNote, /specific node/);
  await assert.rejects(() => methods.listAvailableComponentTypes({ candidateNames: ['bad name'] }), /candidateNames/);
  await assert.rejects(() => methods.listAvailableComponentTypes({ scriptAssets: [
    { uuid: SCRIPT_UUID }, { uuid: SCRIPT_UUID },
  ] }), /Duplicate project script UUID/);
});

test('available component types does not label a script without a Component class as attachable', async () => {
  const missing = createSceneMethods(null).methods;
  const absent = await missing.listAvailableComponentTypes({ scriptAssets: [{ uuid: SCRIPT_UUID }] });
  assert.equal(absent.projectScripts[0].status, 'no-component-registration');
  assert.match(absent.coverageNote, /valid non-component module/);

  const nonComponent = createSceneMethods(NonComponent).methods;
  const result = await nonComponent.listAvailableComponentTypes({ scriptAssets: [{ uuid: SCRIPT_UUID }] });
  assert.equal(result.projectScripts[0].status, 'not-component');
});

test('listComponents bounds live values and distinguishes direct serialization metadata', async () => {
  const { scene, target, methods } = createSceneMethods();
  const probe = target.addComponent(ProbeComponent);
  probe.title = 'x'.repeat(200);
  probe.steps = Array.from({ length: 10 }, (_, index) => index);
  const shared = new MockValueType(9, 8, 7);
  probe.unsupported = [shared, shared];
  const reference = target.addComponent(ReferenceComponent);
  reference.link = target;
  const listed = await methods.listComponents({ uuid: target.uuid, maxProperties: 12 });
  assert.equal(listed.valueSource, 'live-scene');
  assert.equal(listed.componentCount, 2);
  assert.equal(listed.returnedComponents, 2);
  const fields = new Map(Array.from(listed.components[0].properties, (property) => [property.name, property]));
  assert.equal(fields.get('count').runtimeValue, 17);
  assert.equal(fields.get('count').directSerialization, 'declared');
  assert.equal(fields.get('count').origin, 'ccclass-declared');
  assert.equal(fields.get('transient').directSerialization, 'excluded');
  assert.equal(fields.get('title').runtimeValue.length, 161);
  assert.equal(fields.get('steps').runtimeValue.length, 10);
  assert.equal(fields.get('steps').runtimeValue.items.length, 6);
  assert.equal(fields.get('unsupported').runtimeValue.items[1].fields.x, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(fields.get('offset').runtimeValue.fields)), { x: 3, y: 4, z: 5 });
  assert.equal(fields.has('hidden'), false);
  assert.equal(fields.has('node'), false);
  assert.equal(listed.components[1].properties.find((property) => property.name === 'link').runtimeValue.uuid, target.uuid);
  const bounded = await methods.listComponents({ uuid: target.uuid, maxComponents: 1, maxProperties: 2 });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.components.length, 1);
  assert.equal(bounded.components[0].properties.length, 2);
  assert.equal(bounded.components[0].propertiesTruncated, true);
  await assert.rejects(() => methods.listComponents({ uuid: target.uuid, maxProperties: 0 }), /maxProperties/);
  await assert.rejects(() => methods.listComponents({ uuid: scene.uuid }), /Target scene node/);
});

test('listComponents does not invoke project-defined accessors', async () => {
  let getterReads = 0;
  class AccessorComponent extends MockComponent {
    get danger() { getterReads += 1; return 'side effect'; }
  }
  AccessorComponent.__props__ = ['danger'];
  const { target, methods } = createSceneMethods();
  target.addComponent(AccessorComponent);
  const listed = await methods.listComponents({ uuid: target.uuid });
  assert.equal(getterReads, 0);
  assert.equal(listed.components[0].properties[0].runtimeValue.kind, 'accessor-not-read');
});

test('listComponents marks bounded property enumeration as truncated', async () => {
  class ManyFields extends MockComponent {
    constructor() {
      super();
      for (let index = 0; index < 90; index += 1) this[`field${index}`] = index;
    }
  }
  const { target, methods } = createSceneMethods();
  target.addComponent(ManyFields);
  const listed = await methods.listComponents({ uuid: target.uuid, maxProperties: 32 });
  assert.equal(listed.components[0].propertyCount, 0);
  assert.equal(listed.components[0].runtimeFieldCount, 90);
  const expanded = await methods.listComponents({ uuid: target.uuid, maxProperties: 32, includeRuntimeFields: true });
  const component = expanded.components[0];
  assert.equal(component.propertyCount, 80);
  assert.equal(component.propertyEnumerationTruncated, true);
  assert.equal(component.propertiesTruncated, true);
  assert.equal(component.keysTruncated, true);
  assert.equal(component.properties[0].origin, 'runtime-own');
});

test('project script runtime fields require an explicit opt-in', async () => {
  class ProjectScript extends MockComponent {
    constructor() { super(); this.declared = 4; this.internalState = { secret: true }; this.pending = undefined; }
  }
  ProjectScript.__props__ = ['declared'];
  const { target, methods } = createSceneMethods();
  target.addComponent(ProjectScript);
  const normal = await methods.inspectComponent({ uuid: target.uuid, componentName: 'ProjectScript' });
  assert.deepEqual(Array.from(normal.component.properties, (item) => item.name), ['declared']);
  assert.equal(normal.component.runtimeFieldCount, 2);
  assert.equal(normal.component.runtimeFieldsIncluded, false);
  const expanded = await methods.inspectComponent({ uuid: target.uuid, index: 0, includeRuntimeFields: true });
  assert.equal(expanded.component.properties.find((item) => item.name === 'internalState').origin, 'runtime-own');
  assert.equal(expanded.component.properties.find((item) => item.name === 'pending').runtimeValue.kind, 'undefined');
  assert.equal(expanded.component.runtimeFieldsIncluded, true);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: 0, includeRuntimeFields: 'yes' }), /includeRuntimeFields/);
  await assert.rejects(() => methods.listComponents({ uuid: target.uuid, includeRuntimeFields: 1 }), /includeRuntimeFields/);
});

test('inspectComponent selects one component exactly and returns bounded public values', async () => {
  const { scene, target, methods } = createSceneMethods();
  target.addComponent(ProbeComponent);
  target.addComponent(ProbeComponent);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, componentName: 'ProbeComponent' }), /Multiple ProbeComponent/);
  const inspected = await methods.inspectComponent({ uuid: target.uuid, componentName: 'ProbeComponent', index: 1, maxProperties: 2 });
  assert.equal(inspected.valueSource, 'live-scene');
  assert.equal(inspected.component.index, 1);
  assert.equal(inspected.component.name, 'ProbeComponent');
  assert.equal(inspected.component.properties.length, 2);
  assert.equal(inspected.component.propertiesTruncated, true);
  assert.equal(Object.prototype.hasOwnProperty.call(inspected.component, 'data'), false);
  const detailed = await methods.inspectComponent({ uuid: target.uuid, index: 0 });
  assert.equal(detailed.component.properties.find((item) => item.name === 'count').runtimeValue, 17);
  assert.equal(detailed.component.properties.find((item) => item.name === 'count').directSerialization, 'declared');
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid }), /componentName or index/);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: -1 }), /index/);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: 1.5 }), /index/);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: 1, componentName: 'MockSprite' }), /does not match/);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: 9 }), /not found/);
  await assert.rejects(() => methods.inspectComponent({ uuid: target.uuid, index: 0, maxProperties: 0 }), /maxProperties/);
  await assert.rejects(() => methods.inspectComponent({ uuid: scene.uuid, index: 0 }), /Target scene node/);
});

test('inspectComponent does not invoke project-defined getters', async () => {
  let getterReads = 0;
  class AccessorComponent extends MockComponent {
    get danger() { getterReads += 1; return 'side effect'; }
    get enabled() { getterReads += 1; return true; }
  }
  AccessorComponent.__props__ = ['danger'];
  const { target, methods } = createSceneMethods();
  target.addComponent(AccessorComponent);
  const inspected = await methods.inspectComponent({ uuid: target.uuid, componentName: 'AccessorComponent' });
  assert.equal(getterReads, 0);
  assert.equal(inspected.component.properties[0].runtimeValue.kind, 'accessor-not-read');
});

test('setComponentProperty converts declared scalar, Vec, node, component and asset fields', async () => {
  const { scene, target, methods } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  const count = await methods.setComponentProperty({ uuid: target.uuid, index: 0, propertyPath: 'count', value: 23 });
  assert.equal(count.updated, true);
  assert.equal(count.before, 17);
  assert.equal(script.count, 23);
  const again = await methods.setComponentProperty({ uuid: target.uuid, componentName: 'ProbeComponent', propertyPath: 'count', value: 23 });
  assert.equal(again.updated, false);
  const vec = await methods.setComponentProperty({ uuid: target.uuid, index: 0, propertyPath: 'offset', value: { x: 7, y: 8, z: 9 } });
  assert.equal(vec.valueType, 'vec3');
  assert.deepEqual([script.offset.x, script.offset.y, script.offset.z], [7, 8, 9]);

  const refs = target.addComponent(EditableRefs);
  const linked = new MockNode('Linked', 'linked-uuid');
  linked.parent = scene;
  scene.children.push(linked);
  linked.addComponent(MockSprite);
  const node = await methods.setComponentProperty({ uuid: target.uuid, componentName: 'EditableRefs', propertyPath: 'nodeLink', value: { uuid: linked.uuid } });
  assert.equal(node.value.kind, 'node');
  assert.equal(refs.nodeLink, linked);
  const component = await methods.setComponentProperty({ uuid: target.uuid, index: 1, propertyPath: 'componentLink', value: { uuid: linked.uuid } });
  assert.equal(component.value.kind, 'component');
  assert.equal(refs.componentLink, linked.components.find((item) => item instanceof MockSprite));
  const asset = await methods.setComponentProperty({ uuid: target.uuid, index: 1, propertyPath: 'assetLink', value: { assetUuid: 'frame-b' } });
  assert.equal(asset.value.uuid, 'frame-b');
  assert.equal(refs.assetLink.uuid, 'frame-b');
  await assert.rejects(() => methods.setComponentProperty({ uuid: target.uuid, index: 1, propertyPath: 'assetLink', value: { assetUuid: 'missing' } }), /Asset not found/);
  assert.equal(refs.assetLink.uuid, 'frame-b');
});

test('setComponentProperty uses Cocos setters for whitelisted UI values and restores failed writes', async () => {
  const { target, methods } = createSceneMethods();
  const ui = target.addComponent(MockUITransform);
  const sprite = target.addComponent(MockSprite);
  const anchor = await methods.setComponentProperty({ uuid: target.uuid, componentName: 'MockUITransform', propertyPath: 'anchorPoint', value: { x: 0.2, y: 0.8 } });
  assert.equal(anchor.valueType, 'vec2');
  assert.deepEqual([ui.anchorPoint.x, ui.anchorPoint.y], [0.2, 0.8]);
  await methods.setComponentProperty({ uuid: target.uuid, index: 0, propertyPath: 'contentSize', value: { width: 128, height: 64 } });
  assert.deepEqual([ui.contentSize.width, ui.contentSize.height], [128, 64]);
  const color = await methods.setComponentProperty({ uuid: target.uuid, componentName: 'MockSprite', propertyPath: 'color', value: '#40B4FFFF' });
  assert.equal(color.valueType, 'color');
  assert.deepEqual([sprite.color.r, sprite.color.g, sprite.color.b, sprite.color.a], [64, 180, 255, 255]);
  await methods.setComponentProperty({ uuid: target.uuid, index: 1, propertyPath: 'spriteFrame', value: { assetUuid: 'frame-b' } });
  assert.equal(sprite.spriteFrame.uuid, 'frame-b');
  await assert.rejects(() => methods.setComponentProperty({ uuid: target.uuid, index: 1, propertyPath: 'color', value: '#0D0000' }), /Creator rejected color/);
  assert.equal(sprite.color.r, 64);
});

test('setComponentProperty rejects unsafe fields, shapes, selectors and linked prefab nodes', async () => {
  const { scene, target, methods } = createSceneMethods();
  const script = target.addComponent(ProbeComponent);
  const args = { uuid: target.uuid, index: 0, propertyPath: 'count', value: 19 };
  for (const propertyPath of ['offset.x', '__proto__', '_hidden']) {
    await assert.rejects(() => methods.setComponentProperty({ ...args, propertyPath }), /top-level/);
  }
  for (const propertyPath of ['transient', 'hidden', 'unsupported', 'node']) {
    await assert.rejects(() => methods.setComponentProperty({ ...args, propertyPath, value: {} }), /hidden|editable|supported/);
  }
  await assert.rejects(() => methods.setComponentProperty({ ...args, value: '19' }), /finite number/);
  await assert.rejects(() => methods.setComponentProperty({ ...args, index: -1 }), /index/);
  await assert.rejects(() => methods.setComponentProperty({ ...args, componentName: 'MockSprite' }), /does not match/);
  await assert.rejects(() => methods.setComponentProperty({ uuid: scene.uuid, index: 0, propertyPath: 'count', value: 19 }), /Target scene node/);
  const duplicate = target.addComponent(ProbeComponent);
  await assert.rejects(() => methods.setComponentProperty({ uuid: target.uuid, componentName: 'ProbeComponent', propertyPath: 'count', value: 19 }), /Multiple/);
  assert.equal(duplicate.count, 17);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.setComponentProperty(args), /linked prefab/);
  assert.equal(script.count, 17);
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

test('removeComponent rejects required or referenced components and confirms removal', async () => {
  const { target, methods } = createSceneMethods();
  const sprite = target.addComponent(MockSprite);
  const reference = target.addComponent(ReferenceComponent);
  await assert.rejects(
    () => methods.removeComponent({ uuid: target.uuid, componentName: 'cc.UITransform' }),
    /required by MockSprite/
  );
  reference.link = sprite;
  await assert.rejects(
    () => methods.removeComponent({ uuid: target.uuid, componentName: 'cc.Sprite' }),
    /still referenced/
  );
  reference.link = null;
  const removedSprite = await methods.removeComponent({ uuid: target.uuid, componentName: 'cc.Sprite', index: 1 });
  assert.equal(removedSprite.removed, true);
  assert.equal(removedSprite.index, 1);
  assert.equal(removedSprite.nodeUuid, target.uuid);
  assert.equal(removedSprite.checkedDependencies, true);
  assert.equal(target.components.includes(sprite), false);
  const removedTransform = await methods.removeComponent({ uuid: target.uuid, componentName: 'cc.UITransform' });
  assert.equal(removedTransform.index, 0);
  assert.deepEqual(target.components, [reference]);
});

test('removeComponent requires an unambiguous matching selector and ordinary node', async () => {
  const { scene, target, methods } = createSceneMethods();
  target.addComponent(ProbeComponent);
  target.addComponent(ProbeComponent);
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid }), /componentName or index/);
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, index: -1 }), /non-negative integer/);
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, index: 0.5 }), /non-negative integer/);
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, componentName: 'ProbeComponent' }), /Multiple/);
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, componentName: 'cc.Sprite', index: 0 }), /does not match/);
  await assert.rejects(() => methods.removeComponent({ uuid: scene.uuid, index: 0 }), /Target scene node/);
  await assert.rejects(() => methods.removeComponent({ uuid: 'stale', index: 0 }), /Target scene node/);
  target._prefab = { instance: {} };
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, index: 0 }), /linked prefab/);
  assert.equal(target.components.length, 2);
});

test('removeComponent waits for deferred Creator removal before reporting success', async () => {
  const { target, methods } = createSceneMethods();
  const originalRemove = target.removeComponent.bind(target);
  target.addComponent(ProbeComponent);
  target.removeComponent = (component) => setTimeout(() => originalRemove(component), 20);
  const result = await methods.removeComponent({ uuid: target.uuid, index: 0 });
  assert.equal(result.removed, true);
  assert.equal(target.components.length, 0);
});

test('removeComponent never reports success when Creator leaves the component attached', async () => {
  const { target, methods } = createSceneMethods();
  const component = target.addComponent(ProbeComponent);
  target.removeComponent = () => {};
  await assert.rejects(() => methods.removeComponent({ uuid: target.uuid, index: 0 }), /did not finish removing/);
  assert.equal(target.components[0], component);
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
