'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');
const previewRuntime = require('../lib/preview-runtime');

function createRegistry(profile, projectPath = path.resolve('/tmp/funplay-cocos-test-project'), configExtras = {}, overrides = {}) {
  return createToolRegistry({
    getRuntimeContext: () => ({
      config: { toolProfile: profile, ...configExtras },
      projectPath,
      version: '0.0.0-test',
    }),
    interactionLog: overrides.interactionLog || { add() {} },
    runtimeLog: { add() {}, list: () => [], clear: () => 0 },
    sceneBridge: overrides.sceneBridge || { call: async () => ({ ok: true }) },
    editorExecutor: overrides.editorExecutor || (async () => ({ ok: true })),
  });
}

test('runtime tools control the preview toolbar instead of calling edit-scene director helpers', async (t) => {
  const commands = [];
  t.mock.method(previewRuntime, 'controlPreviewToolbar', async (command) => {
    commands.push(command);
    return { scope: 'gameView', running: true, paused: command.action === 'pause', toolbarSynchronized: true };
  });
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async () => assert.fail('Preview controls must not use the edit-scene director') },
  });
  for (const name of ['get_runtime_state', 'pause_runtime', 'resume_runtime']) {
    const { value } = await registry.callToolDetailed(name, {});
    assert.equal(value.ok, true);
    assert.equal(value.data.scope, 'gameView');
    assert.equal(value.data.paused, name === 'pause_runtime');
  }
  assert.deepEqual(commands, [{ action: 'state' }, { action: 'pause' }, { action: 'resume' }]);
});

test('scene validation uses Game View state while preserving separate edit-scene performance counters', async (t) => {
  t.mock.method(previewRuntime, 'controlPreviewToolbar', async (command) => {
    assert.deepEqual(command, { action: 'state' });
    return { scope: 'gameView', running: true, paused: true };
  });
  const sceneCalls = [];
  const registry = createRegistry('core', undefined, {}, {
    sceneBridge: { call: async (method) => { sceneCalls.push(method); return { ok: true }; } },
  });
  const { value } = await registry.callToolDetailed('validate_scene', { includeScriptDiagnostics: false, includeLogErrors: false });
  assert.equal(value.data.runtime.scope, 'gameView');
  assert.equal(value.data.runtime.paused, true);
  assert.deepEqual(sceneCalls, ['getSceneInfo', 'getPerformanceSnapshot']);
});

function mockEditorRequests(t, handler) {
  const previousEditor = global.Editor;
  global.Editor = {
    Message: {
      request: handler,
    },
  };
  t.after(() => {
    if (previousEditor === undefined) {
      delete global.Editor;
    } else {
      global.Editor = previousEditor;
    }
  });
}

function mockAssetDbPersistence(t, projectPath) {
  mockEditorRequests(t, async (channel, method, dbUrl, content) => {
    assert.equal(channel, 'asset-db');
    if (method === 'create-asset' || method === 'save-asset') {
      const filePath = path.join(projectPath, dbUrl.slice('db://'.length));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      return { imported: true };
    }
    if (method === 'query-asset-info') return {
      uuid: 'generated-asset-uuid', url: dbUrl,
      type: dbUrl.endsWith('.scene') ? 'cc.SceneAsset' : 'cc.Prefab', imported: true,
    };
    if (method === 'refresh-asset') return true;
    throw new Error(`Unexpected asset-db method: ${method}`);
  });
}

