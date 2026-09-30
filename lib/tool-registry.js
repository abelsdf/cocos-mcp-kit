'use strict';

const { getSkillProjectPath } = require('./skill-platforms');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  clearSelection,
  deleteAsset,
  findAssetByName,
  getCurrentSelection,
  inspectAsset,
  listAssets,
  openAsset,
  queryAssetData,
  queryAssetInfo,
  queryAssetMeta,
  searchAssets,
  selectAsset,
  selectNode,
} = require('./assets');
const { runScriptDiagnostics } = require('./diagnostics');
const { listWindows, sendKeyCombo, sendKeyPress, sendMouseClick, sendMouseDrag } = require('./input');
const {
  clearProjectLogFiles,
  getRecentProjectLogs,
  searchProjectLogs,
} = require('./logs');
const { resolveProjectPath } = require('./path-safety');
const { resolveSpriteFrameTarget } = require('./asset-resolution');
const { checkAssetReady } = require('./asset-readiness');
const { queryAssetPath } = require('./asset-path');
const { queryAssetUuid } = require('./asset-uuid');
const { queryAssetUrl } = require('./asset-url');
const { getProjectInfo } = require('./project-info');
const { getBackendCapabilities } = require('./backend-capabilities');
const { validateNodeBatch } = require('./node-batch-dto');
const { createNodeBatch } = require('./node-batch-create');
const { copyNodesBetweenScenes, finalizeCrossSceneCut } = require('./node-cross-scene-transfer');
const { buildUI } = require('./ui-builder');
const { getUITemplate } = require('./ui-templates');
const { getUIViewport, attachUIViewport } = require('./ui-viewport');
const { validateUI, RULES: UI_VALIDATION_RULES } = require('./ui-validation');
const { verifyUI } = require('./ui-verification');
const { UI_2D_LAYER, assertSerializedPrefabMetadata } = require('./prefab-metadata');
const { createScene, openSceneSafely } = require('./scenes');
const {
  createCocosMcpProjectSkill,
  createProjectSkill,
  listProjectInstructions,
  readProjectInstruction,
  writeProjectInstruction,
} = require('./project-instructions');
const { writeManagedSkillManifest } = require('./project-skills');
const {
  applyPrefabInstance,
  duplicatePrefab,
  editPrefabJson,
  enterPrefabEditMode,
  exitPrefabEditMode,
  inspectPrefab,
  normalizePrefabTarget,
  revertPrefabInstance,
  savePrefabEditMode,
  savePrefabContent,
  testPrefabEditMode,
  unlinkPrefabInstance,
  validateSerializedPrefabAssetReferences,
  validatePrefabReferences,
} = require('./prefabs');
const { createAssetsAdvancedTools } = require('./tools/assets-advanced');
const { createCocosProjectTools } = require('./tools/cocos-project');
const { buildSnippet, createFileTools } = require('./tools/files');
const { createReferenceImageTools } = require('./tools/reference-images');
const { createSceneViewTools } = require('./tools/scene-view');
const { createSceneEventTools } = require('./tools/scene-events');
const { captureDesktopScreenshot, captureEditorWindowScreenshot, capturePanelScreenshot } = require('./screenshots');
const { checkForUpdate } = require('./update-checker');
const { assertJavascriptSafety } = require('./javascript-safety');
const { safeStringify } = require('./utils');
const { SCRIPT_EXECUTION_PACKET } = require('./script-execution');
const previewRuntime = require('./preview-runtime');
const IMAGE_DATA_URI_PREFIX = 'data:image/png;base64,';

const TOOL_CATEGORY_RULES = [
  ['project', /^(get_project_info|get_editor_state|get_tool_catalog|get_backend_capabilities)$/],
  ['build', /^(get_build_status|get_preview_mode|set_preview_mode|open_build_panel|run_project_preview|save_current_scene)$/],
  ['preferences', /preference/],
  ['broadcast', /broadcast/],
  ['events', /event|bind_button_click|button_click/],
  ['updates', /update/],
  ['logs', /log/],
  ['diagnostics', /diagnostic|validate/],
  ['screenshots', /screenshot|capture/],
  ['input', /mouse|key|input|button_click/],
  ['files', /file|directory|exists|refresh_assets/],
  ['reference-images', /reference_image/],
  ['scene-view', /scene_view|gizmo/],
  ['assets', /asset|scene$|scenes|open_scene|run_scene_asset/],
  ['prefabs', /prefab/],
  ['instructions', /instruction|skill/],
  ['selection', /selection|select_/],
  ['components', /component/],
  ['ui', /canvas|label|button|sprite/],
  ['camera', /camera/],
  ['animation', /animation|clip/],
  ['runtime', /runtime|time_scale|node_event|invoke_component/],
  ['scene', /scene|hierarchy|node/],
  ['execution', /execute_/],
];

function createSchema(properties, required) {
  const schema = {
    type: 'object',
    properties,
  };
  if (required && required.length) {
    schema.required = required;
  }
  return schema;
}

function createOutputSchema(dataSchema = {}) {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'Whether the tool call completed successfully.' },
      tool: { type: 'string', description: 'Tool name that produced this result.' },
      callId: { type: 'string', description: 'Stable identifier for this tool call result.' },
      timestamp: { type: 'string', description: 'ISO timestamp when the result envelope was produced.' },
      summary: { type: 'string', description: 'Short human-readable result summary.' },
      data: dataSchema,
      execution: {
        type: 'object',
        description: 'Script-only execution metadata; data retains its original return shape.',
        properties: {
          context: { type: 'string' },
          durationMs: { type: 'number' },
          logs: { type: 'array', items: { type: 'object', properties: {
            level: { type: 'string' }, message: { type: 'string' },
          } } },
          logsOmitted: { type: 'number' },
        },
      },
      refs: {
        type: 'array',
        description: 'Stable references discovered in the result for follow-up tool calls.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            path: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    },
    required: ['ok', 'tool', 'callId', 'timestamp', 'data'],
  };
}

function inferToolCategory(toolName) {
  for (const [category, pattern] of TOOL_CATEGORY_RULES) {
    if (pattern.test(toolName)) {
      return category;
    }
  }
  return 'other';
}

function normalizeNameSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function normalizeCategorySet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function toolCategory(tool) {
  return tool.category || inferToolCategory(tool.name);
}

function inferToolAnnotations(tool) {
  const name = tool.name;
  const category = toolCategory(tool);
  const readOnly = /^(get|list|inspect|find|read|search|check|query|validate|exists|capture)/.test(name);
  const destructive = /(delete|remove|clear|replace|write|reset|set_|execute|run_scene|invoke|emit|simulate)/.test(name);
  const idempotent = readOnly || /^(set|select|open|pause|resume|stop|refresh)/.test(name);

  return {
    title: name
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : destructive,
    idempotentHint: idempotent,
    openWorldHint: category === 'updates',
    ...(tool.annotations || {}),
  };
}

function isToolExposed(config, tool) {
  const profile = config && config.toolProfile === 'full'
    ? 'full'
    : config && config.toolProfile === 'custom'
      ? 'custom'
      : 'core';
  const category = toolCategory(tool);
  const enabledTools = normalizeNameSet(config && config.enabledTools);
  const disabledTools = normalizeNameSet(config && config.disabledTools);
  const enabledCategories = normalizeCategorySet(config && config.enabledToolCategories);
  const disabledCategories = normalizeCategorySet(config && config.disabledToolCategories);

  let exposed = profile === 'full' || tool.profile === 'core';
  if (profile === 'custom') {
    exposed = tool.profile === 'core' || enabledTools.has(tool.name) || enabledCategories.has(category);
  } else if (enabledTools.has(tool.name) || enabledCategories.has(category)) {
    exposed = true;
  }

  if (disabledTools.has(tool.name) || disabledCategories.has(category)) {
    exposed = false;
  }

  return exposed;
}

function hashObject(value) {
  return crypto
    .createHash('sha256')
    .update(safeStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function summarizeResult(result) {
  if (typeof result === 'string') {
    if (result.startsWith(IMAGE_DATA_URI_PREFIX)) {
      return 'Image payload returned.';
    }
    return result.length > 160 ? `${result.slice(0, 160)}...` : result;
  }
  if (!result || typeof result !== 'object') {
    return String(result);
  }
  if (typeof result.summary === 'string') {
    return result.summary;
  }
  for (const key of ['message', 'path', 'url', 'sceneName', 'projectName']) {
    if (typeof result[key] === 'string' && result[key]) {
      return `${key}: ${result[key]}`;
    }
  }
  if (Number.isFinite(result.count)) {
    return `count: ${result.count}`;
  }
  return 'Structured result returned.';
}

function normalizeEnvelopeData(result) {
  if (typeof result === 'string' && result.startsWith(IMAGE_DATA_URI_PREFIX)) {
    return {
      image: true,
      mimeType: 'image/png',
      byteLength: Buffer.byteLength(result.slice(IMAGE_DATA_URI_PREFIX.length), 'base64'),
    };
  }
  return result;
}

function addRef(refs, type, id, extra = {}) {
  if (!id) {
    return;
  }
  const key = `${type}:${id}`;
  if (refs.some((ref) => ref.key === key)) {
    return;
  }
  refs.push({ key, type, id: String(id), ...extra });
}

function collectRefs(value, refs = [], depth = 0, seen = new WeakSet()) {
  if (!value || depth > 5) {
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, refs, depth + 1, seen);
    }
    return refs;
  }
  if (typeof value !== 'object') {
    return refs;
  }
  if (seen.has(value)) {
    return refs;
  }
  seen.add(value);

  const uuid = value.uuid || value.prefabUuid || value.sceneUuid || value.assetUuid;
  const pathValue = value.path || value.node || value.url;
  if (uuid) {
    addRef(refs, pathValue && String(pathValue).startsWith('db://') ? 'asset' : 'uuid', uuid, {
      path: pathValue ? String(pathValue) : undefined,
      name: value.name ? String(value.name) : undefined,
    });
  }
  if (typeof pathValue === 'string' && pathValue) {
    addRef(refs, pathValue.startsWith('db://') ? 'asset' : 'path', pathValue, {
      name: value.name ? String(value.name) : undefined,
    });
  }

  for (const item of Object.values(value)) {
    collectRefs(item, refs, depth + 1, seen);
  }
  return refs;
}

function createResultEnvelope(tool, args, result, options = {}) {
  const data = normalizeEnvelopeData(result);
  const refs = collectRefs(data).map(({ key, ...ref }) => ref);
  const timestamp = new Date().toISOString();
  const summary = options.summary || summarizeResult(result);
  const callId = `fp_${hashObject({ tool: tool.name, args: args || {}, result: data })}`;
  return {
    ok: options.ok !== false,
    tool: tool.name,
    callId,
    timestamp,
    summary,
    data,
    refs,
  };
}

function summarizeDiagnostics(result) {
  if (!result) {
    return null;
  }
  return {
    ok: Boolean(result.ok),
    tool: result.tool,
    summary: result.summary,
    diagnosticCount: Array.isArray(result.diagnostics) ? result.diagnostics.length : 0,
    diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics.slice(0, 20) : [],
  };
}

function toOutput(value) {
  if (typeof value === 'string') {
    return value;
  }
  return safeStringify(value);
}

function useJavascriptSafetyChecks(args, runtimeContext) {
  if (args && typeof args.safety_checks === 'boolean') {
    return args.safety_checks;
  }
  if (args && typeof args.safetyChecks === 'boolean') {
    return args.safetyChecks;
  }
  const config = runtimeContext && runtimeContext.config;
  if (config && typeof config.executeJavascriptSafetyChecks === 'boolean') {
    return config.executeJavascriptSafetyChecks;
  }
  return true;
}

function assertToolJavascriptSafety(args, runtimeContext) {
  if (!useJavascriptSafetyChecks(args, runtimeContext)) {
    return;
  }

  assertJavascriptSafety(args && args.code, {
    projectPath: runtimeContext && runtimeContext.projectPath,
  });
}

async function resolveNodeUuid(sceneBridge, args) {
  if (args && args.uuid) {
    return String(args.uuid);
  }
  const inspected = await sceneBridge.call('inspectNode', args || {});
  if (!inspected || !inspected.uuid) {
    throw new Error('Target node uuid could not be resolved.');
  }
  return inspected.uuid;
}

