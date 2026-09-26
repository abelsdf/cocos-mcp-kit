'use strict';

const MAX_BYTES = 256 * 1024;
const MAX_NODES = 128;
const MAX_COMPONENTS = 16;
const MAX_REFERENCES = 256;
const MAX_DEPTH = 16;
const MAX_ISSUES = 50;
const LOCAL_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const PROPERTY_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function createIssueCollector() {
  const issues = [];
  let omitted = 0;
  return {
    add(code, path, message) {
      if (issues.length < MAX_ISSUES) issues.push({ code, path, message });
      else omitted += 1;
    },
    get issues() { return issues; },
    get omitted() { return omitted; },
  };
}

function checkKeys(value, allowed, path, collector) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) collector.add('UNKNOWN_FIELD', `${path}.${key}`, 'Unknown field.');
  }
}

function checkJsonValue(value, path, collector, depth = 0) {
  if (depth > MAX_DEPTH) {
    collector.add('VALUE_TOO_DEEP', path, `JSON property depth exceeds ${MAX_DEPTH}.`);
    return;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) checkJsonValue(value[i], `${path}[${i}]`, collector, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) collector.add('UNSAFE_KEY', `${path}.${key}`, 'Prototype-related keys are not allowed.');
      else checkJsonValue(item, `${path}.${key}`, collector, depth + 1);
    }
    return;
  }
  collector.add('INVALID_JSON_VALUE', path, 'Value must be plain JSON data.');
}