test('core profile exposes the documented focused tool set', () => {
  const tools = createRegistry('core').listTools();
  assert.equal(tools.length, 39);
  assert.equal(tools.some((tool) => tool.name === 'execute_javascript'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_editor_state'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_tool_catalog'), true);
  assert.equal(tools.some((tool) => tool.name === 'validate_scene'), true);
  assert.equal(tools.some((tool) => tool.name === 'inspect_asset_dependencies'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_build_status'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_preview_mode'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_performance_snapshot'), true);
  assert.equal(tools.some((tool) => tool.name === 'create_scene'), true);
  assert.equal(tools.some((tool) => tool.name === 'list_project_instructions'), true);
  assert.equal(tools.some((tool) => tool.name === 'set_selection'), true);
  assert.equal(tools.some((tool) => tool.name === 'write_file'), false);
});

test('full profile exposes all built-in tools', () => {
  const tools = createRegistry('full').listTools();
  assert.equal(tools.length, 118);
  assert.equal(tools.some((tool) => tool.name === 'write_file'), true);
  assert.equal(tools.some((tool) => tool.name === 'edit_prefab_json'), true);
  assert.equal(tools.some((tool) => tool.name === 'create_prefab_from_node'), true);
  assert.equal(tools.some((tool) => tool.name === 'create_project_skill'), true);
  assert.equal(tools.some((tool) => tool.name === 'create_cocos_mcp_project_skill'), true);
  assert.equal(tools.some((tool) => tool.name === 'bind_button_click_event'), true);
  assert.equal(tools.some((tool) => tool.name === 'batch_bind_button_click_events'), true);
  assert.equal(tools.some((tool) => tool.name === 'unbind_button_click_event'), true);
  assert.equal(tools.some((tool) => tool.name === 'open_build_panel'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_preview_mode'), true);
  assert.equal(tools.some((tool) => tool.name === 'set_preview_mode'), true);
  assert.equal(tools.some((tool) => tool.name === 'create_scene'), true);
  assert.equal(tools.some((tool) => tool.name === 'broadcast_editor_message'), true);
  assert.equal(tools.some((tool) => tool.name === 'get_editor_state'), true);
  assert.equal(tools.some((tool) => tool.name === 'set_selection'), true);
  assert.equal(tools.some((tool) => tool.name === 'set_sprite_frame'), true);
  assert.equal(tools.some((tool) => tool.name === 'move_node'), true);
  assert.equal(tools.some((tool) => tool.name === 'reorder_node'), true);
  assert.equal(tools.some((tool) => tool.name === 'duplicate_node'), true);
  assert.equal(tools.some((tool) => tool.name === 'attach_script_component'), true);
  assert.equal(tools.some((tool) => tool.name === 'detach_script_component'), true);
  assert.equal(tools.some((tool) => tool.name === 'reset_node_transform'), true);
  assert.equal(tools.some((tool) => tool.name === 'reset_component_property_to_default'), true);
  assert.equal(tools.some((tool) => tool.name === 'detect_node_type'), true);
  assert.equal(tools.some((tool) => tool.name === 'batch_modify_nodes'), true);
});

test('prefab catalog pages asset-db results and joins optional metadata and scene links', async (t) => {
  const assetCalls = [];
  mockEditorRequests(t, async (channel, method, payload) => {
    assert.equal(channel, 'asset-db');
    assetCalls.push({ method, payload });
    if (method === 'query-assets') return [
      { name: 'Z', uuid: 'z', url: 'db://assets/Z.prefab', type: 'cc.Prefab', imported: true },
      { name: 'A', uuid: 'a', url: 'db://assets/A.prefab', type: 'cc.Prefab', imported: true },
      { name: 'Noise', uuid: 'other', url: 'db://assets/Noise.ts', type: 'cc.Script' },
      { name: 'B', uuid: 'b', url: 'db://assets/B.prefab', type: 'cc.Prefab' },
    ];
    if (method === 'query-asset-meta') {
      if (payload === 'b') throw new Error('meta unavailable');
      return { uuid: payload, importer: 'prefab' };
    }
    throw new Error(`Unexpected asset-db method: ${method}`);
  });
  const sceneCalls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      sceneCalls.push({ method, args });
      return { sceneName: 'Sample', scannedNodes: 12, linkedCount: 2, truncated: false,
        instances: [
          { assetUuid: 'a', nodePath: 'AInstance', nodeUuid: 'node-a' },
          { assetUuid: 'z', nodePath: 'ZInstance', nodeUuid: 'node-z' },
        ] };
    } },
  });
  const tool = registry.listTools().find((item) => item.name === 'list_prefabs');
  assert.equal(tool.inputSchema.properties.limit.maximum, 100);
  const result = await registry.callToolDetailed('list_prefabs', {
    limit: 2, includeMetadata: true, includeSceneInstances: true,
  });
  const data = result.value.data;
  assert.equal(data.count, 3);
  assert.equal(data.returned, 2);
  assert.equal(data.truncated, true);
  assert.deepEqual(data.prefabs.map((item) => item.uuid), ['a', 'b']);
  assert.equal(data.prefabs[0].sceneInstanceCount, 1);
  assert.equal(data.prefabs[0].sceneInstances[0].nodePath, 'AInstance');
  assert.equal(data.prefabs[0].metadata.status, 'available');
  assert.equal(data.prefabs[1].metadata.status, 'error');
  assert.equal(data.prefabs[1].imported, null);
  assert.equal(data.sceneInstanceScan.linkedCount, 2);
  assert.deepEqual(sceneCalls, [{ method: 'listPrefabInstanceLinks', args: { maxNodes: 5000, maxInstances: 200 } }]);
  assert.deepEqual(assetCalls[0], { method: 'query-assets', payload: { pattern: 'db://assets/**', ccType: 'cc.Prefab' } });

  const next = await registry.callToolDetailed('list_prefabs', { offset: 2, limit: 1 });
  assert.deepEqual(next.value.data.prefabs.map((item) => item.uuid), ['z']);
  assert.equal(next.value.data.truncated, false);
});

test('prefab catalog rejects invalid bounds and option types before querying asset-db', async () => {
  const registry = createRegistry('full');
  for (const args of [
    { limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 1.5 },
    { pattern: 'db://internal/**' }, { includeSceneInstances: 'yes' },
  ]) {
    await assert.rejects(() => registry.callToolDetailed('list_prefabs', args), /Expected an assets pattern/);
  }
});

test('batch_modify_nodes forwards ordered changes and policy as one scene call', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { completed: true, succeeded: 1, failed: 0 };
    } },
  });
  const args = { changes: [{ uuid: 'node-uuid', active: false }], onError: 'continue' };
  const result = await registry.callToolDetailed('batch_modify_nodes', args);
  assert.equal(result.value.data.succeeded, 1);
  assert.deepEqual(calls, [{ method: 'batchModifyNodes', args }]);
  const tool = registry.listTools().find((item) => item.name === 'batch_modify_nodes');
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, true);
});

