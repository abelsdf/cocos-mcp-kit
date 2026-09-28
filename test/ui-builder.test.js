'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const batchCreate = require('../lib/node-batch-create');
const { validateNodeBatch } = require('../lib/node-batch-dto');
const builder = () => require('../lib/ui-builder');
function ui() {
  return { schemaVersion: 1, mode: 'create', failurePolicy: 'cleanup_new_nodes', events: [], roots: [
    { id: 'panel', name: 'Panel', size: { width: 360, height: 240 }, position: { x: 10, y: -20 },
      sprite: { spriteFrame: 'db://assets/Pixel.png/spriteFrame', color: { r: 20, g: 30, b: 40, a: 255 } },
      button: { interactable: false, target: 'title' }, children: [
        { id: 'title', name: 'Title', size: { width: 240, height: 60 }, anchor: { x: 0, y: 1 },
          label: { text: 'Hello', fontSize: 24, lineHeight: 28 } },
      ] },
  ] };
}

test('UI schema compiles nested local IDs, fixed dimensions and references into a separate batch DTO', () => {
  const input = ui(); const before = JSON.stringify(input); const batch = builder().compileUI(input);
  assert.equal(JSON.stringify(input), before); assert.equal(validateNodeBatch(batch).valid, true);
  assert.equal(batch.ui, true); assert.deepEqual(batch.roots, ['panel']);
  assert.deepEqual(batch.nodes.map(n => [n.id, n.parentId]), [['panel', null], ['title', 'panel']]);
  assert.deepEqual(batch.nodes[0].position, { x: 10, y: -20, z: 0 });
  assert.deepEqual(batch.nodes[1].position, { x: 0, y: 0, z: 0 });
  const label = batch.nodes[1].components.find(c => c.type === 'cc.Label');
  assert.equal(label.properties.overflow, 1); assert.equal(label.properties.fontSize, 24);
  assert.equal(batch.nodes[0].components.find(c => c.type === 'cc.Sprite').properties.sizeMode, 0);
  assert.deepEqual(batch.references.map(r => r.to), [{ kind: 'asset', id: 'db://assets/Pixel.png/spriteFrame' }, { kind: 'node', id: 'title' }]);
});
test('UI defaults are explicit and button target defaults to its own local node', () => {
  const input = ui(); input.roots[0].button = {}; delete input.roots[0].children[0].label.fontSize; delete input.roots[0].children[0].label.lineHeight;
  const batch = builder().compileUI(input);
  assert.equal(batch.references.at(-1).to.id, 'panel');
  assert.equal(batch.nodes[1].components.find(c => c.type === 'cc.Label').properties.lineHeight, 20);
  assert.deepEqual(batch.nodes[0].components[0].properties.anchorPoint, { x: 0.5, y: 0.5 });
});
const invalid = [
  x => { x.mode = 'update'; }, x => { x.failurePolicy = 'keep'; }, x => { x.schemaVersion = 2; },
  x => { x.events = [{ from: 'panel', handler: 'onClick' }]; }, x => { x.scripts = []; },
  x => { x.roots = []; }, x => { x.roots[0].children[0].id = 'panel'; },
  x => { x.roots[0].button.target = 'missing'; }, x => { x.roots[0].button.interactable = 'false'; },
  x => { x.roots[0].size.width = 0; }, x => { x.roots[0].size.height = Infinity; },
  x => { x.roots[0].size.depth = 1; }, x => { x.roots[0].anchor = { x: -1, y: 0.5 }; },
  x => { x.roots[0].position.z = 1; }, x => { x.roots[0].position.x = NaN; },
  x => { x.roots[0].label = { text: 'Conflict' }; }, x => { x.roots[0].sprite.spriteFrame = ''; },
  x => { x.roots[0].sprite.color.a = 256; }, x => { x.roots[0].sprite.color.r = 1.5; },
  x => { x.roots[0].children[0].label.fontSize = -1; }, x => { x.roots[0].children[0].label.text = false; },
  x => { x.roots[0].children[0].label = null; }, x => { x.roots[0].children = 'bad'; },
  x => { x.roots[0].children.push({ ...x.roots[0].children[0], id: 'second' }); },
  x => { x.roots[0].name = '  '; }, x => { x.roots[0].active = false; },
  x => { x.roots[0].sprite.color = JSON.parse('{"r":0,"g":0,"b":0,"a":255,"__proto__":{}}'); },
];
for (const change of invalid) test(`invalid UI rejected statically: ${change}`, () => {
  const input = ui(); change(input); assert.throws(() => builder().compileUI(input));
});
test('UI size, node count and hierarchy depth are bounded before editor calls', () => {
  const input = ui(); input.roots[0].children[0].label.text = 'x'.repeat(262144);
  assert.throws(() => builder().compileUI(input), /256 KiB/);
  const many = ui(); many.roots = Array.from({ length: 129 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, size: { width: 1, height: 1 } }));
  assert.throws(() => builder().compileUI(many), /128/);
  const deep = ui(); let node = deep.roots[0];
  for (let i = 0; i < 17; i++) { node.children = [{ id: `n${i}`, name: `N${i}`, size: { width: 1, height: 1 } }]; node = node.children[0]; }
  assert.throws(() => builder().compileUI(deep), /16/);
  const cyclic = ui(); cyclic.roots[0].children.push(cyclic.roots[0]);
  assert.throws(() => builder().compileUI(cyclic), /JSON/);
});
test('builder delegates the entire mutation to batch creation and preserves its recovery evidence', async t => {
  const result = { created: false, verified: false, uncertain: true, phase: 'undo_finalize',
    identities: { nodes: { panel: 'new' }, components: {} }, undo: { recorded: null }, cleanup: { status: 'partial' } };
  t.mock.method(batchCreate, 'createNodeBatch', async (project, bridge, input) => {
    assert.equal(project, 'project'); assert.equal(bridge, 'bridge');
    assert.equal(input.parentUuid, 'parent'); assert.equal(input.batch.ui, true); return result;
  });
  const actual = await builder().buildUI('project', 'bridge', { sceneUuid: 'scene', parentUuid: 'parent', ui: ui() });
  for (const [key, value] of Object.entries(result)) assert.deepEqual(actual[key], value);
  assert.equal(actual.coordinateSpace, 'parent_local_ui'); assert.ok(actual.warnings.length);
});
test('builder returns preflight failure with no cleanup candidates and never falls back to script execution', async t => {
  t.mock.method(batchCreate, 'createNodeBatch', async () => assert.fail('must not call editor'));
  for (const args of [{ sceneUuid: 'scene', parentUuid: 'parent', ui: { ...ui(), mode: 'update' } },
    { sceneUuid: 'scene', parentUuid: 'parent', ui: ui(), force: true }]) {
    const result = await builder().buildUI('project', {}, args);
    assert.equal(result.created, false); assert.equal(result.phase, 'preflight');
    assert.equal(result.cleanup.status, 'not_needed'); assert.equal(result.needsSave, null);
  }
});