function isFinitePosition(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => ['x', 'y', 'z'].includes(key)) &&
    ['x', 'y', 'z'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function isNewPrefabNodeInScope(inspection, createdUuid, context) {
  return inspection && inspection.sceneUuid === context.sceneUuid && inspection.node &&
    inspection.node.uuid === createdUuid && inspection.node.parentUuid === context.parentUuid &&
    createdUuid !== context.parentUuid && !context.childUuids.includes(createdUuid);
}

async function inspectCreatedPrefabInstance(sceneBridge, createdUuid, expectedPrefabUuid, context, checkPosition) {
  const inspection = await sceneBridge.call('getPrefabInstanceInfo', { uuid: createdUuid });
  const prefab = inspection && inspection.prefab || {};
  const node = inspection && inspection.node || {};
  const checks = {
    newNodeInScope: Boolean(isNewPrefabNodeInScope(inspection, createdUuid, context)),
    linked: prefab.linked === true,
    assetUuidMatches: Boolean(prefab.asset) && prefab.asset.uuid === expectedPrefabUuid,
    rootUuidMatches: prefab.rootUuid === createdUuid,
    fileIdPresent: typeof prefab.fileId === 'string' && Boolean(prefab.fileId.trim()),
    instancePresent: Boolean(prefab.instance && typeof prefab.instance.fileId === 'string' && prefab.instance.fileId.trim()),
    nameMatches: node.name === context.name,
    positionMatches: !checkPosition || Boolean(isFinitePosition(node.position) &&
      ['x', 'y', 'z'].every((key) => Math.abs(node.position[key] - context.position[key]) <= 1e-5)),
  };
  const failed = Object.keys(checks).filter((key) => !checks[key]);
  if (failed.length) throw new Error(`Linked prefab verification failed (${failed.join(', ')}) for node '${createdUuid}'.`);
  return { inspection, checks };
}

async function cleanupCreatedPrefabNode(sceneBridge, createdUuid, context) {
  try {
    const inspection = await sceneBridge.call('getPrefabInstanceInfo', { uuid: createdUuid });
    if (!isNewPrefabNodeInScope(inspection, createdUuid, context)) {
      return 'Cleanup not attempted: the node is outside the verified creation scope. Inspect the hierarchy before retrying.';
    }
    await Editor.Message.request('scene', 'remove-node', { uuid: createdUuid });
    const remaining = await Editor.Message.request('scene', 'query-node', createdUuid);
    return remaining == null ? 'The created node was removed.'
      : `Cleanup not confirmed for '${createdUuid}'; inspect the hierarchy before retrying.`;
  } catch (error) {
    return `Cleanup failed for '${createdUuid}': ${error.message}. Inspect the hierarchy before retrying.`;
  }
}

async function createVerifiedPrefabInstance(sceneBridge, args) {
  if (typeof args.prefabUuid !== 'string' || !args.prefabUuid.trim()) throw new Error('prefabUuid is required.');
  for (const key of ['parentPath', 'parentUuid', 'name']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key].trim())) {
      throw new Error(`${key} must be a non-empty string.`);
    }
  }
  if (args.position !== undefined && !isFinitePosition(args.position)) {
    throw new Error('position must contain finite numeric x, y, and z values only.');
  }
  const info = await queryAssetInfo(args.prefabUuid);
  if (!info || typeof info.uuid !== 'string' || !info.uuid || info.type !== 'cc.Prefab' ||
      info.imported !== true || info.invalid === true || info.isDirectory === true) {
    throw new Error('Target must be a fully imported cc.Prefab asset.');
  }
  if (await Editor.Message.request('asset-db', 'query-ready') !== true ||
      await Editor.Message.request('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready for prefab instantiation.');
  }
  const context = await sceneBridge.call('preparePrefabInstance', { ...args, prefabUuid: info.uuid });
  if (!context || !context.sceneUuid || !context.parentUuid || !Array.isArray(context.childUuids) ||
      typeof context.name !== 'string' || !context.name || !isFinitePosition(context.position)) {
    throw new Error('Scene preflight did not return a complete prefab creation context. No node was created.');
  }
  const sceneInfo = await Editor.Message.request('asset-db', 'query-asset-info', context.sceneUuid);
  if (!sceneInfo || sceneInfo.uuid !== context.sceneUuid || sceneInfo.type !== 'cc.SceneAsset' ||
      sceneInfo.imported !== true || sceneInfo.invalid === true) {
    throw new Error('Open a saved scene (cc.SceneAsset) before instantiating; unsaved scenes and prefab editing are not supported.');
  }
  let createdUuid;
  try {
    createdUuid = await Editor.Message.request('scene', 'create-node', {
      assetUuid: info.uuid, type: 'cc.Prefab', unlinkPrefab: false,
      parent: context.parentUuid, name: context.name, nameIncrease: false, keepWorldTransform: false,
    });
  } catch (error) {
    throw new Error(`scene:create-node failed: ${error.message}. Creation may have occurred; inspect the hierarchy before retrying. No fallback was attempted.`, { cause: error });
  }
  if (typeof createdUuid !== 'string' || !createdUuid.trim()) {
    throw new Error('scene:create-node returned no node UUID. Inspect the hierarchy before retrying; no fallback was attempted.');
  }
  try {
    await inspectCreatedPrefabInstance(sceneBridge, createdUuid, info.uuid, context, false);
    // create-node position is editor placement, not a parent-local transform.
    // Native set-property also records the prefab override used when saving.
    const updated = await Editor.Message.request('scene', 'set-property', {
      uuid: createdUuid, path: 'position', dump: { type: 'cc.Vec3', value: context.position },
    });
    if (updated !== true) throw new Error('Creator did not confirm the prefab local position assignment.');
    const verification = await inspectCreatedPrefabInstance(sceneBridge, createdUuid, info.uuid, context, true);
    return {
      created: true, instantiated: true, linkedPrefab: true, verified: true, needsSave: true,
      creationMethod: 'scene:create-node', prefabUuid: info.uuid, uuid: createdUuid,
      sceneUuid: context.sceneUuid, node: verification.inspection.node,
      prefab: verification.inspection.prefab, verification: verification.checks,
    };
  } catch (error) {
    const cleanup = await cleanupCreatedPrefabNode(sceneBridge, createdUuid, context);
    throw new Error(`${error.message} ${cleanup}`, { cause: error });
  }
}

