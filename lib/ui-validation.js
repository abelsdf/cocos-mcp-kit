'use strict';
const { isDeepStrictEqual } = require('node:util');
const { getUIViewport } = require('./ui-viewport');
const { RULES, validateUIOptions } = require('./ui-validation-scene');

const excluded = (input, rule, nodeUuid) => input.exclude.some(e => e.rule === rule && (!e.nodeUuid || e.nodeUuid === nodeUuid));
function buildUIReport(input, snapshot, viewport, assets) {
  const findings = []; let excludedChecks = 0, checkedRules = 0;
  for (const row of snapshot.nodes) {
    const pending = row.findings.slice();
    if (row.unavailable) pending.push(...RULES.filter(rule => rule !== 'ui_transform').map(rule => ({ rule, code: 'node_unavailable', severity: 'warning', status: 'not_checked', message: 'Node unavailable.', suggestion: 'Refresh the requested node identity.' })));
    else {
      const view = viewport.nodes?.find(n => n.nodeUuid === row.nodeUuid), size = viewport.projectDesignResolution;
      const content = view?.canvas?.content?.aabb, corners = view?.bounds?.canvas?.corners;
      if (!size?.available || !content || !corners || !(content.maxX > content.minX && content.maxY > content.minY)) {
        pending.push({ rule: 'design_bounds', code: 'bounds_unavailable', severity: 'warning', status: 'not_checked', message: 'Design range or Canvas-local rectangle is unavailable.', suggestion: 'Check UITransform, Canvas, transforms and project resolution; do not infer a pass.' });
      } else {
        const left = content.minX / (content.maxX - content.minX) * size.width, bottom = content.minY / (content.maxY - content.minY) * size.height;
        if (corners.some(p => p.x < left - 1e-6 || p.x > left + size.width + 1e-6 || p.y < bottom - 1e-6 || p.y > bottom + size.height + 1e-6)) {
          pending.push({ rule: 'design_bounds', code: 'outside_design_range', severity: 'warning', status: 'failed', message: 'A transformed corner lies outside the project design rectangle in Canvas-local coordinates.', suggestion: 'Review local layout and anchors, or exclude intentional off-screen content.' });
        }
      }
      for (const ref of row.assets) {
        if (excluded(input, ref.rule, row.nodeUuid)) continue;
        const checked = assets.get(ref.uuid);
        let code, status = 'failed', message;
        if (!ref.uuid || checked?.error || !checked) { code = 'asset_unavailable'; status = 'not_checked'; message = 'Asset identity or asset-db lookup is unavailable; runtime-created assets are not persistence-verified.'; }
        else {
          const info = checked.info;
          if (!info || info.uuid !== ref.uuid || info.imported !== true || info.invalid === true) { code = 'invalid_asset'; message = 'Asset is missing, not imported, invalid or has mismatched identity.'; }
          else if (info.type !== ref.expectedType && !(info.extends || []).includes(ref.expectedType)) { code = 'asset_type_mismatch'; message = `Expected ${ref.expectedType}, got ${info.type || 'unknown'}.`; }
        }
        if (code) pending.push({ rule: ref.rule, code, status, severity: status === 'failed' ? 'error' : 'warning', componentUuid: ref.componentUuid,
          assetUuid: ref.uuid.slice(0, 256), message, suggestion: 'Check import state and exact asset type, then verify save/reopen; do not auto-replace resources.' });
      }
    }
    for (const rule of RULES) { if (excluded(input, rule, row.nodeUuid)) excludedChecks++; else checkedRules++; }
    for (const finding of pending) if (!excluded(input, finding.rule, row.nodeUuid)) findings.push({ nodeUuid: row.nodeUuid, name: row.name, ...finding });
  }
  const truncated = findings.length > input.maxFindings;
  const complete = checkedRules > 0 && !truncated && !findings.some(f => f.status === 'not_checked');
  return { sceneUuid: input.sceneUuid, scope: 'explicit_nodes_edit_structure', nodeCount: snapshot.nodes.length,
    complete, passed: complete && findings.length === 0, visualValidation: 'not_run', checkedRules, excludedChecks, exclude: input.exclude,
    totalFindings: findings.length, truncated, findings: findings.slice(0, input.maxFindings),
    warnings: ['Checks cover only requested nodes and listed rules; descendants, arbitrary script references, runtime listeners, masks, occlusion and text glyphs are not inspected.',
      'Design bounds use project dimensions around the Canvas anchor, not camera clipping, Game View pixels or device visibility. No automatic repair, save or event invocation.',
      'Widget/Animation coexistence is only a potential conflict; animation tracks, tweens and script-driven transforms are not analyzed. Exclusions limit the meaning of passed.'] };
}

async function validateUI(sceneBridge, options) {
  const input = validateUIOptions(options), target = { sceneUuid: input.sceneUuid, nodeUuids: input.nodeUuids };
  // The existing viewport path guards ready/general/single-scene identity.
  await getUIViewport(sceneBridge, target);
  const before = await sceneBridge.call('inspectUIValidation', target);
  if (!before || before.sceneUuid !== input.sceneUuid || !Array.isArray(before.nodes) || !isDeepStrictEqual(before.nodes.map(n => n.nodeUuid), input.nodeUuids)) throw new Error('UI validation response identities do not match the request.');
  const viewport = await getUIViewport(sceneBridge, target);
  const assets = new Map();
  const readAsset = async uuid => {
    try {
      const info = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
      return { info: info ? { uuid: info.uuid, imported: info.imported, invalid: info.invalid, type: info.type, extends: info.extends } : null };
    } catch { return { error: true }; }
  };
  for (const row of before.nodes) for (const ref of row.assets) {
    if (!ref.uuid || assets.has(ref.uuid) || excluded(input, ref.rule, row.nodeUuid)) continue;
    assets.set(ref.uuid, await readAsset(ref.uuid));
  }
  const after = await sceneBridge.call('inspectUIValidation', target);
  const finalViewport = await getUIViewport(sceneBridge, target);
  for (const [uuid, value] of assets) if (!isDeepStrictEqual(value, await readAsset(uuid))) throw new Error('Asset state changed during UI validation; no stable report is available.');
  if (before.sceneUuid !== input.sceneUuid || !isDeepStrictEqual(before.nodes.map(n => n.nodeUuid), input.nodeUuids) ||
      !isDeepStrictEqual(before, after) || !isDeepStrictEqual(viewport, finalViewport)) throw new Error('UI validation state changed during query; no stable report is available.');
  return buildUIReport(input, before, viewport, assets);
}
module.exports = { validateUI, validateUIOptions, buildUIReport, RULES };
