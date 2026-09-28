'use strict';
const crypto = require('crypto');
const validation = require('./ui-validation');
const screenshots = require('./screenshots');
const { validateCaptureTarget } = require('./screenshot-target');

function validateVerificationOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['sceneUuid', 'nodeUuids', 'exclude', 'maxFindings', 'waitMs', 'screenshot', 'windowId', 'titleContains'].includes(k))) throw new Error('Invalid UI verification options.');
  const { waitMs = 300, screenshot = 'none', windowId, titleContains, ...checks } = options;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 2000 || !['none', 'scene', 'game'].includes(screenshot)) throw new Error('waitMs requires 0..2000; screenshot requires none, scene or game.');
  validateCaptureTarget({ windowId, titleContains });
  if (screenshot === 'none' && (windowId !== undefined || titleContains !== undefined)) throw new Error('Window targeting requires a screenshot request.');
  return { checks: validation.validateUIOptions(checks), waitMs, screenshot, windowId, titleContains };
}
async function sceneDigest(sceneUuid, allowPreview) {
  const request = method => Editor.Message.request('scene', method);
  const mode = await request('query-scene-mode');
  if (await request('query-is-ready') !== true || await request('query-current-scene') !== sceneUuid ||
      !(mode === 'general' || allowPreview && mode === 'preview') || await request('multi-is-multi-edit-mode') !== false) throw new Error('UI verification requires the matching ready general scene; preview mode only supports an explicit game screenshot with structure marked not_checked.');
  const json = await request('query-scene-json');
  if (typeof json !== 'string' || !json) throw new Error('Scene serialization is unavailable for verification.');
  if (await request('query-current-scene') !== sceneUuid || await request('query-scene-mode') !== mode) throw new Error('Scene context changed during verification.');
  return { hash: crypto.createHash('sha256').update(json).digest('hex'), mode };
}
async function verifyUI(projectPath, sceneBridge, options) {
  const input = validateVerificationOptions(options), startedAt = new Date().toISOString();
  const allowPreview = input.screenshot === 'game';
  await sceneDigest(input.checks.sceneUuid, allowPreview);
  await new Promise(resolve => setTimeout(resolve, input.waitMs));
  const digest = await sceneDigest(input.checks.sceneUuid, allowPreview);
  const structure = digest.mode === 'general' ? await validation.validateUI(sceneBridge, input.checks)
    : { complete: false, passed: false, status: 'not_checked', reason: 'preview_mode',
      message: 'Edit-structure validation requires general mode. Stop Game View explicitly and validate the edit scene separately; no cached structure report was reused.' };
  const report = { sceneUuid: input.checks.sceneUuid, startedAt, waitMs: input.waitMs, sceneSerializationSha256: digest.hash, sceneMode: digest.mode, completed: true,
    structure, screenshot: { status: 'not_requested' }, visualValidation: 'not_run',
    warnings: ['The bounded delay is not an engine frame/render acknowledgment. Structure inspects edit state; screenshot pixels require separate client-side visual review.',
      'Game View runtime scene identity and freshness relative to unsaved edits are not verified. No preview start, save, repair or input was performed.'] };
  let image;
  if (input.screenshot !== 'none') {
    try {
      const { dataUri, ...metadata } = await screenshots.capturePanelScreenshot(projectPath, { panel: input.screenshot, windowId: input.windowId, titleContains: input.titleContains });
      report.screenshot = { status: 'captured', ...metadata }; image = dataUri;
    } catch (error) {
      report.completed = false; report.screenshot = { status: 'failed', source: input.screenshot, error: String(error.message || error).slice(0, 500) };
    }
  }
  const after = await sceneDigest(input.checks.sceneUuid, allowPreview);
  if (after.hash !== digest.hash || after.mode !== digest.mode) throw new Error('Scene changed during verification; structure/image pairing was withheld. Any already written capture file is only a discarded diagnostic artifact.');
  report.finishedAt = new Date().toISOString();
  return { report, image };
}
module.exports = { verifyUI, validateVerificationOptions };
