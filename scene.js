'use strict';

module.paths.push(Editor.App.path + '/node_modules');

const cc = require('cc');
const { assertNoLinkedPrefabInstances, attachPrefabMetadata, normalizePrefabNodeLayers } = require('./lib/prefab-metadata');
const { resolveNode } = require('./lib/node-resolution');
const { captureScriptExecution } = require('./lib/script-execution');

const {
  Node,
  director,
  Vec3,
  Vec2,
  Vec4,
  Size,
  Quat,
  Color,
  Asset,
  assetManager,
  instantiate,
  Prefab,
  Scene,
  SceneAsset,
  js,
  Component,
  EventHandler,
  Canvas,
  UITransform,
  Label,
  Sprite,
  SpriteFrame,
  Button,
  Widget,
  Camera,
  Animation,
  AnimationClip,
} = cc;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const DONT_SAVE_FLAG = cc.CCObjectFlags && cc.CCObjectFlags.DontSave
  || cc.CCObject && cc.CCObject.Flags && cc.CCObject.Flags.DontSave
  || 8;

function isSceneContentNode(node) {
  return !node || !(node._objFlags & DONT_SAVE_FLAG);
}

function sceneContentChildren(node) {
  return node.children.filter(isSceneContentNode);
}

async function callPreviewRuntimeTool(name) {
  // Keep legacy scene-script entrypoints, but route them back to the editor's
  // Game View controller rather than pausing this edit-scene director.
  const output = await Editor.Message.request('cocos-mcp-kit', 'call-tool', name, {});
  const result = typeof output === 'string' ? JSON.parse(output) : output;
  if (!result || result.ok !== true) {
    throw new Error((result && result.summary) || `Preview tool '${name}' failed.`);
  }
  return result.data;
}

function getScene() {
  const scene = director.getScene();
  if (!scene) {
    throw new Error('No active scene is loaded.');
  }
  return scene;
}

function getComponentNames(node) {
  const components = Array.isArray(node.components) ? node.components : [];
  return components
    .map((component) => component && component.constructor && component.constructor.name)
    .filter(Boolean);
}

function detectNodeType(node) {
  const components = Array.isArray(node.components) ? node.components.filter(Boolean) : [];
  const uiClasses = [Canvas, UITransform, cc.UIRenderer, Label, Sprite, Button, Widget]
    .filter((type) => typeof type === 'function');
  const matchingNames = (types) => components
    .filter((component) => types.some((type) => component instanceof type))
    .map((component) => component.constructor.name);
  const cameraComponents = typeof Camera === 'function' ? matchingNames([Camera]) : [];
  const uiComponents = matchingNames(uiClasses);
  const candidates = [];
  const matchedRules = [];
  if (cameraComponents.length) {
    candidates.push('camera');
    matchedRules.push({ id: 'camera-component', components: cameraComponents });
  }
  if (uiComponents.length) {
    candidates.push('ui');
    matchedRules.push({ id: 'ui-component', components: uiComponents });
  }
  if (!candidates.length) {
    candidates.push('plain');
    matchedRules.push({ id: 'no-recognized-camera-or-ui-component', components: [] });
  }
  return {
    type: candidates.length > 1 ? 'ambiguous' : candidates[0],
    candidates,
    ambiguous: candidates.length > 1,
    matchedRules,
    ambiguity: candidates.length > 1
      ? 'Camera and UI components coexist on this node; choose a role using the reported components.'
      : null,
  };
}

function getComponentPropertyNames(component, registeredName, includeRuntimeFields) {
  const names = new Set();
  const declaredNames = new Set();
  let truncated = false;
  const isPublicName = (name) =>
    /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && name !== 'node' && name !== 'constructor';
  const include = (name) => {
    if (isPublicName(name)) {
      if (names.size < 80 || names.has(name)) names.add(name);
      else truncated = true;
    }
  };
  const declared = component.constructor && component.constructor.__props__;
  if (Array.isArray(declared)) {
    if (declared.length > 100) truncated = true;
    declared.slice(0, 100).forEach((name) => {
      if (isPublicName(name)) declaredNames.add(name);
      include(name);
    });
  }
  const projectScript = Boolean(registeredName && !registeredName.startsWith('cc.'));
  let runtimeFieldCount = 0;
  for (const name of Object.getOwnPropertyNames(component)) {
    const descriptor = Object.getOwnPropertyDescriptor(component, name);
    if (isPublicName(name) && !declaredNames.has(name) && descriptor &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        typeof descriptor.value !== 'function') {
      runtimeFieldCount += 1;
      if (!projectScript || includeRuntimeFields) include(name);
    }
  }
  return { names: [...names], declaredNames, truncated, runtimeFieldCount,
    runtimeFieldsIncluded: !projectScript || includeRuntimeFields };
}

function readIncludeRuntimeFields(options) {
  if (options.includeRuntimeFields == null) return false;
  if (typeof options.includeRuntimeFields !== 'boolean') {
    throw new Error('includeRuntimeFields must be a boolean.');
  }
  return options.includeRuntimeFields;
}

function componentPropertyMetadata(componentClass, propertyName) {
  let attrs;
  try {
    attrs = cc.CCClass && typeof cc.CCClass.attr === 'function'
      ? cc.CCClass.attr(componentClass, propertyName) : null;
  } catch (_) {
    attrs = null;
  }
  if (attrs && attrs.visible === false) return { visible: false, serialization: 'unknown' };
  if (attrs && attrs.serializable === false) return { visible: true, serialization: 'excluded' };
  if (attrs && (attrs.serializable === true || Object.prototype.hasOwnProperty.call(attrs, 'default'))) {
    return { visible: true, serialization: 'declared' };
  }
  return { visible: true, serialization: 'unknown' };
}

function readComponentRuntimeProperty(component, propertyName, registeredName) {
  for (let current = component, depth = 0; current && depth < 6; current = Object.getPrototypeOf(current), depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
    if (!descriptor) continue;
    if (typeof descriptor.get === 'function' && !registeredName.startsWith('cc.')) {
      return { unreadAccessor: true };
    }
    break;
  }
  return { value: component[propertyName] };
}

function componentRuntimeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value !== 'object') return { kind: 'unsupported', type: typeof value };
  if (value instanceof Node) return { kind: 'node', uuid: value.uuid || '', name: value.name || '' };
  if (value instanceof Component) return {
    kind: 'component',
    name: value.constructor && value.constructor.name || '',
    nodeUuid: value.node && value.node.uuid || '',
  };
  if (cc.Asset && value instanceof cc.Asset) return {
    kind: 'asset', name: value.name || '', uuid: value.uuid || value._uuid || '',
  };
  if (value instanceof Color) return { kind: 'value-type', type: 'Color', fields: colorToObject(value) };
  if (seen.has(value)) return { kind: 'circular' };
  seen.add(value);
  try {
    if (Array.isArray(value)) return {
      kind: 'array', length: value.length,
      items: depth < 2 ? value.slice(0, 6).map((item) => componentRuntimeValue(item, depth + 1, seen)) : [],
      truncated: value.length > 6 || depth >= 2,
    };
    const type = value.constructor && value.constructor.name || 'Object';
    if (depth >= 2 || (Object.getPrototypeOf(value) !== Object.prototype &&
        !(cc.ValueType && value instanceof cc.ValueType))) {
      return { kind: 'object', type };
    }
    const fields = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => !key.startsWith('_') &&
      Object.prototype.hasOwnProperty.call(descriptors[key], 'value') &&
      typeof descriptors[key].value !== 'function');
    for (const key of keys.slice(0, 8)) {
      fields[key] = componentRuntimeValue(descriptors[key].value, depth + 1, seen);
    }
    return { kind: cc.ValueType && value instanceof cc.ValueType ? 'value-type' : 'object',
      type, fields, truncated: keys.length > 8 };
  } finally {
    seen.delete(value);
  }
}

function describeComponent(component, index, maxProperties, includeRuntimeFields) {
  const componentClass = component.constructor;
  const registeredName = (js && typeof js.getClassName === 'function' && js.getClassName(componentClass)) || '';
  const enabledDescriptor = Object.getOwnPropertyDescriptor(component, '_enabled');
  const enabled = enabledDescriptor && typeof enabledDescriptor.value === 'boolean'
    ? enabledDescriptor.value : undefined;
  const enumerated = getComponentPropertyNames(component, registeredName, includeRuntimeFields);
  const names = enumerated.names
    .map((name) => ({ name, metadata: componentPropertyMetadata(componentClass, name) }))
    .filter(({ metadata }) => metadata.visible);
  const properties = names.slice(0, maxProperties).map(({ name, metadata }) => {
    let value;
    try {
      const read = readComponentRuntimeProperty(component, name, registeredName);
      value = read.unreadAccessor ? { kind: 'accessor-not-read' } : componentRuntimeValue(read.value);
    } catch (_) {
      value = { kind: 'unavailable' };
    }
    return { name, runtimeValue: value, directSerialization: metadata.serialization,
      origin: enumerated.declaredNames.has(name) ? 'ccclass-declared' : 'runtime-own' };
  });
  return {
    index,
    name: componentClass && componentClass.name || 'UnknownComponent',
    registeredName,
    enabled,
    keys: names.slice(0, 50).map(({ name }) => name),
    keysTruncated: names.length > 50 || enumerated.truncated,
    propertyCount: names.length,
    runtimeFieldCount: enumerated.runtimeFieldCount,
    runtimeFieldsIncluded: enumerated.runtimeFieldsIncluded,
    propertyEnumerationTruncated: enumerated.truncated,
    propertiesTruncated: names.length > maxProperties || enumerated.truncated,
    properties,
  };
}

function getNodePath(node) {
  const names = [];
  let current = node;
  const scene = getScene();

  while (current && current !== scene) {
    names.unshift(current.name);
    current = current.parent;
  }

  return names.join('/');
}

function hasLinkedPrefabAncestor(node, scene) {
  for (let current = node; current && current !== scene; current = current.parent) {
    const prefab = current._prefab;
    if (prefab && (prefab.instance || prefab.asset || prefab._asset || prefab.fileId || prefab.root)) {
      return true;
    }
  }
  return false;
}

function assertCloneableSceneSubtree(root, scene) {
  if (hasLinkedPrefabAncestor(root, scene)) {
    throw new Error('Duplicating a linked prefab hierarchy is not supported by duplicate_node.');
  }
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!isSceneContentNode(node)) {
      throw new Error('Duplicating a subtree with editor-only nodes is not supported by duplicate_node.');
    }
    const prefab = node._prefab;
    if (prefab && (prefab.instance || prefab.asset || prefab._asset || prefab.fileId || prefab.root)) {
      throw new Error('Duplicating a subtree containing a linked prefab is not supported by duplicate_node.');
    }
    for (const child of node.children) pending.push(child);
  }
}

