'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateNodeBatch, remapInternalReferences, buildCleanupReport } = require('../lib/node-batch-dto');

function validBatch(policy = 'clear') {
  return {
    schemaVersion: 1,
    roots: ['panel'],
    nodes: [
      { id: 'panel', parentId: null, name: 'Panel', components: [
        { id: 'layout', type: 'cc.UITransform', properties: { width: 640 } },
      ] },
      { id: 'label', parentId: 'panel', name: 'Title', components: [
        { id: 'text', type: 'cc.Label', properties: { string: 'Title' } },
      ] },
    ],
    references: [
      { from: { nodeId: 'panel', componentId: 'layout', property: 'target' }, to: { kind: 'node', id: 'label' } },
      { from: { nodeId: 'panel', componentId: 'layout', property: 'comp' }, to: { kind: 'component', id: 'text' } },
      { from: { nodeId: 'label', componentId: 'text', property: 'font' }, to: { kind: 'asset', id: 'db://assets/Font.ttf' } },
      { from: { nodeId: 'label', componentId: 'text', property: 'owner' }, to: { kind: 'external', id: 'outside-node' } },
    ],
    externalPolicy: policy,
  };
}

test('DTO v1 accepts additive local position and strict UI context opt-in', () => {
  const batch = validBatch(); batch.ui = true; batch.nodes[0].position = { x: 2, y: -3, z: 0 };
  assert.equal(validateNodeBatch(batch).valid, true);
  for (const position of [{ x: 1, y: 2 }, { x: 1, y: 2, z: Infinity }, { x: 1, y: 2, z: 0, w: 1 }, null]) {
    batch.nodes[0].position = position;
    assert.ok(validateNodeBatch(batch).issues.some(i => i.code === 'INVALID_POSITION'));
  }
  delete batch.nodes[0].position; batch.ui = false;
  assert.ok(validateNodeBatch(batch).issues.some(i => i.code === 'INVALID_UI_MODE'));
});

test('DTO adds script UUIDs and ordered local Button events without turning them into field references', () => {
  const batch = validBatch(); batch.nodes[0].components.push({ id: 'button', type: 'cc.Button' });
  batch.nodes[1].components.push({ id: 'controller', type: 'script', scriptUuid: '12345678-1234-1234-1234-123456789abc' });
  batch.events = [{ buttonComponentId: 'button', targetComponentId: 'controller', handler: 'resume', customEventData: '' }];
  assert.equal(validateNodeBatch(batch).valid, true);
  for (const event of [null, {}, { ...batch.events[0], customEventData: 'x'.repeat(1025) }, { ...batch.events[0], handler: 'constructor' }, { ...batch.events[0], extra: true }]) {
    assert.equal(validateNodeBatch({ ...batch, events: [event] }).valid, false);
  }
  for (const events of [null, {}, Array(51).fill(batch.events[0]), [batch.events[0], batch.events[0]]]) assert.equal(validateNodeBatch({ ...batch, events }).valid, false);
  const c = batch.nodes[1].components.at(-1); delete c.scriptUuid; assert.equal(validateNodeBatch(batch).valid, false);
  c.type = 'cc.Label'; c.scriptUuid = '12345678-1234-1234-1234-123456789abc'; assert.equal(validateNodeBatch(batch).valid, false);
});

test('node batch preflight orders parents and distinguishes internal, asset and external references', () => {
  const result = validateNodeBatch(validBatch());
  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.creationOrder, ['panel', 'label']);
  assert.deepEqual(result.plan.rootIds, ['panel']);
  assert.equal(result.plan.nodeCount, 2);
  assert.equal(result.plan.componentCount, 2);
  assert.deepEqual(result.plan.referencePlan.map((item) => item.action), [
    'remap_on_create', 'remap_on_create', 'verify_asset_before_write', 'clear',
  ]);
  assert.equal(result.plan.needsCreatorValidation, true);
  assert.equal(result.plan.writeScope, 'new_nodes_only');
  assert.equal(JSON.stringify(result).includes('Title'), false);
});

test('internal reference remapping requires actual new node and component identities', () => {
  const plan = validateNodeBatch(validBatch()).plan.referencePlan;
  assert.throws(() => remapInternalReferences(plan, { nodes: { label: 'new-label-uuid' }, components: {} }), /text/);
  const resolved = remapInternalReferences(plan, {
    nodes: { label: 'new-label-uuid' }, components: { text: 'new-component-uuid' },
  });
  assert.deepEqual(resolved.map((item) => item.resolvedId), ['new-label-uuid', 'new-component-uuid', null, null]);
});

