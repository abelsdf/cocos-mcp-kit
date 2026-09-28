'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { compileUI, buildUI } = require('../lib/ui-builder');
const batchCreate = require('../lib/node-batch-create');
const { getUITemplate } = require('../lib/ui-templates');
const spriteFrame = 'db://assets/White.png/spriteFrame';
const scriptUuid = '12345678-1234-1234-1234-123456789abc';
const actions = { pause_menu: ['resume', 'restart', 'quit'], settings_dialog: ['music', 'sound', 'close'], result_dialog: ['retry', 'continue'] };
const options = template => ({ template, spriteFrame });

for (const template of Object.keys(actions)) {
  test(`${template} produces deterministic editable UI with disabled unbound actions`, () => {
    const input = options(template), before = JSON.stringify(input), result = getUITemplate(input);
    assert.equal(JSON.stringify(input), before); assert.deepEqual(getUITemplate(input), result);
    assert.deepEqual(result.actions.map(a => a.id), actions[template]);
    assert.ok(result.actions.every(a => !a.bound));
    const dto = compileUI(result.ui);
    assert.equal(result.ui.mode, 'create'); assert.equal(result.ui.failurePolicy, 'cleanup_new_nodes');
    assert.equal(dto.nodes.filter(n => n.components.some(c => c.type === 'cc.Button')).length, actions[template].length);
    assert.ok(dto.nodes.flatMap(n => n.components).filter(c => c.type === 'cc.Button').every(c => c.properties.interactable === false));
    assert.equal(dto.nodes.flatMap(n => n.components).some(c => c.type === 'script'), false);
    assert.equal(result.validation.resources, 'not_checked'); assert.equal(result.validation.scene, 'not_checked');
  });
  test(`${template} custom text, sizes, colors and action data compile through the existing builder`, () => {
    const controller = { scriptUuid, bindings: Object.fromEntries(actions[template].map(action => [action, { handler: 'onAction', customEventData: action }])) };
    const input = { ...options(template), name: 'CustomPanel', size: { width: 600, height: 420 }, texts: { title: '自定义标题', message: '内容\n第二行', [actions[template][0]]: '执行' },
      colors: { panel: { r: 1, g: 2, b: 3, a: 255 }, button: { r: 20, g: 30, b: 40, a: 128 }, text: { r: 250, g: 240, b: 230, a: 255 } }, controller };
    const before = JSON.stringify(input), result = getUITemplate(input), dto = compileUI(result.ui), root = result.ui.roots[0];
    assert.equal(JSON.stringify(input), before); assert.equal(root.name, 'CustomPanel'); assert.deepEqual(root.size, input.size);
    assert.deepEqual(root.sprite.color, input.colors.panel);
    assert.equal(root.children.find(n => n.id === 'title').label.text, '自定义标题');
    assert.equal(root.children.find(n => n.id === actions[template][0]).children[0].label.text, '执行');
    assert.deepEqual(dto.events.map(e => e.customEventData), actions[template]); assert.ok(result.actions.every(a => a.bound));
    const script = dto.nodes[0].components.find(c => c.type === 'script'); assert.equal(script.scriptUuid, scriptUuid);
    assert.ok(dto.events.every(e => e.targetComponentId === script.id));
  });
  test(`${template} minimum layout keeps every direct child and caption inside its parent`, () => {
    const root = getUITemplate({ ...options(template), size: { width: 240, height: 400 } }).ui.roots[0];
    const visit = n => { for (const child of n.children || []) { const p = child.position || { x: 0, y: 0 };
      assert.ok(Math.abs(p.x) + child.size.width / 2 <= n.size.width / 2);
      assert.ok(Math.abs(p.y) + child.size.height / 2 <= n.size.height / 2); visit(child);
    } }; visit(root);
  });
}

test('partial event binding enables only the explicit action and defaults data to action ID', () => {
  const result = getUITemplate({ ...options('pause_menu'), controller: { scriptUuid, bindings: { resume: { handler: 'onResume' } } } });
  assert.deepEqual(result.actions.map(a => [a.id, a.bound]), [['resume', true], ['restart', false], ['quit', false]]);
  assert.equal(compileUI(result.ui).events[0].customEventData, 'resume');
});

const invalid = [
  x => { x.template = 'login'; }, x => { x.template = 'constructor'; }, x => { x.unused = true; },
  x => { delete x.spriteFrame; }, x => { x.spriteFrame = 'db://internal/White'; }, x => { x.spriteFrame = 'assets/White.png'; },
  x => { x.name = ''; }, x => { x.name = 'a/b'; },
  x => { x.size = { width: 239, height: 400 }; }, x => { x.size = { width: 480, height: 399 }; },
  x => { x.size = { width: 2049, height: 480 }; }, x => { x.size = { width: 480, height: Infinity }; },
  x => { x.size = { width: '480', height: 480 }; }, x => { x.size = { width: 480, height: 480, z: 0 }; },
  x => { x.texts = { unknown: 'x' }; }, x => { x.texts = { title: null }; }, x => { x.texts = { title: 'x'.repeat(513) }; },
  x => { x.colors = { panel: { r: 1.5, g: 0, b: 0, a: 255 } }; }, x => { x.colors = { text: '#fff' }; },
  x => { x.colors = { other: {} }; }, x => { x.colors = { button: { r: 0, g: 0, b: 0, a: 256 } }; },
  x => { x.controller = { scriptUuid, bindings: {} }; },
  x => { x.controller = { scriptUuid, bindings: { music: { handler: 'onAction' } } }; },
  x => { x.controller = { scriptUuid: 'SomeClass', bindings: { resume: { handler: 'onAction' } } }; },
  x => { x.controller = { scriptUuid, bindings: { resume: { handler: 'bad.path' } } }; },
  x => { x.controller = { scriptUuid, bindings: { resume: { handler: 'onAction', target: 'outside' } } }; },
  x => { x.controller = { scriptUuid, bindings: { resume: { handler: 'onAction', customEventData: 1 } } }; },
  x => { x.controller = { scriptUuid, bindings: { resume: { handler: 'onAction', customEventData: 'x'.repeat(1025) } } }; },
  x => { x.texts = JSON.parse('{"__proto__":{}}'); }, x => { x.colors = null; },
];
for (const change of invalid) test(`invalid template input refuses before any editor call: ${change}`, () => {
  const input = options('pause_menu'); change(input); assert.throws(() => getUITemplate(input));
});

test('each generation owns its data; editing generated JSON does not change later templates', () => {
  const before = getUITemplate(options('pause_menu')), modified = getUITemplate(options('pause_menu'));
  modified.ui.roots[0].sprite.color.r = 255; modified.ui.roots[0].children[0].label.text = 'Edited';
  assert.deepEqual(getUITemplate(options('pause_menu')), before);
});

test('generated UI goes through existing batch write and preserves failure cleanup and Undo evidence', async t => {
  const failure = { created: false, verified: false, phase: 'create', cleanup: { status: 'complete' }, undo: { cancelled: true } };
  t.mock.method(batchCreate, 'createNodeBatch', async (_project, _bridge, input) => {
    assert.equal(input.batch.nodes[0].name, 'PauseMenu'); assert.equal(input.batch.ui, true); return failure;
  });
  const result = await buildUI('project', {}, { sceneUuid: 'scene', parentUuid: 'parent', ui: getUITemplate(options('pause_menu')).ui });
  for (const [key, value] of Object.entries(failure)) assert.deepEqual(result[key], value);
});
