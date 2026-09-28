'use strict';

const batchCreate = require('./node-batch-create');
const { attachUIViewport } = require('./ui-viewport');
const { validateNodeBatch, buildCleanupReport } = require('./node-batch-dto');

function record(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${location}: expected a plain object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${location}.${key}: unsupported field.`);
}
function number(value, min, max, location) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${location}: expected a finite number in ${min}..${max}.`);
  return value;
}
function pair(value, keys, min, max, location) {
  record(value, keys, location);
  return Object.fromEntries(keys.map(key => [key, number(value[key], min, max, `${location}.${key}`)]));
}
function color(value, location) {
  const result = pair(value, ['r', 'g', 'b', 'a'], 0, 255, location);
  if (!Object.values(result).every(Number.isInteger)) throw new Error(`${location}: RGBA channels must be integers.`);
  return result;
}

// User-facing nested UI is compiled, never treated as a Creator serialization dump.
function compileUI(ui) {
  let json;
  try { json = JSON.stringify(ui); } catch { throw new Error('UI must be serializable JSON.'); }
  if (json && Buffer.byteLength(json, 'utf8') > 256 * 1024) throw new Error('UI exceeds 256 KiB.');
  record(ui, ['schemaVersion', 'mode', 'failurePolicy', 'roots', 'events'], 'ui');
  if (ui.schemaVersion !== 1 || ui.mode !== 'create' || ui.failurePolicy !== 'cleanup_new_nodes') {
    throw new Error('UI requires schemaVersion 1, mode create and failurePolicy cleanup_new_nodes.');
  }
  if (ui.events !== undefined && (!Array.isArray(ui.events) || ui.events.length > 50)) throw new Error('UI events must be an array of at most 50 bindings.');
  const batch = { schemaVersion: 1, ui: true, roots: [], nodes: [], references: [], externalPolicy: 'reject' };
  const scripts = new Map(), buttons = new Map();
  let componentIndex = 0;
  function visit(list, parentId, depth, location) {
    if (!Array.isArray(list) || depth === 1 && list.length === 0) throw new Error(`${location}: expected a node array (roots must not be empty).`);
    if (depth > 16 && list.length) throw new Error('UI hierarchy exceeds 16 levels.');
    const names = new Set();
    for (let i = 0; i < list.length; i++) {
      if (batch.nodes.length === 128) throw new Error('UI exceeds 128 nodes.');
      const input = list[i]; const at = `${location}[${i}]`;
      record(input, ['id', 'name', 'position', 'size', 'anchor', 'label', 'sprite', 'button', 'scripts', 'children'], at);
      if (names.has(input.name)) throw new Error(`${at}.name: duplicate sibling name.`);
      names.add(input.name);
      const node = { id: input.id, name: input.name, parentId, components: [],
        position: { ...pair(input.position === undefined ? { x: 0, y: 0 } : input.position, ['x', 'y'], -1000000, 1000000, `${at}.position`), z: 0 } };
      const add = (type, properties) => {
        const component = { id: `c${componentIndex++}`, type: `cc.${type}`, properties };
        node.components.push(component); return component.id;
      };
      const bind = (componentId, property, kind, id) => batch.references.push({ from: { nodeId: node.id, componentId, property }, to: { kind, id } });
      add('UITransform', { contentSize: pair(input.size, ['width', 'height'], 0.001, 8192, `${at}.size`),
        anchorPoint: pair(input.anchor === undefined ? { x: 0.5, y: 0.5 } : input.anchor, ['x', 'y'], 0, 1, `${at}.anchor`) });
      if (input.label !== undefined && input.sprite !== undefined) throw new Error(`${at}: Label and Sprite require separate nodes.`);
      if (input.label !== undefined) {
        const label = input.label; record(label, ['text', 'fontSize', 'lineHeight', 'color'], `${at}.label`);
        if (typeof label.text !== 'string') throw new Error(`${at}.label.text: expected a string.`);
        const fontSize = number(label.fontSize === undefined ? 20 : label.fontSize, 0.001, 512, `${at}.label.fontSize`);
        add('Label', { overflow: 1, fontSize, lineHeight: number(label.lineHeight === undefined ? fontSize : label.lineHeight, 0.001, 1024, `${at}.label.lineHeight`),
          string: label.text, ...(label.color === undefined ? {} : { color: color(label.color, `${at}.label.color`) }) });
      }
      if (input.sprite !== undefined) {
        const sprite = input.sprite; record(sprite, ['spriteFrame', 'color'], `${at}.sprite`);
        const id = add('Sprite', { sizeMode: 0, ...(sprite.color === undefined ? {} : { color: color(sprite.color, `${at}.sprite.color`) }) });
        bind(id, 'spriteFrame', 'asset', sprite.spriteFrame);
      }
      if (input.button !== undefined) {
        const button = input.button; record(button, ['interactable', 'target'], `${at}.button`);
        if (button.interactable !== undefined && typeof button.interactable !== 'boolean') throw new Error(`${at}.button.interactable: expected a boolean.`);
        const id = add('Button', { interactable: button.interactable === undefined ? true : button.interactable });
        buttons.set(node.id, id);
        bind(id, 'target', 'node', button.target === undefined ? node.id : button.target);
      }
      if (input.scripts !== undefined) {
        if (!Array.isArray(input.scripts) || input.scripts.length > 15) throw new Error(`${at}.scripts: expected at most 15 script declarations.`);
        for (const script of input.scripts) {
          record(script, ['id', 'scriptUuid'], `${at}.scripts`);
          if (typeof script.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(script.id) || scripts.has(script.id)) throw new Error('Script local IDs must be valid and unique across the UI.');
          const id = `c${componentIndex++}`;
          node.components.push({ id, type: 'script', scriptUuid: script.scriptUuid }); scripts.set(script.id, id);
        }
      }
      batch.nodes.push(node);
      if (parentId === null) batch.roots.push(node.id);
      if (input.children !== undefined) visit(input.children, node.id, depth + 1, `${at}.children`);
    }
  }
  visit(ui.roots, null, 1, 'ui.roots');
  if (ui.events?.length) batch.events = ui.events.map(event => {
    record(event, ['button', 'target', 'handler', 'customEventData'], 'ui.events');
    if (!buttons.has(event.button) || !scripts.has(event.target)) throw new Error('Events must name a new Button node and a declared local script ID.');
    return { buttonComponentId: buttons.get(event.button), targetComponentId: scripts.get(event.target), handler: event.handler,
      customEventData: event.customEventData === undefined ? '' : event.customEventData };
  });
  const checked = validateNodeBatch(batch);
  if (!checked.valid) throw new Error(`Invalid compiled UI: ${checked.issues.map(issue => `${issue.path}: ${issue.code}`).join('; ')}`);
  return batch;
}

async function buildUI(projectPath, sceneBridge, options) {
  let result;
  try {
    record(options, ['sceneUuid', 'parentUuid', 'ui'], 'options');
    const batch = compileUI(options.ui);
    result = await batchCreate.createNodeBatch(projectPath, sceneBridge, { sceneUuid: options.sceneUuid, parentUuid: options.parentUuid, batch });
  } catch (error) {
    result = { created: false, verified: false, phase: 'preflight', error: String(error.message || error).slice(0, 1000),
      needsSave: null, cleanup: buildCleanupReport([]) };
  }
  if (result.created && result.verified && !result.uncertain) result = await attachUIViewport(sceneBridge, result);
  return { ...result, phase: result.phase || 'complete', coordinateSpace: 'parent_local_ui',
    warnings: ['Coordinates are parent-local UI units, not screen pixels. Inspect viewport.complete and each clipping status; edit-camera geometry does not verify preview/device visibility.',
      'Create only: duplicate sibling names are refused. No automatic saving. Script constructors/lifecycle callbacks may have external effects that new-node cleanup and Undo do not restore.'] };
}

module.exports = { compileUI, buildUI };