test('detect_node_type forwards strict node selectors to the scene bridge', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { type: 'ui', candidates: ['ui'], ambiguous: false };
    } },
  });
  const result = await registry.callToolDetailed('detect_node_type', { uuid: 'node-uuid' });
  assert.equal(result.value.data.type, 'ui');
  assert.deepEqual(calls, [{ method: 'detectNodeType', args: { uuid: 'node-uuid' } }]);
});

test('list_components exposes bounded parameters and forwards the live query', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { valueSource: 'live-scene', componentCount: 2 };
    } },
  });
  const tool = registry.listTools().find((item) => item.name === 'list_components');
  assert.equal(tool.inputSchema.properties.maxComponents.maximum, 128);
  assert.equal(tool.inputSchema.properties.maxProperties.maximum, 32);
  assert.equal(tool.inputSchema.properties.includeRuntimeFields.type, 'boolean');
  assert.equal(tool.annotations.readOnlyHint, true);
  const args = { path: 'Canvas/HammerIcon', maxComponents: 4, maxProperties: 8 };
  const result = await registry.callToolDetailed('list_components', args);
  assert.equal(result.value.data.valueSource, 'live-scene');
  assert.deepEqual(calls, [{ method: 'listComponents', args }]);
});

test('available component types exposes bounded read-only script and class queries', () => {
  const registry = createRegistry('full');
  const tool = registry.listTools().find((item) => item.name === 'list_available_component_types');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.properties.maxProjectScripts.maximum, 256);
  assert.equal(tool.inputSchema.properties.candidateNames.maxItems, 32);
  assert.equal(tool.inputSchema.properties.candidateNames.items.maxLength, 128);
});

test('Button click binding advertises exact method and bounded literal data', () => {
  const tool = createRegistry('full').listTools().find((item) => item.name === 'bind_button_click_event');
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.componentName.maxLength, 128);
  assert.equal(tool.inputSchema.properties.handler.maxLength, 128);
  assert.equal(tool.inputSchema.properties.customEventData.maxLength, 1024);
});

test('batch Button click binding exposes bounded entries and forwards the policy once', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { completed: true, bound: 1, duplicates: 0, failed: 0 };
    } },
  });
  const tool = registry.listTools().find((item) => item.name === 'batch_bind_button_click_events');
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.bindings.maxItems, 50);
  assert.equal(tool.inputSchema.properties.bindings.items.properties.customEventData.maxLength, 1024);
  const args = { bindings: [{ path: 'Button', targetPath: 'Receiver', componentName: 'Receiver', handler: 'onClick' }], onError: 'continue' };
  const result = await registry.callToolDetailed('batch_bind_button_click_events', args);
  assert.equal(result.value.data.bound, 1);
  assert.deepEqual(calls, [{ method: 'batchBindButtonClickEvents', args }]);
});

test('available component types bounds asset-db records before forwarding to the scene', async (t) => {
  const scripts = [
    { uuid: '00000000-0000-0000-0000-000000000002', url: 'db://assets/Z.ts', imported: true },
    { uuid: '00000000-0000-0000-0000-000000000001', url: 'db://assets/A.ts', invalid: true },
  ];
  mockEditorRequests(t, async (channel, method, payload) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-assets');
    assert.deepEqual(payload, { pattern: 'db://assets/**', ccType: 'cc.Script' });
    return scripts;
  });
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => { calls.push({ method, args }); return { projectScriptCount: 2 }; } },
  });
  const result = await registry.callToolDetailed('list_available_component_types', {
    maxProjectScripts: 1, candidateNames: ['cc.Sprite'],
  });
  assert.equal(result.value.data.projectScriptCount, 2);
  assert.equal(calls[0].method, 'listAvailableComponentTypes');
  assert.deepEqual(calls[0].args, {
    candidateNames: ['cc.Sprite'],
    scriptAssets: [{ uuid: scripts[1].uuid, url: scripts[1].url, imported: undefined, invalid: true }],
    projectScriptCount: 2,
    projectScriptsTruncated: true,
  });
  await assert.rejects(() => registry.callToolDetailed('list_available_component_types', { maxProjectScripts: 257 }),
    /maxProjectScripts must be/);
  assert.equal(calls.length, 1);
});

test('inspect_component requires exact selection and forwards the bounded query', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { valueSource: 'live-scene', component: { index: 1, properties: [] } };
    } },
  });
  const tool = registry.listTools().find((item) => item.name === 'inspect_component');
  assert.equal(tool.inputSchema.properties.index.type, 'integer');
  assert.equal(tool.inputSchema.properties.index.minimum, 0);
  assert.equal(tool.inputSchema.properties.maxProperties.maximum, 80);
  assert.equal(tool.inputSchema.properties.includeRuntimeFields.type, 'boolean');
  assert.equal(tool.annotations.readOnlyHint, true);
  const args = { uuid: 'target-node', componentName: 'cc.Sprite', index: 1, maxProperties: 24 };
  const result = await registry.callToolDetailed('inspect_component', args);
  assert.equal(result.value.data.component.index, 1);
  assert.deepEqual(calls, [{ method: 'inspectComponent', args }]);
});

