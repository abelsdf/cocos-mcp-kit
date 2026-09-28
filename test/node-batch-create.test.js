'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const modulePath = path.resolve(__dirname, '../lib/node-batch-create.js');
  assert.ok(fs.existsSync(modulePath), 'Batch editor implementation must exist before behavior tests');
  const { createNodeBatch } = require(modulePath);
  const args = { sceneUuid: 'scene', parentUuid: 'parent', batch: { schemaVersion: 1, roots: ['root'], nodes: [{ id: 'root', parentId: null, name: 'Root', components: [] }] } };
  const state = { mode: 'general', ready: true, multi: false, current: 'scene', dirty: false, calls: [], methods: [] };
  const old = global.Editor;
  global.Editor = { Message: { request: async (channel, method, target) => {
    state.calls.push(`${channel}:${method}`);
    if (method === 'query-ready' || method === 'query-is-ready') return state.ready;
    if (method === 'query-scene-mode') return state.mode;
    if (method === 'multi-is-multi-edit-mode') return state.multi;
    if (method === 'query-current-scene') return state.current;
    if (method === 'query-dirty') return state.dirty;
    if (method === 'multi-scene-query') return state.tabs || [{ uuid: 'scene', url: 'db://assets/Main.scene', type: 'scene', dirty: state.dirty }];
    if (method === 'query-asset-info') {
      if (target === 'scene' || target === 'db://assets/Main.scene') return { uuid: 'scene', url: 'db://assets/Main.scene', type: 'cc.SceneAsset', imported: !state.notImported };
      if (target === 'frame' || target === 'db://assets/Frame.asset') return state.missingAsset ? null : { uuid: 'frame', url: 'db://assets/Frame.asset', type: state.wrongAsset ? 'cc.ImageAsset' : 'cc.SpriteFrame', imported: true };
      return null;
    }
    if (method === 'query-uuid') return target === 'db://assets/Main.scene' ? 'scene' : 'frame';
    assert.fail(`Unexpected or mutating editor request: ${channel}:${method}`);
  } } };
  t.after(() => { if (old === undefined) delete global.Editor; else global.Editor = old; });
  const bridge = { call: async (method, options) => {
    state.methods.push(method);
    if (method === 'preflightNodeBatch') {
      if (state.drift) state.current = 'other';
      return { sceneUuid: 'scene', parentUuid: 'parent', assetReferences: state.assetRefs || [] };
    }
    assert.equal(method, 'createNodeBatch');
    state.execution = options;
    if (state.transportError) throw new Error('Lost reply');
    if (state.pending) await state.pending;
    return state.result || { created: true, verified: true, needsSave: true };
  } };
  return { state, args, bridge, run: (options = args) => createNodeBatch(process.cwd(), bridge, options),
    registry: createToolRegistry({ getRuntimeContext: () => ({ projectPath: process.cwd(), config: { toolProfile: 'full' } }), sceneBridge: bridge, interactionLog: { add() {} }, runtimeLog: { add() {} } }) };
}

test('batch create resolves a saved scene and performs one write-bridge call without native save or undo', async t => {
  const f = fixture(t); const r = await f.run(); assert.equal(r.created, true);
  assert.deepEqual(f.state.methods, ['preflightNodeBatch', 'createNodeBatch']); assert.deepEqual(f.state.execution.assets, []);
});
for (const change of [a => { delete a.sceneUuid; }, a => { a.parentUuid = ''; }, a => { a.force = true; }, a => { a.batch.roots.push('root'); }]) {
  test(`invalid batch arguments reject before IPC: ${change}`, async t => { const f = fixture(t); change(f.args); await assert.rejects(f.run()); assert.equal(f.state.calls.length, 0); });
}
for (const change of [s => { s.mode = 'prefab'; }, s => { s.multi = true; }, s => { s.current = 'other'; }, s => { s.ready = false; }, s => { s.notImported = true; }, s => { s.tabs = [{}, {}]; }, s => { s.drift = true; }]) {
  test(`unsupported or changed context refuses before execution: ${change}`, async t => { const f = fixture(t); change(f.state); await assert.rejects(f.run()); assert.equal(f.state.methods.includes('createNodeBatch'), false); });
}
test('pre-existing unsaved state is not saved or discarded', async t => { const f = fixture(t); f.state.dirty = true; assert.equal((await f.run()).created, true); assert.equal(f.state.dirty, true); });
test('exact imported asset mapping is passed without guessing subassets', async t => {
  const f = fixture(t); f.state.assetRefs = [{ id: 'frame', type: 'cc.SpriteFrame' }]; await f.run();
  assert.deepEqual(f.state.execution.assets, [{ id: 'frame', uuid: 'frame', type: 'cc.SpriteFrame' }]);
});
for (const key of ['missingAsset', 'wrongAsset']) test(`${key} rejects before creation`, async t => {
  const f = fixture(t); f.state.assetRefs = [{ id: 'frame', type: 'cc.SpriteFrame' }]; f.state[key] = true;
  await assert.rejects(f.run()); assert.equal(f.state.methods.includes('createNodeBatch'), false);
});
test('lost write reply reports uncertainty and never retries or guesses cleanup', async t => {
  const f = fixture(t); f.state.transportError = true; const r = await f.run();
  assert.equal(r.created, false); assert.equal(r.uncertain, true); assert.equal(r.cleanup.status, 'not_attempted');
  assert.equal(f.state.methods.filter(m => m === 'createNodeBatch').length, 1);
});
test('overlapping batch writes to the same project are rejected', async t => {
  const f = fixture(t); let release; f.state.pending = new Promise(resolve => { release = resolve; });
  const first = f.run(); await assert.rejects(f.run(), /batch.*progress/i); release(); await first;
});
test('tool errors retain the structured cleanup report rather than reporting success', async t => {
  const f = fixture(t); f.state.result = { created: false, verified: false, error: 'Injected', cleanup: { status: 'partial', remainingNodeIds: ['owned'], requiresManualReview: true } };
  const tool = f.registry.listTools().find(t => t.name === 'create_node_batch'); assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, false);
  await assert.rejects(f.registry.callToolDetailed('create_node_batch', f.args), error => {
    assert.equal(error.toolEnvelope.ok, false); assert.deepEqual(error.toolEnvelope.data.cleanup.remainingNodeIds, ['owned']); return true;
  });
});
