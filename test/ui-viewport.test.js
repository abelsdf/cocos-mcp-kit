'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const subject = () => require('../lib/ui-viewport');
function fixture(t) {
  const before = global.Editor; const state = { calls: [], width: 1280, height: 720, fitWidth: true, fitHeight: false, scene: 'scene', ready: true, mode: 'general', multi: false };
  global.Editor = { Profile: { getProject: async (name, key) => { state.calls.push(['profile', name, key]); if (state.profileError) throw new Error('Profile unavailable'); return state[key.split('.').at(-1)]; } },
    Message: { request: async (channel, method) => {
      state.calls.push([channel, method]);
      return { 'query-is-ready': state.ready, 'query-scene-mode': state.mode, 'multi-is-multi-edit-mode': state.multi, 'query-current-scene': state.scene }[method];
    } } };
  t.after(() => { if (before === undefined) delete global.Editor; else global.Editor = before; });
  const args = { sceneUuid: 'scene', nodeUuids: ['node'] };
  const bridge = { call: async (method, input) => {
    state.calls.push(['bridge', method, input]);
    assert.equal(method, 'getUIViewport'); assert.deepEqual(input, args);
    state.onRead?.();
    if (state.bridgeError) throw new Error('Viewport query failed');
    return { sceneUuid: 'scene', complete: true, scope: 'edit_scene_camera', nodes: [{ nodeUuid: 'node', available: true }], warnings: ['Geometry only'] };
  } };
  return { state, args, bridge };
}
test('viewport reads native project resolution twice around one scene query without writing', async t => {
  const f = fixture(t); const r = await subject().getUIViewport(f.bridge, f.args);
  assert.equal(r.complete, true); assert.deepEqual(r.projectDesignResolution, { available: true, width: 1280, height: 720, fitWidth: true, fitHeight: false, source: 'Editor.Profile.getProject' });
  assert.equal(f.state.calls.filter(c => c[0] === 'bridge').length, 1); assert.equal(f.state.calls.filter(c => c[0] === 'profile').length, 8);
  assert.equal(f.state.calls.every(c => c[0] === 'bridge' || c[0] === 'profile' || c[1].startsWith('query-') || c[1] === 'multi-is-multi-edit-mode'), true);
});
for (const kind of ['profileError', 'invalid', 'missing']) test(`unknown project resolution is not defaulted: ${kind}`, async t => {
  const f = fixture(t); if (kind === 'profileError') f.state.profileError = true; else f.state.width = kind === 'invalid' ? -1 : undefined;
  const r = await subject().getUIViewport(f.bridge, f.args); assert.equal(r.complete, false); assert.equal(r.projectDesignResolution.available, false); assert.equal(r.projectDesignResolution.width, undefined); assert.equal(r.nodes[0].available, true);
});
test('project configuration drift yields explicit incomplete context', async t => {
  const f = fixture(t); f.state.onRead = () => { f.state.height = 1080; };
  const r = await subject().getUIViewport(f.bridge, f.args); assert.equal(r.complete, false); assert.equal(r.projectDesignResolution.reason, 'changed_during_query');
});
for (const change of [s => { s.scene = 'other'; }, s => { s.ready = false; }, s => { s.mode = 'prefab'; }, s => { s.multi = true; }]) test(`scene context refuses: ${change}`, async t => {
  const f = fixture(t); change(f.state); await assert.rejects(subject().getUIViewport(f.bridge, f.args)); assert.equal(f.state.calls.some(c => c[0] === 'bridge'), false);
});
test('scene switch after the read rejects stale geometry', async t => {
  const f = fixture(t); f.state.onRead = () => { f.state.scene = 'other'; }; await assert.rejects(subject().getUIViewport(f.bridge, f.args), /scene/i);
});
test('invalid viewport options fail before IPC', async t => {
  const f = fixture(t); f.args.nodeUuids = []; await assert.rejects(subject().getUIViewport(f.bridge, f.args)); assert.equal(f.state.calls.length, 0);
});
test('viewport enrichment never converts a completed write to failure or repeats it', async t => {
  const f = fixture(t); f.state.bridgeError = true;
  const result = { created: true, verified: true, needsSave: true, sceneUuid: 'scene', identities: { nodes: { panel: 'node' } }, undo: { recorded: true } };
  const r = await subject().attachUIViewport(f.bridge, result);
  assert.equal(r.created, true); assert.equal(r.needsSave, true); assert.deepEqual(r.undo, result.undo);
  assert.equal(r.viewport.complete, false); assert.equal(r.viewport.reason, 'query_failed');
  assert.equal(f.state.calls.filter(c => c[0] === 'bridge').length, 1);
});
test('uncertain mutations and missing identities never trigger follow-up scene queries', async t => {
  const f = fixture(t);
  for (const result of [{ created: true, uncertain: true }, { created: true }]) {
    const r = await subject().attachUIViewport(f.bridge, result); assert.equal(r.created, true); assert.equal(r.viewport.complete, false);
  }
  assert.equal(f.state.calls.length, 0);
});
test('batch modification enrichment deduplicates known target IDs and preserves partial failure', async t => {
  const f = fixture(t);
  const result = { sceneUuid: 'scene', allSucceeded: false, results: [{ nodeUuid: 'node', status: 'applied' }, { nodeUuid: 'node', status: 'failed' }] };
  const r = await subject().attachUIViewport(f.bridge, result); assert.equal(r.allSucceeded, false); assert.equal(r.viewport.complete, true);
});