test('set_component_property accepts bounded JSON and forwards a typed value', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { updated: true, value: args.value };
    } },
  });
  const tool = registry.listTools().find((item) => item.name === 'set_component_property');
  assert.equal(tool.inputSchema.properties.index.type, 'integer');
  assert.equal(tool.inputSchema.properties.index.minimum, 0);
  assert.equal(tool.inputSchema.properties.valueJson.maxLength, 4096);
  const args = { uuid: 'target-node', componentName: 'cc.Sprite', propertyPath: 'color', valueJson: '{"r":64,"g":180,"b":255,"a":255}' };
  const result = await registry.callToolDetailed('set_component_property', args);
  assert.equal(result.value.data.updated, true);
  assert.deepEqual(calls, [{ method: 'setComponentProperty', args: { ...args, value: { r: 64, g: 180, b: 255, a: 255 } } }]);
  await assert.rejects(() => registry.callToolDetailed('set_component_property', { ...args, valueJson: '{invalid' }), /valid JSON/);
  await assert.rejects(() => registry.callToolDetailed('set_component_property', { ...args, valueJson: ' '.repeat(4097) }), /at most 4096/);
});

test('reset_component_property_to_default forwards the exact selector and field', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { reset: true, value: 17 };
    } },
  });
  const result = await registry.callToolDetailed('reset_component_property_to_default', {
    uuid: 'target-node', componentName: 'ProbeComponent', propertyName: 'count',
  });
  assert.equal(result.value.data.value, 17);
  assert.deepEqual(calls, [{ method: 'resetComponentPropertyToDefault', args: {
    uuid: 'target-node', componentName: 'ProbeComponent', propertyName: 'count',
  } }]);
});

test('reset_node_transform forwards the selected fields to the scene bridge', async () => {
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { reset: true, fields: args.fields };
    } },
  });
  const result = await registry.callToolDetailed('reset_node_transform', {
    uuid: 'node-uuid', fields: ['position', 'scale'],
  });
  assert.equal(result.value.data.reset, true);
  assert.deepEqual(calls, [{ method: 'resetNodeTransform', args: {
    uuid: 'node-uuid', fields: ['position', 'scale'],
  } }]);
});

test('attach_script_component validates the asset before calling the scene', async (t) => {
  mockEditorRequests(t, async (channel, method, target) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-asset-info');
    return {
      type: target.includes('NotScript') ? 'cc.ImageAsset' : 'cc.Script',
      uuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c7',
      url: target,
      imported: true,
      invalid: false,
    };
  });
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { attached: true, scriptUuid: args.scriptUuid };
    } },
  });
  const result = await registry.callToolDetailed('attach_script_component', {
    uuid: 'target-node', scriptTarget: 'assets/scripts/Probe.ts', waitForCompileMs: 200,
  });
  assert.equal(result.value.data.attached, true);
  assert.deepEqual(calls, [{
    method: 'attachScriptComponent',
    args: {
      path: undefined,
      uuid: 'target-node',
      name: undefined,
      scriptUuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c7',
      waitForCompileMs: 200,
    },
  }]);
  await assert.rejects(
    () => registry.callToolDetailed('attach_script_component', { uuid: 'target-node', scriptTarget: 'assets/NotScript.png' }),
    /not a ready cc.Script/
  );
  assert.equal(calls.length, 1);
});

test('detach_script_component validates the script asset before calling the scene', async (t) => {
  mockEditorRequests(t, async (channel, method, target) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-asset-info');
    return {
      type: target.includes('NotScript') ? 'cc.ImageAsset' : 'cc.Script',
      uuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c7',
      url: target,
      imported: true,
      invalid: false,
    };
  });
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, args) => {
      calls.push({ method, args });
      return { removed: true, scriptUuid: args.scriptUuid };
    } },
  });
  const result = await registry.callToolDetailed('detach_script_component', {
    uuid: 'target-node', scriptTarget: 'assets/scripts/Probe.ts',
  });
  assert.equal(result.value.data.removed, true);
  assert.deepEqual(calls, [{ method: 'detachScriptComponent', args: {
    path: undefined, uuid: 'target-node', name: undefined,
    scriptUuid: 'bbee4fb1-c9b5-4fde-9346-8ee1357142c7',
  } }]);
  await assert.rejects(
    () => registry.callToolDetailed('detach_script_component', { uuid: 'target-node', scriptTarget: 'assets/NotScript.png' }),
    /not a ready cc.Script/
  );
  assert.equal(calls.length, 1);
});

test('create_sprite resolves an image target before creating a scene node', async (t) => {
  const imageUrl = 'db://assets/icons/arrow.png';
  const frameUuid = 'image-uuid@frame';
  mockEditorRequests(t, async (channel, method, target) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-asset-info');
    if (target === imageUrl) return {
      uuid: 'image-uuid', url: imageUrl, type: 'cc.ImageAsset', imported: true,
      subAssets: { frame: { uuid: frameUuid, type: 'cc.SpriteFrame' } },
    };
    if (target === frameUuid) return {
      uuid: frameUuid, url: `${imageUrl}/spriteFrame`, type: 'cc.SpriteFrame', imported: true,
    };
    throw new Error(`Unexpected asset target: ${target}`);
  });
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, payload) => { calls.push({ method, payload }); return { created: true, uuid: 'new-node' }; } },
  });
  const result = await registry.callToolDetailed('create_sprite', {
    name: 'Arrow', spriteFrameTarget: 'assets/icons/arrow.png', parentPath: 'Canvas',
  });
  assert.equal(result.value.data.created, true);
  assert.equal(result.value.data.spriteFrameResolution.spriteFrame.uuid, frameUuid);
  assert.deepEqual(calls, [{
    method: 'createSprite',
    payload: { name: 'Arrow', parentPath: 'Canvas', spriteFrameUuid: frameUuid },
  }]);
  const legacy = await registry.callToolDetailed('create_sprite', {
    name: 'LegacyArrow', spriteFrameUuid: frameUuid,
  });
  assert.equal(legacy.value.data.created, true);
  assert.deepEqual(calls[1], {
    method: 'createSprite',
    payload: { name: 'LegacyArrow', spriteFrameUuid: frameUuid },
  });
});