function createToolRegistry({ getRuntimeContext, getStatus, interactionLog, runtimeLog, sceneBridge, editorExecutor }) {
  const prefabInstanceSchema = createSchema({
    prefabUuid: { type: 'string', description: 'Imported prefab asset UUID, db URL, or path.' },
    parentPath: { type: 'string', description: 'Ordinary parent path; defaults to the saved scene root. UI prefabs require a Canvas ancestor; an enabled parent Layout is not supported.' },
    parentUuid: { type: 'string', description: 'Exact parent UUID. If also given, parentPath must identify the same node.' },
    name: { type: 'string', description: 'Optional non-empty instance name; defaults to the prefab root name.' },
    position: { type: 'object', description: 'Parent-local position; defaults to the prefab root position.',
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
      required: ['x', 'y', 'z'], additionalProperties: false },
  }, ['prefabUuid']);
  async function executeScript(context, args, call) {
    assertToolJavascriptSafety(args, getRuntimeContext());
    const payload = { code: args.code, args: args.args || {}, captureActivity: true };
    let packet;
    if (context === 'scene') {
      packet = await sceneBridge.call('executeCode', payload);
    } else if (context === 'editor') {
      if (typeof editorExecutor !== 'function') throw new Error('Editor JavaScript execution is unavailable.');
      packet = await editorExecutor(payload);
    } else {
      throw new Error(`Unknown execution context '${args.context}'. Expected 'scene' or 'editor'.`);
    }
    // The internal packet also transports logs on failures across scene IPC.
    // Keep support for an older scene host while an extension is being reloaded.
    if (!packet || packet.kind !== SCRIPT_EXECUTION_PACKET) return packet;
    call.execution = packet.execution;
    if (packet.error) throw new Error(packet.error.message);
    return packet.value;
  }
  const tools = [
    {
      name: 'execute_javascript',
      profile: 'core',
      description: '[primary] Execute JavaScript in either the scene or editor context. Use context=\"scene\" for live scene/runtime inspection and mutation, or context=\"editor\" for Editor APIs, asset-db workflows, MCP orchestration, local filesystem access, and higher-level automation. Prefer this as the main flexible tool when many narrow tools would be noisy.',
      inputSchema: createSchema(
        {
          context: { type: 'string', description: 'Execution context: scene or editor.' },
          code: { type: 'string', description: 'JavaScript code to execute. May directly return a value, define run(env), or export a function.' },
          args: { type: 'object', description: 'Optional JSON object passed into the script.' },
          safety_checks: { type: 'boolean', description: 'Override the project default JavaScript safety checks for this call.' },
        },
        ['context', 'code']
      ),
      handler: async (args, call) => executeScript(String(args.context || '').toLowerCase(), args, call),
    },
    {
      name: 'execute_scene_script',
      profile: 'core',
      description: '[compat] Execute JavaScript in the active Cocos scene context. Prefer execute_javascript with context="scene" as the main unified tool; use this when you specifically want the scene-only compatibility entrypoint.',
      inputSchema: createSchema(
        {
          code: { type: 'string', description: 'JavaScript code to execute inside the scene script context.' },
          args: { type: 'object', description: 'Optional JSON object passed to the scene script.' },
          safety_checks: { type: 'boolean', description: 'Override the project default JavaScript safety checks for this call.' },
        },
        ['code']
      ),
      handler: async (args, call) => executeScript('scene', args, call),
    },
    {
      name: 'execute_editor_script',
      profile: 'core',
      description: '[compat] Execute JavaScript in the editor/browser context. Prefer execute_javascript with context="editor" as the main unified tool; use this when you specifically want the editor-only compatibility entrypoint.',
      inputSchema: createSchema(
        {
          code: { type: 'string', description: 'JavaScript code to execute inside the editor context.' },
          args: { type: 'object', description: 'Optional JSON object passed to the editor script.' },
          safety_checks: { type: 'boolean', description: 'Override the project default JavaScript safety checks for this call.' },
        },
        ['code']
      ),
      handler: async (args, call) => executeScript('editor', args, call),
    },
    {
      name: 'get_editor_state',
      profile: 'core',
      description: '[specialist] Return a structured editor-state snapshot including project info, runtime server status, current selection, and visible Electron windows. Prefer this when you want one compact editor summary.',
      inputSchema: createSchema({}, []),
      handler: async () => {
        const runtimeContext = getRuntimeContext();
        const status = typeof getStatus === 'function' ? getStatus() : null;
        let scene = null;
        try {
          const sceneInfo = await sceneBridge.call('getSceneInfo', { maxDepth: 1, includeComponents: false });
          scene = sceneInfo
            ? {
                sceneName: sceneInfo.sceneName,
                uuid: sceneInfo.uuid,
                childCount: sceneInfo.childCount,
              }
            : null;
        } catch (error) {
          scene = { error: error.message };
        }

        let windows = [];
        try {
          windows = listWindows();
        } catch (error) {
          windows = [{ error: error.message }];
        }

        return {
          extensionName: runtimeContext.extensionName,
          version: runtimeContext.version,
          projectName: runtimeContext.projectName,
          projectPath: runtimeContext.projectPath,
          cocosVersion: runtimeContext.cocosVersion,
          toolProfile: runtimeContext.config ? runtimeContext.config.toolProfile : 'core',
          status,
          selection: getCurrentSelection(),
          scene,
          windows,
        };
      },
    },
    {
      name: 'get_tool_catalog',
      profile: 'core',
      description: '[specialist] Return every built-in MCP tool with profile, category, and current exposure state. Use this before changing custom tool exposure.',
      inputSchema: createSchema({}, []),
      handler: async () => registry.listToolCatalog(),
    },
    {
      name: 'get_backend_capabilities',
      profile: 'core',
      description: '[specialist] Report the active Creator extension backend, project and platform identity, exposed operations with risk hints, and the unconfigured official CLI adapter. Exposure is not execution or persistence proof.',
      inputSchema: createSchema({
        offset: { type: 'integer', minimum: 0, description: 'Zero-based offset in the sorted exposed operation list. Defaults to 0.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum exposed operations to return. Defaults to 50; maximum 200.' },
      }, []),
      handler: async (args) => getBackendCapabilities(getRuntimeContext(), registry.listToolCatalog(), args, {
        editor: global.Editor,
      }),
    },
    {
      name: 'validate_node_batch',
      profile: 'core',
      category: 'scene',
      description: '[specialist] Preflight a bounded local-ID node/component graph and reference policy without reading or writing a Creator scene. Returns parent-first creation order and deferred reference actions; real component and asset validity still require Creator checks.',
      inputSchema: createSchema({
        batch: { type: 'object', description: 'Cocos MCP Kit node batch DTO v1; see docs/NODE_BATCH_DTO.md. Maximum 128 nodes and 256 KiB JSON.' },
      }, ['batch']),
      handler: async (args) => validateNodeBatch(args.batch),
    },
    {
      name: 'create_node_batch',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      description: '[specialist] Create a bounded DTO v1 batch under an exact ordinary parent in the current saved scene. Preflights UI fields/assets and imported project script UUIDs, binds internal references/ordered Button events and verifies readback. Only new nodes are cleanup candidates; script constructors/lifecycle effects outside them are not restored. Creator 3.8.8 records one parent-scoped Undo; other versions report unsupported. Uncertain recording blocks further batches pending manual review and a safe Creator restart. Never auto-saves, invokes events or Undo/redo, or resolves external references. See docs/NODE_BATCH_DTO.md.',
      inputSchema: createSchema({
        sceneUuid: { type: 'string', description: 'Exact imported UUID of the currently open saved scene asset.' },
        parentUuid: { type: 'string', description: 'Exact live parent UUID; UI batches require an existing Canvas ancestor. Prefab instances and enabled Layout parents are refused.' },
        batch: { type: 'object', description: 'Node batch DTO v1; maximum 128 new nodes. Allowlisted built-in UI properties, imported script components by scriptUuid (no script property writes), and up to 50 local Button events. See docs/NODE_BATCH_DTO.md.' },
      }, ['sceneUuid', 'parentUuid', 'batch']),
      handler: async (args, call) => {
        const result = await createNodeBatch(getRuntimeContext().projectPath, sceneBridge, args);
        if (!result.created || result.uncertain) {
          call.failureData = result;
          throw new Error(result.error || 'Node batch creation failed; inspect the cleanup report.');
        }
        return result;
      },
    },
    {
      name: 'copy_nodes_between_scenes',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      description: '[specialist] Export exact same-parent source roots into the public node-batch DTO v1 subset, safely switch from a clean saved source to a different clean saved scene, and create verified new identities under an exact destination path. Preserves node transforms/active state, supported component enabled/declared fields, and remaps supported internal node/component and SpriteFrame references. Rejects prefabs, editor-only nodes, unsupported components, Button events, unsafe external references and conflicts. Leaves the destination dirty; never saves or deletes the source. prepareCut only returns a session-local transferId for the separate finalize tool.',
      inputSchema: createSchema({
        sourceSceneUuid: { type: 'string', description: 'Exact UUID of the currently open, clean and saved source scene.' },
        rootUuids: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true, items: { type: 'string' }, description: 'Exact roots sharing one source parent; entire ordinary subtrees are included.' },
        targetScene: { type: 'string', description: 'Different imported writable scene UUID, db:// URL, project path or absolute project asset path.' },
        targetParentPath: { type: 'string', description: 'Exact destination hierarchy path after switching; use / for the scene root.' },
        externalPolicy: { type: 'string', enum: ['reject', 'clear'], description: 'Default reject. clear is allowed only for supported nullable fields; external Button.target remains rejected.' },
        prepareCut: { type: 'boolean', description: 'Default false. If true, stage a session-local cut receipt; source remains untouched until explicit target save and finalize_cross_scene_cut.' },
      }, ['sourceSceneUuid', 'rootUuids', 'targetScene', 'targetParentPath']),
      handler: async (args, call) => {
        const result = await copyNodesBetweenScenes(getRuntimeContext().projectPath, sceneBridge, args);
        if (!result.copied) { call.failureData = result; throw new Error(result.error || 'Cross-scene copy failed.'); }
        return result;
      },
    },
    {
      name: 'finalize_cross_scene_cut',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      description: '[specialist] Finalize a staged cross-scene cut only after the destination was explicitly saved. Re-exports and compares the saved destination, safely switches back, rechecks the unchanged source and incoming references, then records one Creator 3.8.8 parent-scoped Undo while deleting the source roots. Leaves the source dirty and never saves it, so its saved scene remains the recovery copy until explicit save. Session-local transferId; no retry when native history is uncertain.',
      inputSchema: createSchema({
        transferId: { type: 'string', description: 'Session-local ID returned by copy_nodes_between_scenes with prepareCut=true.' },
      }, ['transferId']),
      handler: async args => finalizeCrossSceneCut(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'get_ui_viewport',
      profile: 'core',
      category: 'scene',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      description: '[specialist] Read project design resolution and exact UI nodes with Canvas/associated camera identities, anchor-relative/world/Canvas bounds, and orthographic edit-camera pixel clipping. Uses the associated scene-camera buffer in edit mode, not the Scene observer viewport or design resolution as screen pixels. Unsupported contexts report unavailable; own rectangles only, not masks/occlusion/Game View/device visibility. Never changes or saves authored scene data. See docs/UI_VIEWPORT.md.',
      inputSchema: createSchema({
        sceneUuid: { type: 'string', description: 'Exact UUID of the active general scene, outside prefab/multi-scene editing.' },
        nodeUuids: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true, items: { type: 'string' }, description: '1–128 distinct exact UI node UUIDs; does not scan descendants. Missing/non-UI targets yield per-node unavailable results.' },
      }, ['sceneUuid', 'nodeUuids']),
      handler: async args => getUIViewport(sceneBridge, args),
    },
    {
      name: 'verify_ui',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description: 'Wait a bounded delay after an explicit edit, validate exact UI nodes in general mode, and optionally return a strictly targeted Scene or embedded Game View PNG plus separate metadata. Default: no screenshot. In preview mode, game screenshots mark structure not_checked. Writes only a new temp capture file; never starts preview, saves, repairs, or judges pixels. Screenshot failures retain structure as an MCP error. Runtime scene freshness is not verified. See docs/UI_VERIFICATION.md.',
      inputSchema: createSchema({
        sceneUuid: { type: 'string' }, nodeUuids: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true, items: { type: 'string' } },
        exclude: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['rule'], properties: { rule: { type: 'string', enum: UI_VALIDATION_RULES }, nodeUuid: { type: 'string' } } } },
        maxFindings: { type: 'integer', minimum: 1, maximum: 100 },
        waitMs: { type: 'integer', minimum: 0, maximum: 2000, description: 'Default 300; delay is not an engine/render acknowledgment.' },
        screenshot: { type: 'string', enum: ['none', 'scene', 'game'], description: 'Default none. game requires an already running embedded Game View.' },
        windowId: { type: 'integer', minimum: 1, description: 'Optional exact Electron ID; only with a screenshot request.' },
        titleContains: { type: 'string', description: 'Optional strict title filter; no fallback. Only with a screenshot request.' },
      }, ['sceneUuid', 'nodeUuids']),
      handler: async (args, call) => {
        const { report, image } = await verifyUI(getRuntimeContext().projectPath, sceneBridge, args);
        if (!report.completed) { call.failureData = report; throw new Error(report.screenshot.error); }
        call.image = image;
        return report;
      },
    },
    {
      name: 'validate_ui',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      description: 'Read-only bounded checks for exact UI nodes: UITransform, project design bounds, SpriteFrame/custom Label font imports, serialized Button receivers and potential Widget/Animation conflicts. Reports targets, severity, suggestions, exclusions and incomplete checks. No subtree scan, repair, save, event invocation or visual pass. See docs/UI_VALIDATION.md.',
      inputSchema: createSchema({
        sceneUuid: { type: 'string', description: 'Exact active general scene UUID; no prefab or multi-scene editing.' },
        nodeUuids: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true, items: { type: 'string' }, description: 'Explicit nodes only, no descendant traversal.' },
        exclude: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['rule'], properties: {
          rule: { type: 'string', enum: UI_VALIDATION_RULES }, nodeUuid: { type: 'string', description: 'Optional requested node UUID; omission excludes this rule for every requested node.' },
        } }, description: 'Explicit rule exclusions; included in the report.' },
        maxFindings: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 50. Truncation reports total count and prevents complete/pass.' },
      }, ['sceneUuid', 'nodeUuids']),
      handler: async args => validateUI(sceneBridge, args),
    },
    {
      name: 'get_ui_template',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      description: '[specialist] Generate editable UI JSON for pause_menu, settings_dialog or result_dialog, with text, dimensions, RGBA colors and project-script event parameters. Read-only data generation; inspect/edit the returned ui then pass it to build_ui. Unbound buttons are disabled. No bundled art, game logic, scene mutation, saving or asset validation. See docs/UI_TEMPLATES.md.',
      inputSchema: createSchema({
        template: { type: 'string', enum: ['pause_menu', 'settings_dialog', 'result_dialog'], description: 'Template kind. Actions: pause resume/restart/quit; settings music/sound/close; result retry/continue.' },
        spriteFrame: { type: 'string', description: 'Project SpriteFrame UUID or exact db://assets subasset URL used for panel/buttons. Use a white image for solid colors; verified only by build_ui.' },
        name: { type: 'string', description: 'Optional root name. Defaults to PauseMenu, SettingsDialog or ResultDialog; duplicate siblings are refused at build time.' },
        size: { type: 'object', description: 'Optional {width,height} in parent-local UI units: width 240..2048, height 400..2048; default 480x480.' },
        texts: { type: 'object', description: 'Optional strings (max 512 characters each): title, message and action IDs for the chosen template only.' },
        colors: { type: 'object', description: 'Optional panel, button, text colors; each requires integer {r,g,b,a} channels 0..255.' },
        controller: { type: 'object', description: 'Optional {scriptUuid,bindings:{action:{handler,customEventData?}}}. Mounts one project script on the new panel; non-empty bindings enable those buttons, omitted event data defaults to action ID. No external targets or generated scripts.' },
      }, ['template', 'spriteFrame']),
      handler: async args => getUITemplate(args),
    },
    {
      name: 'build_ui',
      profile: 'full',
      category: 'scene',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      description: '[specialist] Build nested JSON UI under an exact active UI parent with an existing Canvas/associated camera. Supports local positions, sizes, anchors, Label, project SpriteFrame, Button targets, imported script UUIDs and ordered events targeting new scripts. Create-only; name conflicts refuse, failures clean up only this batch, and Creator 3.8.8 records one Undo. Script constructors/lifecycle effects outside new nodes are not restored. Adds independent read-only viewport context. Never saves, creates Canvas/Camera, generates scripts or invokes click events. No preview/device visual guarantee. See docs/UI_BUILDER.md.',
      inputSchema: createSchema({
        sceneUuid: { type: 'string', description: 'Exact imported UUID of the currently open saved scene.' },
        parentUuid: { type: 'string', description: 'Exact active parent node UUID, with UITransform and an existing Canvas ancestor.' },
        ui: { type: 'object', description: 'UI schema v1: schemaVersion:1, mode:create, failurePolicy:cleanup_new_nodes, nested roots with id/name/size and optional position/anchor/label/sprite/button/scripts/children. scripts declare local id and imported scriptUuid; up to 50 events name button node ID, target script ID, handler and optional customEventData. Maximum 128 nodes, 16 levels and 256 KiB. See docs/UI_BUILDER.md.' },
      }, ['sceneUuid', 'parentUuid', 'ui']),
      handler: async (args, call) => {
        const result = await buildUI(getRuntimeContext().projectPath, sceneBridge, args);
        if (!result.created || result.uncertain) {
          call.failureData = result;
          throw new Error(result.error || 'UI construction failed; inspect the cleanup report.');
        }
        return result;
      },
    },
    {
      name: 'check_for_updates',
      profile: 'core',
      description: '[specialist] Check a configured Cocos MCP Kit release source; no default source is configured for this fork.',
      inputSchema: createSchema(
        {
          timeoutMs: { type: 'number', description: 'Optional network timeout in milliseconds.' },
        },
        []
      ),
      handler: async (args) => {
        const runtimeContext = getRuntimeContext();
        return await checkForUpdate({
          currentVersion: runtimeContext.version,
          timeoutMs: Number.isFinite(args.timeoutMs) ? args.timeoutMs : 5000,
        });
      },
    },
    {
      name: 'get_selection',
      profile: 'core',
      description: '[specialist] Return the current editor selection in a compact structured form. Prefer this when selection state matters for the next action.',
      inputSchema: createSchema({}, []),
      handler: async () => getCurrentSelection(),
    },
    {
      name: 'list_project_instructions',
      profile: 'core',
      description: '[specialist] List project AI instruction files and Skills for a supported client (defaults to Codex).',
      inputSchema: createSchema({ clientId: { type: 'string', enum: ['codex', 'claude_code', 'cursor', 'qoder', 'kimi', 'opencode'], description: 'Target Skills client; defaults to Codex.' } }, []),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return listProjectInstructions(projectPath, args);
      },
    },
    {
      name: 'read_project_instruction',
      profile: 'core',
      description: '[specialist] Read a project AI instruction file such as AGENTS.md, CLAUDE.md, or a project SKILL.md.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Project-relative instruction path.' },
        },
        ['target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return readProjectInstruction(projectPath, args.target);
      },
    },
    {
      name: 'write_project_instruction',
      profile: 'full',
      description: '[core] Create or update a project AI instruction file inside the Cocos project.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Project-relative instruction path.' },
          content: { type: 'string', description: 'Instruction file content.' },
          overwrite: { type: 'boolean', description: 'Allow overwriting an existing file. Defaults to true.' },
        },
        ['target', 'content']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return writeProjectInstruction(projectPath, args);
      },
    },
    {
      name: 'create_project_skill',
      profile: 'full',
      description: '[core] Create a project Skill for Codex, Claude Code, Cursor, Qoder, or Kimi Code. Defaults to Codex under .agents/skills.',
      inputSchema: createSchema(
        {
          skillName: { type: 'string', description: 'Filesystem-safe project skill name.' },
          clientId: { type: 'string', enum: ['codex', 'claude_code', 'cursor', 'qoder', 'kimi', 'opencode'], description: 'Target client; defaults to Codex. Kimi uses the nearest Git root.' },
          title: { type: 'string', description: 'Human-readable skill title.' },
          description: { type: 'string', description: 'Skill trigger description.' },
          instructions: { type: 'string', description: 'Skill instructions body.' },
          overwrite: { type: 'boolean', description: 'Allow overwriting an existing skill. Defaults to true.' },
        },
        ['skillName']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return createProjectSkill(projectPath, args);
      },
    },
    {
      name: 'create_cocos_mcp_project_skill',
      profile: 'full',
      description: '[core] Create the recommended Cocos MCP Kit workflow Skill for a supported client (defaults to Codex).',
      inputSchema: createSchema(
        {
          skillName: { type: 'string', description: 'Optional filesystem-safe project skill name.' },
          clientId: { type: 'string', enum: ['codex', 'claude_code', 'cursor', 'qoder', 'kimi', 'opencode'], description: 'Target client; defaults to Codex. Kimi uses the nearest Git root.' },
          overwrite: { type: 'boolean', description: 'Allow overwriting an existing skill. Defaults to true.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath, version } = getRuntimeContext();
        const result = createCocosMcpProjectSkill(projectPath, args);
        const content = readProjectInstruction(getSkillProjectPath(projectPath, args), result.path).content;
        const managedSkillName = result.path.split('/').slice(-2, -1)[0];
        const manifest = writeManagedSkillManifest(projectPath, content, {
          clientId: args.clientId,
          skillName: managedSkillName,
          extensionVersion: version,
        });
        return { ...result, manifest: manifest.path };
      },
    },
    {
      name: 'set_selection',
      profile: 'core',
      description: '[specialist] Set or clear the current editor selection for an asset or node. Use this when downstream editor workflows depend on selection state.',
      inputSchema: createSchema(
        {
          type: { type: 'string', description: 'Selection target type: asset, node, or clear.' },
          target: { type: 'string', description: 'Asset uuid/path/db url, or node uuid when type=node.' },
          clearMode: { type: 'string', description: 'When type=clear, choose asset, node, or all.' },
        },
        ['type']
      ),
      handler: async (args) => {
        const type = String(args.type || '').trim().toLowerCase();
        if (type === 'clear') {
          return clearSelection(args.clearMode || 'all');
        }
        if (type === 'asset') {
          const info = await queryAssetInfo(args.target);
          return selectAsset(info.uuid || args.target);
        }
        if (type === 'node') {
          const target = String(args.target || '').trim();
          if (!target) {
            throw new Error('target is required when type=node.');
          }
          return selectNode(target);
        }
        throw new Error(`Unknown selection type '${args.type}'. Expected asset, node, or clear.`);
      },
    },
    {
      name: 'get_scene_info',
      profile: 'core',
      description: '[specialist] Return a structured summary of the active Cocos scene. Prefer execute_javascript for multi-step inspection or mutation; use this when you specifically want a compact scene snapshot.',
      inputSchema: createSchema(
        {
          maxDepth: { type: 'integer', description: 'Maximum child depth to include (1-32, default 2).' },
          maxNodes: { type: 'integer', description: 'Maximum number of nodes returned (1-2000, default 200).' },
          includeComponents: { type: 'boolean', description: 'Include component names for nodes.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('getSceneInfo', args),
    },
    {
      name: 'get_hierarchy',
      profile: 'core',
      description: '[specialist] Return a bounded hierarchy tree from the active scene or one uniquely identified node. Reports truncation when depth or node limits hide descendants.',
      inputSchema: createSchema(
        {
          rootPath: { type: 'string', description: 'Optional node path to use as the traversal root.' },
          rootUuid: { type: 'string', description: 'Optional node UUID; combine with a path or name only when they identify the same node.' },
          rootName: { type: 'string', description: 'Optional unique node name. Ambiguous names return candidates.' },
          maxDepth: { type: 'integer', description: 'Maximum child depth to include (1-32, default 3).' },
          maxNodes: { type: 'integer', description: 'Maximum number of nodes returned (1-2000, default 200).' },
          includeComponents: { type: 'boolean', description: 'Include component names for each node.' },
          includeInactive: { type: 'boolean', description: 'Include inactive nodes in the result.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('getHierarchy', args),
    },
    {
      name: 'find_nodes',
      profile: 'full',
      description: '[core] Find scene nodes by exact name, partial path, or component type.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Exact node name to match.' },
          pathContains: { type: 'string', description: 'Substring that must appear in the node path.' },
          component: { type: 'string', description: 'Component constructor name to match.' },
          includeInactive: { type: 'boolean', description: 'Include inactive nodes.' },
          maxResults: { type: 'integer', description: 'Maximum matching nodes returned (1-500, default 200). Total count and truncation are reported separately.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('findNodes', args),
    },
    {
      name: 'inspect_node',
      profile: 'full',
      description: '[core] Inspect a node by UUID, path, or unique name. Multiple selectors must identify the same node; ambiguous matches return candidates.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Hierarchy path such as Canvas/Player.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Exact node name; must be unique unless combined with a matching UUID or path.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('inspectNode', args),
    },
    {
      name: 'detect_node_type',
      profile: 'full',
      annotations: { readOnlyHint: true, idempotentHint: true },
      description: 'Classify a scene node as camera, UI-capable, or plain using attached Cocos components. Reports matching rules and an explicit ambiguity when Camera and UI components coexist; node names are not evidence.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Hierarchy path such as Canvas/Player.' },
          uuid: { type: 'string', description: 'Node UUID.' },
          name: { type: 'string', description: 'Exact node name; must be unique unless combined with a matching UUID or path.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('detectNodeType', args),
    },
    {
      name: 'create_node',
      profile: 'full',
      description: 'Create a new node under the active scene or a specified parent path.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Name of the node to create.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          parentUuid: { type: 'string', description: 'Optional parent node UUID.' },
          parentName: { type: 'string', description: 'Optional unique parent node name.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
          scale: { type: 'object', description: 'Optional scale {x,y,z}.' },
          eulerAngles: { type: 'object', description: 'Optional rotation {x,y,z} in degrees.' },
          active: { type: 'boolean', description: 'Optional active state for the node.' },
        },
        ['name']
      ),
      handler: async (args) => sceneBridge.call('createNode', args),
    },
    {
      name: 'delete_node',
      profile: 'full',
      description: 'Delete a node by path, uuid, or name.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('deleteNode', args),
    },
    {
      name: 'move_node',
      profile: 'full',
      description: 'Move an ordinary scene node to another parent. Preserves its world transform by default; set keepWorldTransform=false to preserve its local transform. Rejects cycles and linked prefab hierarchies.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Current hierarchy path of the node to move.' },
          uuid: { type: 'string', description: 'UUID of the node to move.' },
          name: { type: 'string', description: 'Exact, unique name of the node to move.' },
          parentPath: { type: 'string', description: 'Destination parent path; "/" selects the scene root.' },
          parentUuid: { type: 'string', description: 'Destination parent UUID.' },
          parentName: { type: 'string', description: 'Exact, unique destination parent name.' },
          keepWorldTransform: { type: 'boolean', description: 'True (default) preserves world transform; false preserves local transform.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('moveNode', args),
    },
    {
      name: 'reorder_node',
      profile: 'full',
      description: 'Reorder an ordinary scene node among its serializable siblings using a zero-based index. Optional parent selectors guard against stale hierarchy; rejects linked prefab hierarchies and out-of-range indices.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Current hierarchy path of the node to reorder.' },
          uuid: { type: 'string', description: 'UUID of the node to reorder.' },
          name: { type: 'string', description: 'Exact, unique name of the node to reorder.' },
          parentPath: { type: 'string', description: 'Optional expected parent path; "/" selects the scene root.' },
          parentUuid: { type: 'string', description: 'Optional expected parent UUID.' },
          parentName: { type: 'string', description: 'Optional exact, unique expected parent name.' },
          index: { type: 'integer', description: 'New zero-based index among serializable siblings; must be within the current sibling range.' },
        },
        ['index']
      ),
      handler: async (args) => sceneBridge.call('reorderNode', args),
    },
    {
      name: 'duplicate_node',
      profile: 'full',
      description: 'Clone an ordinary scene node subtree beside its source, with fresh node identities. Uses Cocos instantiate for components and internal references; rejects linked prefab hierarchies. Save the scene to persist it.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Hierarchy path of the source node.' },
          uuid: { type: 'string', description: 'UUID of the source node.' },
          name: { type: 'string', description: 'Exact, unique name of the source node.' },
          newName: { type: 'string', description: 'Optional unique name for the copy. Defaults to "<source> Copy" with a numeric suffix if needed.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('duplicateNode', args),
    },
    {
      name: 'set_node_transform',
      profile: 'full',
      description: 'Update node position, rotation, scale, or active state. Adds read-only UI viewport context when computable; unavailable geometry does not undo the update or imply preview visibility.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          position: { type: 'object', description: 'Position {x,y,z}.' },
          scale: { type: 'object', description: 'Scale {x,y,z}.' },
          eulerAngles: { type: 'object', description: 'Rotation {x,y,z} in degrees.' },
          active: { type: 'boolean', description: 'Optional active state.' },
        },
        []
      ),
      handler: async (args) => attachUIViewport(sceneBridge, await sceneBridge.call('setNodeTransform', args)),
    },
    {
      name: 'batch_modify_nodes',
      profile: 'full',
      category: 'scene',
      annotations: { destructiveHint: true },
      description: 'Apply 1-50 ordered node transform/active changes. Reports each result and supports stop or continue on error. A failing step attempts its own rollback; earlier successful steps remain changed. Adds read-only UI viewport context for known targets without changing step outcomes. Save the scene to persist successful changes.',
      inputSchema: createSchema(
        {
          changes: {
            type: 'array', minItems: 1, maxItems: 50,
            description: 'Ordered modifications; each step selects a node and sets at least one complete field.',
            items: {
              type: 'object',
              properties: {
                uuid: { type: 'string' }, path: { type: 'string' }, name: { type: 'string' },
                position: { type: 'object', description: 'Complete local {x,y,z} position.' },
                scale: { type: 'object', description: 'Complete local {x,y,z} scale; zero is allowed.' },
                eulerAngles: { type: 'object', description: 'Complete local {x,y,z} rotation in degrees.' },
                active: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
          onError: { type: 'string', enum: ['stop', 'continue'], description: 'Default stop; continue attempts later steps after a failure.' },
        },
        ['changes']
      ),
      handler: async (args) => attachUIViewport(sceneBridge, await sceneBridge.call('batchModifyNodes', args)),
    },
    {
      name: 'reset_node_transform',
      profile: 'full',
      description: 'Reset selected local position, rotation, or scale of an ordinary scene node to identity defaults. Omitting fields resets all three. Linked prefab instances require the separate prefab revert workflow. Adds read-only UI viewport context when computable. Save the scene to persist the change.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Target node hierarchy path.' },
          uuid: { type: 'string', description: 'Target node UUID.' },
          name: { type: 'string', description: 'Exact, unique target node name.' },
          fields: {
            type: 'array',
            items: { type: 'string', enum: ['position', 'rotation', 'scale'] },
            description: 'Local transform fields to reset. Defaults to position, rotation, and scale.',
          },
        },
        []
      ),
      handler: async (args) => attachUIViewport(sceneBridge, await sceneBridge.call('resetNodeTransform', args)),
    },
    {
      name: 'get_project_info',
      profile: 'core',
      description: '[specialist] Return the active project identity and Creator version from public Editor.Project and Editor.App fields, alongside the existing MCP runtime context. Unavailable native fields are null. Prefer this for a structured project summary.',
      inputSchema: createSchema({}, []),
      handler: async () => getProjectInfo(getRuntimeContext(), global.Editor),
    },
    ...createCocosProjectTools({ createSchema }),
    ...createReferenceImageTools({ createSchema }),
    ...createSceneViewTools({ createSchema }),
    {
      name: 'create_scene',
      profile: 'core',
      description: '[core] Create an empty, UI (Canvas/orthographic Camera), or current-copy scene at an explicit assets path. Defaults to create-only. Opening requires expectedSceneUuid and a verified saved/clean origin; never auto-save or discard. UI mode never overwrites. A created file is retained if switching fails.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Target scene path under assets, such as assets/Scenes/Level01.scene or db://assets/Scenes/Level01.scene.' },
          mode: { type: 'string', enum: ['empty', 'current', 'ui'], description: 'empty (default), current copy, or ui with Canvas and Camera sized to the current design resolution.' },
          sceneName: { type: 'string', description: 'Optional internal scene name. Defaults to the target file name.' },
          overwrite: { type: 'boolean', description: 'Overwrite an existing scene asset at target.' },
          openAfterCreate: { type: 'boolean', description: 'Defaults to false. True requires expectedSceneUuid and a saved, single, clean origin verified against disk before creation and switching.' },
          expectedSceneUuid: { type: 'string', description: 'Required only when openAfterCreate=true: exact current scene asset UUID.' },
        },
        ['target']
      ),
      handler: async (args) => createScene(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'list_scenes',
      profile: 'core',
      description: '[specialist] List scene assets in the project. Prefer this when you need exact scene discovery before opening one; otherwise stay in execute_javascript for broader workflows.',
      inputSchema: createSchema(
        {
          pattern: { type: 'string', description: 'Optional asset-db pattern. Defaults to db://assets/**.' },
        },
        []
      ),
      handler: async (args) => {
        const assets = await listAssets({ pattern: args.pattern || 'db://assets/**', ccType: 'cc.SceneAsset' });
        return { count: assets.length, scenes: assets.slice(0, 200) };
      },
    },
    {
      name: 'open_scene',
      profile: 'core',
      description: '[specialist] Open an exact project scene UUID, db URL or path only from a saved, single, clean scene. Compare live serialization with disk even if dirty=false; never auto-save/discard. Verify target and retained origin after one native open; uncertain results are not retried or rolled back.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Exact scene uuid, db url, or path including .scene.' },
          expectedSceneUuid: { type: 'string', description: 'Optional exact current scene asset UUID to reject a stale caller context.' },
        },
        ['target']
      ),
      handler: async (args) => openSceneSafely(getRuntimeContext().projectPath, args),
    },
    {
      name: 'list_prefabs',
      profile: 'full',
      description: '[core] List prefab assets and import status with stable pagination. Optionally include bounded asset metadata and links from the active scene; scene instance counts are partial when the scan is truncated.',
      inputSchema: createSchema(
        {
          pattern: { type: 'string', description: 'Optional asset-db pattern. Defaults to db://assets/**.' },
          offset: { type: 'integer', minimum: 0, description: 'Zero-based offset after sorting by asset URL. Defaults to 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum returned prefabs. Defaults to 50.' },
          includeMetadata: { type: 'boolean', description: 'Query a compact .meta summary for each returned prefab. Defaults to false.' },
          includeSceneInstances: { type: 'boolean', description: 'Include live links from the active scene (up to 5000 nodes and 200 instance roots). Defaults to false.' },
        },
        []
      ),
      handler: async (args) => {
        const pattern = args.pattern === undefined ? 'db://assets/**' : args.pattern;
        const offset = args.offset === undefined ? 0 : args.offset;
        const limit = args.limit === undefined ? 50 : args.limit;
        if (typeof pattern !== 'string' || !pattern.startsWith('db://assets/') ||
            !Number.isInteger(offset) || offset < 0 ||
            !Number.isInteger(limit) || limit < 1 || limit > 100 ||
            (args.includeMetadata !== undefined && typeof args.includeMetadata !== 'boolean') ||
            (args.includeSceneInstances !== undefined && typeof args.includeSceneInstances !== 'boolean')) {
          throw new Error('Expected an assets pattern, non-negative integer offset, limit 1-100, and boolean include options.');
        }
        const assets = (await listAssets({ pattern, ccType: 'cc.Prefab' }))
          .filter((asset) => asset && (!asset.type || asset.type === 'cc.Prefab'))
          .sort((a, b) => String(a.url || '').localeCompare(String(b.url || '')) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')));
        const page = assets.slice(offset, offset + limit);
        const instanceScan = args.includeSceneInstances
          ? await sceneBridge.call('listPrefabInstanceLinks', { maxNodes: 5000, maxInstances: 200 }) : null;
        const instancesByAsset = new Map();
        if (instanceScan) {
          for (const instance of instanceScan.instances || []) {
            if (!instance || typeof instance.assetUuid !== 'string') continue;
            if (!instancesByAsset.has(instance.assetUuid)) instancesByAsset.set(instance.assetUuid, []);
            instancesByAsset.get(instance.assetUuid).push(instance);
          }
        }
        const prefabs = [];
        for (const asset of page) {
          const item = {
            name: asset.name || '',
            uuid: asset.uuid || '',
            url: asset.url || '',
            imported: typeof asset.imported === 'boolean' ? asset.imported : null,
          };
          if (args.includeMetadata) {
            try {
              const meta = await queryAssetMeta(item.uuid || item.url);
              item.metadata = meta ? {
                status: 'available', uuid: typeof meta.uuid === 'string' ? meta.uuid : '',
                importer: typeof meta.importer === 'string' ? meta.importer : '',
              } : { status: 'missing' };
            } catch (error) {
              item.metadata = { status: 'error', error: error.message };
            }
          }
          if (instanceScan) {
            const linked = instancesByAsset.get(item.uuid) || [];
            item.sceneInstanceCount = linked.length;
            item.sceneInstances = linked.slice(0, 20);
            item.sceneInstancesTruncated = linked.length > 20 || Boolean(instanceScan.truncated);
          }
          prefabs.push(item);
        }
        return {
          count: assets.length,
          offset,
          limit,
          returned: prefabs.length,
          truncated: offset + prefabs.length < assets.length,
          prefabs,
          sceneInstanceScan: instanceScan ? {
            sceneName: instanceScan.sceneName,
            scannedNodes: instanceScan.scannedNodes,
            linkedCount: instanceScan.linkedCount,
            returnedLinks: (instanceScan.instances || []).length,
            truncated: Boolean(instanceScan.truncated),
          } : undefined,
        };
      },
    },
    {
      name: 'inspect_prefab',
      profile: 'core',
      description: '[specialist] Inspect a prefab asset, compact metadata, serialized root and component structure, and bounded UUID-like references. Optionally list matching instance roots in the active scene; truncated scans are marked.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Prefab uuid, db url, or project path.' },
          includeSceneInstances: { type: 'boolean', description: 'Join instance roots from the active scene. Defaults to false.' },
          maxSceneInstances: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum returned matching instances. Defaults to 20.' },
        },
        ['target']
      ),
      handler: async (args) => {
        if ((args.includeSceneInstances !== undefined && typeof args.includeSceneInstances !== 'boolean') ||
            (args.maxSceneInstances !== undefined &&
              (!Number.isInteger(args.maxSceneInstances) || args.maxSceneInstances < 1 || args.maxSceneInstances > 50))) {
          throw new Error('includeSceneInstances must be boolean and maxSceneInstances must be an integer from 1 to 50.');
        }
        const { projectPath } = getRuntimeContext();
        const details = await inspectPrefab(projectPath, args.target);
        if (args.includeSceneInstances) {
          const scan = await sceneBridge.call('listPrefabInstanceLinks', { maxNodes: 5000, maxInstances: 200 });
          const matching = (scan.instances || []).filter((instance) => instance.assetUuid === details.info.uuid);
          const maxSceneInstances = args.maxSceneInstances === undefined ? 20 : args.maxSceneInstances;
          details.sceneInstanceCount = matching.length;
          details.sceneInstances = matching.slice(0, maxSceneInstances);
          details.sceneInstancesTruncated = matching.length > maxSceneInstances || Boolean(scan.truncated);
          details.sceneInstanceScan = {
            sceneName: scan.sceneName,
            scannedNodes: scan.scannedNodes,
            linkedCount: scan.linkedCount,
            returnedLinks: (scan.instances || []).length,
            truncated: Boolean(scan.truncated),
          };
        }
        return details;
      },
    },
    {
      name: 'validate_prefab_references',
      profile: 'core',
      description: '[specialist] Validate bounded explicit prefab asset UUID references, serialized component links, and declared nested prefab assets. Incomplete scans are marked; runtime dynamic loads and component class registration are not verified.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Optional prefab uuid, db url, or path. When omitted, scans prefab assets.' },
          pattern: { type: 'string', description: 'Optional asset-db pattern used when scanning prefabs.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum prefab assets to scan when target is omitted. Defaults to 50.' },
          maxReferences: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum explicit asset references to check per prefab. Defaults to 2000; incomplete scans are flagged.' },
          maxIssues: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum examples per issue category. Counts include all checked issues. Defaults to 50.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await validatePrefabReferences(projectPath, args);
      },
    },
    {
      name: 'duplicate_prefab',
      profile: 'full',
      description: '[core] Duplicate a prefab through asset-db, preserving references while assigning the new asset its own UUID.',
      inputSchema: createSchema(
        {
          source: { type: 'string', description: 'Source prefab uuid, db url, or project path.' },
          target: { type: 'string', description: 'Project-relative target path under assets, with or without .prefab.' },
          overwrite: { type: 'boolean', description: 'Overwrite target prefab if it already exists.' },
        },
        ['source', 'target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await duplicatePrefab(projectPath, args);
      },
    },
    {
      name: 'edit_prefab_json',
      profile: 'full',
      description: '[core] Edit serialized prefab JSON through asset-db, verify stable persistence, then validate references.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Prefab uuid, db url, or project path.' },
          jsonPath: { type: 'string', description: 'JSON path such as /0/_name or 0._name when assigning valueJson.' },
          valueJson: { type: 'string', description: 'JSON encoded value to assign at jsonPath.' },
          search: { type: 'string', description: 'Literal text to search for instead of jsonPath assignment.' },
          replace: { type: 'string', description: 'Replacement text for literal search.' },
          replaceAll: { type: 'boolean', description: 'Replace all literal matches.' },
          createBackup: { type: 'boolean', description: 'Create a .bak file before writing.' },
        },
        ['target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await editPrefabJson(projectPath, args);
      },
    },
    {
      name: 'enter_prefab_edit_mode',
      profile: 'full',
      description: 'Enter native editing for an exact non-nested project prefab from one clean saved scene. Checks live serialization against disk, editor mode, asset and edit-root identity, and unchanged source/origin files. Returns sourceHash for guarded saves. Already-open clean targets are verified without reopening. Refuses dirty, multi-scene, other-prefab and unsupported states; never auto-saves, discards, closes or retries.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: createSchema({ target: { type: 'string', description: 'Exact prefab UUID, db URL, or project source file path including .prefab; no extension guessing.' } }, ['target']),
      handler: async (args) => enterPrefabEditMode(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'save_prefab_edit_mode',
      profile: 'full',
      description: 'Save property-only edits of the explicitly selected, currently open non-nested prefab through one native save. Requires the source SHA-256 from entry or the last verified save; rejects source conflicts, structure changes and unsupported references. Verifies persisted content, stable edit identity, clean state and unchanged origin scene; never auto-exits, retries, rolls back or saves the origin scene.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: createSchema({
        prefabUuid: { type: 'string', description: 'Exact current prefab asset UUID returned by enter_prefab_edit_mode, not a node UUID or asset path.' },
        expectedSourceHash: { type: 'string', description: 'Source SHA-256 returned by enter_prefab_edit_mode or the last verified save; prevents overwriting intervening file changes.' },
      }, ['prefabUuid', 'expectedSourceHash']),
      handler: async (args) => savePrefabEditMode(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'exit_prefab_edit_mode',
      profile: 'full',
      description: 'Exit a clean, saved non-nested prefab through one native close, with explicit prefab and return-scene asset UUIDs. Compares live prefab/origin serialization with disk even when dirty is false, verifies the restored scene and unchanged files twice, and reports its actual needsSave state. Repeating in the matching verified scene never closes it. Never auto-saves, discards, retries, reopens or rolls back.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: createSchema({
        prefabUuid: { type: 'string', description: 'Exact current prefab asset UUID returned by entry or save, not a node UUID or path.' },
        returnSceneUuid: { type: 'string', description: 'Exact origin scene asset UUID from previousScene.uuid returned by initial entry or verified save; never an arbitrary replacement scene.' },
      }, ['prefabUuid', 'returnSceneUuid']),
      handler: async (args) => exitPrefabEditMode(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'test_prefab_edit_mode',
      profile: 'full',
      description: 'Read-only diagnostics for an explicit prefab asset UUID: query editor context, source/reference and origin state, and inspect the edit root only if that target is already open. Reports failed/not-checked queries, unsaved differences and observation stability. complete/readChecksPassed describe read checks only, never permission or proof that entering/saving/exiting works; all mutation tests remain not_run. Never opens, saves, closes, creates instances or discards data.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: createSchema({ prefabUuid: { type: 'string', description: 'Exact project prefab asset UUID to inspect without opening it; not a node UUID or path.' } }, ['prefabUuid']),
      handler: async (args) => testPrefabEditMode(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'create_prefab_from_node',
      profile: 'full',
      description: '[core] Create a prefab from an ordinary scene node after validating the cloned hierarchy, component ownership, PrefabInfo metadata, and explicit asset references. Persists only through asset-db and verifies the imported asset; linked nested instances are rejected.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Target prefab path under assets, such as assets/Prefabs/SettingsPanel.prefab or db://assets/Prefabs/SettingsPanel.prefab.' },
          path: { type: 'string', description: 'Source node hierarchy path.' },
          uuid: { type: 'string', description: 'Source node uuid.' },
          name: { type: 'string', description: 'Fallback exact source node name.' },
          rootName: { type: 'string', description: 'Optional root name; must match the target prefab filename in Creator 3.8.8.' },
          prefabName: { type: 'string', description: 'Optional internal asset name; must match the target prefab filename in Creator 3.8.8.' },
          overwrite: { type: 'boolean', description: 'Overwrite an existing prefab asset at target.' },
          maxReferenceChecks: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum explicit serialized asset references checked before writing. Defaults to 5000; creation is rejected if this bound is insufficient.' },
        },
        ['target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const target = normalizePrefabTarget(projectPath, args.target);
        const targetName = path.basename(target.filePath, '.prefab');
        for (const [label, name] of [['rootName', args.rootName], ['prefabName', args.prefabName]]) {
          if (name !== undefined && name !== targetName) {
            throw new Error(`${label} must match the target prefab filename "${targetName}" in Creator 3.8.8.`);
          }
        }
        const serialized = await sceneBridge.call('serializePrefabFromNode', {
          path: args.path,
          uuid: args.uuid,
          name: args.name,
          rootName: targetName,
          prefabName: targetName,
        });
        if (!serialized || serialized.sourceUnchanged !== true) {
          throw new Error('Prefab serialization did not prove that the source scene hierarchy remained unchanged. No asset was written.');
        }
        const prefabMetadata = assertSerializedPrefabMetadata(serialized.content, {
          expectedLayer: UI_2D_LAYER,
          expectedName: targetName,
        });
        const referencePreflight = await validateSerializedPrefabAssetReferences(serialized.content, {
          maxReferences: args.maxReferenceChecks === undefined ? 5000 : args.maxReferenceChecks,
        });
        if (!referencePreflight.ok) {
          const reasons = [];
          if (!referencePreflight.complete) reasons.push('reference scan was truncated');
          if (referencePreflight.missingCount) reasons.push(`${referencePreflight.missingCount} asset reference(s) are missing`);
          if (referencePreflight.lookupErrorCount) reasons.push(`${referencePreflight.lookupErrorCount} asset-db lookup(s) failed`);
          if (referencePreflight.nestedIssues.length) reasons.push(`${referencePreflight.nestedIssues.length} nested asset(s) are not prefabs`);
          throw new Error(`Prefab reference preflight failed: ${reasons.join('; ')}. No asset was written.`);
        }
        const result = await savePrefabContent(projectPath, {
          target: args.target,
          content: serialized.content,
          overwrite: args.overwrite,
        });
        const imported = await inspectPrefab(projectPath, result.info.uuid || result.dbUrl);
        const structure = imported.structure || {};
        const verification = {
          imported: imported.info && imported.info.imported === true,
          uuid: imported.info && imported.info.uuid,
          dbUrl: imported.info && imported.info.url,
          metadataUuidMatchesAsset: imported.metadata && imported.metadata.uuidMatchesAsset,
          rootName: structure.rootName,
          nodeCount: structure.nodeCount,
          componentCount: structure.componentCount,
        };
        const verified = verification.imported && verification.uuid === result.info.uuid &&
          verification.dbUrl === result.dbUrl && verification.metadataUuidMatchesAsset === true &&
          verification.rootName === targetName && verification.nodeCount === prefabMetadata.nodeCount &&
          verification.componentCount === prefabMetadata.componentCount;
        if (!verified) {
          throw new Error(`Created prefab did not pass imported structure verification: ${JSON.stringify(verification)}. Inspect ${result.dbUrl} before retrying.`);
        }
        return {
          ...result,
          source: serialized.source,
          root: serialized.root,
          sourceUnchanged: serialized.sourceUnchanged === true,
          prefabMetadata,
          referencePreflight,
          verification,
        };
      },
    },
    {
      name: 'create_prefab_instance',
      profile: 'full',
      description: '[core] Create a linked prefab in a saved scene through native editor messages and verify its identity, parent, name and local position. Reject linked parents, missing UI Canvas context, Canvas roots and enabled root Widget/parent Layout controllers. Requires explicit save; no runtime fallback on uncertain creation.',
      inputSchema: prefabInstanceSchema,
      handler: async (args) => createVerifiedPrefabInstance(sceneBridge, args),
    },
    {
      name: 'inspect_prefab_instance',
      profile: 'core',
      description: '[specialist] Inspect whether a scene node is linked to a prefab instance and return prefab metadata when available.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('getPrefabInstanceInfo', args),
    },
    {
      name: 'unlink_prefab_instance',
      profile: 'full',
      description: 'Unlink an explicitly selected, independent non-nested prefab instance through the native editor message. Verifies node/component identities, hierarchy, transforms and removed link metadata; requires a saved scene and explicit save afterward. Nested hierarchies are refused due to reference-persistence limits. No runtime fallback or automatic relink.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Exact instance-root hierarchy path.' },
          uuid: { type: 'string', description: 'Exact instance-root UUID.' },
          name: { type: 'string', description: 'Unique instance-root name. At least one selector is required; multiple selectors must match.' },
        },
        []
      ),
      handler: async (args) => unlinkPrefabInstance(sceneBridge, args),
    },
    {
      name: 'apply_prefab_instance',
      profile: 'full',
      description: 'Apply property changes from an explicit non-nested instance root to its source prefab through one native message. Verifies serialized source writeback and instance identity; affects other instances. Requires a saved scene and explicit scene save afterward. Refuses hierarchy/component changes, external scene references and unverifiable serialization. No automatic retry or rollback.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Exact instance-root hierarchy path.' },
          uuid: { type: 'string', description: 'Exact instance-root UUID.' },
          name: { type: 'string', description: 'Unique instance-root name. At least one selector is required; multiple selectors must match.' },
        },
        []
      ),
      handler: async (args) => applyPrefabInstance(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'revert_prefab_instance',
      profile: 'full',
      description: 'Discard property overrides on an explicit non-nested instance root through one native restore. Verifies source values, unchanged source asset and stable instance identities; preserves root name, position and rotation, but restores scale. Requires a saved scene and explicit save afterward. Refuses structure changes, external scene references and unverifiable serialization. No automatic retry or rollback.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Exact instance-root hierarchy path.' },
          uuid: { type: 'string', description: 'Exact instance-root UUID.' },
          name: { type: 'string', description: 'Unique instance-root name. At least one selector is required; multiple selectors must match.' },
        },
        []
      ),
      handler: async (args) => revertPrefabInstance(getRuntimeContext().projectPath, sceneBridge, args),
    },
    {
      name: 'instantiate_prefab',
      profile: 'full',
      description: 'Create a verified linked prefab instance using the same native editor workflow and safety checks as create_prefab_instance. Position is parent-local, and the scene must be saved explicitly; no unverified runtime fallback.',
      inputSchema: prefabInstanceSchema,
      handler: async (args) => createVerifiedPrefabInstance(sceneBridge, args),
    },
    {
      name: 'run_scene_asset',
      profile: 'full',
      description: 'Load a scene asset by uuid directly into the current runtime scene context.',
      inputSchema: createSchema(
        {
          sceneUuid: { type: 'string', description: 'Scene asset uuid.' },
        },
        ['sceneUuid']
      ),
      handler: async (args) => sceneBridge.call('runSceneAsset', args),
    },
    {
      name: 'list_assets',
      profile: 'core',
      description: '[specialist] Search project assets with bounded stable pagination, name/type/directory filters, optional subassets, and explicit duplicate-name candidates.',
      inputSchema: createSchema(
        {
          pattern: { type: 'string', minLength: 1, maxLength: 4096, description: 'Optional asset-db pattern such as db://assets/**. Project scope is still enforced unless scope is all.' },
          ccType: { type: 'string', minLength: 1, maxLength: 256, description: 'Optional exact Cocos asset type, such as cc.Prefab or cc.SceneAsset.' },
          name: { type: 'string', minLength: 1, maxLength: 256, description: 'Optional file, display, URL-basename, or extensionless-basename search text.' },
          nameMode: { type: 'string', enum: ['contains', 'prefix', 'exact'], description: 'Name matching mode. Defaults to contains.' },
          caseSensitive: { type: 'boolean', description: 'Use case-sensitive name matching. Defaults to false.' },
          directory: { type: 'string', minLength: 1, maxLength: 4096, description: 'Optional exact db://assets, assets-relative, or absolute project-assets directory.' },
          includeSubassets: { type: 'boolean', description: 'Include imported subassets such as SpriteFrames. Defaults to true.' },
          scope: { type: 'string', enum: ['project', 'all'], description: 'Search project assets by default; all also permits internal/editor assets.' },
          offset: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Stable result offset. Defaults to 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum page size. Defaults to 50.' },
        },
        []
      ),
      handler: async (args) => searchAssets({ ...args, projectPath: getRuntimeContext().projectPath }),
    },
    {
      name: 'find_asset_by_name',
      profile: 'core',
      description: '[specialist] Resolve one exact asset name without choosing arbitrarily: returns not_found, unique, or ambiguous plus bounded stable candidates. Use type, directory, or subasset filters to disambiguate.',
      inputSchema: createSchema(
        {
          name: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact file, display, URL-basename, or extensionless-basename to resolve.' },
          ccType: { type: 'string', minLength: 1, maxLength: 256, description: 'Optional exact Cocos asset type, such as cc.Prefab or cc.SpriteFrame.' },
          directory: { type: 'string', minLength: 1, maxLength: 4096, description: 'Optional exact db://assets, assets-relative, or absolute project-assets directory.' },
          caseSensitive: { type: 'boolean', description: 'Use case-sensitive exact matching. Defaults to false.' },
          includeSubassets: { type: 'boolean', description: 'Include imported subassets such as SpriteFrames. Defaults to true.' },
          scope: { type: 'string', enum: ['project', 'all'], description: 'Resolve project assets by default; all also permits internal/editor assets.' },
          maxCandidates: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum ambiguity candidates returned. Defaults to 50.' },
        },
        ['name']
      ),
      handler: async (args) => findAssetByName(args.name, {
        ...args,
        projectPath: getRuntimeContext().projectPath,
      }),
    },
    {
      name: 'inspect_asset',
      profile: 'core',
      description: '[specialist] Inspect one exact asset-db target with stable source/import/file/main-subasset details plus bounded info, metadata, and optional serialized data. Missing extensions are never guessed; missing files, query failures, and truncation remain visible.',
      inputSchema: createSchema(
        {
          target: { type: 'string', minLength: 1, maxLength: 4096, description: 'Exact asset UUID, db URL, project assets path, or absolute path inside this project assets directory.' },
          includeData: { type: 'boolean', description: 'Include serialized asset data when available.' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum nested depth retained in info, metadata, and serialized data. Defaults to 6.' },
          maxItems: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum entries retained per object/array and in the subasset catalog. Defaults to 100.' },
          maxNodes: { type: 'integer', minimum: 10, maximum: 5000, description: 'Maximum values visited per returned snapshot. Defaults to 1000.' },
          maxStringLength: { type: 'integer', minimum: 64, maximum: 20000, description: 'Maximum characters retained per string. Defaults to 4000.' },
          maxCharacters: { type: 'integer', minimum: 1000, maximum: 250000, description: 'Maximum string characters retained per returned snapshot. Defaults to 50000.' },
        },
        ['target']
      ),
      handler: async (args) => inspectAsset(args.target, {
        ...args,
        projectPath: getRuntimeContext().projectPath,
      }),
    },
    {
      name: 'open_asset',
      profile: 'core',
      description: '[specialist] Open an asset inside Cocos Creator by uuid, db url, or path. Use this only when opening the asset itself is the explicit next step.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Asset uuid, db url, or path.' },
        },
        ['target']
      ),
      handler: async (args) => await openAsset(args.target),
    },
    {
      name: 'delete_asset',
      profile: 'full',
      description: 'Safely delete an exact project prefab or imported JSON, text, image, or audio main asset through one asset-db request. External main/subasset UUID references must be absent; same-main internal subasset links are ignored. Identity, source bytes, metadata, mappings, and source/.meta removal are verified. No force, cascade, directory, subasset, script, or scene deletion.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Asset uuid, db url, or path.' },
        },
        ['target']
      ),
      handler: async (args) => await deleteAsset(args.target, { projectPath: getRuntimeContext().projectPath }),
    },
    {
      name: 'select_asset',
      profile: 'core',
      description: '[specialist] Select an asset in the Cocos editor. Use this when editor selection state matters; otherwise keep execute_javascript as the primary workflow.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Asset uuid, db url, or path.' },
        },
        ['target']
      ),
      handler: async (args) => {
        const info = await queryAssetInfo(args.target);
        return selectAsset(info.uuid || args.target);
      },
    },
    ...createAssetsAdvancedTools({ createSchema, getRuntimeContext }),
    {
      name: 'query_asset_path',
      profile: 'full',
      description: 'Resolve one exact asset UUID, db URL, project-relative or absolute asset path to its verified source path. Imported subassets report their parent file as the physical source and mark the native @ mapping as non-physical. Missing or inconsistent identities return an incomplete status rather than a usable file path.',
      inputSchema: createSchema({
        target: { type: 'string', description: 'Exact asset UUID, db URL, project assets path, or absolute path inside project assets.' },
      }, ['target']),
      handler: async (args) => queryAssetPath(args.target,
        { projectPath: getRuntimeContext().projectPath }),
    },
    {
      name: 'query_asset_uuid',
      profile: 'full',
      description: 'Resolve one exact asset URL, project path, or UUID to a verified imported UUID. Cross-check asset-db identity and native URL-to-UUID mapping; preserve subasset UUIDs and verify their parent link. Missing or inconsistent records never provide a selected UUID.',
      inputSchema: createSchema({
        target: { type: 'string', description: 'Exact asset UUID, db URL, project assets path, or absolute path inside project assets.' },
      }, ['target']),
      handler: async (args) => queryAssetUuid(args.target,
        { projectPath: getRuntimeContext().projectPath }),
    },
    {
      name: 'query_asset_url',
      profile: 'full',
      description: 'Resolve one exact asset UUID, db URL, or project path to its verified canonical asset URL. Native query-url may return a subasset @ alias; the tool cross-checks that alias before returning the canonical URL from asset-db. Missing or inconsistent records never provide a selected URL.',
      inputSchema: createSchema({
        target: { type: 'string', description: 'Exact asset UUID, db URL, project assets path, or absolute path inside project assets.' },
      }, ['target']),
      handler: async (args) => queryAssetUrl(args.target,
        { projectPath: getRuntimeContext().projectPath }),
    },
    {
      name: 'check_asset_ready',
      profile: 'full',
      description: 'Read-only bounded check of Cocos asset-db readiness. With a target UUID or db URL, require two stable imported identity reads and matching UUID/URL lookups. Without a target, confirm only asset-db query readiness. A native ready response does not prove the importer queue, source bytes, or build outputs are complete.',
      inputSchema: createSchema({
        target: { type: 'string', description: 'Optional exact asset UUID or db://assets / db://internal URL.' },
        waitMs: { type: 'integer', minimum: 0, maximum: 10000, description: 'Maximum polling wait in milliseconds; defaults to 1500. Zero performs one unconfirmed observation.' },
        pollMs: { type: 'integer', minimum: 0, maximum: 2000, description: 'Milliseconds between reads; defaults to 150 and must be positive when waiting.' },
      }, []),
      handler: async (args) => checkAssetReady(args),
    },
    {
      name: 'get_editor_selection',
      profile: 'full',
      description: '[compat] Return the current node and asset selection in the Cocos editor. Prefer get_selection as the primary structured selection read tool.',
      inputSchema: createSchema({}, []),
      handler: async () => getCurrentSelection(),
    },
    {
      name: 'list_available_component_types',
      profile: 'full',
      description: 'List registered built-in Component classes and bounded project script assets, marking missing component registrations, invalid assets, and non-Component candidates. Probe up to 32 exact class names; attachability is not a node-specific guarantee.',
      inputSchema: createSchema(
        {
          maxProjectScripts: { type: 'integer', minimum: 1, maximum: 256, description: 'Maximum project script assets to inspect; defaults to 128.' },
          candidateNames: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 128 }, description: 'Optional exact registered class names to probe, including missing or non-Component names.' },
        },
        []
      ),
      handler: async (args) => {
        const maxProjectScripts = args.maxProjectScripts == null ? 128 : args.maxProjectScripts;
        if (!Number.isInteger(maxProjectScripts) || maxProjectScripts < 1 || maxProjectScripts > 256) {
          throw new Error('maxProjectScripts must be an integer between 1 and 256.');
        }
        const scripts = await listAssets({ pattern: 'db://assets/**', ccType: 'cc.Script' });
        const records = scripts
          .filter((asset) => asset && typeof asset.uuid === 'string')
          .sort((a, b) => String(a.url || '').localeCompare(String(b.url || '')))
          .slice(0, maxProjectScripts)
          .map((asset) => ({ uuid: asset.uuid, url: asset.url, imported: asset.imported, invalid: asset.invalid }));
        return sceneBridge.call('listAvailableComponentTypes', {
          candidateNames: args.candidateNames,
          scriptAssets: records,
          projectScriptCount: scripts.length,
          projectScriptsTruncated: scripts.length > maxProjectScripts,
        });
      },
    },
    {
      name: 'list_components',
      profile: 'full',
      description: '[core] List bounded live component property snapshots on a scene node. Project script fields without CCClass declarations require includeRuntimeFields; their visibility and persistence are unknown.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          maxComponents: { type: 'integer', minimum: 1, maximum: 128, description: 'Maximum returned components; defaults to 32.' },
          maxProperties: { type: 'integer', minimum: 1, maximum: 32, description: 'Maximum returned public properties per component; defaults to 12.' },
          includeRuntimeFields: { type: 'boolean', description: 'Include undeclared own fields of project scripts; defaults to false. Such fields may be TypeScript private and are not proven persistent.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('listComponents', args),
    },
    {
      name: 'inspect_component',
      profile: 'full',
      description: '[core] Inspect one selected component with bounded live property values and direct serialization metadata. Project script fields without CCClass declarations require includeRuntimeFields; duplicate classes require an index.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'integer', minimum: 0, description: 'Zero-based component index; required when the class appears more than once.' },
          maxProperties: { type: 'integer', minimum: 1, maximum: 80, description: 'Maximum returned public properties; defaults to 32.' },
          includeRuntimeFields: { type: 'boolean', description: 'Include undeclared own fields of project scripts; defaults to false. Such fields may be TypeScript private and are not proven persistent.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('inspectComponent', args),
    },
    {
      name: 'add_component',
      profile: 'full',
      description: 'Add a registered Cocos Component to an ordinary scene node by class name. Reports automatically added dependencies; Creator enforces duplicate rules. Save the scene to persist the change.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name, for example Sprite or cc.UITransform.' },
        },
        ['componentName']
      ),
      handler: async (args) => sceneBridge.call('addComponent', args),
    },
    {
      name: 'attach_script_component',
      profile: 'full',
      description: 'Attach an imported project script as a component by its asset path or UUID. Resolves the registered class from the script UUID, waits briefly for compilation, and avoids duplicate attachment. Save the scene to persist it.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Target node hierarchy path.' },
          uuid: { type: 'string', description: 'Target node UUID.' },
          name: { type: 'string', description: 'Exact, unique target node name.' },
          scriptTarget: { type: 'string', description: 'Imported .ts/.js script asset path, db URL, or UUID.' },
          waitForCompileMs: { type: 'integer', description: 'Wait for the registered component class (0-10000 ms, default 5000).' },
        },
        ['scriptTarget']
      ),
      handler: async (args) => {
        const info = await queryAssetInfo(args.scriptTarget);
        if (info.type !== 'cc.Script' || info.imported !== true || info.invalid === true || !info.uuid) {
          throw new Error(`Target is not a ready cc.Script asset: ${args.scriptTarget}`);
        }
        const result = await sceneBridge.call('attachScriptComponent', {
          path: args.path,
          uuid: args.uuid,
          name: args.name,
          scriptUuid: info.uuid,
          waitForCompileMs: args.waitForCompileMs,
        });
        return { ...result, scriptUrl: info.url || info.source || '' };
      },
    },
    {
      name: 'detach_script_component',
      profile: 'full',
      annotations: { destructiveHint: true },
      description: 'Remove an imported project script component from an ordinary scene node by script asset path or UUID. Refuses removal when active-scene component properties or Button click events still reference it. Save the scene to persist the change.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Target node hierarchy path.' },
          uuid: { type: 'string', description: 'Target node UUID.' },
          name: { type: 'string', description: 'Exact, unique target node name.' },
          scriptTarget: { type: 'string', description: 'Imported .ts/.js script asset path, db URL, or UUID.' },
        },
        ['scriptTarget']
      ),
      handler: async (args) => {
        const info = await queryAssetInfo(args.scriptTarget);
        if (info.type !== 'cc.Script' || info.imported !== true || info.invalid === true || !info.uuid) {
          throw new Error(`Target is not a ready cc.Script asset: ${args.scriptTarget}`);
        }
        const result = await sceneBridge.call('detachScriptComponent', {
          path: args.path,
          uuid: args.uuid,
          name: args.name,
          scriptUuid: info.uuid,
        });
        return { ...result, scriptUrl: info.url || info.source || '' };
      },
    },
    {
      name: 'remove_component',
      profile: 'full',
      description: 'Remove exactly one component from an ordinary scene node by class name or index. Rejects required or referenced components and waits for Creator to finish removal. Save the scene to persist the change.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'integer', minimum: 0, description: 'Zero-based component index; required when multiple components share the same class.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('removeComponent', args),
    },
    {
      name: 'set_component_property',
      profile: 'full',
      description: 'Set one editable top-level component property with validated JSON. Supports declared script fields and selected Cocos UI properties, with typed Color, Vec, node, component, and asset references; linked prefab instances are excluded. Adds read-only UI viewport context for the target when computable. Save and reopen to verify persistence.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'integer', minimum: 0, description: 'Zero-based component index; required when the class appears more than once.' },
          propertyPath: { type: 'string', description: 'One public top-level field name; dot paths are rejected.' },
          valueJson: { type: 'string', maxLength: 4096, description: 'JSON value. References use {"uuid":"scene-node-uuid"} or {"assetUuid":"asset-uuid"}; Color accepts #RRGGBB[AA] or RGBA object.' },
        },
        ['propertyPath', 'valueJson']
      ),
      handler: async (args) => {
        if (typeof args.valueJson !== 'string' || args.valueJson.length > 4096) {
          throw new Error('valueJson must be a JSON string of at most 4096 characters.');
        }
        let value;
        try {
          value = JSON.parse(args.valueJson);
        } catch (error) {
          throw new Error(`valueJson must be valid JSON: ${error.message}`);
        }
        return attachUIViewport(sceneBridge, await sceneBridge.call('setComponentProperty', { ...args, value }));
      },
    },
    {
      name: 'reset_component_property_to_default',
      profile: 'full',
      description: 'Restore a writable, serialized, public component field to its declared Cocos CCClass default. Supports primitives, Cocos ValueTypes, and bounded arrays; rejects linked prefab instances and unsupported defaults. Save the scene to persist the change.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Target node hierarchy path.' },
          uuid: { type: 'string', description: 'Target node UUID.' },
          name: { type: 'string', description: 'Exact, unique target node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'integer', description: 'Exact component index; may be combined with componentName as a guard.' },
          propertyName: { type: 'string', description: 'Public top-level serialized field name, without dots.' },
        },
        ['propertyName']
      ),
      handler: async (args) => sceneBridge.call('resetComponentPropertyToDefault', args),
    },
    {
      name: 'reset_component_property',
      profile: 'full',
      description: 'Clear a component property by dot path. This does not restore the Cocos class default; inspect and save the scene to verify persistence.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'number', description: 'Optional component index.' },
          propertyPath: { type: 'string', description: 'Property path such as color.r or enabled.' },
        },
        ['propertyPath']
      ),
      handler: async (args) => sceneBridge.call('resetComponentProperty', args),
    },
    {
      name: 'create_canvas',
      profile: 'full',
      description: 'Create a Cocos Canvas node with UITransform.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Canvas node name.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          width: { type: 'number', description: 'Canvas width.' },
          height: { type: 'number', description: 'Canvas height.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('createCanvas', args),
    },
    {
      name: 'create_label',
      profile: 'full',
      description: 'Create a UI Label node under a parent.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Label node name.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          text: { type: 'string', description: 'Label text.' },
          fontSize: { type: 'number', description: 'Font size.' },
          width: { type: 'number', description: 'UI width.' },
          height: { type: 'number', description: 'UI height.' },
          color: { type: 'string', description: 'Text color as #RRGGBB or #RRGGBBAA.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('createLabel', args),
    },
    {
      name: 'create_button',
      profile: 'full',
      description: 'Create a UI Button node with child Label.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Button node name.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          text: { type: 'string', description: 'Button text.' },
          width: { type: 'number', description: 'Button width.' },
          height: { type: 'number', description: 'Button height.' },
          fontSize: { type: 'number', description: 'Text font size.' },
          backgroundColor: { type: 'string', description: 'Background color as #RRGGBB or #RRGGBBAA.' },
          textColor: { type: 'string', description: 'Text color as #RRGGBB or #RRGGBBAA.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('createButton', args),
    },
    {
      name: 'create_sprite',
      profile: 'full',
      description: 'Create a UI Sprite node. spriteFrameTarget accepts an imported image path, ImageAsset UUID, or SpriteFrame UUID and resolves it before creating the node.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Sprite node name.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          spriteFrameUuid: { type: 'string', description: 'Optional SpriteFrame asset uuid.' },
          spriteFrameTarget: { type: 'string', description: 'Optional db://assets or assets/ image path, ImageAsset UUID, or SpriteFrame UUID. Do not combine with spriteFrameUuid.' },
          width: { type: 'number', description: 'UI width.' },
          height: { type: 'number', description: 'UI height.' },
          color: { type: 'string', description: 'Sprite color as #RRGGBB or #RRGGBBAA.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
        },
        []
      ),
      handler: async (args) => {
        if (args.spriteFrameTarget !== undefined && args.spriteFrameUuid !== undefined) {
          throw new Error('Provide either spriteFrameTarget or spriteFrameUuid, not both.');
        }
        if (args.spriteFrameTarget === undefined) {
          return sceneBridge.call('createSprite', args);
        }
        const resolution = await resolveSpriteFrameTarget(args.spriteFrameTarget);
        const { spriteFrameTarget, ...spriteOptions } = args;
        const created = await sceneBridge.call('createSprite', {
          ...spriteOptions,
          spriteFrameUuid: resolution.spriteFrame.uuid,
        });
        return { ...created, spriteFrameResolution: resolution };
      },
    },
    {
      name: 'set_sprite_frame',
      profile: 'full',
      description: 'Replace the SpriteFrame on an existing Sprite node. Resolve an imported image path, ImageAsset UUID, or exact SpriteFrame UUID before changing the component.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Existing Sprite node hierarchy path.' },
          uuid: { type: 'string', description: 'Existing Sprite node UUID.' },
          name: { type: 'string', description: 'Fallback exact Sprite node name.' },
          spriteFrameTarget: { type: 'string', description: 'Imported image path, ImageAsset UUID, or exact SpriteFrame UUID.' },
        },
        ['spriteFrameTarget']
      ),
      handler: async (args) => {
        const resolution = await resolveSpriteFrameTarget(args.spriteFrameTarget);
        const updated = await sceneBridge.call('setSpriteFrame', {
          path: args.path,
          uuid: args.uuid,
          name: args.name,
          spriteFrameUuid: resolution.spriteFrame.uuid,
        });
        return { ...updated, spriteFrameResolution: resolution };
      },
    },
    {
      name: 'list_cameras',
      profile: 'full',
      description: '[core] List Camera components in the active scene.',
      inputSchema: createSchema({}, []),
      handler: async (args) => sceneBridge.call('listCameras', args),
    },
    {
      name: 'create_camera',
      profile: 'full',
      description: 'Create a Camera node in the active scene.',
      inputSchema: createSchema(
        {
          name: { type: 'string', description: 'Camera node name.' },
          parentPath: { type: 'string', description: 'Optional parent node path.' },
          priority: { type: 'number', description: 'Camera priority.' },
          visibility: { type: 'number', description: 'Camera visibility mask.' },
          clearFlags: { type: 'number', description: 'Camera clear flags.' },
          position: { type: 'object', description: 'Optional position {x,y,z}.' },
          eulerAngles: { type: 'object', description: 'Optional rotation {x,y,z}.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('createCamera', args),
    },
    {
      name: 'set_camera_properties',
      profile: 'full',
      description: 'Set selected Camera component properties.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Camera node path.' },
          uuid: { type: 'string', description: 'Camera node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          priority: { type: 'number', description: 'Camera priority.' },
          visibility: { type: 'number', description: 'Camera visibility mask.' },
          clearFlags: { type: 'number', description: 'Camera clear flags.' },
          projection: { type: 'number', description: 'Projection enum value.' },
          orthoHeight: { type: 'number', description: 'Ortho height.' },
          fov: { type: 'number', description: 'Field of view.' },
          near: { type: 'number', description: 'Near clip.' },
          far: { type: 'number', description: 'Far clip.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('setCameraProperties', args),
    },
    {
      name: 'list_animations',
      profile: 'full',
      description: '[core] List Animation components in the active scene or under one node.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Optional node path.' },
          uuid: { type: 'string', description: 'Optional node uuid.' },
          name: { type: 'string', description: 'Optional exact node name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('listAnimations', args),
    },
    {
      name: 'add_animation_clip',
      profile: 'full',
      description: 'Add an AnimationClip asset to a node Animation component.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          clipUuid: { type: 'string', description: 'AnimationClip asset uuid.' },
          makeDefault: { type: 'boolean', description: 'Set this clip as defaultClip.' },
        },
        ['clipUuid']
      ),
      handler: async (args) => sceneBridge.call('addAnimationClip', args),
    },
    {
      name: 'play_animation',
      profile: 'full',
      description: '[core] Play an Animation component clip on a node.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          clipName: { type: 'string', description: 'Optional clip name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('playAnimation', args),
    },
    {
      name: 'stop_animation',
      profile: 'full',
      description: '[core] Stop an Animation component clip on a node.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          clipName: { type: 'string', description: 'Optional clip name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('stopAnimation', args),
    },
    ...createFileTools({ createSchema, getRuntimeContext }),
    {
      name: 'run_script_diagnostics',
      profile: 'core',
      description: '[specialist] Run a TypeScript no-emit check for the current Cocos project and return parsed diagnostics. This is a preferred specialist tool for script errors when diagnostics are needed.',
      inputSchema: createSchema(
        {
          tsconfigPath: { type: 'string', description: 'Optional path to the tsconfig file to use.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await runScriptDiagnostics(projectPath, args);
      },
    },
    {
      name: 'get_recent_logs',
      profile: 'core',
      description: '[specialist] Return recent MCP runtime logs, recent tool interactions, and tails of common project log files.',
      inputSchema: createSchema(
        {
          limit: { type: 'number', description: 'Maximum in-memory runtime/interactions to return.' },
          includeProjectLogs: { type: 'boolean', description: 'Include tails from common project log files.' },
          projectLogLines: { type: 'number', description: 'Tail lines to read per project log file.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(200, args.limit)) : 50;
        return {
          runtimeLogs: runtimeLog && typeof runtimeLog.list === 'function' ? runtimeLog.list(limit) : [],
          interactions: interactionLog && typeof interactionLog.list === 'function' ? interactionLog.list(limit) : [],
          projectLogs: args.includeProjectLogs === false
            ? []
            : getRecentProjectLogs(projectPath, {
                limit: 10,
                lines: Number.isFinite(args.projectLogLines) ? args.projectLogLines : 80,
              }),
        };
      },
    },
    {
      name: 'search_project_logs',
      profile: 'core',
      description: '[specialist] Search common Cocos project log files for a string or regular expression.',
      inputSchema: createSchema(
        {
          query: { type: 'string', description: 'Text or regex pattern to search for.' },
          regex: { type: 'boolean', description: 'Treat query as a JavaScript regular expression.' },
          caseSensitive: { type: 'boolean', description: 'Use case-sensitive matching.' },
          limit: { type: 'number', description: 'Maximum matches to return.' },
          directory: { type: 'string', description: 'Optional project-relative log directory to search.' },
        },
        ['query']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return searchProjectLogs(projectPath, args);
      },
    },
    {
      name: 'clear_logs',
      profile: 'core',
      description: '[specialist] Clear in-memory MCP logs and, only with explicit confirmation, truncate common project log files.',
      inputSchema: createSchema(
        {
          scope: { type: 'string', description: 'mcp, project, or all. Defaults to mcp.' },
          confirmProjectLogs: { type: 'boolean', description: 'Required when scope includes project log files.' },
          directory: { type: 'string', description: 'Optional project-relative log directory to clear.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const scope = String(args.scope || 'mcp').toLowerCase();
        const clearMcp = scope === 'mcp' || scope === 'all';
        const clearProject = scope === 'project' || scope === 'all';
        const result = {
          runtimeLogEntriesCleared: 0,
          interactionEntriesCleared: 0,
          projectLogFilesCleared: [],
        };

        if (clearMcp) {
          result.runtimeLogEntriesCleared = runtimeLog && typeof runtimeLog.clear === 'function' ? runtimeLog.clear() : 0;
          result.interactionEntriesCleared = interactionLog && typeof interactionLog.clear === 'function' ? interactionLog.clear() : 0;
        }

        if (clearProject) {
          if (!args.confirmProjectLogs) {
            throw new Error('confirmProjectLogs=true is required before truncating project log files.');
          }
          result.projectLogFilesCleared = clearProjectLogFiles(projectPath, { directory: args.directory, limit: 50 });
        }

        if (!clearMcp && !clearProject) {
          throw new Error("scope must be 'mcp', 'project', or 'all'.");
        }

        return result;
      },
    },
    {
      name: 'validate_scene',
      profile: 'core',
      description: '[specialist] Run a compact validation pass over the active scene, runtime state, TypeScript diagnostics, and recent project log errors.',
      inputSchema: createSchema(
        {
          maxDepth: { type: 'number', description: 'Scene hierarchy depth for the scene snapshot.' },
          includeScriptDiagnostics: { type: 'boolean', description: 'Run TypeScript diagnostics as part of validation.' },
          includeLogErrors: { type: 'boolean', description: 'Search project logs for error lines.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const scene = await sceneBridge.call('getSceneInfo', {
          maxDepth: Number.isFinite(args.maxDepth) ? args.maxDepth : 2,
          includeComponents: true,
        }).catch((error) => ({ ok: false, error: error.message }));
        const runtime = await previewRuntime.controlPreviewToolbar({ action: 'state' }).catch((error) => ({ ok: false, error: error.message }));
        const performance = await sceneBridge.call('getPerformanceSnapshot', {}).catch((error) => ({ ok: false, error: error.message }));
        const diagnostics = args.includeScriptDiagnostics === false
          ? null
          : summarizeDiagnostics(await runScriptDiagnostics(projectPath, args).catch((error) => ({ ok: false, summary: error.message, diagnostics: [] })));
        const logErrors = args.includeLogErrors === false
          ? null
          : searchProjectLogs(projectPath, { query: 'error', limit: 20 }).matches;

        return {
          ok: !scene.error && !runtime.error && !performance.error && (!diagnostics || diagnostics.ok) && (!logErrors || logErrors.length === 0),
          scene,
          runtime,
          performance,
          diagnostics,
          logErrors,
        };
      },
    },
    {
      name: 'get_performance_snapshot',
      profile: 'core',
      description: '[specialist] Return edit-scene scale and performance-oriented counters such as node/component counts, UI counts, depth, memory, and warnings. Its director counters are not Game View preview state.',
      inputSchema: createSchema({}, []),
      handler: async (args) => sceneBridge.call('getPerformanceSnapshot', args),
    },
    {
      name: 'get_runtime_state',
      profile: 'core',
      description: '[specialist] Return the editor Game View preview running/paused state and toolbar synchronization status, not edit-scene director counters. Does not inspect browser or simulator runtime state.',
      inputSchema: createSchema({}, []),
      handler: async () => previewRuntime.controlPreviewToolbar({ action: 'state' }),
    },
    {
      name: 'pause_runtime',
      profile: 'full',
      description: '[core] Pause an active editor Game View preview through the native toolbar. Idempotent; does not pause the edit-scene director, browser, or simulator.',
      inputSchema: createSchema({}, []),
      handler: async () => previewRuntime.controlPreviewToolbar({ action: 'pause' }),
    },
    {
      name: 'resume_runtime',
      profile: 'full',
      description: '[core] Resume a paused editor Game View preview through the native toolbar. Idempotent; requires a running Game View preview.',
      inputSchema: createSchema({}, []),
      handler: async () => previewRuntime.controlPreviewToolbar({ action: 'resume' }),
    },
    {
      name: 'set_time_scale',
      profile: 'full',
      description: '[core] Set the edit-scene Cocos scheduler time scale. Does not change the separate Game View preview runtime.',
      inputSchema: createSchema(
        {
          scale: { type: 'number', description: 'Time scale from 0 to 100.' },
        },
        ['scale']
      ),
      handler: async (args) => sceneBridge.call('setTimeScale', args),
    },
    {
      name: 'emit_node_event',
      profile: 'full',
      description: '[core] Emit a custom event on a target scene node with an optional JSON payload.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          eventName: { type: 'string', description: 'Event name to emit.' },
          payload: { type: 'object', description: 'Optional event payload object.' },
        },
        ['eventName']
      ),
      handler: async (args) => sceneBridge.call('emitNodeEvent', args),
    },
    {
      name: 'simulate_button_click',
      profile: 'full',
      description: '[core] Simulate a Cocos Button click by emitting click events on the target button node.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Button node hierarchy path.' },
          uuid: { type: 'string', description: 'Button node uuid.' },
          name: { type: 'string', description: 'Fallback exact button node name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('simulateButtonClick', args),
    },
    ...createSceneEventTools({ createSchema, sceneBridge }),
    {
      name: 'invoke_component_method',
      profile: 'full',
      description: '[core] Invoke a method on a component for runtime validation and test hooks.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Node hierarchy path.' },
          uuid: { type: 'string', description: 'Node uuid.' },
          name: { type: 'string', description: 'Fallback exact node name.' },
          componentName: { type: 'string', description: 'Component class name.' },
          index: { type: 'number', description: 'Optional component index.' },
          methodName: { type: 'string', description: 'Method name to invoke.' },
          args: { type: 'array', description: 'Optional argument array.' },
        },
        ['methodName']
      ),
      handler: async (args) => sceneBridge.call('invokeComponentMethod', args),
    },
    {
      name: 'get_script_diagnostic_context',
      profile: 'core',
      description: '[specialist] Run TypeScript diagnostics and attach source snippets for each error. This is a preferred specialist tool for compile-error triage before repair.',
      inputSchema: createSchema(
        {
          tsconfigPath: { type: 'string', description: 'Optional path to the tsconfig file to use.' },
          contextLines: { type: 'number', description: 'Number of surrounding source lines per diagnostic.' },
          limit: { type: 'number', description: 'Maximum diagnostics to include.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const result = await runScriptDiagnostics(projectPath, args);
        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10;
        const contextLines = Number.isFinite(args.contextLines) ? Math.max(0, Math.min(20, args.contextLines)) : 3;
        const diagnostics = result.diagnostics.slice(0, limit).map((diagnostic) => ({
          ...diagnostic,
          snippet: fs.existsSync(diagnostic.file)
            ? buildSnippet(diagnostic.file, diagnostic.line, contextLines)
            : 'Source file not found.',
        }));

        return {
          ...result,
          diagnostics,
        };
      },
    },
    {
      name: 'capture_desktop_screenshot',
      profile: 'full',
      description: '[core] Capture a screenshot from the local desktop and return it as an MCP image payload.',
      inputSchema: createSchema(
        {
          fileName: { type: 'string', description: 'Optional output file name under temp/mcp-captures.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const result = await captureDesktopScreenshot(projectPath, args);
        return result.dataUri;
      },
    },
    {
      name: 'capture_editor_screenshot',
      profile: 'core',
      description: '[specialist] Capture one unique visible Creator main window as PNG plus source metadata. No focused-window fallback; use windowId/titleContains to disambiguate. Never overwrite a capture file or infer visual correctness.',
      inputSchema: createSchema(
        {
          fileName: { type: 'string', description: 'Optional output file name under temp/mcp-captures.' },
          titleContains: { type: 'string', description: 'Strict window title substring; no fallback.' },
          windowId: { type: 'integer', minimum: 1, description: 'Exact Electron window ID from list_editor_windows.' },
        },
        []
      ),
      handler: async (args, call) => {
        const { projectPath } = getRuntimeContext();
        const { dataUri, ...result } = await captureEditorWindowScreenshot(projectPath, args);
        call.image = dataUri;
        return result;
      },
    },
    {
      name: 'capture_scene_screenshot',
      profile: 'core',
      description: '[specialist] Capture the verified visible Scene webview crop, not Game View or an arbitrary canvas. Returns PNG and source/crop metadata; hidden, missing, ambiguous or changed targets fail without fallback. No visual verdict.',
      inputSchema: createSchema(
        {
          fileName: { type: 'string', description: 'Optional output file name under temp/mcp-captures.' },
          windowKind: { type: 'string', enum: ['editor', 'focused'], description: 'Main editor only; focused is a legacy alias, not a fallback.' },
          titleContains: { type: 'string', description: 'Strict window title substring; no fallback.' },
          windowId: { type: 'integer', minimum: 1, description: 'Exact Electron window ID from list_editor_windows.' },
        },
        []
      ),
      handler: async (args, call) => {
        const { projectPath } = getRuntimeContext();
        const { dataUri, ...result } = await capturePanelScreenshot(projectPath, { ...args, panel: 'scene', windowKind: args.windowKind || 'editor' });
        call.image = dataUri;
        return result;
      },
    },
    {
      name: 'capture_game_screenshot',
      profile: 'full',
      description: '[core] Capture the verified visible embedded Game View crop with runtime/source metadata. Requires an already running synchronized preview; never starts it or falls back to Scene/browser/simulator. Pixels are not a visual pass or runtime scene freshness proof.',
      inputSchema: createSchema(
        {
          fileName: { type: 'string', description: 'Optional output file name under temp/mcp-captures.' },
          windowKind: { type: 'string', enum: ['editor', 'focused'], description: 'Main editor only; external preview/simulator is unsupported.' },
          titleContains: { type: 'string', description: 'Strict window title substring; no fallback.' },
          windowId: { type: 'integer', minimum: 1, description: 'Exact Electron window ID from list_editor_windows.' },
        },
        []
      ),
      handler: async (args, call) => {
        const { projectPath } = getRuntimeContext();
        const { dataUri, ...result } = await capturePanelScreenshot(projectPath, { ...args, panel: 'game', windowKind: args.windowKind || 'editor' });
        call.image = dataUri;
        return result;
      },
    },
    {
      name: 'list_editor_windows',
      profile: 'core',
      description: '[specialist] List available Electron windows so screenshots or input-targeting can choose the correct window. Use this when window targeting is the explicit problem.',
      inputSchema: createSchema({}, []),
      handler: async () => listWindows(),
    },
    {
      name: 'simulate_mouse_click',
      profile: 'full',
      description: '[core] Send a low-level Electron mouse click to the editor, preview, or simulator window.',
      inputSchema: createSchema(
        {
          windowKind: { type: 'string', description: 'Window target kind: focused, editor, simulator, or preview.' },
          panel: { type: 'string', description: 'Optional panel hint such as scene or game.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          x: { type: 'number', description: 'Panel-relative or window-relative x offset from center/focus target.' },
          y: { type: 'number', description: 'Panel-relative or window-relative y offset from center/focus target.' },
          button: { type: 'string', description: 'Mouse button: left, right, or middle.' },
          clickCount: { type: 'number', description: 'Click count.' },
          modifiers: { type: 'array', description: 'Optional key modifiers array.' },
        },
        []
      ),
      handler: async (args) => await sendMouseClick(args),
    },
    {
      name: 'simulate_mouse_drag',
      profile: 'full',
      description: '[core] Send a low-level Electron mouse drag to the editor, preview, or simulator window.',
      inputSchema: createSchema(
        {
          windowKind: { type: 'string', description: 'Window target kind: focused, editor, simulator, or preview.' },
          panel: { type: 'string', description: 'Optional panel hint such as scene or game.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          startX: { type: 'number', description: 'Start x offset.' },
          startY: { type: 'number', description: 'Start y offset.' },
          endX: { type: 'number', description: 'End x offset.' },
          endY: { type: 'number', description: 'End y offset.' },
          button: { type: 'string', description: 'Mouse button: left, right, or middle.' },
          steps: { type: 'number', description: 'How many intermediate move steps to send.' },
          stepDelayMs: { type: 'number', description: 'Optional delay between drag steps.' },
          modifiers: { type: 'array', description: 'Optional key modifiers array.' },
        },
        []
      ),
      handler: async (args) => await sendMouseDrag(args),
    },
    {
      name: 'simulate_key_press',
      profile: 'full',
      description: '[core] Send a low-level Electron key press to the editor, preview, or simulator window.',
      inputSchema: createSchema(
        {
          windowKind: { type: 'string', description: 'Window target kind: focused, editor, simulator, or preview.' },
          panel: { type: 'string', description: 'Optional panel hint such as scene or game.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          keyCode: { type: 'string', description: 'Electron keyCode such as A, Space, Enter, ArrowLeft.' },
          text: { type: 'string', description: 'Optional text payload for char events.' },
          modifiers: { type: 'array', description: 'Optional key modifiers array.' },
        },
        ['keyCode']
      ),
      handler: async (args) => await sendKeyPress(args),
    },
    {
      name: 'simulate_key_combo',
      profile: 'full',
      description: '[core] Send a low-level Electron modified key press such as Ctrl+S or Cmd+P.',
      inputSchema: createSchema(
        {
          windowKind: { type: 'string', description: 'Window target kind: focused, editor, simulator, or preview.' },
          panel: { type: 'string', description: 'Optional panel hint such as scene or game.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          keyCode: { type: 'string', description: 'Electron keyCode such as S, P, Enter.' },
          modifiers: { type: 'array', description: 'Modifier array such as [\"command\"] or [\"control\",\"shift\"].' },
        },
        ['keyCode', 'modifiers']
      ),
      handler: async (args) => await sendKeyCombo(args),
    },
    {
      name: 'simulate_preview_input',
      profile: 'full',
      description: '[core] Convenience wrapper for low-level preview/simulator input. Uses mouse click by default or key press when keyCode is provided.',
      inputSchema: createSchema(
        {
          windowKind: { type: 'string', description: 'Window target kind, usually preview or simulator.' },
          panel: { type: 'string', description: 'Optional panel hint such as game.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          mode: { type: 'string', description: 'click, drag, key, or combo.' },
          x: { type: 'number', description: 'Mouse x offset.' },
          y: { type: 'number', description: 'Mouse y offset.' },
          startX: { type: 'number', description: 'Drag start x offset.' },
          startY: { type: 'number', description: 'Drag start y offset.' },
          endX: { type: 'number', description: 'Drag end x offset.' },
          endY: { type: 'number', description: 'Drag end y offset.' },
          keyCode: { type: 'string', description: 'Electron keyCode for key or combo mode.' },
          text: { type: 'string', description: 'Optional char payload.' },
          button: { type: 'string', description: 'Mouse button.' },
          modifiers: { type: 'array', description: 'Modifier array.' },
        },
        []
      ),
      handler: async (args) => {
        const mode = String(args.mode || (args.keyCode ? 'key' : 'click')).toLowerCase();
        const base = { ...args, windowKind: args.windowKind || 'preview', panel: args.panel || 'game' };
        if (mode === 'drag') return await sendMouseDrag(base);
        if (mode === 'combo') return await sendKeyCombo(base);
        if (mode === 'key') return await sendKeyPress(base);
        return await sendMouseClick(base);
      },
    },
    {
      name: 'capture_preview_screenshot',
      profile: 'core',
      description: '[specialist] Alias for strictly cropped embedded Game View capture with PNG and metadata. Requires a running preview in the unique visible Creator main window. External browser/simulator windows are unsupported and never selected by fallback.',
      inputSchema: createSchema(
        {
          fileName: { type: 'string', description: 'Optional output file name under temp/mcp-captures.' },
          windowKind: { type: 'string', enum: ['editor', 'focused'], description: 'Main editor only; external preview/simulator is unsupported.' },
          titleContains: { type: 'string', description: 'Optional window title substring.' },
          windowId: { type: 'integer', minimum: 1, description: 'Exact Electron window ID from list_editor_windows.' },
        },
        []
      ),
      handler: async (args, call) => {
        const { projectPath } = getRuntimeContext();
        const { dataUri, ...result } = await capturePanelScreenshot(projectPath, { ...args, panel: 'game', windowKind: args.windowKind || 'editor' });
        call.image = dataUri;
        return result;
      },
    },
  ];

  const registry = {
    listTools() {
      const { config } = getRuntimeContext();
      return tools
        .filter((tool) => isToolExposed(config || {}, tool))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema || createOutputSchema(tool.dataSchema),
          annotations: inferToolAnnotations(tool),
        }));
    },
    listToolCatalog() {
      const { config } = getRuntimeContext();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        profile: tool.profile,
        category: toolCategory(tool),
        annotations: inferToolAnnotations(tool),
        outputSchema: tool.outputSchema || createOutputSchema(tool.dataSchema),
        enabled: isToolExposed(config || {}, tool),
      }));
    },
    async callToolDetailed(name, args) {
      const { config } = getRuntimeContext();
      const tool = tools.find((item) => item.name === name);
      if (!tool) {
        throw new Error(`Unknown tool '${name}'`);
      }
      if (!isToolExposed(config || {}, tool)) {
        throw new Error(`Tool '${name}' is not exposed by the current MCP tool profile '${config.toolProfile}'.`);
      }

      const call = {};
      try {
        const result = await tool.handler(args || {}, call);
        const envelope = createResultEnvelope(tool, args || {}, result);
        if (call.execution) envelope.execution = call.execution;
        const output = typeof result === 'string' && result.startsWith(IMAGE_DATA_URI_PREFIX)
          ? result
          : toOutput(envelope);
        interactionLog.add(name, 'success', envelope.summary.slice(0, 500), envelope.data, call.execution);
        return {
          value: envelope,
          text: output,
          ...(call.image ? { image: call.image } : {}),
        };
      } catch (error) {
        interactionLog.add(name, 'error', error.message, undefined, call.execution);
        error.toolEnvelope = createResultEnvelope(tool, args || {}, call.failureData || { message: error.message }, {
          ok: false,
          summary: error.message,
        });
        if (call.execution) error.toolEnvelope.execution = call.execution;
        throw error;
      }
    },
    async callTool(name, args) {
      const result = await registry.callToolDetailed(name, args);
      return result.text;
    },
  };

  return registry;
}

module.exports = {
  createToolRegistry,
};