function readQueryLimit(value, fallback, maximum, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function readBatchVector(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['x', 'y', 'z'].includes(key)) ||
      ['x', 'y', 'z'].some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
    throw new Error(`${label} must contain finite numeric x, y, and z values only.`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function batchNodeSnapshot(node) {
  return {
    position: vectorToObject(node.position),
    rotation: quatToObject(node.rotation),
    scale: vectorToObject(node.scale),
    active: Boolean(node.active),
  };
}

function valuesNear(actual, expected, keys, tolerance = 1e-5) {
  return keys.every((key) => Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= tolerance);
}

function rotationsNear(actual, expected) {
  const keys = ['x', 'y', 'z', 'w'];
  return valuesNear(actual, expected, keys, 1e-4) ||
    keys.every((key) => Number.isFinite(actual[key]) && Math.abs(actual[key] + expected[key]) <= 1e-4);
}

function vectorToObject(value) {
  if (!value) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z };
}

function quatToObject(value) {
  if (!value) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function colorToObject(value) {
  if (!value) {
    return null;
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function summarizeNode(node, depth, maxDepth, includeComponents, includeInactive, budget) {
  if (!isSceneContentNode(node) || (!includeInactive && !node.active)) {
    return null;
  }
  if (budget.count >= budget.maxNodes) {
    budget.truncatedByCount = true;
    return null;
  }
  budget.count += 1;

  const summary = {
    name: node.name,
    path: getNodePath(node),
    uuid: node.uuid,
    active: Boolean(node.active),
    layer: node.layer,
    position: vectorToObject(node.position),
    rotation: quatToObject(node.rotation),
    scale: vectorToObject(node.scale),
  };

  if (includeComponents) {
    summary.components = getComponentNames(node);
  }

  if (depth < maxDepth) {
    const children = [];
    for (const child of sceneContentChildren(node)) {
      const childSummary = summarizeNode(child, depth + 1, maxDepth, includeComponents, includeInactive, budget);
      if (childSummary) {
        children.push(childSummary);
      }
    }
    summary.children = children;
  } else {
    summary.childCount = sceneContentChildren(node).length;
    if (summary.childCount > 0) budget.truncatedByDepth = true;
  }

  return summary;
}

function walkNodes(visitor, node) {
  if (!isSceneContentNode(node)) return;
  visitor(node);
  for (const child of sceneContentChildren(node)) {
    walkNodes(visitor, child);
  }
}

function findNodeByPath(nodePath) {
  return resolveNode(getScene(), { path: nodePath }, { includeNode: isSceneContentNode });
}

function findNode(input) {
  return resolveNode(getScene(), input || {}, { includeNode: isSceneContentNode });
}

function getCceSerializer() {
  const cceGlobal = typeof globalThis !== 'undefined' ? globalThis.cce : undefined;
  const serializer = cceGlobal && cceGlobal.Utils && cceGlobal.Utils.serialize;
  if (typeof serializer !== 'function') {
    throw new Error('cce.Utils.serialize is unavailable. Prefab serialization must run in the Cocos scene process.');
  }
  return serializer.bind(cceGlobal.Utils);
}

function resolveComponentClass(componentName) {
  if (!componentName) {
    return null;
  }
  if (typeof componentName !== 'string') {
    return componentName;
  }

  const direct = js && typeof js.getClassByName === 'function' ? js.getClassByName(componentName) : null;
  if (direct) {
    return direct;
  }

  const candidates = [componentName, `cc.${componentName}`];
  for (const candidate of candidates) {
    const found = js && typeof js.getClassByName === 'function' ? js.getClassByName(candidate) : null;
    if (found) {
      return found;
    }
  }

  return null;
}

function isAttachableComponentClass(type) {
  return typeof type === 'function' && Boolean(Component) &&
    type !== Component && Boolean(type.prototype) && type.prototype instanceof Component;
}

function componentTypeEntry(type, source, extra = {}) {
  const registeredName = js && typeof js.getClassName === 'function' ? js.getClassName(type) || '' : '';
  return {
    name: registeredName || type.name || '',
    registeredName,
    source,
    status: isAttachableComponentClass(type) ? 'attachable' : 'not-component',
    ...extra,
  };
}

function readComponentTypeCandidates(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some((name) =>
    typeof name !== 'string' || name.length > 128 || !/^[A-Za-z_$][\w.$-]*$/.test(name))) {
    throw new Error('candidateNames must be an array of at most 32 non-empty class names (each at most 128 characters).');
  }
  return [...new Set(value)];
}

function findComponent(node, options = {}) {
  if (!node) {
    return null;
  }

  if (Number.isInteger(options.index)) {
    return node.components[options.index] || null;
  }

  if (options.componentName) {
    const exact = node.components.find((component) => component && component.constructor && component.constructor.name === options.componentName);
    if (exact) {
      return exact;
    }

    const componentClass = resolveComponentClass(options.componentName);
    if (componentClass) {
      return node.getComponent(componentClass);
    }
  }

  return null;
}

function getEventHandlerClass() {
  return (Component && Component.EventHandler) || EventHandler || null;
}

function getEventHandlerComponentName(handler) {
  const declaredName = handler && handler.component || '';
  if (declaredName) {
    return declaredName;
  }
  const componentId = handler && handler._componentId;
  const componentClass = componentId && js && typeof js.getClassById === 'function'
    ? js.getClassById(componentId)
    : null;
  if (componentClass) {
    return (js && typeof js.getClassName === 'function' && js.getClassName(componentClass))
      || componentClass.name
      || '';
  }
  return '';
}

function findComponentReferences(scene, targetNode, targetComponent, componentClass, classId) {
  const references = [];
  const className = (js && typeof js.getClassName === 'function' && js.getClassName(componentClass))
    || componentClass.name || '';
  let inspected = 0;
  const inspectValue = (value, location, seen, depth) => {
    if (++inspected > 100000) {
      throw new Error('Component reference check exceeded 100000 values; no component was removed.');
    }
    if (value === targetComponent) {
      references.push(location);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.target === targetNode && (
      value._componentId ? value._componentId === classId : value.component === className
    )) {
      references.push(location);
      return;
    }
    if (value instanceof Node || value instanceof Component || depth >= 4) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        inspectValue(value[index], `${location}[${index}]`, seen, depth + 1);
      }
    } else if (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value).constructor === Object ||
        Object.getPrototypeOf(value).constructor && Object.getPrototypeOf(value).constructor.name === 'Object') {
      for (const key of Object.keys(value)) {
        if (key.startsWith('__')) continue;
        inspectValue(value[key], `${location}.${key}`, seen, depth + 1);
      }
    }
  };
  walkNodes((node) => {
    for (const component of node.components || []) {
      if (!component || component === targetComponent) continue;
      const prefix = `${getNodePath(node)}:${component.constructor && component.constructor.name || 'Component'}`;
      const seen = new Set();
      for (const key of Object.keys(component)) {
        if (key === 'node' || key === '_node' || key.startsWith('__')) continue;
        inspectValue(component[key], `${prefix}.${key}`, seen, 0);
      }
      if (Button && component instanceof Button && Array.isArray(component.clickEvents)) {
        inspectValue(component.clickEvents, `${prefix}.clickEvents`, seen, 0);
      }
    }
  }, scene);
  return [...new Set(references)];
}

function serializeEventHandler(handler) {
  if (!handler) {
    return null;
  }
  return {
    target: handler.target && handler.target.name ? getNodePath(handler.target) : '',
    targetUuid: handler.target && handler.target.uuid ? handler.target.uuid : '',
    component: getEventHandlerComponentName(handler),
    handler: handler.handler || '',
    customEventData: handler.customEventData || '',
  };
}

function getOrAddComponent(node, componentClass) {
  return node.getComponent(componentClass) || node.addComponent(componentClass);
}

function configureNodeBasics(node, options = {}) {
  if (options.position) {
    node.setPosition(options.position.x || 0, options.position.y || 0, options.position.z || 0);
  }
  if (options.scale) {
    node.setScale(options.scale.x || 1, options.scale.y || 1, options.scale.z || 1);
  }
  if (options.eulerAngles) {
    node.setRotationFromEuler(
      options.eulerAngles.x || 0,
      options.eulerAngles.y || 0,
      options.eulerAngles.z || 0
    );
  }
  if (typeof options.active === 'boolean') {
    node.active = options.active;
  }
}

function configureUITransform(node, options = {}) {
  const transform = getOrAddComponent(node, UITransform);
  const width = Number.isFinite(options.width) ? options.width : 160;
  const height = Number.isFinite(options.height) ? options.height : 60;
  transform.setContentSize(width, height);
  if (options.anchor) {
    transform.setAnchorPoint(options.anchor.x ?? 0.5, options.anchor.y ?? 0.5);
  }
  return transform;
}

function parseColor(value, fallback = Color.WHITE) {
  if (!value) {
    return fallback.clone ? fallback.clone() : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.startsWith('#') ? value.slice(1) : value;
    const number = Number.parseInt(normalized.length === 6 ? `${normalized}ff` : normalized, 16);
    if (Number.isFinite(number)) {
      return new Color(
        (number >> 24) & 255,
        (number >> 16) & 255,
        (number >> 8) & 255,
        number & 255
      );
    }
  }
  return new Color(value.r ?? 255, value.g ?? 255, value.b ?? 255, value.a ?? 255);
}

function findComponentsByClass(componentClass) {
  const results = [];
  walkNodes((node) => {
    if (node === getScene()) {
      return;
    }
    const component = node.getComponent(componentClass);
    if (component) {
      results.push(component);
    }
  }, getScene());
  return results;
}

function getPrefabInfo(node) {
  const prefab = node && node._prefab;
  if (!prefab) {
    return {
      linked: false,
    };
  }

  const asset = prefab.asset || prefab._asset || null;
  return {
    linked: Boolean(asset || prefab.fileId || prefab.root),
    fileId: prefab.fileId || '',
    asset: asset
      ? {
          name: asset.name || '',
          uuid: asset.uuid || asset._uuid || '',
        }
      : null,
    instance: prefab.instance ? plain(prefab.instance) : null,
    sync: prefab.sync,
    rawKeys: Object.keys(prefab).slice(0, 50),
  };
}

function recordButtonClickEventPrefabOverride(button) {
  // Creator serializes linked instances from propertyOverrides, not from a
  // direct component assignment. Use the component's prefab-local file ID.
  let root = button.node;
  while (root && !(root._prefab && root._prefab.instance)) root = root.parent;
  if (!root) return false;

  const instance = root._prefab.instance;
  const fileId = button.__prefab && button.__prefab.fileId;
  const utils = Prefab && Prefab._utils;
  if (!fileId || !Array.isArray(instance.propertyOverrides) ||
      !utils || !utils.TargetInfo || !utils.PropertyOverrideInfo) {
    throw new Error('Cannot persist Button click events on this prefab instance: Creator prefab override metadata is unavailable.');
  }

  const localID = [fileId];
  const propertyPath = ['clickEvents'];
  let override = typeof instance.findPropertyOverride === 'function'
    ? instance.findPropertyOverride(localID, propertyPath)
    : instance.propertyOverrides.find((item) =>
      item && item.targetInfo && Array.isArray(item.targetInfo.localID) &&
      item.targetInfo.localID.length === 1 && item.targetInfo.localID[0] === fileId &&
      Array.isArray(item.propertyPath) && item.propertyPath.length === 1 &&
      item.propertyPath[0] === 'clickEvents');
  if (!override) {
    override = new utils.PropertyOverrideInfo();
    override.targetInfo = new utils.TargetInfo();
    override.targetInfo.localID = localID;
    override.propertyPath = propertyPath;
    instance.propertyOverrides.push(override);
  }
  override.value = button.clickEvents.slice();
  return true;
}

function collectSceneStats() {
  const stats = {
    nodeCount: 0,
    activeNodeCount: 0,
    inactiveNodeCount: 0,
    maxDepth: 0,
    componentCount: 0,
    componentsByType: {},
    prefabInstanceCount: 0,
    uiTransformCount: 0,
    canvasCount: 0,
    cameraCount: 0,
    labelCount: 0,
    spriteCount: 0,
    buttonCount: 0,
  };

  function visit(node, depth) {
    if (!isSceneContentNode(node)) return;
    if (node !== getScene()) {
      stats.nodeCount += 1;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      if (node.active) stats.activeNodeCount += 1;
      else stats.inactiveNodeCount += 1;
      if (node._prefab) stats.prefabInstanceCount += 1;
    }

    for (const component of node.components || []) {
      const name = component && component.constructor ? component.constructor.name : 'UnknownComponent';
      stats.componentCount += 1;
      stats.componentsByType[name] = (stats.componentsByType[name] || 0) + 1;
      if (component instanceof UITransform) stats.uiTransformCount += 1;
      if (component instanceof Canvas) stats.canvasCount += 1;
      if (component instanceof Camera) stats.cameraCount += 1;
      if (component instanceof Label) stats.labelCount += 1;
      if (component instanceof Sprite) stats.spriteCount += 1;
      if (component instanceof Button) stats.buttonCount += 1;
    }

    for (const child of sceneContentChildren(node)) {
      visit(child, depth + 1);
    }
  }

  visit(getScene(), 0);
  return stats;
}

function buildSceneWarnings(stats) {
  const warnings = [];
  if (stats.nodeCount === 0) {
    warnings.push({ severity: 'warn', code: 'empty_scene', message: 'The active scene has no child nodes.' });
  }
  if (stats.cameraCount === 0) {
    warnings.push({ severity: 'warn', code: 'missing_camera', message: 'No Camera component was found in the active scene.' });
  }
  if (stats.nodeCount > 500) {
    warnings.push({ severity: 'info', code: 'large_node_count', message: `Scene has ${stats.nodeCount} nodes.` });
  }
  if (stats.maxDepth > 12) {
    warnings.push({ severity: 'info', code: 'deep_hierarchy', message: `Scene hierarchy depth is ${stats.maxDepth}.` });
  }
  if (stats.labelCount > 80) {
    warnings.push({ severity: 'info', code: 'many_labels', message: `Scene has ${stats.labelCount} Label components.` });
  }
  return warnings;
}