test('create_sprite does not create a node when resource resolution is invalid', async (t) => {
  mockEditorRequests(t, async () => ({
    uuid: 'image-uuid', type: 'cc.ImageAsset', imported: true, subAssets: {},
  }));
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async () => assert.fail('createSprite must not be called for an invalid resource') },
  });
  await assert.rejects(
    () => registry.callToolDetailed('create_sprite', { spriteFrameTarget: 'assets/icons/arrow.png' }),
    /no SpriteFrame subasset/
  );
  await assert.rejects(
    () => registry.callToolDetailed('create_sprite', {
      spriteFrameTarget: 'assets/icons/arrow.png', spriteFrameUuid: 'other-frame',
    }),
    /either spriteFrameTarget or spriteFrameUuid/
  );
});

test('set_sprite_frame resolves an image before changing an existing Sprite', async (t) => {
  const imageUrl = 'db://assets/icons/new.png';
  const frameUuid = 'new-image@frame';
  mockEditorRequests(t, async (channel, method, target) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-asset-info');
    if (target === imageUrl) return {
      uuid: 'new-image', url: imageUrl, type: 'cc.ImageAsset', imported: true,
      subAssets: { frame: { uuid: frameUuid, type: 'cc.SpriteFrame' } },
    };
    if (target === frameUuid) return {
      uuid: frameUuid, url: `${imageUrl}/spriteFrame`, type: 'cc.SpriteFrame', imported: true,
    };
    throw new Error(`Unexpected target: ${target}`);
  });
  const calls = [];
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async (method, payload) => {
      calls.push({ method, payload });
      return { updated: true, previousSpriteFrameUuid: 'old-image@frame', spriteFrameUuid: frameUuid };
    } },
  });
  const result = await registry.callToolDetailed('set_sprite_frame', {
    path: 'Canvas/Icon', spriteFrameTarget: 'assets/icons/new.png',
  });
  assert.equal(result.value.data.previousSpriteFrameUuid, 'old-image@frame');
  assert.equal(result.value.data.spriteFrameResolution.spriteFrame.uuid, frameUuid);
  assert.deepEqual(calls, [{ method: 'setSpriteFrame', payload: {
    path: 'Canvas/Icon', uuid: undefined, name: undefined, spriteFrameUuid: frameUuid,
  } }]);
});

test('set_sprite_frame rejects an invalid target before touching the scene', async (t) => {
  mockEditorRequests(t, async () => ({
    uuid: 'texture-uuid', type: 'cc.Texture2D', imported: true,
  }));
  const registry = createRegistry('full', undefined, {}, {
    sceneBridge: { call: async () => assert.fail('Invalid image must not change the scene') },
  });
  await assert.rejects(
    () => registry.callToolDetailed('set_sprite_frame', {
      path: 'Canvas/Icon', spriteFrameTarget: 'texture-uuid',
    }),
    /Expected cc.SpriteFrame or cc.ImageAsset/
  );
});

test('recommended project skill tool records managed template metadata', async (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-managed-skill-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const registry = createRegistry('full', projectPath);

  const result = await registry.callToolDetailed('create_cocos_mcp_project_skill', {});

  assert.equal(result.value.data.path, '.agents/skills/cocos-mcp-kit-workflow/SKILL.md');
  assert.equal(
    result.value.data.manifest,
    '.agents/skills/cocos-mcp-kit-workflow/.cocos-mcp-kit.json'
  );
  assert.equal(fs.existsSync(path.join(projectPath, result.value.data.manifest)), true);
});

test('Skills tool schemas and execution support OpenCode project directories', async (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-opencode-tools-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const registry = createRegistry('full', projectPath);
  for (const name of ['list_project_instructions', 'create_project_skill', 'create_cocos_mcp_project_skill']) {
    const tool = registry.listTools().find((entry) => entry.name === name);
    assert.ok(tool.inputSchema.properties.clientId.enum.includes('opencode'));
  }
  const result = await registry.callToolDetailed('create_cocos_mcp_project_skill', { clientId: 'opencode' });
  assert.equal(result.value.data.path, '.opencode/skills/cocos-mcp-kit-workflow/SKILL.md');
  assert.equal(fs.existsSync(path.join(projectPath, result.value.data.path)), true);
  assert.equal(fs.existsSync(path.join(projectPath, '.agents')), false);
});