function validateNodeBatch(batch) {
  const collector = createIssueCollector();
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(batch), 'utf8');
  } catch {
    collector.add('INVALID_JSON', '$', 'Batch must be serializable JSON data.');
  }
  if (bytes !== undefined && bytes > MAX_BYTES) {
    collector.add('BATCH_TOO_LARGE', '$', `Batch exceeds ${MAX_BYTES} UTF-8 bytes.`);
  }
  if (!isRecord(batch)) {
    collector.add('INVALID_BATCH', '$', 'Batch must be an object.');
    return { valid: false, issues: collector.issues, omittedIssues: collector.omitted, plan: null };
  }
  checkKeys(batch, ['schemaVersion', 'roots', 'nodes', 'references', 'externalPolicy'], '$', collector);
  if (batch.schemaVersion !== 1) collector.add('UNSUPPORTED_VERSION', '$.schemaVersion', 'Expected schemaVersion 1.');
  if (!Array.isArray(batch.nodes) || batch.nodes.length < 1 || batch.nodes.length > MAX_NODES) {
    collector.add('INVALID_NODES', '$.nodes', `Expected 1–${MAX_NODES} nodes.`);
  }
  if (!Array.isArray(batch.roots) || batch.roots.length < 1 || batch.roots.length > MAX_NODES) {
    collector.add('INVALID_ROOTS', '$.roots', `Expected 1–${MAX_NODES} root IDs.`);
  }
  if (batch.references !== undefined && (!Array.isArray(batch.references) || batch.references.length > MAX_REFERENCES)) {
    collector.add('INVALID_REFERENCES', '$.references', `Expected at most ${MAX_REFERENCES} references.`);
  }
  const policy = batch.externalPolicy === undefined ? 'reject' : batch.externalPolicy;
  if (!['reject', 'clear', 'resolve'].includes(policy)) {
    collector.add('INVALID_POLICY', '$.externalPolicy', 'Expected reject, clear, or resolve.');
  }
  if (collector.issues.some((item) => ['INVALID_JSON', 'BATCH_TOO_LARGE', 'INVALID_NODES', 'INVALID_ROOTS', 'INVALID_REFERENCES'].includes(item.code))) {
    return { valid: false, issues: collector.issues, omittedIssues: collector.omitted, plan: null };
  }

  const nodes = new Map();
  const components = new Map();
  for (let index = 0; index < batch.nodes.length; index += 1) {
    const node = batch.nodes[index];
    const path = `$.nodes[${index}]`;
    if (!isRecord(node)) { collector.add('INVALID_NODE', path, 'Node must be an object.'); continue; }
    checkKeys(node, ['id', 'parentId', 'name', 'components'], path, collector);
    if (typeof node.id !== 'string' || !LOCAL_ID.test(node.id)) {
      collector.add('INVALID_ID', `${path}.id`, 'Node ID must be a 1–64 character local identifier.');
    } else if (nodes.has(node.id)) {
      collector.add('DUPLICATE_NODE_ID', `${path}.id`, `Duplicate node ID '${node.id}'.`);
    } else nodes.set(node.id, { node, index });
    if (node.parentId !== null && (typeof node.parentId !== 'string' || !LOCAL_ID.test(node.parentId))) {
      collector.add('INVALID_PARENT', `${path}.parentId`, 'parentId must be a local node ID or null.');
    }
    if (typeof node.name !== 'string' || !node.name.trim() || node.name.length > 128) {
      collector.add('INVALID_NAME', `${path}.name`, 'Node name must contain 1–128 characters.');
    }
    if (!Array.isArray(node.components) || node.components.length > MAX_COMPONENTS) {
      collector.add('INVALID_COMPONENTS', `${path}.components`, `Expected at most ${MAX_COMPONENTS} components.`);
      continue;
    }
    for (let componentIndex = 0; componentIndex < node.components.length; componentIndex += 1) {
      const component = node.components[componentIndex];
      const componentPath = `${path}.components[${componentIndex}]`;
      if (!isRecord(component)) { collector.add('INVALID_COMPONENT', componentPath, 'Component must be an object.'); continue; }
      checkKeys(component, ['id', 'type', 'properties'], componentPath, collector);
      if (typeof component.id !== 'string' || !LOCAL_ID.test(component.id)) {
        collector.add('INVALID_ID', `${componentPath}.id`, 'Component ID must be a 1–64 character local identifier.');
      } else if (components.has(component.id)) {
        collector.add('DUPLICATE_COMPONENT_ID', `${componentPath}.id`, `Duplicate component ID '${component.id}'.`);
      } else components.set(component.id, { nodeId: node.id, component });
      if (typeof component.type !== 'string' || component.type.length > 128 || !TYPE_NAME.test(component.type) || component.type.split('.').some((part) => UNSAFE_KEYS.has(part))) {
        collector.add('INVALID_COMPONENT_TYPE', `${componentPath}.type`, 'Component type must be a safe registered class name.');
      }
      if (component.properties !== undefined) {
        if (!isRecord(component.properties)) collector.add('INVALID_PROPERTIES', `${componentPath}.properties`, 'Properties must be a plain object.');
        else checkJsonValue(component.properties, `${componentPath}.properties`, collector);
      }
    }
  }

  const declaredRoots = new Set();
  for (let index = 0; index < batch.roots.length; index += 1) {
    const id = batch.roots[index];
    const path = `$.roots[${index}]`;
    if (typeof id !== 'string' || !LOCAL_ID.test(id) || !nodes.has(id)) collector.add('UNKNOWN_ROOT', path, 'Root must name a node in this batch.');
    else if (declaredRoots.has(id)) collector.add('DUPLICATE_ROOT', path, `Duplicate root '${id}'.`);
    else declaredRoots.add(id);
  }
  const children = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const [id, { node, index }] of nodes) {
    if (node.parentId === null) {
      if (!declaredRoots.has(id)) collector.add('UNDECLARED_ROOT', `$.nodes[${index}].parentId`, `Node '${id}' is a root but is not listed in roots.`);
    } else if (typeof node.parentId === 'string' && LOCAL_ID.test(node.parentId)) {
      if (!nodes.has(node.parentId)) collector.add('MISSING_PARENT', `$.nodes[${index}].parentId`, `Parent '${node.parentId}' is absent.`);
      else children.get(node.parentId).push(id);
    }
  }
  for (const id of declaredRoots) {
    const record = nodes.get(id);
    if (record && record.node.parentId !== null) collector.add('NON_ROOT_DECLARED', `$.nodes[${record.index}].parentId`, `Declared root '${id}' has a parent.`);
  }

  const parentState = new Map();
  function checkParentChain(id) {
    if (parentState.get(id) === 'active') {
      collector.add('PARENT_CYCLE', `$.nodes[${nodes.get(id).index}].parentId`, `Parent cycle includes '${id}'.`);
      return;
    }
    if (parentState.get(id) === 'done') return;
    parentState.set(id, 'active');
    const parentId = nodes.get(id).node.parentId;
    if (nodes.has(parentId)) checkParentChain(parentId);
    parentState.set(id, 'done');
  }
  for (const id of nodes.keys()) checkParentChain(id);

  const visited = new Set();
  const visiting = new Set();
  const creationOrder = [];
  function visit(id, depth) {
    if (visiting.has(id)) { collector.add('PARENT_CYCLE', `$.nodes[${nodes.get(id).index}].parentId`, `Parent cycle includes '${id}'.`); return; }
    if (visited.has(id)) return;
    if (depth > MAX_DEPTH) collector.add('HIERARCHY_TOO_DEEP', `$.nodes[${nodes.get(id).index}]`, `Hierarchy exceeds ${MAX_DEPTH} levels.`);
    visiting.add(id);
    visited.add(id);
    creationOrder.push(id);
    for (const childId of children.get(id) || []) visit(childId, depth + 1);
    visiting.delete(id);
  }
  for (const id of batch.roots) if (nodes.has(id)) visit(id, 1);
  for (const id of nodes.keys()) {
    if (!visited.has(id)) collector.add('UNREACHABLE_NODE', `$.nodes[${nodes.get(id).index}]`, `Node '${id}' is not reachable from a declared root.`);
  }

  const sourceProperties = new Set();
  const referencePlan = [];
  for (let index = 0; index < (batch.references || []).length; index += 1) {
    const reference = batch.references[index];
    const path = `$.references[${index}]`;
    if (!isRecord(reference)) { collector.add('INVALID_REFERENCE', path, 'Reference must be an object.'); continue; }
    checkKeys(reference, ['from', 'to'], path, collector);
    const from = reference.from;
    const to = reference.to;
    if (!isRecord(from) || !isRecord(to)) { collector.add('INVALID_REFERENCE', path, 'Reference needs from and to objects.'); continue; }
    checkKeys(from, ['nodeId', 'componentId', 'property'], `${path}.from`, collector);
    checkKeys(to, ['kind', 'id'], `${path}.to`, collector);
    const owner = components.get(from.componentId);
    if (!nodes.has(from.nodeId) || !owner || owner.nodeId !== from.nodeId) {
      collector.add('INVALID_REFERENCE_SOURCE', `${path}.from`, 'Reference source component must belong to the source node.');
    }
    if (typeof from.property !== 'string' || !PROPERTY_NAME.test(from.property) || UNSAFE_KEYS.has(from.property)) {
      collector.add('INVALID_REFERENCE_PROPERTY', `${path}.from.property`, 'Reference property must be a safe top-level property name.');
    }
    if (owner && isRecord(owner.component.properties) && Object.hasOwn(owner.component.properties, from.property)) {
      collector.add('REFERENCE_PROPERTY_CONFLICT', `${path}.from.property`, 'A property cannot have both a literal value and a reference binding.');
    }
    const sourceKey = `${from.nodeId}:${from.componentId}:${from.property}`;
    if (sourceProperties.has(sourceKey)) collector.add('DUPLICATE_REFERENCE_SOURCE', `${path}.from`, 'Only one binding per source property is allowed.');
    else sourceProperties.add(sourceKey);
    if (!['node', 'component', 'asset', 'external'].includes(to.kind) || typeof to.id !== 'string' || !to.id.trim() || to.id.length > 256) {
      collector.add('INVALID_REFERENCE_TARGET', `${path}.to`, 'Expected node, component, asset, or external target with a nonempty ID.');
      continue;
    }
    if (to.kind === 'node' && !nodes.has(to.id)) collector.add('MISSING_NODE_TARGET', `${path}.to.id`, `Node '${to.id}' is absent.`);
    if (to.kind === 'component' && !components.has(to.id)) collector.add('MISSING_COMPONENT_TARGET', `${path}.to.id`, `Component '${to.id}' is absent.`);
    if (to.kind === 'external' && policy === 'reject') collector.add('EXTERNAL_REFERENCE_REJECTED', `${path}.to`, 'External references require clear or resolve policy.');
    const action = to.kind === 'external'
      ? policy === 'clear' ? 'clear' : 'resolve_later'
      : to.kind === 'asset' ? 'verify_asset_before_write' : 'remap_on_create';
    referencePlan.push({ sourceNodeId: from.nodeId, sourceComponentId: from.componentId, property: from.property, targetKind: to.kind, targetId: to.id, action });
  }

  if (collector.issues.length || collector.omitted) {
    return { valid: false, issues: collector.issues, omittedIssues: collector.omitted, plan: null };
  }
  return {
    valid: true,
    issues: [],
    omittedIssues: 0,
    plan: {
      schemaVersion: 1,
      rootIds: [...batch.roots],
      creationOrder,
      nodeCount: nodes.size,
      componentCount: components.size,
      referencePlan,
      externalPolicy: policy,
      needsCreatorValidation: true,
      writeScope: 'new_nodes_only',
    },
  };
}

