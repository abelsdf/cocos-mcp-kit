'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createToolRegistry } = require('../lib/tool-registry');
let fixtureId = 0;

function fixture(t) {
  const modulePath = path.resolve(__dirname, '../lib/node-batch-create.js');
  assert.ok(fs.existsSync(modulePath), 'Batch editor implementation must exist before behavior tests');
  const { createNodeBatch } = require(modulePath);
  const args = { sceneUuid: 'scene', parentUuid: 'parent', batch: { schemaVersion: 1, roots: ['root'], nodes: [{ id: 'root', parentId: null, name: 'Root', components: [] }] } };
  const state = { mode: 'general', ready: true, multi: false, current: 'scene', dirty: false, calls: [], methods: [] };
  const projectPath = path.join(process.cwd(), 'temp', `batch-unit-${++fixtureId}`);
  const old = global.Editor;
  global.Editor = { App: { get version() { return state.version; } }, Message: { request: async (channel, method, target) => {
    state.calls.push(`${channel}:${method}`);
    if (['begin-recording', 'end-recording', 'cancel-recording'].includes(method)) {
      (state.recordings ||= []).push({ method, target });
      if (state[`${method}Error`]) throw new Error(`Lost ${method} reply`);
      return method === 'begin-recording' ? Object.hasOwn(state, 'beginResult') ? state.beginResult : 'record-1' : state.finalizeResult;
    }
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
    state.calls.push(`bridge:${method}`);
    if (method === 'preflightNodeBatch') {
      if (state.drift) state.current = 'other';
      return { sceneUuid: 'scene', parentUuid: 'parent', assetReferences: state.assetRefs || [] };
    }
    assert.equal(method, 'createNodeBatch');
    state.execution = options;
    if (state.transportError) throw new Error('Lost reply');
    if (state.pending) await state.pending;
    if (state.driftAfterWrite) state.current = 'other';
    return state.result || { created: true, verified: true, needsSave: true };
  } };
  return { state, args, bridge, run: (options = args) => createNodeBatch(projectPath, bridge, options),
    registry: createToolRegistry({ getRuntimeContext: () => ({ projectPath, config: { toolProfile: 'full' } }), sceneBridge: bridge, interactionLog: { add() {} }, runtimeLog: { add() {} } }) };
}

test('batch create resolves a saved scene and performs one write-bridge call without native save or undo', async t => {
  const f = fixture(t); const r = await f.run(); assert.equal(r.created, true);
  assert.deepEqual(f.state.methods, ['preflightNodeBatch', 'createNodeBatch']); assert.deepEqual(f.state.execution.assets, []);
});

function uiInput() {
  return { sceneUuid: 'scene', parentUuid: 'parent', ui: { schemaVersion: 1, mode: 'create', failurePolicy: 'cleanup_new_nodes',
    roots: [{ id: 'panel', name: 'Panel', size: { width: 300, height: 200 }, label: { text: 'UI' } }] } };
}
test('build_ui formal entry reuses the same preflight, one write call and native Undo lifecycle', async t => {
  const f = fixture(t); f.state.version = '3.8.8';
  const { value } = await f.registry.callToolDetailed('build_ui', uiInput());
  assert.equal(value.ok, true); assert.equal(value.data.phase, 'complete'); assert.equal(value.data.undo.recorded, true);
  assert.deepEqual(f.state.methods, ['preflightNodeBatch', 'createNodeBatch']);
  assert.equal(f.state.execution.batch.ui, true);
  assert.deepEqual(f.state.recordings.map(r => r.method), ['begin-recording', 'end-recording']);
});
test('build_ui invalid schema returns structured no-write preflight failure', async t => {
  const f = fixture(t); const args = uiInput(); args.ui.roots[0].size.width = -1;
  await assert.rejects(f.registry.callToolDetailed('build_ui', args), error => {
    assert.equal(error.toolEnvelope.ok, false); assert.equal(error.toolEnvelope.data.phase, 'preflight');
    assert.equal(error.toolEnvelope.data.cleanup.status, 'not_needed'); return true;
  });
  assert.equal(f.state.calls.length, 0);
});
test('build_ui preserves scene asset preflight errors without starting Undo', async t => {
  const f = fixture(t); f.state.notImported = true;
  await assert.rejects(f.registry.callToolDetailed('build_ui', uiInput()), error => {
    assert.equal(error.toolEnvelope.data.phase, 'preflight'); assert.equal(error.toolEnvelope.data.created, false); return true;
  });
  assert.equal(f.state.methods.length, 0); assert.equal(f.state.recordings, undefined);
});
test('build_ui incomplete native finalization is never reported as a successful build', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state['end-recordingError'] = true;
  await assert.rejects(f.registry.callToolDetailed('build_ui', uiInput()), error => {
    const result = error.toolEnvelope.data;
    assert.equal(result.created, true); assert.equal(result.uncertain, true);
    assert.equal(result.undo.recorded, null); assert.equal(result.phase, 'undo_finalize'); return true;
  });
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

test('Creator 3.8.8 records exactly one parent-scoped Undo after verified creation', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; const result = await f.run();
  assert.equal(result.created, true); assert.equal(result.undo.supported, true); assert.equal(result.undo.recorded, true);
  assert.deepEqual(f.state.recordings, [{ method: 'begin-recording', target: 'parent' }, { method: 'end-recording', target: 'record-1' }]);
  assert.ok(f.state.calls.indexOf('scene:begin-recording') < f.state.calls.indexOf('bridge:createNodeBatch'));
  assert.ok(f.state.calls.indexOf('bridge:createNodeBatch') < f.state.calls.indexOf('scene:end-recording'));
  assert.equal(f.state.calls.some(c => /:(undo|redo|snapshot)$/.test(c)), false);
});

test('an unverified Creator version keeps creation available but reports Undo unsupported', async t => {
  const f = fixture(t); f.state.version = '3.8.7'; const result = await f.run();
  assert.equal(result.created, true); assert.equal(result.undo.supported, false); assert.equal(result.undo.recorded, false);
  assert.equal(result.undo.reason, 'unverified_creator_version'); assert.equal(f.state.recordings, undefined);
});

for (const beginResult of ['', undefined, 7]) test(`invalid recording identity ${beginResult} never creates or guesses a cancellation`, async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state.beginResult = beginResult;
  const result = await f.run(); assert.equal(result.created, false); assert.equal(result.uncertain, true);
  assert.equal(f.state.methods.includes('createNodeBatch'), false); assert.equal(f.state.recordings.length, 1);
  await assert.rejects(f.run(), /manual.*review/i);
});