test('create_scene serializes and persists a scene without an interactive save dialog', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-scene-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
  mockAssetDbPersistence(t, tmp);

  const calls = [];
  const registry = createRegistry('full', tmp, {}, {
    sceneBridge: {
      call: async (method, payload) => {
        calls.push({ method, payload });
        return {
          mode: payload.mode,
          source: null,
          scene: { name: payload.sceneName, childCount: 0 },
          content: JSON.stringify([
            { __type__: 'cc.SceneAsset', _name: payload.sceneName, scene: { __id__: 1 } },
            { __type__: 'cc.Scene', _name: payload.sceneName, _children: [] },
          ]),
        };
      },
    },
  });

  const result = await registry.callToolDetailed('create_scene', {
    target: 'Scenes/GeneratedLevel',
    openAfterCreate: false,
  });

  assert.deepEqual(calls[0], {
    method: 'serializeScene',
    payload: { mode: 'empty', sceneName: 'GeneratedLevel' },
  });
  assert.equal(result.value.data.created, true);
  assert.equal(result.value.data.path, 'assets/Scenes/GeneratedLevel.scene');
  assert.equal(result.value.data.opened, null);
  assert.equal(fs.existsSync(path.join(tmp, 'assets', 'Scenes', 'GeneratedLevel.scene')), true);
});

test('tool definitions include MCP outputSchema and annotations', () => {
  const tool = createRegistry('core').listTools().find((item) => item.name === 'get_project_info');
  assert.equal(tool.outputSchema.type, 'object');
  assert.equal(tool.outputSchema.properties.ok.type, 'boolean');
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('custom profile can expose a category and disable a specific tool', () => {
  const tools = createRegistry('custom', path.resolve('/tmp/funplay-cocos-test-project'), {
    enabledToolCategories: ['files'],
    disabledTools: ['write_file'],
  }).listTools();

  assert.equal(tools.some((tool) => tool.name === 'read_file'), true);
  assert.equal(tools.some((tool) => tool.name === 'write_file'), false);
  assert.equal(tools.some((tool) => tool.name === 'execute_javascript'), true);
});

test('tool catalog reports disabled tools under the current exposure settings', () => {
  const catalog = createRegistry('core', path.resolve('/tmp/funplay-cocos-test-project'), {
    disabledTools: ['execute_javascript'],
  }).listToolCatalog();
  const executeTool = catalog.find((tool) => tool.name === 'execute_javascript');
  assert.equal(executeTool.enabled, false);
  assert.equal(executeTool.category, 'execution');
});

test('file tools reject writes outside the project root', async () => {
  const registry = createRegistry('full');
  await assert.rejects(
    () => registry.callTool('write_file', { path: '../outside.txt', content: 'x' }),
    /outside the Cocos project/
  );
});

test('callToolDetailed preserves structured values and text output', async () => {
  const registry = createRegistry('core');
  const result = await registry.callToolDetailed('get_project_info', {});
  assert.equal(result.value.ok, true);
  assert.equal(result.value.tool, 'get_project_info');
  assert.equal(result.value.data.projectPath, path.resolve('/tmp/funplay-cocos-test-project'));
  assert.match(result.value.callId, /^fp_/);
  assert.match(result.text, /projectPath/);
});

test('tool calls retain diagnostic summaries with detached activity previews', async () => {
  const { InteractionLog } = require('../lib/interaction-log');
  const log = new InteractionLog();
  const registry = createRegistry('core', path.resolve('/tmp/funplay-cocos-test-project'), {}, { interactionLog: log });
  const result = await registry.callToolDetailed('get_project_info', {});
  assert.equal(log.list()[0].toolName, 'get_project_info');
  assert.equal(log.list()[0].status, 'success');
  assert.equal(typeof log.list()[0].summary, 'string');
  assert.equal(log.list()[0].preview.projectPath, result.value.data.projectPath);
  assert.notEqual(log.list()[0].preview, result.value.data);
});

test('create_prefab_from_node serializes through scene bridge and writes asset file', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-prefab-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
  mockAssetDbPersistence(t, tmp);

  const calls = [];
  const registry = createRegistry('full', tmp, {}, {
    sceneBridge: {
      call: async (method, payload) => {
        calls.push({ method, payload });
        return {
          source: { name: 'SourceNode', path: 'Canvas/SourceNode', uuid: 'source-uuid' },
          root: { name: payload.rootName || 'SourceNode' },
          content: JSON.stringify([
            { __type__: 'cc.Prefab', _name: payload.prefabName, data: { __id__: 1 } },
            {
              __type__: 'cc.Node',
              _name: payload.rootName,
              _layer: 33554432,
              _components: [{ __id__: 2 }],
              _prefab: { __id__: 4 },
            },
            { __type__: 'cc.UITransform', node: { __id__: 1 }, __prefab: { __id__: 3 } },
            { __type__: 'cc.CompPrefabInfo', fileId: 'component-file-id' },
            {
              __type__: 'cc.PrefabInfo',
              root: { __id__: 1 },
              asset: { __id__: 0 },
              fileId: 'node-file-id',
            },
          ]),
        };
      },
    },
  });

  const result = await registry.callToolDetailed('create_prefab_from_node', {
    name: 'SourceNode',
    rootName: 'SettingsPanel',
    target: 'Prefabs/SettingsPanel',
  });

  assert.equal(calls[0].method, 'serializePrefabFromNode');
  assert.deepEqual(calls[0].payload, {
    path: undefined,
    uuid: undefined,
    name: 'SourceNode',
    rootName: 'SettingsPanel',
    prefabName: 'SettingsPanel',
  });
  assert.equal(result.value.data.created, true);
  assert.equal(result.value.data.path, 'assets/Prefabs/SettingsPanel.prefab');
  assert.deepEqual(result.value.data.prefabMetadata, {
    valid: true,
    prefabIndex: 0,
    rootIndex: 1,
    nodeCount: 1,
    componentCount: 1,
    fileIdCount: 2,
  });
  assert.equal(fs.existsSync(path.join(tmp, 'assets', 'Prefabs', 'SettingsPanel.prefab')), true);
});

test('create_prefab_from_node rejects a root name that differs from the target filename', async () => {
  const registry = createRegistry('full', path.resolve('/tmp/cocos-prefab-name-test'), {}, {
    sceneBridge: { call: async () => assert.fail('Rejected names must not serialize a node') },
  });
  await assert.rejects(
    () => registry.callToolDetailed('create_prefab_from_node', {
      target: 'Prefabs/SettingsPanel', name: 'SourceNode', rootName: 'DifferentName',
    }),
    /rootName must match the target prefab filename "SettingsPanel"/
  );
});

test('create_prefab_from_node rejects non-UI_2D node layers before writing', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-prefab-layer-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });

  const registry = createRegistry('full', tmp, {}, {
    sceneBridge: {
      call: async () => ({
        source: { name: 'SourceNode', path: 'SourceNode', uuid: 'source-uuid' },
        root: { name: 'SourceNode' },
        content: JSON.stringify([
          { __type__: 'cc.Prefab', data: { __id__: 1 } },
          {
            __type__: 'cc.Node',
            _name: 'SourceNode',
            _layer: 1,
            _components: [],
            _prefab: { __id__: 2 },
          },
          {
            __type__: 'cc.PrefabInfo',
            root: { __id__: 1 },
            asset: { __id__: 0 },
            fileId: 'node-file-id',
          },
        ]),
      }),
    },
  });

  await assert.rejects(
    () => registry.callToolDetailed('create_prefab_from_node', {
      name: 'SourceNode',
      target: 'Prefabs/WrongLayer',
    }),
    /cc\.Node at index 1\._layer is 1, expected 33554432/
  );
  assert.equal(fs.existsSync(path.join(tmp, 'assets', 'Prefabs', 'WrongLayer.prefab')), false);
});

