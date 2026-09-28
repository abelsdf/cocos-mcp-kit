'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateUIOptions, buildUIReport } = require('../lib/ui-validation');
const options = { sceneUuid: 'scene', nodeUuids: ['node'] };
const snapshot = () => ({ sceneUuid: 'scene', nodes: [{ nodeUuid: 'node', name: 'Panel', findings: [], assets: [] }] });
const viewport = () => ({ projectDesignResolution: { available: true, width: 100, height: 100 }, nodes: [{ nodeUuid: 'node',
  canvas: { content: { aabb: { minX: -50, maxX: 50, minY: -50, maxY: 50 } } },
  bounds: { canvas: { corners: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] } } }] });
const report = (s = snapshot(), v = viewport(), extra = {}) => buildUIReport(validateUIOptions({ ...options, ...extra }), s, v, new Map());
test('valid explicit nodes pass structural checks, never visual checks', () => {
  const r = report(); assert.equal(r.passed, true); assert.equal(r.complete, true); assert.equal(r.visualValidation, 'not_run');
});
test('design bounds use transformed corners and project resolution, not camera clipping', () => {
  const v = viewport(); v.nodes[0].bounds.canvas.corners[0].x = 60;
  const r = report(snapshot(), v); assert.equal(r.passed, false); assert.equal(r.findings[0].rule, 'design_bounds');
  assert.equal(r.findings[0].severity, 'warning');
});
test('missing geometry is not a passed bounds check', () => {
  const r = report(snapshot(), { nodes: [] }); assert.equal(r.complete, false); assert.equal(r.passed, false);
  assert.equal(r.findings[0].status, 'not_checked');
});

test('design bounds preserve asymmetric Canvas anchor when content and design sizes differ', () => {
  const v = viewport(); v.nodes[0].canvas.content.aabb = { minX: -50, maxX: 150, minY: -150, maxY: 50 };
  v.nodes[0].bounds.canvas.corners = [{ x: -25, y: -75 }, { x: 75, y: 25 }];
  assert.equal(report(snapshot(), v).passed, true);
  v.nodes[0].bounds.canvas.corners[0].x = -26;
  assert.equal(report(snapshot(), v).findings[0].code, 'outside_design_range');
});
test('exclusions retain counts and do not pretend every rule was checked', () => {
  const v = viewport(); v.nodes[0].bounds.canvas.corners[0].x = 60;
  const r = report(snapshot(), v, { exclude: [{ rule: 'design_bounds', nodeUuid: 'node' }] });
  assert.equal(r.passed, true); assert.equal(r.excludedChecks, 1); assert.equal(r.findings.length, 0);
});
test('findings truncation cannot turn a failing report into passing', () => {
  const s = snapshot(); s.nodes[0].findings = Array.from({ length: 5 }, (_, i) => ({ rule: 'button_events', code: 'bad', severity: 'error', status: 'failed', message: 'missing', suggestion: 'repair', eventIndex: i }));
  const r = report(s, viewport(), { maxFindings: 1 }); assert.equal(r.totalFindings, 5); assert.equal(r.findings.length, 1); assert.equal(r.truncated, true); assert.equal(r.complete, false); assert.equal(r.passed, false);
});
for (const extra of [{ other: true }, { nodeUuids: [] }, { nodeUuids: ['node', 'node'] }, { maxFindings: 0 }, { maxFindings: 101 },
  { exclude: [{ rule: 'unknown' }] }, { exclude: [{ rule: 'design_bounds', nodeUuid: 'elsewhere' }] }, { exclude: [{}] }, { exclude: 'all' }]) {
  test('reject invalid validation options ' + JSON.stringify(extra), () => assert.throws(() => validateUIOptions({ ...options, ...extra })));
}
test('all rules excluded produces incomplete not empty success', () => {
  const r = report(snapshot(), viewport(), { exclude: ['ui_transform', 'design_bounds', 'sprite_frame', 'label_font', 'button_events', 'widget_animation'].map(rule => ({ rule })) });
  assert.equal(r.complete, false); assert.equal(r.passed, false);
});