test('a lost begin reply does not create or retry and blocks further batches until manual review', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state['begin-recordingError'] = true;
  const result = await f.run(); assert.equal(result.phase, 'undo_begin'); assert.equal(result.undo.recorded, null);
  assert.equal(result.created, false); assert.equal(result.uncertain, true); assert.equal(f.state.methods.includes('createNodeBatch'), false);
  assert.equal(f.state.recordings.length, 1); await assert.rejects(f.run(), /manual.*review/i);
});

for (const status of ['complete', 'partial', 'not_needed']) test(`failed batch with ${status} cleanup cancels only its recording`, async t => {
  const f = fixture(t); f.state.version = '3.8.8';
  f.state.result = { created: false, verified: false, error: 'Injected failure', cleanup: { status, remainingNodeIds: status === 'partial' ? ['owned'] : [] } };
  const result = await f.run(); assert.equal(result.created, false); assert.equal(result.undo.recorded, false); assert.equal(result.undo.cancelled, true);
  assert.deepEqual(result.cleanup, f.state.result.cleanup);
  assert.deepEqual(f.state.recordings, [{ method: 'begin-recording', target: 'parent' }, { method: 'cancel-recording', target: 'record-1' }]);
});

test('a lost write reply with an open recording never finalizes or cancels speculative history', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state.transportError = true;
  const result = await f.run(); assert.equal(result.uncertain, true); assert.equal(result.undo.recorded, null);
  assert.equal(result.undo.recordingId, 'record-1'); assert.equal(result.cleanup.status, 'not_attempted');
  assert.equal(f.state.recordings.length, 1); await assert.rejects(f.run(), /manual.*review/i);
});

test('a lost end reply preserves successful creation evidence but reports uncertain Undo', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state['end-recordingError'] = true;
  const result = await f.run(); assert.equal(result.created, true); assert.equal(result.verified, true); assert.equal(result.needsSave, true);
  assert.equal(result.uncertain, true); assert.equal(result.undo.recorded, null); assert.equal(result.phase, 'undo_finalize');
  assert.equal(f.state.recordings.length, 2); await assert.rejects(f.run(), /manual.*review/i);
});

test('a lost cancel reply keeps the cleanup evidence and marks history uncertain', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state['cancel-recordingError'] = true;
  f.state.result = { created: false, verified: false, error: 'Injected failure', cleanup: { status: 'complete', remainingNodeIds: [] } };
  const result = await f.run(); assert.equal(result.created, false); assert.equal(result.cleanup.status, 'complete');
  assert.equal(result.uncertain, true); assert.equal(result.undo.recorded, null); assert.match(result.error, /Injected failure/);
  assert.equal(f.state.recordings.length, 2); await assert.rejects(f.run(), /manual.*review/i);
});

test('a changed scene after writing prevents finalization in the wrong editor context', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state.driftAfterWrite = true;
  const result = await f.run(); assert.equal(result.uncertain, true); assert.equal(result.undo.recorded, null);
  assert.equal(f.state.recordings.length, 1); await assert.rejects(f.run(), /manual.*review/i);
});

test('asset preflight refusal does not start an Undo recording', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state.assetRefs = [{ id: 'frame', type: 'cc.SpriteFrame' }]; f.state.missingAsset = true;
  await assert.rejects(f.run()); assert.equal(f.state.recordings, undefined);
});

test('uncertain history is an MCP error even when the batch nodes were verified', async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state['end-recordingError'] = true;
  await assert.rejects(f.registry.callToolDetailed('create_node_batch', f.args), error => {
    assert.equal(error.toolEnvelope.ok, false); assert.equal(error.toolEnvelope.data.created, true);
    assert.equal(error.toolEnvelope.data.undo.recorded, null); assert.equal(error.toolEnvelope.data.uncertain, true); return true;
  });
});

for (const created of [true, false]) test(`unexpected finalization reply is uncertain for created=${created}`, async t => {
  const f = fixture(t); f.state.version = '3.8.8'; f.state.finalizeResult = false;
  f.state.result = { created, verified: created, cleanup: { status: 'not_needed' } };
  const result = await f.run(); assert.equal(result.uncertain, true); assert.equal(result.created, created);
  assert.equal(result.undo.recorded, null); await assert.rejects(f.run(), /manual.*review/i);
});

test('a known cancelled recording does not block the next explicit batch', async t => {
  const f = fixture(t); f.state.version = '3.8.8';
  f.state.result = { created: false, verified: false, cleanup: { status: 'complete' } };
  assert.equal((await f.run()).undo.cancelled, true);
  delete f.state.result;
  const next = await f.run(); assert.equal(next.created, true); assert.equal(next.undo.recorded, true);
  assert.equal(f.state.recordings.length, 4);
});
