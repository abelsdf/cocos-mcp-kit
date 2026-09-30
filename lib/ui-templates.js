'use strict';

const { compileUI } = require('./ui-builder');

const TEMPLATES = {
  pause_menu: { name: 'PauseMenu', title: '暂停菜单', message: '请选择下一步操作', actions: { resume: '继续游戏', restart: '重新开始', quit: '返回菜单' } },
  settings_dialog: { name: 'SettingsDialog', title: '设置', message: '选择要调整的偏好', actions: { music: '音乐设置', sound: '音效设置', close: '关闭' } },
  result_dialog: { name: 'ResultDialog', title: '本局结果', message: '在此填写得分或结果说明', actions: { retry: '再玩一次', continue: '继续' } },
};

function record(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${location}: expected a plain object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${location}.${key}: unsupported field.`);
}

// Original data-only templates. No editor API, bundled art, script generation or
// second mutation route: callers inspect/edit the result, then invoke build_ui.
function getUITemplate(options) {
  record(options, ['template', 'spriteFrame', 'name', 'size', 'texts', 'colors', 'controller'], 'options');
  if (typeof options.template !== 'string' || !Object.prototype.hasOwnProperty.call(TEMPLATES, options.template)) throw new Error('template must be pause_menu, settings_dialog or result_dialog.');
  const frame = options.spriteFrame;
  if (typeof frame !== 'string' || frame !== frame.trim() || frame.length > 2048 ||
      !(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[A-Za-z0-9_-]+)?$/i.test(frame) ||
        frame.startsWith('db://assets/') && frame.slice(12).split('/').every(part => part && !['.', '..'].includes(part)) && !/[\\?#]/.test(frame))) throw new Error('spriteFrame requires an exact project db://assets URL or canonical UUID.');
  if (options.name !== undefined && (typeof options.name !== 'string' || !options.name || options.name !== options.name.trim() || options.name.length > 128 || /[/\\]/.test(options.name))) throw new Error('name requires 1..128 characters without slashes or surrounding whitespace.');
  const definition = TEMPLATES[options.template], actionIds = Object.keys(definition.actions);
  const size = options.size === undefined ? { width: 480, height: 480 } : options.size;
  record(size, ['width', 'height'], 'size');
  if (!Number.isFinite(size.width) || size.width < 240 || size.width > 2048 || !Number.isFinite(size.height) || size.height < 400 || size.height > 2048) throw new Error('Template size requires width 240..2048 and height 400..2048.');
  const texts = options.texts === undefined ? {} : options.texts;
  record(texts, ['title', 'message', ...actionIds], 'texts');
  for (const [key, value] of Object.entries(texts)) if (typeof value !== 'string' || value.length > 512) throw new Error(`texts.${key}: expected a string of at most 512 characters.`);
  const colors = options.colors === undefined ? {} : options.colors;
  record(colors, ['panel', 'button', 'text'], 'colors');
  const palette = { panel: { r: 32, g: 40, b: 56, a: 255 }, button: { r: 54, g: 104, b: 190, a: 255 }, text: { r: 255, g: 255, b: 255, a: 255 }, ...colors };
  // Validate supplied palette entries even if a caller provides malformed values;
  // spreading a primitive/null would otherwise conceal the invalid input.
  for (const [key, value] of Object.entries(palette)) {
    record(value, ['r', 'g', 'b', 'a'], `colors.${key}`);
    if (!['r', 'g', 'b', 'a'].every(c => Number.isInteger(value[c]) && value[c] >= 0 && value[c] <= 255)) throw new Error(`colors.${key}: expected integer RGBA channels 0..255.`);
  }
  let bindings = {};
  if (options.controller !== undefined) {
    record(options.controller, ['scriptUuid', 'bindings'], 'controller');
    bindings = options.controller.bindings;
    record(bindings, actionIds, 'controller.bindings');
    if (!Object.keys(bindings).length) throw new Error('controller.bindings must bind at least one action.');
    for (const [action, binding] of Object.entries(bindings)) record(binding, ['handler', 'customEventData'], `controller.bindings.${action}`);
  }
  const label = (id, name, text, width, height, y, fontSize) => ({ id, name, size: { width, height }, position: { x: 0, y },
    label: { text, fontSize, lineHeight: fontSize + 4, color: { ...palette.text } } });
  const width = size.width - 48;
  const root = { id: 'panel', name: options.name === undefined ? definition.name : options.name, size: { ...size },
    sprite: { spriteFrame: options.spriteFrame, color: { ...palette.panel } }, children: [
      label('title', 'Title', texts.title ?? definition.title, width, 48, size.height / 2 - 48, 32),
      label('message', 'Message', texts.message ?? definition.message, width, 64, size.height / 2 - 110, 20),
    ] };
  const ui = { schemaVersion: 1, mode: 'create', failurePolicy: 'cleanup_new_nodes', roots: [root], events: [] };
  if (options.controller !== undefined) root.scripts = [{ id: 'controller', scriptUuid: options.controller.scriptUuid }];
  for (const [index, action] of actionIds.entries()) {
    const binding = Object.prototype.hasOwnProperty.call(bindings, action) ? bindings[action] : null;
    const caption = label(`${action}_label`, 'Caption', texts[action] ?? definition.actions[action], width - 24, 44, 0, 22);
    if (!binding) caption.label.color = { r: 203, g: 213, b: 225, a: palette.text.a };
    root.children.push({ id: action, name: action, size: { width, height: 52 },
      position: { x: 0, y: -size.height / 2 + 58 + (actionIds.length - 1 - index) * 68 },
      sprite: { spriteFrame: options.spriteFrame, color: binding ? { ...palette.button } : { r: 75, g: 85, b: 99, a: palette.button.a } }, button: { interactable: Boolean(binding) },
      children: [caption] });
    if (binding) ui.events.push({ button: action, target: 'controller', handler: binding.handler,
      customEventData: binding.customEventData === undefined ? action : binding.customEventData });
  }
  compileUI(ui);
  return { template: options.template, ui, actions: actionIds.map(id => ({ id, nodeId: id, bound: Object.prototype.hasOwnProperty.call(bindings, id) })),
    validation: { schema: 'passed', resources: 'not_checked', scene: 'not_checked' },
    warnings: ['Data only: inspect/edit ui, then pass it to build_ui with an explicit sceneUuid and parentUuid. Assets and script methods are checked only at build time.',
      'Unbound actions are disabled with muted initial colors. Manually enabling them also requires restoring Sprite/Label colors. Templates do not implement game pause, audio settings, rewards, input blocking or navigation. Supply project callbacks.',
      'Use a project-owned white SpriteFrame for solid colors. Fixed local layout; long text, custom art and viewport fit require visual review. No automatic save or scene switching.'] };
}

module.exports = { getUITemplate };
