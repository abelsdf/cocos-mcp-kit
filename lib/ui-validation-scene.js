'use strict';
const { validateViewportOptions } = require('./ui-viewport-scene');

const RULES = ['ui_transform', 'design_bounds', 'sprite_frame', 'label_font', 'button_events', 'widget_animation'];
function validateUIOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['sceneUuid', 'nodeUuids', 'exclude', 'maxFindings'].includes(k))) throw new Error('Invalid UI validation options.');
  validateViewportOptions({ sceneUuid: options.sceneUuid, nodeUuids: options.nodeUuids });
  const exclude = options.exclude ?? [], maxFindings = options.maxFindings ?? 50;
  if (!Array.isArray(exclude) || exclude.length > 32 || !Number.isInteger(maxFindings) || maxFindings < 1 || maxFindings > 100) throw new Error('exclude requires at most 32 rules; maxFindings requires 1..100.');
  for (const item of exclude) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['rule', 'nodeUuid'].includes(k)) ||
        !RULES.includes(item.rule) || (item.nodeUuid !== undefined && !options.nodeUuids.includes(item.nodeUuid))) throw new Error('Exclusions require a known rule and optional requested nodeUuid.');
  }
  return { sceneUuid: options.sceneUuid, nodeUuids: options.nodeUuids.slice(), exclude: exclude.map(e => ({ ...e })), maxFindings };
}

function createUIValidationMethods({ cc, getScene, findNode, getEventHandlerComponentName, findComponent, resolveButtonEventMethod }) {
  function member(node, scene) {
    if (!node || !cc.isValid(node)) return false;
    for (let current = node; current; current = current.parent) {
      if (current._objFlags & (cc.CCObjectFlags?.DontSave || 8)) return false;
      if (current === scene) return true;
    }
    return false;
  }
  function inspectUIValidation(options) {
    const input = validateUIOptions(options), scene = getScene();
    if (scene.uuid !== input.sceneUuid) throw new Error('UI validation scene identity changed.');
    const nodes = input.nodeUuids.map(nodeUuid => {
      const row = { nodeUuid, name: '', findings: [], assets: [] };
      const add = (rule, code, message, suggestion, extra = {}) => row.findings.push({ rule, code, severity: 'error', status: 'failed', message, suggestion, ...extra });
      const node = findNode({ uuid: nodeUuid });
      if (!member(node, scene) || node === scene) {
        row.unavailable = true;
        add('ui_transform', 'node_not_found', 'Requested node is not saved scene content.', 'Refresh the exact node UUID.');
        return row;
      }
      row.name = String(node.name).slice(0, 128);
      const ui = node.getComponent(cc.UITransform);
      if (!ui) add('ui_transform', 'missing_ui_transform', 'UITransform is missing.', 'Confirm this is an intended UI node; add UITransform explicitly or exclude the rule.');
      else if (![ui.contentSize.width, ui.contentSize.height, ui.anchorPoint.x, ui.anchorPoint.y].every(Number.isFinite) || ui.contentSize.width <= 0 || ui.contentSize.height <= 0) {
        add('ui_transform', 'invalid_ui_rectangle', 'UI size must be finite and positive; anchors must be finite.', 'Check the intended UI size and anchor.');
      }
      function asset(component, property, rule, expectedType) {
        const value = component[property];
        if (!value || !cc.isValid(value)) add(rule, 'missing_asset', `${property} has no valid asset.`, 'Assign an imported asset of the expected type and verify save/reopen.', { componentUuid: component.uuid });
        else row.assets.push({ rule, property, componentUuid: component.uuid, uuid: value._uuid || '', expectedType });
      }
      const sprite = node.getComponent(cc.Sprite), label = node.getComponent(cc.Label), button = node.getComponent(cc.Button);
      if (sprite) asset(sprite, 'spriteFrame', 'sprite_frame', 'cc.SpriteFrame');
      if (label && !label.useSystemFont) asset(label, 'font', 'label_font', 'cc.Font');
      if (button) {
        if (button.target && !member(button.target, scene)) add('button_events', 'invalid_visual_target', 'Button visual target is outside this scene or invalid.', 'Check Button.target separately from click event targets.');
        const events = button.clickEvents;
        if (!Array.isArray(events)) add('button_events', 'invalid_event_list', 'Button clickEvents is not an array.', 'Inspect the serialized Button events.');
        else {
          if (events.length > 32) add('button_events', 'event_limit', 'Only the first 32 click events are inspected.', 'Inspect a smaller event list separately.', { status: 'not_checked', severity: 'warning' });
          if (!events.length && button.interactable) add('button_events', 'no_serialized_events', 'Interactive Button has no serialized click events; runtime listeners are not inspected.', 'Confirm runtime registration or add a serialized binding; exclude if intentional.', { severity: 'warning' });
          for (const [eventIndex, event] of events.slice(0, 32).entries()) {
            try {
              if (!event || !member(event.target, scene)) throw Error('Event target is missing or outside this scene.');
              const componentName = getEventHandlerComponentName(event);
              const target = componentName && findComponent(event.target, { componentName });
              if (!target || !cc.isValid(target)) throw Error('Event receiver component is missing or ambiguous.');
              if (typeof event.handler !== 'string' || !resolveButtonEventMethod(target, event.handler)) throw Error('Event handler is missing, an accessor, or outside the supported project-method policy.');
            } catch (error) { add('button_events', 'invalid_event', String(error.message).slice(0, 200), 'Inspect target, registered component and declared handler; do not invoke it to validate.', { eventIndex, componentUuid: button.uuid }); }
          }
        }
      }
      const widget = node.getComponent(cc.Widget);
      if (widget?.enabledInHierarchy && widget.alignMode === cc.Widget.AlignMode.ALWAYS) {
        for (let parent = node; parent; parent = parent.parent) {
          const animation = parent.getComponent(cc.Animation);
          if (animation?.enabledInHierarchy && animation.clips?.length) {
            add('widget_animation', 'potential_animation_conflict', 'ALWAYS Widget and an enabled ancestor/self Animation with clips coexist; affected tracks are not inspected.',
              'Review position/size tracks; consider ONCE or animating Widget margins, with an explicit adaptation tradeoff.', { status: 'not_checked', severity: 'warning' });
            break;
          }
          if (parent === scene) break;
        }
      }
      return row;
    });
    return { sceneUuid: scene.uuid, nodes };
  }
  return { inspectUIValidation };
}

module.exports = { RULES, validateUIOptions, createUIValidationMethods };