test('create_prefab_from_node rejects serialized output without PrefabInfo', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-invalid-prefab-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });

  const registry = createRegistry('full', tmp, {}, {
    sceneBridge: {
      call: async () => ({
        source: { name: 'SourceNode', path: 'Canvas/SourceNode', uuid: 'source-uuid' },
        root: { name: 'SourceNode' },
        content: '[{"__type__":"cc.Prefab","data":{"__id__":1}},{"__type__":"cc.Node","_name":"SourceNode","_layer":33554432,"_components":[],"_prefab":null}]',
      }),
    },
  });

  await assert.rejects(
    () => registry.callToolDetailed('create_prefab_from_node', {
      name: 'SourceNode',
      target: 'Prefabs/Invalid',
    }),
    /cc.Node at index 1\._prefab is not an object reference/
  );
  assert.equal(fs.existsSync(path.join(tmp, 'assets', 'Prefabs', 'Invalid.prefab')), false);
});

test('create_prefab_instance creates a cc.Prefab node and verifies its linkage', async (t) => {
  const editorRequests = [];
  mockEditorRequests(t, async (channel, method, payload) => {
    editorRequests.push({ channel, method, payload });
    if (channel === 'asset-db' && method === 'query-asset-info') {
      return { uuid: 'prefab-uuid' };
    }
    if (channel === 'scene' && method === 'create-node') {
      return 'created-node-uuid';
    }
    throw new Error(`Unexpected editor request: ${channel}:${method}`);
  });

  const sceneCalls = [];
  const registry = createRegistry('full', path.resolve('/tmp/funplay-cocos-test-project'), {}, {
    sceneBridge: {
      call: async (method, payload) => {
        sceneCalls.push({ method, payload });
        if (method === 'inspectNode') {
          return { uuid: 'parent-node-uuid' };
        }
        if (method === 'getPrefabInstanceInfo') {
          return {
            node: { name: 'LinkedPanel', path: 'Canvas/LinkedPanel', uuid: 'created-node-uuid' },
            prefab: {
              linked: true,
              fileId: 'linked-file-id',
              asset: { name: 'Panel', uuid: 'prefab-uuid' },
              instance: { root: 'created-node-uuid' },
            },
          };
        }
        throw new Error(`Unexpected scene call: ${method}`);
      },
    },
  });

  const result = await registry.callToolDetailed('create_prefab_instance', {
    prefabUuid: 'db://assets/Prefabs/Panel.prefab',
    parentPath: 'Canvas',
    name: 'LinkedPanel',
  });

  assert.deepEqual(editorRequests[1], {
    channel: 'scene',
    method: 'create-node',
    payload: {
      assetUuid: 'prefab-uuid',
      type: 'cc.Prefab',
      unlinkPrefab: false,
      parent: 'parent-node-uuid',
      name: 'LinkedPanel',
    },
  });
  assert.deepEqual(sceneCalls, [
    { method: 'inspectNode', payload: { path: 'Canvas' } },
    { method: 'getPrefabInstanceInfo', payload: { uuid: 'created-node-uuid' } },
  ]);
  assert.equal(result.value.data.linkedPrefab, true);
  assert.equal(result.value.data.verified, true);
  assert.equal(result.value.data.creationMethod, 'scene:create-node');
  assert.deepEqual(result.value.data.verification, {
    nodeUuidMatches: true,
    linked: true,
    assetUuidMatches: true,
    fileIdPresent: true,
    instancePresent: true,
  });
});