function remapInternalReferences(referencePlan, identities) {
  if (!Array.isArray(referencePlan) || !isRecord(identities) || !isRecord(identities.nodes) || !isRecord(identities.components)) {
    throw new Error('Reference plan and node/component identity maps are required.');
  }
  return referencePlan.map((entry) => {
    if (entry.action !== 'remap_on_create') return { ...entry, resolvedId: null };
    const map = entry.targetKind === 'node' ? identities.nodes : identities.components;
    const resolvedId = Object.hasOwn(map, entry.targetId) ? map[entry.targetId] : null;
    if (typeof resolvedId !== 'string' || !resolvedId.trim()) {
      throw new Error(`Missing created identity for ${entry.targetKind} '${entry.targetId}'.`);
    }
    return { ...entry, resolvedId };
  });
}

function buildCleanupReport(createdNodeIds, attempts = {}) {
  if (!Array.isArray(createdNodeIds) || !isRecord(attempts)) throw new Error('Created node IDs and cleanup attempts are required.');
  if (createdNodeIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(createdNodeIds).size !== createdNodeIds.length) {
    throw new Error('Created node IDs must be unique nonempty strings.');
  }
  const cleanupOrder = [...createdNodeIds].reverse();
  const remainingNodeIds = cleanupOrder.filter((id) => !Object.hasOwn(attempts, id) || attempts[id] !== true);
  return {
    status: cleanupOrder.length === 0 ? 'not_needed' : remainingNodeIds.length === 0 ? 'complete' : 'partial',
    cleanupOrder,
    removedCount: cleanupOrder.length - remainingNodeIds.length,
    remainingNodeIds,
    requiresManualReview: remainingNodeIds.length > 0,
  };
}

module.exports = { validateNodeBatch, remapInternalReferences, buildCleanupReport };