test('external policy rejects by default, clears explicitly, and never pretends to resolve', () => {
  const rejected = validBatch();
  delete rejected.externalPolicy;
  assert.equal(validateNodeBatch(rejected).issues.some((issue) => issue.code === 'EXTERNAL_REFERENCE_REJECTED'), true);
  const resolved = validateNodeBatch(validBatch('resolve'));
  assert.equal(resolved.valid, true);
  assert.equal(resolved.plan.referencePlan.at(-1).action, 'resolve_later');
  assert.equal(remapInternalReferences(resolved.plan.referencePlan, {
    nodes: { label: 'node-uuid' }, components: { text: 'component-uuid' },
  }).at(-1).resolvedId, null);
});

test('node batch rejects duplicate roots, cycles, broken parents and stale internal references', () => {
  const batch = validBatch('clear');
  batch.roots = ['panel', 'panel'];
  batch.nodes.push({ id: 'orphan', parentId: 'missing', name: 'Orphan', components: [] });
  batch.nodes.push({ id: 'loopA', parentId: 'loopB', name: 'A', components: [] });
  batch.nodes.push({ id: 'loopB', parentId: 'loopA', name: 'B', components: [] });
  batch.references[0].to.id = 'absent';
  const result = validateNodeBatch(batch);
  assert.equal(result.valid, false);
  assert.equal(result.plan, null);
  const codes = new Set(result.issues.map((issue) => issue.code));
  for (const code of ['DUPLICATE_ROOT', 'MISSING_PARENT', 'PARENT_CYCLE', 'UNREACHABLE_NODE', 'MISSING_NODE_TARGET']) {
    assert.equal(codes.has(code), true, code);
  }
});

test('node batch rejects unsafe properties, duplicate component IDs and conflicting bindings', () => {
  const batch = validBatch();
  batch.nodes[1].components[0].id = 'layout';
  batch.nodes[0].components[0].properties = JSON.parse('{"__proto__":{"polluted":true}}');
  batch.references.push({ ...batch.references[0] });
  const codes = new Set(validateNodeBatch(batch).issues.map((issue) => issue.code));
  for (const code of ['DUPLICATE_COMPONENT_ID', 'UNSAFE_KEY', 'DUPLICATE_REFERENCE_SOURCE']) {
    assert.equal(codes.has(code), true, code);
  }
  assert.equal({}.polluted, undefined);
});

test('node batch enforces size and hierarchy bounds before any Creator write', () => {
  const oversized = validBatch();
  oversized.nodes[0].components[0].properties.payload = 'x'.repeat(256 * 1024);
  assert.equal(validateNodeBatch(oversized).issues[0].code, 'BATCH_TOO_LARGE');

  const deep = { schemaVersion: 1, roots: ['node0'], nodes: [], references: [] };
  for (let i = 0; i < 17; i += 1) {
    deep.nodes.push({ id: `node${i}`, parentId: i === 0 ? null : `node${i - 1}`, name: `N${i}`, components: [] });
  }
  assert.equal(validateNodeBatch(deep).issues.some((issue) => issue.code === 'HIERARCHY_TOO_DEEP'), true);
});

test('cleanup report never calls a partial or missing cleanup complete', () => {
  const partial = buildCleanupReport(['panel', 'label'], { label: true, panel: false });
  assert.deepEqual(partial.cleanupOrder, ['label', 'panel']);
  assert.deepEqual(partial.remainingNodeIds, ['panel']);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.requiresManualReview, true);
  assert.equal(buildCleanupReport(['panel', 'label'], { panel: true, label: true }).status, 'complete');
  assert.equal(buildCleanupReport([], {}).status, 'not_needed');
  assert.throws(() => buildCleanupReport(['panel', 'panel'], { panel: true }), /unique/);
});

test('node batch rejects a cyclic JavaScript input before traversing properties', () => {
  const batch = validBatch();
  batch.nodes[0].components[0].properties.self = batch;
  const result = validateNodeBatch(batch);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_JSON'), true);
  assert.equal(result.plan, null);
});

test('node batch rejects ambiguous literal/reference fields and malformed component types', () => {
  const batch = validBatch();
  batch.nodes[0].components[0].properties.target = null;
  batch.nodes[1].components[0].type = 'cc..Label';
  const codes = new Set(validateNodeBatch(batch).issues.map((issue) => issue.code));
  assert.equal(codes.has('REFERENCE_PROPERTY_CONFLICT'), true);
  assert.equal(codes.has('INVALID_COMPONENT_TYPE'), true);
});