for (const [name, asset, code, complete] of [
  ['imported frame', { info: { uuid: 'asset', imported: true, type: 'cc.SpriteFrame' } }, null, true],
  ['missing', { info: null }, 'invalid_asset', true],
  ['not imported', { info: { uuid: 'asset', imported: false, type: 'cc.SpriteFrame' } }, 'invalid_asset', true],
  ['wrong type', { info: { uuid: 'asset', imported: true, type: 'cc.Texture2D' } }, 'asset_type_mismatch', true],
  ['lookup rejected', { error: true }, 'asset_unavailable', false],
]) test('asset reference: ' + name, () => {
  const s = snapshot(); s.nodes[0].assets.push({ rule: 'sprite_frame', uuid: 'asset', expectedType: 'cc.SpriteFrame', componentUuid: 'sprite' });
  const r = buildUIReport(validateUIOptions(options), s, viewport(), new Map([['asset', asset]]));
  assert.equal(r.complete, complete); assert.equal(r.findings[0]?.code ?? null, code);
});

test('font subclasses are accepted, UUID-less runtime assets are not persistence verified', () => {
  const s = snapshot(); s.nodes[0].assets.push({ rule: 'label_font', uuid: 'asset', expectedType: 'cc.Font' });
  assert.equal(buildUIReport(validateUIOptions(options), s, viewport(), new Map([['asset', { info: { uuid: 'asset', imported: true, type: 'cc.TTFFont', extends: ['cc.Font'] } }]])).passed, true);
  s.nodes[0].assets[0].uuid = ''; assert.equal(report(s).complete, false);
});

function orchestrator(t) {
  const original = global.Editor, state = { reads: 0, assets: 0, scene: 'scene' };
  global.Editor = { Profile: { getProject: async (_p, key) => ({ width: 100, height: 100, fitWidth: true, fitHeight: false })[key.split('.').at(-1)] },
    Message: { request: async (channel, method) => {
      if (channel === 'asset-db') { state.assets++; if (state.assetError) throw Error('offline'); return { uuid: 'asset', imported: true, type: state.assetDrift && state.assets > 1 ? 'cc.Texture2D' : 'cc.SpriteFrame' }; }
      return { 'query-is-ready': true, 'query-scene-mode': 'general', 'multi-is-multi-edit-mode': false, 'query-current-scene': state.scene }[method];
    } } };
  t.after(() => { if (original === undefined) delete global.Editor; else global.Editor = original; });
  const bridge = { call: async method => {
    if (method === 'getUIViewport') return { ...viewport(), sceneUuid: 'scene', complete: true };
    assert.equal(method, 'inspectUIValidation'); state.reads++; const s = snapshot();
    if (state.drift && state.reads > 1) s.nodes[0].name = 'Changed';
    if (state.asset) s.nodes[0].assets.push({ rule: 'sprite_frame', uuid: 'asset', expectedType: 'cc.SpriteFrame' });
    return s;
  } };
  return { state, run: (extra = {}) => require('../lib/ui-validation').validateUI(bridge, { ...options, ...extra }) };
}
test('orchestrator verifies stable scene snapshots and deduplicated asset metadata without writes', async t => {
  const f = orchestrator(t); f.state.asset = true; assert.equal((await f.run()).passed, true); assert.equal(f.state.reads, 2); assert.equal(f.state.assets, 2);
});
test('orchestrator rejects scene drift', async t => { const f = orchestrator(t); f.state.drift = true; await assert.rejects(f.run(), /changed/); });
test('orchestrator rejects asset metadata drift', async t => { const f = orchestrator(t); f.state.asset = f.state.assetDrift = true; await assert.rejects(f.run(), /Asset state changed/); });
test('orchestrator reports query errors as incomplete, not invalid assets', async t => { const f = orchestrator(t); f.state.asset = f.state.assetError = true; const r = await f.run(); assert.equal(r.complete, false); assert.equal(r.findings[0].code, 'asset_unavailable'); });
test('orchestrator refuses mismatched scene before inspection', async t => { const f = orchestrator(t); f.state.scene = 'elsewhere'; await assert.rejects(f.run(), /matching ready scene/); assert.equal(f.state.reads, 0); });

test('excluded asset rules do not query asset-db or manufacture missing-resource findings', async t => {
  const f = orchestrator(t); f.state.asset = f.state.assetError = true;
  const r = await f.run({ exclude: [{ rule: 'sprite_frame' }] }); assert.equal(r.passed, true); assert.equal(f.state.assets, 0);
});