test('create_prefab_instance removes an unverified node and does not fall back', async (t) => {
  mockEditorRequests(t, async (channel, method) => {
    if (channel === 'asset-db' && method === 'query-asset-info') {
      return { uuid: 'expected-prefab-uuid' };
    }
    if (channel === 'scene' && method === 'create-node') {
      return 'unlinked-node-uuid';
    }
    throw new Error(`Unexpected editor request: ${channel}:${method}`);
  });

  const sceneCalls = [];
  const registry = createRegistry('full', path.resolve('/tmp/funplay-cocos-test-project'), {}, {
    sceneBridge: {
      call: async (method, payload) => {
        sceneCalls.push({ method, payload });
        if (method === 'getPrefabInstanceInfo') {
          return {
            node: { uuid: 'unlinked-node-uuid' },
            prefab: {
              linked: false,
              fileId: '',
              asset: { uuid: 'wrong-prefab-uuid' },
              instance: null,
            },
          };
        }
        if (method === 'deleteNode') {
          return { deleted: true, uuid: payload.uuid };
        }
        throw new Error(`Unexpected scene call: ${method}`);
      },
    },
  });

  await assert.rejects(
    () => registry.callToolDetailed('create_prefab_instance', { prefabUuid: 'expected-prefab-uuid' }),
    /failed linked Prefab verification \(linked, assetUuidMatches, fileIdPresent, instancePresent\).*created node was removed/
  );
  assert.deepEqual(sceneCalls, [
    { method: 'getPrefabInstanceInfo', payload: { uuid: 'unlinked-node-uuid' } },
    { method: 'deleteNode', payload: { uuid: 'unlinked-node-uuid' } },
  ]);
});

test('create_prefab_instance verifies the scene fallback when create-node is unavailable', async (t) => {
  mockEditorRequests(t, async (channel, method) => {
    if (channel === 'asset-db' && method === 'query-asset-info') {
      return { uuid: 'prefab-uuid' };
    }
    if (channel === 'scene' && method === 'create-node') {
      throw new Error('create-node unavailable');
    }
    throw new Error(`Unexpected editor request: ${channel}:${method}`);
  });

  const sceneCalls = [];
  const registry = createRegistry('full', path.resolve('/tmp/funplay-cocos-test-project'), {}, {
    sceneBridge: {
      call: async (method, payload) => {
        sceneCalls.push({ method, payload });
        if (method === 'instantiatePrefab') {
          return {
            instantiated: true,
            prefabUuid: payload.prefabUuid,
            node: { name: 'Panel', path: 'Panel', uuid: 'fallback-node-uuid' },
          };
        }
        if (method === 'getPrefabInstanceInfo') {
          return {
            node: { name: 'Panel', path: 'Panel', uuid: 'fallback-node-uuid' },
            prefab: {
              linked: true,
              fileId: 'fallback-file-id',
              asset: { name: 'Panel', uuid: 'prefab-uuid' },
              instance: {},
            },
          };
        }
        throw new Error(`Unexpected scene call: ${method}`);
      },
    },
  });

  const result = await registry.callToolDetailed('create_prefab_instance', { prefabUuid: 'prefab-uuid' });

  assert.equal(result.value.data.linkedPrefab, true);
  assert.equal(result.value.data.verified, true);
  assert.equal(result.value.data.creationMethod, 'scene:instantiatePrefab');
  assert.deepEqual(sceneCalls.map((call) => call.method), [
    'instantiatePrefab',
    'getPrefabInstanceInfo',
  ]);
});

test('callToolDetailed preserves screenshot image text while keeping structured envelope small', async () => {
  const dataUri = 'data:image/png;base64,AAAA';
  const registry = createRegistry('core', path.resolve('/tmp/funplay-cocos-test-project'), {}, {
    editorExecutor: async () => dataUri,
  });

  const result = await registry.callToolDetailed('execute_javascript', { context: 'editor', code: 'return image;' });
  assert.equal(result.text, dataUri);
  assert.equal(result.value.data.image, true);
  assert.equal(result.value.data.mimeType, 'image/png');
});

test('execute_javascript safety checks block risky editor snippets by default', async () => {
  const registry = createRegistry('core');

  await assert.rejects(
    () => registry.callToolDetailed('execute_javascript', {
      context: 'editor',
      code: "fs.rmSync(path.join(context.projectPath, 'assets'), { recursive: true });",
    }),
    /JavaScript safety checks blocked/
  );
});

test('execute_javascript safety checks can be explicitly disabled per call', async () => {
  let called = false;
  const registry = createRegistry('core', path.resolve('/tmp/funplay-cocos-test-project'), {}, {
    editorExecutor: async () => {
      called = true;
      return { ok: true };
    },
  });

  const result = await registry.callToolDetailed('execute_javascript', {
    context: 'editor',
    code: "fs.rmSync(path.join(context.projectPath, 'assets'), { recursive: true });",
    safety_checks: false,
  });

  assert.equal(called, true);
  assert.equal(result.value.ok, true);
});