function getScheduler() {
  return typeof director.getScheduler === 'function' ? director.getScheduler() : null;
}

function loadAnimationClipByUuid(uuid) {
  return new Promise((resolve, reject) => {
    assetManager.loadAny(uuid, (error, asset) => {
      if (error) {
        reject(error);
        return;
      }
      if (!(asset instanceof AnimationClip)) {
        reject(new Error(`Asset '${uuid}' is not an AnimationClip.`));
        return;
      }
      resolve(asset);
    });
  });
}

function getValueByPath(target, propertyPath) {
  const segments = String(propertyPath || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current = target;
  for (const segment of segments) {
    if (current == null) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function classIs(type, base) {
  return typeof type === 'function' && typeof base === 'function' &&
    (type === base || type.prototype instanceof base);
}

function editableComponentProperty(component, propertyName) {
  const cls = component.constructor;
  let attrs;
  try {
    attrs = cc.CCClass && typeof cc.CCClass.attr === 'function' ? cc.CCClass.attr(cls, propertyName) : null;
  } catch (_) {
    attrs = null;
  }
  if (attrs && (attrs.visible === false || attrs.readonly === true)) {
    throw new Error(`${propertyName} is hidden or readonly.`);
  }
  const builtins = typeof Sprite === 'function' && cls === Sprite
    ? { color: 'color', spriteFrame: 'asset' }
    : typeof UITransform === 'function' && cls === UITransform
      ? { anchorPoint: 'vec2', contentSize: 'size' }
      : typeof Label === 'function' && cls === Label
        ? { string: 'string', color: 'color' } : {};
  const builtinKind = builtins[propertyName];
  const declared = Array.isArray(cls.__props__) && cls.__props__.includes(propertyName);
  if (!builtinKind && (!declared || !attrs || attrs.serializable === false)) {
    throw new Error(`${propertyName} is not an editable declared field or supported built-in property.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(component, propertyName);
  if (!builtinKind && (!descriptor || descriptor.writable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value'))) {
    throw new Error(`${propertyName} is not a writable own data field.`);
  }
  if (builtinKind) {
    let writableAccessor = false;
    for (let proto = component; proto; proto = Object.getPrototypeOf(proto)) {
      const candidate = Object.getOwnPropertyDescriptor(proto, propertyName);
      if (candidate) {
        writableAccessor = typeof candidate.set === 'function';
        break;
      }
    }
    if (!writableAccessor) throw new Error(`${propertyName} has no writable Cocos setter.`);
  }
  const current = component[propertyName];
  const ctor = attrs && attrs.ctor;
  let kind = builtinKind;
  if (!kind) {
    if (classIs(ctor, Node) || current instanceof Node) kind = 'node';
    else if (classIs(ctor, Component) || current instanceof Component) kind = 'component';
    else if (classIs(ctor, Asset) || (typeof Asset === 'function' && current instanceof Asset)) kind = 'asset';
    else if (current instanceof Color || classIs(ctor, Color)) kind = 'color';
    else if (typeof Vec2 === 'function' && (current instanceof Vec2 || classIs(ctor, Vec2))) kind = 'vec2';
    else if (current instanceof Vec3 || classIs(ctor, Vec3)) kind = 'vec3';
    else if (typeof Vec4 === 'function' && (current instanceof Vec4 || classIs(ctor, Vec4))) kind = 'vec4';
    else if (typeof Size === 'function' && (current instanceof Size || classIs(ctor, Size))) kind = 'size';
    else if (['boolean', 'number', 'string'].includes(typeof current)) kind = typeof current;
  }
  if (!kind) throw new Error(`${propertyName} has no supported editable value type.`);
  return { kind, expectedClass: ctor || (current && current.constructor), current };
}

function exactObject(value, required, optional = []) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    throw new Error(`Value must be an object with ${required.join(', ')}.`);
  }
  const keys = Object.keys(value);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Value must contain only ${[...required, ...optional].join(', ')}.`);
  }
  return value;
}

function finiteFields(value, keys, { integer = false, min = -Infinity, max = Infinity } = {}) {
  exactObject(value, keys);
  for (const key of keys) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) ||
        (integer && !Number.isInteger(value[key])) || value[key] < min || value[key] > max) {
      throw new Error(`${key} must be a finite ${integer ? 'integer' : 'number'} between ${min} and ${max}.`);
    }
  }
  return value;
}

async function convertEditableComponentValue(edit, input) {
  const { kind, expectedClass } = edit;
  if (kind === 'boolean' || kind === 'string') {
    if (typeof input !== kind) throw new Error(`Value must be ${kind}.`);
    return input;
  }
  if (kind === 'number') {
    if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error('Value must be a finite number.');
    return input;
  }
  if (input === null && ['node', 'component', 'asset'].includes(kind)) return null;
  if (kind === 'color') {
    if (typeof input === 'string') {
      if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(input)) throw new Error('Color must be #RRGGBB or #RRGGBBAA.');
      const hex = input.slice(1);
      return new Color(...[0, 2, 4, 6].map((offset) => offset < hex.length
        ? Number.parseInt(hex.slice(offset, offset + 2), 16) : 255));
    }
    exactObject(input, ['r', 'g', 'b'], ['a']);
    finiteFields({ r: input.r, g: input.g, b: input.b, a: input.a == null ? 255 : input.a },
      ['r', 'g', 'b', 'a'], { integer: true, min: 0, max: 255 });
    return new Color(input.r, input.g, input.b, input.a == null ? 255 : input.a);
  }
  if (['vec2', 'vec3', 'vec4', 'size'].includes(kind)) {
    const keys = kind === 'size' ? ['width', 'height'] :
      kind === 'vec2' ? ['x', 'y'] : kind === 'vec3' ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'w'];
    finiteFields(input, keys, kind === 'size' ? { min: 0 } : {});
    const cls = { vec2: Vec2, vec3: Vec3, vec4: Vec4, size: Size }[kind];
    if (typeof cls !== 'function') throw new Error(`${kind} is unavailable in this Creator version.`);
    return new cls(...keys.map((key) => input[key]));
  }
  if (kind === 'node' || kind === 'component') {
    const node = findNode(exactObject(input, [], ['uuid', 'path', 'name']));
    if (!node || node === getScene()) throw new Error('Referenced scene node was not found.');
    if (kind === 'node') return node;
    const matches = node.components.filter((item) => classIs(item && item.constructor, expectedClass));
    if (matches.length !== 1) throw new Error('Referenced node must contain exactly one matching component.');
    return matches[0];
  }
  if (kind === 'asset') {
    const { assetUuid } = exactObject(input, ['assetUuid']);
    if (typeof assetUuid !== 'string' || !assetUuid.trim() || assetUuid.length > 200) {
      throw new Error('assetUuid must be a non-empty asset identifier of at most 200 characters.');
    }
    const asset = await loadAssetByUuid(assetUuid.trim());
    if (!classIs(asset && asset.constructor, expectedClass)) {
      throw new Error(`Asset '${assetUuid}' is not the declared component asset type.`);
    }
    return asset;
  }
  throw new Error(`Unsupported editable value type: ${kind}.`);
}

function resetValueByPath(target, propertyPath) {
  const segments = String(propertyPath || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    throw new Error('propertyPath is required.');
  }

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = current[segments[index]];
    if (current == null) {
      return;
    }
  }

  const key = segments[segments.length - 1];
  if (current && Object.prototype.hasOwnProperty.call(current, key)) {
    delete current[key];
  } else if (current) {
    current[key] = undefined;
  }
}

function copyComponentDefault(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (cc.ValueType && value instanceof cc.ValueType && typeof value.clone === 'function') {
    return value.clone();
  }
  if (Array.isArray(value) && depth < 4 && value.length <= 100) {
    return value.map((item) => copyComponentDefault(item, depth + 1));
  }
  throw new Error('This component default is not a supported primitive, Cocos ValueType, or bounded array.');
}

function loadAssetByUuid(uuid) {
  return new Promise((resolve, reject) => {
    assetManager.loadAny(uuid, (error, asset) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(asset);
    });
  });
}

