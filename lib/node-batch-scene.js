'use strict';

const { validateNodeBatch, remapInternalReferences, buildCleanupReport } = require('./node-batch-dto');

// Built-in property writes stay allowlisted. Project scripts are attached by
// verified asset identity only; their external side effects are not rolled back.
const FIELDS = {
  'cc.UITransform': { contentSize: 'size', anchorPoint: 'vec2' },
  'cc.Label': { string: 'string', color: 'color', fontSize: 'number', lineHeight: 'number', overflow: 'number' },
  'cc.Sprite': { color: 'color', spriteFrame: 'asset', sizeMode: 'number' },
  'cc.Button': { interactable: 'boolean', target: 'node' },
  'cc.ProgressBar': { progress: 'number', barSprite: 'component' },
};
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function createNodeBatchMethods({ cc, getScene, findNode, hasLinkedPrefabAncestor,
  convertEditableComponentValue, componentRuntimeValue, loadAssetByUuid,
  resolveScriptClass, resolveButtonEventMethod, getEventHandlerComponentName }) {
  const typeFor = name => cc[name.slice(3)];
  const referenceClass = kind => ({ node: cc.Node, component: cc.Sprite, asset: cc.SpriteFrame }[kind]);
  const valid = node => cc.isValid(node);

  function uiContext(parent, scene) {
    let canvasNode = parent;
    while (canvasNode && !canvasNode.getComponent(cc.Canvas)) canvasNode = canvasNode.parent;
    const canvas = canvasNode?.getComponent(cc.Canvas);
    const camera = canvas?.cameraComponent;
    if (!parent.activeInHierarchy || !parent.getComponent(cc.UITransform) || !canvas?.enabledInHierarchy ||
        !(camera instanceof cc.Camera) || !valid(camera) || !camera.enabledInHierarchy || camera.targetTexture ||
        parent.layer === 0 || ((camera.visibility & parent.layer) >>> 0) !== (parent.layer >>> 0)) throw new Error('UI requires an active UITransform parent and Canvas with an enabled associated screen camera whose visibility includes the inherited node layer.');
    let ancestor = camera.node;
    for (; ancestor && ancestor !== scene; ancestor = ancestor.parent) {
      if (ancestor._objFlags & (cc.CCObjectFlags?.DontSave || 8)) throw new Error('UI camera must not be an editor-only node.');
    }
    if (ancestor !== scene) throw new Error('UI camera must belong to the active scene.');
    return { canvasUuid: canvasNode.uuid, cameraUuid: camera.uuid, cameraNodeUuid: camera.node.uuid, cameraVisibility: camera.visibility };
  }

  async function prepare(options) {
    const checked = validateNodeBatch(options.batch);
    if (!checked.valid) throw new Error(`Invalid node batch: ${checked.issues.map(i => `${i.path}: ${i.code}`).join('; ')}`);
    const { batch } = options;
    if (checked.plan.referencePlan.some(ref => ref.action === 'resolve_later')) throw new Error('External resolve is not supported by batch creation.');
    const scene = getScene();
    const parent = findNode({ uuid: options.parentUuid });
    if (scene.uuid !== options.sceneUuid || !parent || !valid(parent)) throw new Error('Scene or exact parent UUID does not match the active scene.');
    let canvas = null;
    let ancestor = parent;
    for (; ancestor; ancestor = ancestor.parent) {
      if (ancestor._objFlags & (cc.CCObjectFlags?.DontSave || 8)) throw new Error('Editor-only parents are not supported.');
      if (ancestor.getComponent(cc.Canvas)) canvas = ancestor;
      if (ancestor === scene) break;
    }
    if (ancestor !== scene || hasLinkedPrefabAncestor(parent, scene)) throw new Error('Parent must be an ordinary node in the expected scene, not a prefab hierarchy.');
    if (cc.Layout && parent.getComponent(cc.Layout)?.enabled) throw new Error('A parent with enabled Layout is not supported.');
    if (parent.children.length > 2000) throw new Error('Parent child scan exceeds 2000 nodes.');
    const context = { sceneUuid: scene.uuid, parentUuid: parent.uuid, layer: parent.layer,
      canvasUuid: canvas?.uuid || null, children: parent.children.map(n => ({ uuid: n.uuid, name: n.name })) };
    if (batch.ui) {
      context.uiContext = uiContext(parent, scene);
      context.canvasUuid = context.uiContext.canvasUuid;
    }
    const names = new Set(parent.children.map(n => `${null}:${n.name}`));
    const components = new Map();
    const classes = new Map(), scriptClasses = [], assets = [];
    const values = [];
    for (const node of batch.nodes) {
      const key = `${node.parentId}:${node.name}`;
      if (names.has(key)) throw new Error(`Sibling name conflict: ${node.name}`);
      names.add(key);
      const types = new Set();
      const nodeClasses = [];
      for (const component of node.components) {
        const script = component.type === 'script';
        const fields = script ? {} : Object.hasOwn(FIELDS, component.type) ? FIELDS[component.type] : null;
        const cls = script ? resolveScriptClass?.(component.scriptUuid) : typeFor(component.type);
        if (!fields || typeof cls !== 'function' || !(cls.prototype instanceof cc.Component)) throw new Error(script
          ? `Project script has no registered Component class: ${component.scriptUuid}. Check compilation diagnostics.` : `Unsupported batch component: ${component.type}`);
        if (nodeClasses.some(other => cls === other || cls.prototype instanceof other || other.prototype instanceof cls)) throw new Error(`Duplicate or overlapping component type: ${component.type}`);
        nodeClasses.push(cls); classes.set(component.id, cls);
        types.add(component.type);
        components.set(component.id, { ...component, nodeId: node.id });
        if (script) {
          const className = cc.js.getClassName(cls);
          if (typeof className !== 'string' || !/^[A-Za-z_$][\w.$-]{0,127}$/.test(className) || cc.js.getClassByName(className) !== cls) throw new Error('Script needs an unambiguous registered component name.');
          scriptClasses.push({ id: component.id, scriptUuid: component.scriptUuid, className });
          assets.push({ id: component.scriptUuid, type: 'cc.Script' });
        }
        for (const [property, input] of Object.entries(component.properties || {})) {
          const kind = Object.hasOwn(fields, property) ? fields[property] : null;
          if (!kind) throw new Error(`Unsupported batch property: ${component.type}.${property}`);
          if (['asset', 'node', 'component'].includes(kind) && input !== null) throw new Error('Object references must use the explicit references array.');
          if (component.type === 'cc.Button' && property === 'target') throw new Error('Button.target cannot stay null after activation; use an explicit internal node reference.');
          if (component.type === 'cc.ProgressBar' && property === 'progress' && (input < 0 || input > 1)) throw new Error('Progress must be between 0 and 1.');
          if (component.type === 'cc.Label' && ['fontSize', 'lineHeight'].includes(property) &&
              (!Number.isFinite(input) || input <= 0 || input > (property === 'fontSize' ? 512 : 1024))) throw new Error('Label fontSize/lineHeight must be positive bounded numbers.');
          if (component.type === 'cc.Label' && property === 'overflow' && input !== 1) throw new Error('Only Label CLAMP overflow (1) is supported by batches.');
          if (component.type === 'cc.Sprite' && property === 'sizeMode' && input !== 0) throw new Error('Only Sprite CUSTOM sizeMode (0) is supported by batches.');
          const value = await convertEditableComponentValue({ kind, expectedClass: referenceClass(kind) }, input);
          values.push({ componentId: component.id, property, value });
        }
      }
      if (types.size && (!canvas || !types.has('cc.UITransform'))) throw new Error('UI batches require an existing Canvas ancestor and an explicit UITransform on each component-bearing node.');
      if (types.has('cc.Label') && types.has('cc.Sprite')) throw new Error('Label and Sprite cannot share the same batch node.');
      if (batch.ui && (!types.has('cc.UITransform') || node.components.some(component =>
        component.type === 'cc.Label' && component.properties?.overflow !== 1 ||
        component.type === 'cc.Sprite' && component.properties?.sizeMode !== 0))) throw new Error('Strict UI batches require UITransform and explicit Label CLAMP / Sprite CUSTOM dimensions.');
    }
    if (scriptClasses.length) context.scriptClasses = scriptClasses;
    if (batch.events?.length && !(cc.Component.EventHandler || cc.EventHandler)) throw new Error('Cocos EventHandler is unavailable.');
    for (const event of batch.events || []) {
      if (!resolveButtonEventMethod(classes.get(event.targetComponentId).prototype, event.handler)) throw new Error(`Event method is missing or reserved: ${event.handler}`);
    }
    for (const ref of checked.plan.referencePlan) {
      const owner = components.get(ref.sourceComponentId);
      const kind = FIELDS[owner.type]?.[ref.property];
      if (!['node', 'component', 'asset'].includes(kind) ||
          ref.targetKind !== 'external' && ref.targetKind !== kind) throw new Error(`Reference type does not match ${owner.type}.${ref.property}.`);
      if (owner.type === 'cc.Button' && ref.action === 'clear') throw new Error('Button.target cannot stay null after activation; external clear is not supported for this field.');
      if (kind === 'component' && ref.targetKind === 'component' && components.get(ref.targetId).type !== 'cc.Sprite') throw new Error('barSprite must reference a batch Sprite component.');
      if (kind === 'asset' && ref.targetKind === 'asset') assets.push({ id: ref.targetId, type: 'cc.SpriteFrame' });
    }
    return { scene, parent, context, components, classes, values, plan: checked.plan, assets };
  }

  async function preflightNodeBatch(options) {
    const prepared = await prepare(options);
    return { ...prepared.context, assetReferences: prepared.assets };
  }

  async function createNodeBatch(options) {
    const created = [];
    const parents = new Map();
    const nodes = new Map();
    const components = new Map();
    const identities = { nodes: Object.create(null), components: Object.create(null) };
    const scriptReport = options.batch?.nodes?.some(node => node.components?.some(c => c.type === 'script')) ? { scriptEffects: 'not_audited' } : {};
    let phase = 'preflight';
    try {
      const prepared = await prepare(options);
      const { scene, parent, plan, values } = prepared;
      if (!same({ ...prepared.context, assetReferences: prepared.assets }, options.expected)) throw new Error('Target changed since batch preflight.');
      const assets = new Map();
      for (const expected of prepared.assets) {
        if (assets.has(expected.id)) continue;
        const resolved = options.assets.find(asset => asset.id === expected.id);
        if (!resolved || resolved.type !== expected.type) throw new Error('Missing verified asset mapping.');
        if (expected.type === 'cc.Script') {
          if (resolved.uuid !== expected.id) throw new Error('Script asset UUID mapping changed.');
          continue; // Imported scripts are already registered; never load/execute source here.
        }
        let timer;
        try {
          const asset = await Promise.race([loadAssetByUuid(resolved.uuid), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Asset load timed out; no nodes were created.')), 10000);
          })]);
          if (!(asset instanceof cc.SpriteFrame) || asset.uuid !== resolved.uuid) throw new Error('Loaded asset identity or type does not match.');
          assets.set(expected.id, asset);
        } finally { clearTimeout(timer); }
      }
      if (getScene() !== scene || !same(await preflightNodeBatch(options), options.expected)) throw new Error('Target changed while preparing the batch.');
      for (const script of prepared.context.scriptClasses || []) {
        if (resolveScriptClass(script.scriptUuid) !== prepared.classes.get(script.id)) throw new Error('Script registration changed before creation.');
      }
      phase = 'create';
      const definitions = new Map(options.batch.nodes.map(node => [node.id, node]));
      for (const id of plan.creationOrder) {
        const definition = definitions.get(id);
        const node = new cc.Node(definition.name);
        created.push(node);
        nodes.set(id, node);
        identities.nodes[id] = node.uuid;
        node.active = false;
        node.layer = parent.layer;
        const owner = definition.parentId === null ? parent : nodes.get(definition.parentId);
        parents.set(node, owner);
        node.parent = owner;
        if (definition.position) node.setPosition(definition.position.x, definition.position.y, definition.position.z);
        // Explicit UITransform first avoids hidden automatic dependency creation.
        const rank = type => type === 'cc.UITransform' ? 0 : type === 'script' ? 2 : 1;
        const ordered = definition.components.slice().sort((a, b) => rank(a.type) - rank(b.type));
        for (const definition of ordered) {
          const cls = prepared.classes.get(definition.id);
          const component = node.addComponent(cls);
          if (!component || component.node !== node || component.constructor !== cls) throw new Error('Creator did not attach the requested component.');
          components.set(definition.id, component);
          identities.components[definition.id] = component.uuid;
        }
        if (node.components.length !== definition.components.length) throw new Error('Creator added undeclared component dependencies.');
      }
      phase = 'properties';
      for (const edit of values) components.get(edit.componentId)[edit.property] = edit.value;
      phase = 'references';
      const references = remapInternalReferences(plan.referencePlan, identities).map(ref => ({ ...ref,
        value: ref.action === 'clear' ? null : ref.targetKind === 'asset' ? assets.get(ref.targetId)
          : ref.targetKind === 'node' ? nodes.get(ref.targetId) : components.get(ref.targetId) }));
      for (const ref of references) components.get(ref.sourceComponentId)[ref.property] = ref.value;
      if (options.batch.events?.length) phase = 'events';
      const eventGroups = new Map();
      for (const definition of options.batch.events || []) {
        const button = components.get(definition.buttonComponentId), target = components.get(definition.targetComponentId);
        if (!resolveButtonEventMethod(target, definition.handler)) throw new Error(`Event method changed: ${definition.handler}`);
        if (!eventGroups.has(button)) {
          if (!Array.isArray(button.clickEvents) || button.clickEvents.length) throw new Error('New Button already has undeclared click events.');
          eventGroups.set(button, []);
        }
        const Handler = cc.Component.EventHandler || cc.EventHandler;
        const event = new Handler(); event.target = target.node; event.component = cc.js.getClassName(target.constructor);
        event.handler = definition.handler; event.customEventData = definition.customEventData ?? '';
        eventGroups.get(button).push({ event, target, definition });
      }
      for (const [button, entries] of eventGroups) button.clickEvents = entries.map(entry => entry.event);
      // Apply authored UI dimensions after renderer settings/assets that can
      // otherwise resize their UITransform while components are configured.
      if (options.batch.ui) for (const edit of values) {
        if (prepared.components.get(edit.componentId).type === 'cc.UITransform') components.get(edit.componentId)[edit.property] = edit.value;
      }
      for (const node of created) node.active = true;
      phase = 'verify';
      await pause();
      if (getScene() !== scene || !valid(parent)) throw new Error('Scene changed during batch creation.');
      const oldChildren = parent.children.filter(n => !created.includes(n)).map(n => ({ uuid: n.uuid, name: n.name }));
      if (!same(oldChildren, prepared.context.children) || parent.layer !== prepared.context.layer) throw new Error('Existing parent changed during batch creation.');
      if (options.batch.ui && !same(uiContext(parent, scene), prepared.context.uiContext)) throw new Error('UI Canvas/Camera context changed during creation.');
      for (const [id, node] of nodes) {
        const definition = definitions.get(id);
        const children = options.batch.nodes.filter(n => n.parentId === id).map(n => nodes.get(n.id));
        if (!valid(node) || node.parent !== parents.get(node) || node.name !== definition.name || !node.active || node.layer !== parent.layer ||
            node.children.length !== children.length || children.some((child, index) => node.children[index] !== child) ||
            node.components.length !== definition.components.length || definition.components.some(c => !node.components.includes(components.get(c.id)))) throw new Error('Created hierarchy or component identity did not persist.');
        if (definition.position && !['x', 'y', 'z'].every(axis => node.position[axis] === definition.position[axis])) throw new Error(`Position readback failed: ${id}`);
      }
      for (const edit of values) {
        if (!same(componentRuntimeValue(components.get(edit.componentId)[edit.property]), componentRuntimeValue(edit.value))) throw new Error(`Property readback failed: ${edit.componentId}.${edit.property}`);
      }
      for (const ref of references) if (components.get(ref.sourceComponentId)[ref.property] !== ref.value) throw new Error(`Reference readback failed: ${ref.sourceComponentId}.${ref.property}`);
      for (const script of prepared.context.scriptClasses || []) {
        if (resolveScriptClass(script.scriptUuid) !== prepared.classes.get(script.id) || cc.js.getClassName(prepared.classes.get(script.id)) !== script.className) throw new Error('Script registration changed during creation.');
      }
      for (const [button, entries] of eventGroups) {
        if (button.clickEvents.length !== entries.length || entries.some(({ target, definition }, i) => {
          const event = button.clickEvents[i];
          return !event || event.target !== target.node || getEventHandlerComponentName(event) !== cc.js.getClassName(target.constructor) ||
            event.handler !== definition.handler || event.customEventData !== (definition.customEventData ?? '') || !resolveButtonEventMethod(target, definition.handler);
        })) throw new Error('Button event readback failed.');
      }
      return { created: true, verified: true, needsSave: true, sceneUuid: scene.uuid, parentUuid: parent.uuid,
        ...scriptReport, eventCount: (options.batch.events || []).length,
        identities, rootUuids: plan.rootIds.map(id => nodes.get(id).uuid), nodeCount: nodes.size, componentCount: components.size,
        referenceCount: references.length, ...(prepared.context.uiContext ? { uiContext: prepared.context.uiContext } : {}),
        undo: { supported: false, recorded: false }, cleanup: buildCleanupReport([]) };
    } catch (error) {
      const cleanupErrors = [];
      for (const node of created.slice().reverse()) {
        if (!valid(node)) continue;
        try {
          // Children are processed first. Any remaining child (including an owned
          // child whose cleanup was refused) must not be destroyed recursively.
          if (node.parent && node.parent !== parents.get(node) || node.children.length) throw new Error('Ownership changed; refusing to remove this node.');
          node.removeFromParent();
          node.destroy();
        } catch (cleanupError) { cleanupErrors.push({ uuid: node.uuid, error: String(cleanupError.message || cleanupError).slice(0, 500) }); }
      }
      for (let attempt = 0; created.some(valid) && attempt < 20; attempt += 1) await pause();
      const cleanup = buildCleanupReport(created.map(node => node.uuid), Object.fromEntries(created.map(node => [node.uuid, !valid(node)])));
      return { created: false, verified: false, needsSave: null,
        ...scriptReport,
        phase, error: String(error.message || error).slice(0, 1000), identities,
        undo: { supported: false, recorded: false }, cleanup: { ...cleanup, errors: cleanupErrors } };
    }
  }
  return { preflightNodeBatch, createNodeBatch };
}

module.exports = { createNodeBatchMethods };