function plain(value, depth = 0, seen = new WeakSet()) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Node) {
    return {
      name: value.name,
      path: getNodePath(value),
      uuid: value.uuid,
      active: Boolean(value.active),
      components: getComponentNames(value),
    };
  }

  if (value instanceof Vec3) {
    return vectorToObject(value);
  }

  if (value instanceof Quat) {
    return quatToObject(value);
  }

  if (value instanceof Color) {
    return colorToObject(value);
  }

  if (Array.isArray(value)) {
    if (depth >= 5) {
      return `[Array(${value.length})]`;
    }
    return value.map((item) => plain(item, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (depth >= 5) {
      return `[${value.constructor && value.constructor.name ? value.constructor.name : 'Object'}]`;
    }

    const output = {};
    for (const key of Object.keys(value)) {
      try {
        output[key] = plain(value[key], depth + 1, seen);
      } catch (error) {
        output[key] = `[Unserializable: ${error.message}]`;
      }
    }
    return output;
  }

  return String(value);
}

async function executeUserCode(code, args, scriptConsole = console) {
  const scene = getScene();
  const runner = new AsyncFunction('require', 'cc', 'Editor', 'scene', 'director', 'args', 'console', `
    const module = { exports: {} };
    const exports = module.exports;
    ${code}
    if (typeof run === 'function') {
      return await run({ cc, Editor, scene, director, args, console });
    }
    if (typeof module.exports === 'function') {
      return await module.exports({ cc, Editor, scene, director, args, console });
    }
    if (module.exports && typeof module.exports.run === 'function') {
      return await module.exports.run({ cc, Editor, scene, director, args, console });
    }
  `);
  return await runner(require, cc, global.Editor, scene, director, args || {}, scriptConsole);
}

exports.methods = {
  async getSceneInfo(options = {}) {
    const maxDepth = readQueryLimit(options.maxDepth, 2, 32, 'maxDepth');
    const maxNodes = readQueryLimit(options.maxNodes, 200, 2000, 'maxNodes');
    const includeComponents = options.includeComponents !== false;
    const scene = getScene();
    const budget = { count: 0, maxNodes, truncatedByCount: false, truncatedByDepth: false };
    const children = sceneContentChildren(scene);
    const nodes = children
      .map((child) => summarizeNode(child, 1, maxDepth, includeComponents, true, budget))
      .filter(Boolean);
    return {
      sceneName: scene.name,
      uuid: scene.uuid,
      childCount: children.length,
      nodes,
      returnedNodes: budget.count,
      truncated: budget.truncatedByCount || budget.truncatedByDepth,
      truncationReasons: [budget.truncatedByCount && 'maxNodes', budget.truncatedByDepth && 'maxDepth'].filter(Boolean),
    };
  },

  async getHierarchy(options = {}) {
    const hasSelector = options.rootPath || options.rootUuid || options.rootName;
    const root = hasSelector
      ? findNode({ path: options.rootPath, uuid: options.rootUuid, name: options.rootName })
      : getScene();
    if (!root) {
      throw new Error(`Node not found: ${options.rootUuid || options.rootPath || options.rootName}`);
    }

    const maxDepth = readQueryLimit(options.maxDepth, 3, 32, 'maxDepth');
    const maxNodes = readQueryLimit(options.maxNodes, 200, 2000, 'maxNodes');
    const includeComponents = options.includeComponents !== false;
    const includeInactive = options.includeInactive !== false;
    const budget = { count: 0, maxNodes, truncatedByCount: false, truncatedByDepth: false };

    if (root === getScene()) {
      const nodes = sceneContentChildren(root)
        .map((child) => summarizeNode(child, 1, maxDepth, includeComponents, includeInactive, budget))
        .filter(Boolean);
      return {
        sceneName: root.name,
        nodes,
        returnedNodes: budget.count,
        truncated: budget.truncatedByCount || budget.truncatedByDepth,
        truncationReasons: [budget.truncatedByCount && 'maxNodes', budget.truncatedByDepth && 'maxDepth'].filter(Boolean),
      };
    }

    const summary = summarizeNode(root, 0, maxDepth, includeComponents, includeInactive, budget);
    if (!summary) return null;
    summary.returnedNodes = budget.count;
    summary.truncated = budget.truncatedByCount || budget.truncatedByDepth;
    summary.truncationReasons = [budget.truncatedByCount && 'maxNodes', budget.truncatedByDepth && 'maxDepth'].filter(Boolean);
    return summary;
  },

  async inspectNode(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }

    return {
      name: node.name,
      path: getNodePath(node),
      uuid: node.uuid,
      active: Boolean(node.active),
      layer: node.layer,
      siblingIndex: node.getSiblingIndex(),
      position: vectorToObject(node.position),
      rotation: quatToObject(node.rotation),
      scale: vectorToObject(node.scale),
      children: sceneContentChildren(node).map((child) => ({
        name: child.name,
        path: getNodePath(child),
        uuid: child.uuid,
      })),
      components: getComponentNames(node),
    };
  },

  async detectNodeType(options = {}) {
    const node = findNode(options);
    if (!node || node === getScene()) {
      throw new Error('Target scene node was not found. Provide a node uuid, path, or unique name.');
    }
    return {
      name: node.name,
      path: getNodePath(node),
      uuid: node.uuid,
      components: getComponentNames(node),
      ...detectNodeType(node),
    };
  },

  async findNodes(options = {}) {
    const name = options.name ? String(options.name) : '';
    const pathContains = options.pathContains ? String(options.pathContains) : '';
    const component = options.component ? String(options.component) : '';
    const includeInactive = options.includeInactive !== false;
    const maxResults = readQueryLimit(options.maxResults, 200, 500, 'maxResults');
    const results = [];
    let count = 0;

    walkNodes((node) => {
      if (node === getScene()) {
        return;
      }

      if (!includeInactive && !node.active) {
        return;
      }

      const nodePath = getNodePath(node);
      const components = getComponentNames(node);

      if (name && node.name !== name) {
        return;
      }

      if (pathContains && !nodePath.includes(pathContains)) {
        return;
      }

      if (component && !components.includes(component)) {
        return;
      }

      count += 1;
      if (results.length < maxResults) {
        results.push({
          name: node.name,
          path: nodePath,
          uuid: node.uuid,
          active: Boolean(node.active),
          components,
        });
      }
    }, getScene());

    return {
      count,
      returnedCount: results.length,
      truncated: count > results.length,
      nodes: results,
    };
  },

  async createNode(options = {}) {
    const name = String(options.name || '').trim();
    if (!name) {
      throw new Error('name is required.');
    }

    const parent = options.parentPath || options.parentUuid || options.parentName
      ? findNode({ path: options.parentPath, uuid: options.parentUuid, name: options.parentName })
      : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentUuid || options.parentPath || options.parentName}`);
    }

    const node = new Node(name);
    node.parent = parent;

    if (options.position) {
      node.setPosition(options.position.x || 0, options.position.y || 0, options.position.z || 0);
    }

    if (options.scale) {
      node.setScale(options.scale.x || 1, options.scale.y || 1, options.scale.z || 1);
    }

    if (options.eulerAngles) {
      node.setRotationFromEuler(
        options.eulerAngles.x || 0,
        options.eulerAngles.y || 0,
        options.eulerAngles.z || 0
      );
    }

    if (typeof options.active === 'boolean') {
      node.active = options.active;
    }

    return {
      created: true,
      name: node.name,
      path: getNodePath(node),
      uuid: node.uuid,
    };
  },

  async deleteNode(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }

    const targetPath = getNodePath(node);
    node.removeFromParent();
    node.destroy();

    return {
      deleted: true,
      path: targetPath,
      uuid: node.uuid,
    };
  },

  async moveNode(options = {}) {
    const scene = getScene();
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found. Provide its uuid, path, or unique name.');
    }
    const parentSelector = {
      uuid: options.parentUuid,
      path: options.parentPath,
      name: options.parentName,
    };
    const parent = findNode(parentSelector);
    if (!parent) {
      throw new Error('Parent node was not found. Provide parentUuid, parentPath, or parentName (parentPath "/" selects the scene root).');
    }
    if (node === scene) {
      throw new Error('The scene root cannot be moved.');
    }
    if (typeof options.keepWorldTransform !== 'undefined' && typeof options.keepWorldTransform !== 'boolean') {
      throw new Error('keepWorldTransform must be a boolean.');
    }
    for (let current = parent; current; current = current.parent) {
      if (current === node) {
        throw new Error('A node cannot be moved into itself or one of its descendants.');
      }
    }

    // Direct reparenting of a linked prefab hierarchy may not be recorded as
    // an instance override. Keep this operation limited to ordinary scene nodes.
    if (hasLinkedPrefabAncestor(node, scene) || hasLinkedPrefabAncestor(parent, scene)) {
      throw new Error('Moving a linked prefab instance or moving into one is not supported by move_node.');
    }

    const previousParent = node.parent;
    const previousPath = getNodePath(node);
    const keepWorldTransform = options.keepWorldTransform !== false;
    if (previousParent === parent) {
      return {
        moved: false,
        uuid: node.uuid,
        path: previousPath,
        parentPath: getNodePath(parent),
        keepWorldTransform,
      };
    }

    node.setParent(parent, keepWorldTransform);
    if (node.parent !== parent) {
      throw new Error('Node.setParent did not attach the node to the requested parent.');
    }
    return {
      moved: true,
      uuid: node.uuid,
      previousPath,
      path: getNodePath(node),
      previousParentUuid: previousParent.uuid,
      parentUuid: parent.uuid,
      previousParentPath: getNodePath(previousParent),
      parentPath: getNodePath(parent),
      keepWorldTransform,
      position: vectorToObject(node.position),
      worldPosition: vectorToObject(node.worldPosition),
    };
  },

  async reorderNode(options = {}) {
    const scene = getScene();
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found. Provide its uuid, path, or unique name.');
    }
    if (node === scene) {
      throw new Error('The scene root cannot be reordered.');
    }
    const parent = node.parent;
    if (!parent || hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Reordering a linked prefab hierarchy is not supported by reorder_node.');
    }
    const parentSelector = {
      uuid: options.parentUuid,
      path: options.parentPath,
      name: options.parentName,
    };
    if (Object.values(parentSelector).some((value) => value != null && String(value).trim() !== '')) {
      const expectedParent = findNode(parentSelector);
      if (expectedParent !== parent) {
        throw new Error('The node is no longer under the specified parent.');
      }
    }

    const siblings = sceneContentChildren(parent);
    const previousIndex = siblings.indexOf(node);
    if (previousIndex < 0) {
      throw new Error('The node is not a serializable child of its parent.');
    }
    const index = options.index;
    if (!Number.isInteger(index) || index < 0 || index >= siblings.length) {
      throw new Error(`index must be an integer between 0 and ${siblings.length - 1}.`);
    }
    if (index === previousIndex) {
      return {
        reordered: false,
        uuid: node.uuid,
        path: getNodePath(node),
        parentUuid: parent.uuid,
        parentPath: getNodePath(parent),
        previousIndex,
        index,
        siblingUuids: siblings.map((sibling) => sibling.uuid),
      };
    }

    // Translate the index among serializable nodes into the actual children
    // array, which may contain Creator-only DontSave helper nodes.
    const remaining = siblings.filter((sibling) => sibling !== node);
    const rawRemaining = parent.children.filter((sibling) => sibling !== node);
    const next = remaining[index];
    const rawIndex = next
      ? rawRemaining.indexOf(next)
      : rawRemaining.indexOf(remaining[remaining.length - 1]) + 1;
    const previousRawIndex = node.getSiblingIndex();
    node.setSiblingIndex(rawIndex);
    const reorderedSiblings = sceneContentChildren(parent);
    if (node.parent !== parent || reorderedSiblings[index] !== node) {
      if (node.parent === parent) node.setSiblingIndex(previousRawIndex);
      throw new Error('Node.setSiblingIndex did not produce the requested sibling order.');
    }
    return {
      reordered: true,
      uuid: node.uuid,
      path: getNodePath(node),
      parentUuid: parent.uuid,
      parentPath: getNodePath(parent),
      previousIndex,
      index,
      siblingUuids: reorderedSiblings.map((sibling) => sibling.uuid),
    };
  },

  async duplicateNode(options = {}) {
    const scene = getScene();
    const source = findNode(options);
    if (!source) {
      throw new Error('Target node was not found. Provide its uuid, path, or unique name.');
    }
    if (source === scene) {
      throw new Error('The scene root cannot be duplicated.');
    }
    assertCloneableSceneSubtree(source, scene);

    const parent = source.parent;
    const siblings = sceneContentChildren(parent);
    const sourceIndex = siblings.indexOf(source);
    if (sourceIndex < 0) {
      throw new Error('The source is not a serializable child of its parent.');
    }
    if (options.newName != null && typeof options.newName !== 'string') {
      throw new Error('newName must be a string.');
    }
    const requestedName = typeof options.newName === 'string' ? options.newName.trim() : '';
    if (options.newName != null && !requestedName) {
      throw new Error('newName cannot be empty.');
    }
    const usedNames = new Set(siblings.map((sibling) => sibling.name));
    let cloneName = requestedName;
    if (cloneName) {
      if (usedNames.has(cloneName)) {
        throw new Error(`A sibling named '${cloneName}' already exists.`);
      }
    } else {
      const base = `${source.name || 'Node'} Copy`;
      cloneName = base;
      for (let suffix = 2; usedNames.has(cloneName); suffix += 1) {
        cloneName = `${base} ${suffix}`;
      }
    }
    if (cloneName.includes('/') || cloneName.includes('\\')) {
      throw new Error('The duplicate name cannot contain a path separator.');
    }

    let clone = null;
    try {
      clone = instantiate(source);
      if (!(clone instanceof Node) || clone === source) {
        throw new Error('Cocos instantiate did not create a distinct Node.');
      }
      clone.name = cloneName;
      clone.parent = parent;
      clone.setSiblingIndex(source.getSiblingIndex() + 1);

      const pending = [[source, clone]];
      let clonedNodes = 0;
      while (pending.length) {
        const [original, copy] = pending.pop();
        if (original.uuid === copy.uuid || original.children.length !== copy.children.length
          || original.components.length !== copy.components.length) {
          throw new Error('The duplicate hierarchy or component count does not match the source.');
        }
        clonedNodes += 1;
        for (let index = 0; index < original.children.length; index += 1) {
          pending.push([original.children[index], copy.children[index]]);
        }
      }
      if (clone.parent !== parent || sceneContentChildren(parent)[sourceIndex + 1] !== clone) {
        throw new Error('The duplicate was not inserted immediately after its source.');
      }
      return {
        duplicated: true,
        sourceUuid: source.uuid,
        sourcePath: getNodePath(source),
        uuid: clone.uuid,
        path: getNodePath(clone),
        name: clone.name,
        parentUuid: parent.uuid,
        siblingIndex: sourceIndex + 1,
        clonedNodes,
      };
    } catch (error) {
      if (clone && clone !== source && clone instanceof Node) {
        if (clone.parent) clone.removeFromParent();
        clone.destroy();
      }
      throw error;
    }
  },

  async setNodeTransform(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }

    if (options.position) {
      node.setPosition(options.position.x || 0, options.position.y || 0, options.position.z || 0);
    }

    if (options.scale) {
      node.setScale(options.scale.x || 1, options.scale.y || 1, options.scale.z || 1);
    }

    if (options.eulerAngles) {
      node.setRotationFromEuler(
        options.eulerAngles.x || 0,
        options.eulerAngles.y || 0,
        options.eulerAngles.z || 0
      );
    }

    if (typeof options.active === 'boolean') {
      node.active = options.active;
    }

    return {
      updated: true,
      name: node.name,
      path: getNodePath(node),
      active: Boolean(node.active),
      position: vectorToObject(node.position),
      rotation: quatToObject(node.rotation),
      scale: vectorToObject(node.scale),
    };
  },

  async batchModifyNodes(options = {}) {
    const changes = options.changes;
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 50) {
      throw new Error('changes must contain between 1 and 50 node modifications.');
    }
    const onError = options.onError === undefined ? 'stop' : options.onError;
    if (!['stop', 'continue'].includes(onError)) {
      throw new Error('onError must be stop or continue.');
    }

    const scene = getScene();
    const results = [];
    const allowed = new Set(['uuid', 'path', 'name', 'position', 'scale', 'eulerAngles', 'active']);
    const startedAt = Date.now();
    for (let index = 0; index < changes.length; index += 1) {
      const step = changes[index];
      const stepStartedAt = Date.now();
      let node;
      let nodePath;
      let before;
      try {
        if (!step || typeof step !== 'object' || Array.isArray(step) ||
            Object.keys(step).some((key) => !allowed.has(key))) {
          throw new Error('Each change must be an object containing only node selectors and supported fields.');
        }
        if (!['uuid', 'path', 'name'].some((key) => typeof step[key] === 'string' && step[key].trim()) ||
            ['uuid', 'path', 'name'].some((key) => step[key] !== undefined &&
              (typeof step[key] !== 'string' || !step[key].trim()))) {
          throw new Error('Each change requires a non-empty uuid, path, or name selector.');
        }
        const fields = ['position', 'scale', 'eulerAngles', 'active']
          .filter((key) => Object.prototype.hasOwnProperty.call(step, key));
        if (!fields.length) {
          throw new Error('Each change requires at least one transform or active field.');
        }
        const position = fields.includes('position') ? readBatchVector(step.position, 'position') : null;
        const scale = fields.includes('scale') ? readBatchVector(step.scale, 'scale') : null;
        const eulerAngles = fields.includes('eulerAngles') ? readBatchVector(step.eulerAngles, 'eulerAngles') : null;
        if (fields.includes('active') && typeof step.active !== 'boolean') {
          throw new Error('active must be a boolean.');
        }
        node = findNode(step);
        if (!node || node === scene) {
          throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
        }
        if (hasLinkedPrefabAncestor(node, scene)) {
          throw new Error('Batch modification of a linked prefab hierarchy is not supported.');
        }
        nodePath = getNodePath(node);
        before = batchNodeSnapshot(node);
        try {
          if (position) node.setPosition(position.x, position.y, position.z);
          if (scale) node.setScale(scale.x, scale.y, scale.z);
          if (eulerAngles) node.setRotationFromEuler(eulerAngles.x, eulerAngles.y, eulerAngles.z);
          if (fields.includes('active')) node.active = step.active;
          const after = batchNodeSnapshot(node);
          if ((position && !valuesNear(after.position, position, ['x', 'y', 'z'])) ||
              (scale && !valuesNear(after.scale, scale, ['x', 'y', 'z'])) ||
              (eulerAngles && !rotationsNear(after.rotation,
                quatToObject(Quat.fromEuler(new Quat(), eulerAngles.x, eulerAngles.y, eulerAngles.z)))) ||
              (fields.includes('active') && after.active !== step.active)) {
            throw new Error('Creator did not apply every requested node field.');
          }
          results.push({
            index,
            status: 'applied',
            nodeUuid: node.uuid,
            nodePath,
            fields,
            before,
            after,
            durationMs: Date.now() - stepStartedAt,
          });
        } catch (applyError) {
          const restoreErrors = [];
          for (const [field, restore] of [
            ['position', () => {
              if (!valuesNear(vectorToObject(node.position), before.position, ['x', 'y', 'z'])) {
                node.setPosition(before.position.x, before.position.y, before.position.z);
              }
            }],
            ['rotation', () => {
              if (!rotationsNear(quatToObject(node.rotation), before.rotation)) {
                node.setRotation(before.rotation.x, before.rotation.y, before.rotation.z, before.rotation.w);
              }
            }],
            ['scale', () => {
              if (!valuesNear(vectorToObject(node.scale), before.scale, ['x', 'y', 'z'])) {
                node.setScale(before.scale.x, before.scale.y, before.scale.z);
              }
            }],
            ['active', () => { if (Boolean(node.active) !== before.active) node.active = before.active; }],
          ]) {
            try { restore(); } catch (error) { restoreErrors.push(`${field}: ${error.message}`); }
          }
          const restored = batchNodeSnapshot(node);
          if (!valuesNear(restored.position, before.position, ['x', 'y', 'z']) ||
              !rotationsNear(restored.rotation, before.rotation) ||
              !valuesNear(restored.scale, before.scale, ['x', 'y', 'z']) ||
              restored.active !== before.active) {
            restoreErrors.push('state differs from the snapshot');
          }
          const error = new Error(restoreErrors.length
            ? `${applyError.message} Step rollback failed: ${restoreErrors.join('; ')}`
            : applyError.message);
          error.rollbackStatus = restoreErrors.length ? 'failed' : 'restored';
          throw error;
        }
      } catch (error) {
        results.push({
          index,
          status: 'failed',
          nodeUuid: node && node !== scene ? node.uuid : undefined,
          nodePath,
          error: error.message,
          code: error.code || undefined,
          rollbackStatus: error.rollbackStatus || 'not-needed',
          durationMs: Date.now() - stepStartedAt,
        });
        if (onError === 'stop') break;
      }
    }
    const failedCount = results.filter((result) => result.status === 'failed').length;
    return {
      completed: results.length === changes.length,
      allSucceeded: failedCount === 0 && results.length === changes.length,
      onError,
      total: changes.length,
      attempted: results.length,
      succeeded: results.length - failedCount,
      failed: failedCount,
      stoppedAtIndex: onError === 'stop' && failedCount ? results.findIndex((result) => result.status === 'failed') : null,
      durationMs: Date.now() - startedAt,
      results,
    };
  },

  async resetNodeTransform(options = {}) {
    const allowedFields = ['position', 'rotation', 'scale'];
    const fields = options.fields === undefined ? allowedFields : options.fields;
    if (!Array.isArray(fields) || fields.length === 0 ||
        fields.some((field) => !allowedFields.includes(field)) ||
        new Set(fields).size !== fields.length) {
      throw new Error('fields must be a non-empty list without duplicates, using position, rotation, or scale.');
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Resetting a linked prefab hierarchy requires the separate prefab revert workflow.');
    }
    const snapshot = () => ({
      position: vectorToObject(node.position),
      rotation: quatToObject(node.rotation),
      scale: vectorToObject(node.scale),
    });
    const before = snapshot();
    const restore = () => {
      if (fields.includes('position')) node.setPosition(before.position.x, before.position.y, before.position.z);
      if (fields.includes('rotation')) node.setRotation(before.rotation.x, before.rotation.y, before.rotation.z, before.rotation.w);
      if (fields.includes('scale')) node.setScale(before.scale.x, before.scale.y, before.scale.z);
    };
    try {
      if (fields.includes('position')) node.setPosition(0, 0, 0);
      if (fields.includes('rotation')) node.setRotation(0, 0, 0, 1);
      if (fields.includes('scale')) node.setScale(1, 1, 1);
      const after = snapshot();
      const defaults = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      };
      if (fields.some((field) => Object.keys(defaults[field]).some((key) =>
        Math.abs(after[field][key] - defaults[field][key]) > 1e-6))) {
        throw new Error('Creator did not apply all requested local transform defaults.');
      }
      return {
        reset: true,
        nodeUuid: node.uuid,
        nodePath: getNodePath(node),
        fields,
        changedFields: fields.filter((field) => Object.keys(before[field]).some((key) =>
          Math.abs(before[field][key] - after[field][key]) > 1e-6)),
        before,
        after,
      };
    } catch (error) {
      try {
        restore();
      } catch (restoreError) {
        throw new Error(`${error.message} Failed to restore the original transform: ${restoreError.message}`);
      }
      throw error;
    }
  },

  async listComponents(options = {}) {
    const maxComponents = readQueryLimit(options.maxComponents, 32, 128, 'maxComponents');
    const maxProperties = readQueryLimit(options.maxProperties, 12, 32, 'maxProperties');
    const includeRuntimeFields = readIncludeRuntimeFields(options);
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    const components = Array.isArray(node.components) ? node.components : [];
    return {
      node: {
        name: node.name,
        path: getNodePath(node),
        uuid: node.uuid,
      },
      componentCount: components.length,
      returnedComponents: Math.min(components.length, maxComponents),
      truncated: components.length > maxComponents,
      valueSource: 'live-scene',
      serializationNote: 'A public property marked excluded may persist through a different backing field; save and reopen to verify disk state.',
      components: components.slice(0, maxComponents).map((component, index) => {
        if (!component) return { index, name: 'UnknownComponent', keys: [], properties: [] };
        return describeComponent(component, index, maxProperties, includeRuntimeFields);
      }),
    };
  },

  async listAvailableComponentTypes(options = {}) {
    const candidateNames = readComponentTypeCandidates(options.candidateNames);
    const scriptAssets = options.scriptAssets == null ? [] : options.scriptAssets;
    if (!Array.isArray(scriptAssets) || scriptAssets.length > 256) {
      throw new Error('scriptAssets must contain at most 256 project script records.');
    }
    const builtinTypes = [];
    const seenBuiltinNames = new Set();
    for (const exportName of Object.keys(cc).sort()) {
      let type;
      try { type = cc[exportName]; } catch (_) { continue; }
      if (!isAttachableComponentClass(type)) continue;
      const entry = componentTypeEntry(type, 'builtin');
      const name = entry.registeredName || `cc.${exportName}`;
      if (!name.startsWith('cc.') || seenBuiltinNames.has(name)) continue;
      seenBuiltinNames.add(name);
      entry.name = name;
      entry.status = js && typeof js.getClassByName === 'function' && js.getClassByName(name) === type
        ? 'attachable' : 'unregistered';
      builtinTypes.push(entry);
    }
    const uuidUtils = typeof Editor !== 'undefined' && Editor.Utils && Editor.Utils.UUID;
    const seenScriptUuids = new Set();
    const projectScripts = scriptAssets.map((asset) => {
      const uuid = asset && asset.uuid;
      if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new Error('Each script asset must have a full UUID.');
      }
      if (seenScriptUuids.has(uuid)) throw new Error(`Duplicate project script UUID: ${uuid}`);
      seenScriptUuids.add(uuid);
      const extra = { scriptUuid: uuid, assetUrl: typeof asset.url === 'string' ? asset.url.slice(0, 512) : '' };
      if (asset.invalid === true) return { name: '', registeredName: '', source: 'project-script', status: 'invalid-asset', ...extra };
      if (asset.imported === false) return { name: '', registeredName: '', source: 'project-script', status: 'not-imported', ...extra };
      const classId = uuidUtils && typeof uuidUtils.compressUUID === 'function' ? uuidUtils.compressUUID(uuid) : null;
      const type = classId && js && typeof js.getClassById === 'function' ? js.getClassById(classId) : null;
      return type
        ? componentTypeEntry(type, 'project-script', extra)
        : { name: '', registeredName: '', source: 'project-script', status: 'no-component-registration', ...extra };
    });
    const candidates = candidateNames.map((name) => {
      const type = resolveComponentClass(name);
      return type
        ? { query: name, ...componentTypeEntry(type, 'candidate') }
        : { query: name, name: '', registeredName: '', source: 'candidate', status: 'not-found' };
    });
    const maxBuiltinTypes = 256;
    return {
      valueSource: 'live-class-registry-and-asset-db',
      builtinTypes: builtinTypes.slice(0, maxBuiltinTypes),
      builtinTypeCount: builtinTypes.length,
      builtinTypesTruncated: builtinTypes.length > maxBuiltinTypes,
      projectScripts,
      projectScriptCount: Number.isInteger(options.projectScriptCount) ? options.projectScriptCount : projectScripts.length,
      projectScriptsTruncated: options.projectScriptsTruncated === true,
      candidates,
      attachabilityNote: 'Attachable means a registered Component subclass was found; a specific node may still reject it because of dependencies, duplicates, or prefab restrictions.',
      coverageNote: 'A script without component registration may be a valid non-component module or have a compilation problem. Project scripts are bounded asset-db results; runtime-only classes absent from assets appear only when explicitly probed in candidateNames.',
    };
  },

  async addComponent(options = {}) {
    const componentName = typeof options.componentName === 'string' ? options.componentName.trim() : '';
    if (!componentName) {
      throw new Error('componentName must be a non-empty registered Cocos Component class name.');
    }
    const componentClass = resolveComponentClass(componentName);
    if (!componentClass) {
      throw new Error(`Component class not found: ${componentName}`);
    }
    if (!Component || !componentClass.prototype || !(componentClass.prototype instanceof Component)) {
      throw new Error(`${componentName} is not a Cocos Component class.`);
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Adding a component directly to a linked prefab hierarchy is not supported by add_component.');
    }
    const before = new Set(node.components);
    const removeNewComponents = async () => {
      let removalError = null;
      for (const item of node.components.slice().reverse()) {
        if (item && !before.has(item)) {
          try {
            node.removeComponent(item);
          } catch (error) {
            removalError = error;
          }
        }
      }
      for (let attempt = 0; node.components.some((item) => item && !before.has(item)) && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        clean: !node.components.some((item) => item && !before.has(item)),
        removalError,
      };
    };
    let component;
    try {
      component = node.addComponent(componentClass);
      if (getScene() !== scene || !component || component.node !== node
        || !node.components.includes(component) || !(component instanceof componentClass)
        || before.has(component)) {
        throw new Error('Creator did not attach a new component of the requested class to the target node.');
      }
    } catch (error) {
      const cleanup = await removeNewComponents();
      const cleanupDetail = cleanup.removalError ? ` Cleanup error: ${cleanup.removalError.message}.` : '';
      throw new Error(`Could not add ${componentName}: ${error.message}${cleanup.clean ? '' : ' Newly added components could not be fully removed; inspect the node before saving.'}${cleanupDetail}`);
    }
    const addedComponents = node.components
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item && !before.has(item))
      .map(({ item, index }) => ({
        name: (js && typeof js.getClassName === 'function' && js.getClassName(item.constructor))
          || item.constructor.name || 'UnknownComponent',
        index,
        requested: item === component,
      }));
    return {
      added: true,
      node: getNodePath(node),
      nodeUuid: node.uuid,
      component: component.constructor ? component.constructor.name : componentName,
      index: node.components.indexOf(component),
      addedComponents,
    };
  },

  async attachScriptComponent(options = {}) {
    const scriptUuid = String(options.scriptUuid || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scriptUuid)) {
      throw new Error('scriptUuid must be an imported script asset UUID.');
    }
    const waitForCompileMs = options.waitForCompileMs == null ? 5000 : options.waitForCompileMs;
    if (!Number.isInteger(waitForCompileMs) || waitForCompileMs < 0 || waitForCompileMs > 10000) {
      throw new Error('waitForCompileMs must be an integer between 0 and 10000.');
    }
    const uuidUtils = typeof Editor !== 'undefined' && Editor.Utils && Editor.Utils.UUID;
    if (!uuidUtils || typeof uuidUtils.compressUUID !== 'function' || !js || typeof js.getClassById !== 'function') {
      throw new Error('Creator script class resolution is unavailable in the scene process.');
    }
    const classId = uuidUtils.compressUUID(scriptUuid);
    const scene = getScene();
    const deadline = Date.now() + waitForCompileMs;
    let componentClass = js.getClassById(classId);
    while (!componentClass && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
      componentClass = js.getClassById(classId);
    }
    if (!componentClass) {
      throw new Error(`Script ${scriptUuid} is imported but its component class is not registered. Check compilation diagnostics and retry.`);
    }
    if (!Component || !componentClass.prototype || !(componentClass.prototype instanceof Component)) {
      throw new Error(`Script ${scriptUuid} does not register a Cocos Component class.`);
    }
    if (getScene() !== scene) {
      throw new Error('The active scene changed while waiting for the script to compile.');
    }
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Attaching a script directly to a linked prefab hierarchy is not supported by attach_script_component.');
    }
    const className = (typeof js.getClassName === 'function' && js.getClassName(componentClass))
      || componentClass.name || '';
    const existing = node.components.find((component) => component && component.constructor === componentClass);
    if (existing) {
      return {
        attached: false,
        alreadyPresent: true,
        nodeUuid: node.uuid,
        nodePath: getNodePath(node),
        scriptUuid,
        classId,
        className,
        componentIndex: node.components.indexOf(existing),
      };
    }
    const component = node.addComponent(componentClass);
    if (!component || component.node !== node || !node.components.includes(component)) {
      if (component && node.components.includes(component)) node.removeComponent(component);
      throw new Error('The script component was not attached to the requested node.');
    }
    return {
      attached: true,
      alreadyPresent: false,
      nodeUuid: node.uuid,
      nodePath: getNodePath(node),
      scriptUuid,
      classId,
      className,
      componentIndex: node.components.indexOf(component),
    };
  },

  async removeComponent(options = {}) {
    const hasIndex = Object.prototype.hasOwnProperty.call(options, 'index');
    const componentName = typeof options.componentName === 'string' ? options.componentName.trim() : '';
    if (hasIndex && (!Number.isInteger(options.index) || options.index < 0)) {
      throw new Error('index must be a non-negative integer.');
    }
    if (options.componentName != null && !componentName) {
      throw new Error('componentName must be a non-empty string.');
    }
    if (!hasIndex && !componentName) {
      throw new Error('Provide componentName or index to identify the component to remove.');
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Removing a component directly from a linked prefab hierarchy is not supported by remove_component.');
    }
    const componentClass = componentName ? resolveComponentClass(componentName) : null;
    const matchesName = (item) => item && item.constructor && (
      item.constructor.name === componentName
      || (js && typeof js.getClassName === 'function' && js.getClassName(item.constructor) === componentName)
      || (componentClass && item.constructor === componentClass)
    );
    const matches = componentName ? node.components.filter(matchesName) : [];
    if (!hasIndex && matches.length > 1) {
      throw new Error(`Multiple ${componentName} components are attached; specify index to remove exactly one.`);
    }
    const component = hasIndex ? node.components[options.index] : matches[0];
    if (!component) {
      throw new Error('Target component was not found.');
    }
    if (componentName && !matchesName(component)) {
      throw new Error(`Component at index ${options.index} does not match ${componentName}.`);
    }
    const componentIndex = node.components.indexOf(component);
    const className = (js && typeof js.getClassName === 'function' && js.getClassName(component.constructor))
      || component.constructor.name || 'UnknownComponent';
    // Creator stores @requireComponent here; the post-removal check also catches an engine no-op if this changes.
    const requiredBy = node.components.filter((other) => {
      if (!other || other === component || !other.constructor) return false;
      const declared = other.constructor._requireComponent;
      const requiredClasses = Array.isArray(declared) ? declared : [declared];
      return requiredClasses.some((requiredClass) => typeof requiredClass === 'function'
        && component instanceof requiredClass
        && !node.components.some((remaining) => remaining && remaining !== component && remaining instanceof requiredClass));
    }).map((other) => (js && typeof js.getClassName === 'function' && js.getClassName(other.constructor))
      || other.constructor.name || 'UnknownComponent');
    if (requiredBy.length) {
      throw new Error(`${className} is required by ${requiredBy.join(', ')} on this node; remove those components first.`);
    }
    const classId = js && typeof js.getClassId === 'function' ? js.getClassId(component.constructor) : '';
    const references = findComponentReferences(scene, node, component, component.constructor, classId);
    if (references.length) {
      throw new Error(`${className} is still referenced (${references.length}): ${references.slice(0, 10).join(', ')}. Clear these references before removing it.`);
    }
    node.removeComponent(component);
    for (let attempt = 0; node.components.includes(component) && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (getScene() !== scene) {
      throw new Error('The active scene changed while waiting for the component to be removed.');
    }
    if (node.components.includes(component)) {
      throw new Error('Creator did not finish removing the component within 1 second. It may still be required; inspect the node before saving or retrying.');
    }
    return {
      removed: true,
      node: getNodePath(node),
      nodeUuid: node.uuid,
      component: className,
      index: componentIndex,
      checkedReferences: true,
      checkedDependencies: true,
    };
  },

  async detachScriptComponent(options = {}) {
    const scriptUuid = String(options.scriptUuid || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scriptUuid)) {
      throw new Error('scriptUuid must be an imported script asset UUID.');
    }
    const uuidUtils = typeof Editor !== 'undefined' && Editor.Utils && Editor.Utils.UUID;
    if (!uuidUtils || typeof uuidUtils.compressUUID !== 'function' || !js || typeof js.getClassById !== 'function') {
      throw new Error('Creator script class resolution is unavailable in the scene process.');
    }
    const classId = uuidUtils.compressUUID(scriptUuid);
    const componentClass = js.getClassById(classId);
    if (!componentClass || !Component || !componentClass.prototype || !(componentClass.prototype instanceof Component)) {
      throw new Error(`Script ${scriptUuid} does not have a registered Cocos Component class. Check compilation diagnostics and retry.`);
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Removing a script directly from a linked prefab hierarchy is not supported by detach_script_component.');
    }
    const className = (typeof js.getClassName === 'function' && js.getClassName(componentClass))
      || componentClass.name || '';
    const component = node.components.find((item) => item && item.constructor === componentClass);
    const result = {
      nodeUuid: node.uuid,
      nodePath: getNodePath(node),
      scriptUuid,
      classId,
      className,
    };
    if (!component) return { ...result, removed: false, notPresent: true };
    const references = findComponentReferences(scene, node, component, componentClass, classId);
    if (references.length) {
      throw new Error(`Script component is still referenced (${references.length}): ${references.slice(0, 10).join(', ')}. Clear these references before removing it.`);
    }
    const componentIndex = node.components.indexOf(component);
    node.removeComponent(component);
    for (let attempt = 0; node.components.includes(component) && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (getScene() !== scene) {
      throw new Error('The active scene changed while waiting for the script component to be removed.');
    }
    if (node.components.includes(component)) {
      throw new Error('Creator did not finish removing the script component within 1 second. Check the scene before saving or retrying.');
    }
    return { ...result, removed: true, notPresent: false, componentIndex, checkedReferences: true };
  },

  async inspectComponent(options = {}) {
    const maxProperties = readQueryLimit(options.maxProperties, 32, 80, 'maxProperties');
    const includeRuntimeFields = readIncludeRuntimeFields(options);
    const hasIndex = Object.prototype.hasOwnProperty.call(options, 'index');
    const componentName = typeof options.componentName === 'string' ? options.componentName.trim() : '';
    if (hasIndex && (!Number.isInteger(options.index) || options.index < 0)) {
      throw new Error('index must be a non-negative integer.');
    }
    if (options.componentName != null && !componentName) {
      throw new Error('componentName must be a non-empty string.');
    }
    if (!hasIndex && !componentName) {
      throw new Error('Provide componentName or index to inspect exactly one component.');
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    const componentClass = componentName ? resolveComponentClass(componentName) : null;
    const matchesName = (item) => item && item.constructor && (
      item.constructor.name === componentName
      || (js && typeof js.getClassName === 'function' && js.getClassName(item.constructor) === componentName)
      || (componentClass && item.constructor === componentClass)
    );
    const matches = componentName ? node.components.filter(matchesName) : [];
    if (!hasIndex && matches.length > 1) {
      throw new Error(`Multiple ${componentName} components are attached at indices ${matches.map((item) => node.components.indexOf(item)).join(', ')}; specify index.`);
    }
    const component = hasIndex ? node.components[options.index] : matches[0];
    if (!component) {
      throw new Error('Target component was not found.');
    }
    if (componentName && !matchesName(component)) {
      throw new Error(`Component at index ${options.index} does not match ${componentName}.`);
    }
    return {
      node: {
        name: node.name,
        path: getNodePath(node),
        uuid: node.uuid,
      },
      valueSource: 'live-scene',
      serializationNote: 'A public property marked excluded may persist through a different backing field; save and reopen to verify disk state.',
      component: describeComponent(component, node.components.indexOf(component), maxProperties, includeRuntimeFields),
    };
  },

  async setComponentProperty(options = {}) {
    const propertyName = typeof options.propertyPath === 'string' ? options.propertyPath.trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(propertyName) ||
        ['constructor', 'prototype', '__proto__'].includes(propertyName)) {
      throw new Error('propertyPath must name one public top-level component field; dot paths are not supported.');
    }
    const hasIndex = Object.prototype.hasOwnProperty.call(options, 'index');
    const componentName = typeof options.componentName === 'string' ? options.componentName.trim() : '';
    if (hasIndex && (!Number.isInteger(options.index) || options.index < 0)) {
      throw new Error('index must be a non-negative integer.');
    }
    if (!hasIndex && !componentName) {
      throw new Error('componentName or index is required to select the component.');
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Setting a component property on a linked prefab hierarchy requires a separate prefab override workflow.');
    }
    const componentClass = componentName ? resolveComponentClass(componentName) : null;
    const matchesName = (item) => item && item.constructor && (
      item.constructor.name === componentName
      || (js && typeof js.getClassName === 'function' && js.getClassName(item.constructor) === componentName)
      || (componentClass && item.constructor === componentClass)
    );
    const matches = componentName ? node.components.filter(matchesName) : [];
    if (!hasIndex && matches.length > 1) {
      throw new Error(`Multiple ${componentName} components are attached; specify index.`);
    }
    const component = hasIndex ? node.components[options.index] : matches[0];
    if (!component) throw new Error('Target component was not found.');
    if (componentName && !matchesName(component)) {
      throw new Error(`Component at index ${options.index} does not match ${componentName}.`);
    }
    const edit = editableComponentProperty(component, propertyName);
    const next = await convertEditableComponentValue(edit, options.value);
    const before = componentRuntimeValue(edit.current);
    const expected = JSON.stringify(componentRuntimeValue(next));
    const result = {
      node: getNodePath(node),
      nodeUuid: node.uuid,
      component: component.constructor ? component.constructor.name : 'UnknownComponent',
      componentIndex: node.components.indexOf(component),
      propertyPath: propertyName,
      valueType: edit.kind,
      before,
    };
    if (JSON.stringify(before) === expected) {
      return { ...result, updated: false, alreadySet: true, value: before };
    }
    try {
      component[propertyName] = next;
      const value = componentRuntimeValue(component[propertyName]);
      if (JSON.stringify(value) !== expected) {
        throw new Error('Creator did not retain the requested component property value.');
      }
      return { ...result, updated: true, alreadySet: false, value };
    } catch (error) {
      try {
        component[propertyName] = edit.current;
        if (JSON.stringify(componentRuntimeValue(component[propertyName])) !== JSON.stringify(before)) {
          throw new Error('restored value differs from the original');
        }
      } catch (restoreError) {
        throw new Error(`${error.message} Failed to restore the original property: ${restoreError.message}`);
      }
      throw error;
    }
  },

  async resetComponentProperty(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }

    const component = findComponent(node, options);
    if (!component) {
      throw new Error('Target component was not found.');
    }

    resetValueByPath(component, options.propertyPath);
    return {
      reset: true,
      node: getNodePath(node),
      component: component.constructor ? component.constructor.name : 'UnknownComponent',
      propertyPath: options.propertyPath,
      value: plain(getValueByPath(component, options.propertyPath)),
    };
  },

  async resetComponentPropertyToDefault(options = {}) {
    const propertyName = String(options.propertyName || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(propertyName) ||
        ['constructor', 'prototype', '__proto__'].includes(propertyName)) {
      throw new Error('propertyName must be a public top-level component field name.');
    }
    if (!Number.isInteger(options.index) && !String(options.componentName || '').trim()) {
      throw new Error('componentName or index is required to select the component.');
    }
    const scene = getScene();
    const node = findNode(options);
    if (!node || node === scene) {
      throw new Error('Target scene node was not found. Provide its uuid, path, or unique name.');
    }
    if (hasLinkedPrefabAncestor(node, scene)) {
      throw new Error('Resetting a component on a linked prefab hierarchy requires the separate prefab revert workflow.');
    }
    const component = findComponent(node, options);
    if (!component) throw new Error('Target component was not found.');
    const componentName = component.constructor && component.constructor.name || 'UnknownComponent';
    if (Number.isInteger(options.index) && options.componentName &&
        findComponent(node, { componentName: options.componentName }) !== component) {
      throw new Error(`Component at index does not match componentName: ${options.componentName}.`);
    }
    const classMetadata = cc.CCClass;
    if (!classMetadata || typeof classMetadata.attr !== 'function' || typeof classMetadata.getDefault !== 'function') {
      throw new Error('Cocos CCClass default metadata is unavailable in the scene process.');
    }
    const attrs = classMetadata.attr(component.constructor, propertyName);
    if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, 'default') ||
        attrs.serializable === false || attrs.readonly === true || attrs.visible === false) {
      throw new Error(`No editable serialized class default is declared for ${componentName}.${propertyName}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(component, propertyName);
    if (!descriptor || descriptor.writable !== true || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error(`${componentName}.${propertyName} is not a writable own data field.`);
    }
    const defaultValue = copyComponentDefault(classMetadata.getDefault(attrs.default));
    const expected = JSON.stringify(plain(defaultValue));
    const previous = component[propertyName];
    const before = plain(previous);
    const result = {
      nodeUuid: node.uuid,
      nodePath: getNodePath(node),
      component: componentName,
      componentIndex: node.components.indexOf(component),
      propertyName,
      before,
      defaultValue: plain(defaultValue),
    };
    if (JSON.stringify(before) === expected) {
      return { ...result, reset: false, alreadyDefault: true, value: before };
    }
    try {
      component[propertyName] = defaultValue;
      const value = plain(component[propertyName]);
      if (JSON.stringify(value) !== expected) {
        throw new Error('Creator did not apply the declared class default.');
      }
      return { ...result, reset: true, alreadyDefault: false, value };
    } catch (error) {
      try {
        component[propertyName] = previous;
      } catch (restoreError) {
        throw new Error(`${error.message} Failed to restore the original property: ${restoreError.message}`);
      }
      throw error;
    }
  },

  async instantiatePrefab(options = {}) {
    const prefabUuid = String(options.prefabUuid || '').trim();
    if (!prefabUuid) {
      throw new Error('prefabUuid is required.');
    }

    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    const asset = await loadAssetByUuid(prefabUuid);
    if (!(asset instanceof Prefab)) {
      throw new Error(`Asset '${prefabUuid}' is not a Prefab.`);
    }

    const node = instantiate(asset);
    node.parent = parent;

    if (options.name) {
      node.name = options.name;
    }
    if (options.position) {
      node.setPosition(options.position.x || 0, options.position.y || 0, options.position.z || 0);
    }

    return {
      instantiated: true,
      prefabUuid,
      node: {
        name: node.name,
        path: getNodePath(node),
        uuid: node.uuid,
      },
    };
  },

  async serializePrefabFromNode(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    assertNoLinkedPrefabInstances(node);

    const serialize = getCceSerializer();
    const prefab = new Prefab();
    if (typeof options.prefabName === 'string') {
      prefab.name = options.prefabName;
    }

    const root = instantiate(node);
    try {
      root.parent = null;
      if (options.rootName) {
        root.name = String(options.rootName);
      }

      normalizePrefabNodeLayers(root);
      prefab.data = root;
      const metadata = attachPrefabMetadata(root, prefab, {
        prefabUtils: Prefab._utils,
      });
      const serialized = serialize(prefab);
      const content = typeof serialized === 'string'
        ? serialized
        : JSON.stringify(serialized, null, 2);

      JSON.parse(content);
      return {
        serialized: true,
        source: {
          name: node.name,
          path: getNodePath(node),
          uuid: node.uuid,
        },
        root: {
          name: root.name,
        },
        metadata,
        content,
      };
    } finally {
      if (root && typeof root.destroy === 'function') {
        root.destroy();
      }
    }
  },

  async serializeScene(options = {}) {
    const mode = String(options.mode || 'empty').trim().toLowerCase();
    if (mode !== 'empty' && mode !== 'current') {
      throw new Error("mode must be either 'empty' or 'current'.");
    }

    const sceneName = String(options.sceneName || 'NewScene').trim() || 'NewScene';
    const source = mode === 'current' ? getScene() : null;
    const scene = source || new Scene(sceneName);
    const originalName = source ? source.name : '';
    const asset = new SceneAsset();

    try {
      scene.name = sceneName;
      asset.name = sceneName;
      asset.scene = scene;

      const serialize = getCceSerializer();
      const serialized = serialize(asset);
      const content = typeof serialized === 'string'
        ? serialized
        : JSON.stringify(serialized, null, 2);

      JSON.parse(content);
      return {
        serialized: true,
        mode,
        source: source
          ? { name: originalName, uuid: source.uuid, childCount: sceneContentChildren(source).length }
          : null,
        scene: { name: scene.name, childCount: sceneContentChildren(scene).length },
        content,
      };
    } finally {
      asset.scene = null;
      if (source) {
        source.name = originalName;
      } else if (scene && typeof scene.destroy === 'function') {
        scene.destroy();
      }
    }
  },

  async runSceneAsset(options = {}) {
    const sceneUuid = String(options.sceneUuid || '').trim();
    if (!sceneUuid) {
      throw new Error('sceneUuid is required.');
    }

    const asset = await loadAssetByUuid(sceneUuid);
    if (!(asset instanceof SceneAsset)) {
      throw new Error(`Asset '${sceneUuid}' is not a SceneAsset.`);
    }

    director.runSceneImmediate(asset);
    const scene = getScene();
    return {
      loaded: true,
      sceneUuid,
      sceneName: scene.name,
      childCount: sceneContentChildren(scene).length,
    };
  },

  async createCanvas(options = {}) {
    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    const node = new Node(options.name || 'Canvas');
    node.parent = parent;
    configureNodeBasics(node, options);
    getOrAddComponent(node, Canvas);
    configureUITransform(node, {
      width: Number.isFinite(options.width) ? options.width : 1280,
      height: Number.isFinite(options.height) ? options.height : 720,
    });

    return {
      created: true,
      name: node.name,
      path: getNodePath(node),
      uuid: node.uuid,
      components: getComponentNames(node),
    };
  },

  async createLabel(options = {}) {
    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    const node = new Node(options.name || 'Label');
    node.parent = parent;
    configureNodeBasics(node, options);
    configureUITransform(node, options);
    const label = getOrAddComponent(node, Label);
    label.string = options.text || 'Label';
    label.fontSize = Number.isFinite(options.fontSize) ? options.fontSize : 32;
    label.lineHeight = Number.isFinite(options.lineHeight) ? options.lineHeight : label.fontSize + 8;
    label.color = parseColor(options.color, Color.WHITE);

    return {
      created: true,
      path: getNodePath(node),
      uuid: node.uuid,
      text: label.string,
    };
  },

  async createButton(options = {}) {
    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    const node = new Node(options.name || 'Button');
    node.parent = parent;
    configureNodeBasics(node, options);
    configureUITransform(node, {
      ...options,
      width: Number.isFinite(options.width) ? options.width : 180,
      height: Number.isFinite(options.height) ? options.height : 64,
    });
    const sprite = getOrAddComponent(node, Sprite);
    sprite.color = parseColor(options.backgroundColor, new Color(64, 96, 255, 255));
    const button = getOrAddComponent(node, Button);
    button.target = node;

    const labelNode = new Node(options.labelName || 'Label');
    labelNode.parent = node;
    configureUITransform(labelNode, {
      width: Number.isFinite(options.width) ? options.width : 180,
      height: Number.isFinite(options.height) ? options.height : 64,
    });
    const label = getOrAddComponent(labelNode, Label);
    label.string = options.text || 'Button';
    label.fontSize = Number.isFinite(options.fontSize) ? options.fontSize : 28;
    label.lineHeight = Number.isFinite(options.lineHeight) ? options.lineHeight : label.fontSize + 8;
    label.color = parseColor(options.textColor, Color.WHITE);

    return {
      created: true,
      path: getNodePath(node),
      uuid: node.uuid,
      labelPath: getNodePath(labelNode),
      components: getComponentNames(node),
    };
  },

  async createSprite(options = {}) {
    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    let spriteFrame = null;
    if (options.spriteFrameUuid) {
      spriteFrame = await loadAssetByUuid(options.spriteFrameUuid);
      if (!(spriteFrame instanceof SpriteFrame)) {
        throw new Error(`spriteFrameUuid must resolve to a cc.SpriteFrame: ${options.spriteFrameUuid}`);
      }
    }
    const color = parseColor(options.color, Color.WHITE);

    const node = new Node(options.name || 'Sprite');
    node.parent = parent;
    configureNodeBasics(node, options);
    configureUITransform(node, options);
    const sprite = getOrAddComponent(node, Sprite);
    sprite.color = color;
    if (spriteFrame) {
      sprite.spriteFrame = spriteFrame;
    }

    return {
      created: true,
      path: getNodePath(node),
      uuid: node.uuid,
      components: getComponentNames(node),
    };
  },

  async setSpriteFrame(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const sprite = node.getComponent(Sprite);
    if (!sprite) {
      throw new Error('Sprite component was not found on target node.');
    }
    const spriteFrameUuid = String(options.spriteFrameUuid || '').trim();
    if (!spriteFrameUuid) {
      throw new Error('spriteFrameUuid is required.');
    }
    const spriteFrame = await loadAssetByUuid(spriteFrameUuid);
    if (!(spriteFrame instanceof SpriteFrame)) {
      throw new Error(`spriteFrameUuid must resolve to a cc.SpriteFrame: ${spriteFrameUuid}`);
    }

    const previousSpriteFrameUuid = sprite.spriteFrame ? sprite.spriteFrame.uuid : null;
    sprite.spriteFrame = spriteFrame;
    return {
      updated: true,
      node: getNodePath(node),
      uuid: node.uuid,
      previousSpriteFrameUuid,
      spriteFrameUuid: spriteFrame.uuid,
    };
  },

  async listCameras() {
    const cameras = findComponentsByClass(Camera);
    return {
      count: cameras.length,
      cameras: cameras.map((camera) => ({
        node: camera.node ? getNodePath(camera.node) : '',
        uuid: camera.node ? camera.node.uuid : '',
        enabled: Boolean(camera.enabled),
        priority: camera.priority,
        projection: camera.projection,
        visibility: camera.visibility,
        clearFlags: camera.clearFlags,
      })),
    };
  },

  async createCamera(options = {}) {
    const parent = options.parentPath ? findNodeByPath(options.parentPath) : getScene();
    if (!parent) {
      throw new Error(`Parent not found: ${options.parentPath}`);
    }

    const node = new Node(options.name || 'Camera');
    node.parent = parent;
    configureNodeBasics(node, options);
    const camera = getOrAddComponent(node, Camera);
    if (Number.isFinite(options.priority)) {
      camera.priority = options.priority;
    }
    if (Number.isFinite(options.visibility)) {
      camera.visibility = options.visibility;
    }
    if (Number.isFinite(options.clearFlags)) {
      camera.clearFlags = options.clearFlags;
    }

    return {
      created: true,
      path: getNodePath(node),
      uuid: node.uuid,
      camera: plain(camera),
    };
  },

  async setCameraProperties(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target camera node was not found.');
    }
    const camera = node.getComponent(Camera);
    if (!camera) {
      throw new Error('Camera component was not found on target node.');
    }

    for (const key of ['priority', 'visibility', 'clearFlags', 'projection', 'orthoHeight', 'fov', 'near', 'far']) {
      if (options[key] !== undefined) {
        camera[key] = options[key];
      }
    }

    return {
      updated: true,
      node: getNodePath(node),
      camera: plain(camera),
    };
  },

  async listAnimations(options = {}) {
    const animations = options.path || options.uuid || options.name
      ? [findNode(options)].filter(Boolean).map((node) => node.getComponent(Animation)).filter(Boolean)
      : findComponentsByClass(Animation);

    return {
      count: animations.length,
      animations: animations.map((animation) => ({
        node: animation.node ? getNodePath(animation.node) : '',
        uuid: animation.node ? animation.node.uuid : '',
        enabled: Boolean(animation.enabled),
        defaultClip: animation.defaultClip ? animation.defaultClip.name : '',
        clips: Array.isArray(animation.clips) ? animation.clips.map((clip) => clip && clip.name).filter(Boolean) : [],
      })),
    };
  },

  async addAnimationClip(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const clipUuid = String(options.clipUuid || '').trim();
    if (!clipUuid) {
      throw new Error('clipUuid is required.');
    }

    const clip = await loadAnimationClipByUuid(clipUuid);
    const animation = getOrAddComponent(node, Animation);
    const clips = Array.isArray(animation.clips) ? animation.clips.slice() : [];
    if (!clips.includes(clip)) {
      clips.push(clip);
      animation.clips = clips;
    }
    if (options.makeDefault !== false) {
      animation.defaultClip = clip;
    }

    return {
      added: true,
      node: getNodePath(node),
      clip: clip.name,
      clipUuid,
      clips: animation.clips.map((item) => item && item.name).filter(Boolean),
    };
  },

  async playAnimation(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const animation = node.getComponent(Animation);
    if (!animation) {
      throw new Error('Animation component was not found on target node.');
    }
    const state = options.clipName ? animation.play(options.clipName) : animation.play();
    return {
      playing: true,
      node: getNodePath(node),
      clip: state && state.clip ? state.clip.name : options.clipName || '',
    };
  },

  async stopAnimation(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const animation = node.getComponent(Animation);
    if (!animation) {
      throw new Error('Animation component was not found on target node.');
    }
    if (options.clipName) {
      animation.stop(options.clipName);
    } else {
      animation.stop();
    }
    return {
      stopped: true,
      node: getNodePath(node),
      clip: options.clipName || '(all)',
    };
  },

  async getRuntimeState() {
    const scheduler = getScheduler();
    return {
      scope: 'editScene',
      sceneName: getScene().name,
      paused: typeof director.isPaused === 'function' ? director.isPaused() : false,
      timeScale: scheduler && typeof scheduler.getTimeScale === 'function' ? scheduler.getTimeScale() : 1,
      totalFrames: typeof director.getTotalFrames === 'function' ? director.getTotalFrames() : undefined,
    };
  },

  async getPerformanceSnapshot() {
    const scheduler = getScheduler();
    const stats = collectSceneStats();
    const memory = typeof performance !== 'undefined' && performance.memory
      ? {
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          usedJSHeapSize: performance.memory.usedJSHeapSize,
        }
      : null;

    return {
      sceneName: getScene().name,
      runtime: {
        scope: 'editScene',
        paused: typeof director.isPaused === 'function' ? director.isPaused() : false,
        timeScale: scheduler && typeof scheduler.getTimeScale === 'function' ? scheduler.getTimeScale() : 1,
        totalFrames: typeof director.getTotalFrames === 'function' ? director.getTotalFrames() : undefined,
      },
      stats,
      memory,
      warnings: buildSceneWarnings(stats),
    };
  },

  async getPrefabInstanceInfo(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    return {
      node: {
        name: node.name,
        path: getNodePath(node),
        uuid: node.uuid,
      },
      prefab: getPrefabInfo(node),
    };
  },

  async pauseRuntime() {
    return await callPreviewRuntimeTool('pause_runtime');
  },

  async resumeRuntime() {
    return await callPreviewRuntimeTool('resume_runtime');
  },

  async setTimeScale(options = {}) {
    const scale = Number(options.scale);
    if (!Number.isFinite(scale) || scale < 0 || scale > 100) {
      throw new Error('scale must be a number between 0 and 100.');
    }
    const scheduler = getScheduler();
    if (!scheduler || typeof scheduler.setTimeScale !== 'function') {
      throw new Error('director scheduler time scale API is unavailable.');
    }
    scheduler.setTimeScale(scale);
    return await exports.methods.getRuntimeState();
  },

  async emitNodeEvent(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const eventName = String(options.eventName || '').trim();
    if (!eventName) {
      throw new Error('eventName is required.');
    }
    node.emit(eventName, options.payload || {});
    return {
      emitted: true,
      node: getNodePath(node),
      eventName,
    };
  },

  async simulateButtonClick(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const button = node.getComponent(Button);
    if (!button) {
      throw new Error('Button component was not found on target node.');
    }

    if (Component && Component.EventHandler && typeof Component.EventHandler.emitEvents === 'function') {
      Component.EventHandler.emitEvents(button.clickEvents, button);
    }
    node.emit(Button.EventType ? Button.EventType.CLICK : 'click', button);

    return {
      clicked: true,
      node: getNodePath(node),
      clickEventCount: Array.isArray(button.clickEvents) ? button.clickEvents.length : 0,
    };
  },

  async listButtonClickEvents(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const button = node.getComponent(Button);
    if (!button) {
      throw new Error('Button component was not found on target node.');
    }

    return {
      node: getNodePath(node),
      uuid: node.uuid,
      clickEventCount: Array.isArray(button.clickEvents) ? button.clickEvents.length : 0,
      clickEvents: Array.isArray(button.clickEvents)
        ? button.clickEvents.map((event, index) => {
          const summary = serializeEventHandler(event);
          return summary ? { index, ...summary } : null;
        }).filter(Boolean)
        : [],
    };
  },

  async bindButtonClickEvent(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Button node was not found.');
    }
    const button = node.getComponent(Button);
    if (!button) {
      throw new Error('Button component was not found on target node.');
    }

    const target = findNode({
      path: options.targetPath,
      uuid: options.targetUuid,
      name: options.targetName,
    });
    if (!target) {
      throw new Error('Event target node was not found.');
    }

    const componentName = String(options.componentName || '').trim();
    const handlerName = String(options.handler || options.handlerName || '').trim();
    if (!componentName || !handlerName) {
      throw new Error('componentName and handler are required.');
    }

    const component = findComponent(target, { componentName });
    if (!component) {
      throw new Error(`Target component was not found: ${componentName}`);
    }
    if (typeof component[handlerName] !== 'function') {
      throw new Error(`Target component method was not found: ${componentName}.${handlerName}`);
    }

    const HandlerClass = getEventHandlerClass();
    if (!HandlerClass) {
      throw new Error('Cocos EventHandler class is unavailable.');
    }

    const existing = Array.isArray(button.clickEvents) ? button.clickEvents : [];
    const duplicate = existing.find((event) => (
      event &&
      event.target === target &&
      getEventHandlerComponentName(event) === componentName &&
      event.handler === handlerName &&
      String(event.customEventData || '') === String(options.customEventData || '')
    ));
    if (duplicate && options.replace !== true) {
      return {
        bound: false,
        duplicate: true,
        node: getNodePath(node),
        event: serializeEventHandler(duplicate),
        clickEventCount: existing.length,
      };
    }

    const event = new HandlerClass();
    event.target = target;
    event.component = componentName;
    event.handler = handlerName;
    event.customEventData = String(options.customEventData || '');

    button.clickEvents = options.replace === true
      ? existing.filter((item) => item !== duplicate).concat(event)
      : existing.concat(event);
    try {
      recordButtonClickEventPrefabOverride(button);
    } catch (error) {
      button.clickEvents = existing;
      throw error;
    }

    return {
      bound: true,
      node: getNodePath(node),
      uuid: node.uuid,
      event: serializeEventHandler(event),
      clickEventCount: button.clickEvents.length,
    };
  },

  async unbindButtonClickEvent(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Button node was not found.');
    }
    const button = node.getComponent(Button);
    if (!button) {
      throw new Error('Button component was not found on target node.');
    }
    const existing = Array.isArray(button.clickEvents) ? button.clickEvents : [];
    const index = options.eventIndex;
    if (!Number.isInteger(index) || index < 0 || index >= existing.length) {
      throw new Error(`eventIndex must identify a current click event (0-${Math.max(0, existing.length - 1)}).`);
    }
    const expected = options.expectedEvent;
    const signatureFields = ['targetUuid', 'component', 'handler', 'customEventData'];
    if (!expected || typeof expected !== 'object' ||
        signatureFields.some((field) => typeof expected[field] !== 'string')) {
      throw new Error('expectedEvent must include targetUuid, component, handler, and customEventData strings from list_button_click_events.');
    }
    const current = serializeEventHandler(existing[index]);
    if (!current || signatureFields.some((field) => current[field] !== expected[field])) {
      throw new Error('Click event at eventIndex has changed. List events again before unbinding.');
    }

    button.clickEvents = existing.filter((_, currentIndex) => currentIndex !== index);
    try {
      recordButtonClickEventPrefabOverride(button);
    } catch (error) {
      button.clickEvents = existing;
      throw error;
    }
    return {
      unbound: true,
      node: getNodePath(node),
      uuid: node.uuid,
      eventIndex: index,
      event: current,
      clickEventCount: button.clickEvents.length,
    };
  },

  async invokeComponentMethod(options = {}) {
    const node = findNode(options);
    if (!node) {
      throw new Error('Target node was not found.');
    }
    const component = findComponent(node, options);
    if (!component) {
      throw new Error('Target component was not found.');
    }
    const methodName = String(options.methodName || '').trim();
    if (!methodName || typeof component[methodName] !== 'function') {
      throw new Error(`Component method not found: ${methodName}`);
    }

    const result = component[methodName](...(Array.isArray(options.args) ? options.args : []));
    return {
      invoked: true,
      node: getNodePath(node),
      component: component.constructor ? component.constructor.name : 'UnknownComponent',
      methodName,
      result: plain(result),
    };
  },

  async executeCode(options = {}) {
    const code = String(options.code || '');
    if (!code.trim()) {
      throw new Error('code is required.');
    }

    const execute = async (scriptConsole) => {
      const result = await executeUserCode(code, options.args || {}, scriptConsole);
      return { ok: true, result: plain(result), sceneName: getScene().name };
    };
    return options.captureActivity
      ? captureScriptExecution(execute, { context: 'scene', targetConsole: console })
      : execute(console);
  },
};
