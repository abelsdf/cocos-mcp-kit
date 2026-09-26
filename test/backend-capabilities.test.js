'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getBackendCapabilities } = require('../lib/backend-capabilities');

const runtime = {
  version: '0.1.0',
  projectPath: 'D:/Game/project-folder',
  projectName: 'project-folder',
  cocosVersion: '3.8.8',
  config: { toolProfile: 'core', clientConfigEntries: [{ token: 'private-value' }] },
};
const catalog = [
  { name: 'write_asset', category: 'assets', enabled: true, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'inspect_asset', category: 'assets', enabled: true, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'disabled_tool', category: 'files', enabled: false, annotations: { readOnlyHint: true } },
];

test('capability report exposes only enabled operations and keeps CLI unconfigured', () => {
  const report = getBackendCapabilities(runtime, catalog, {}, {
    editor: { Project: { name: 'manifest-name', path: runtime.projectPath, uuid: 'project-uuid' }, App: { version: '3.8.8' } },
    platform: 'win32', arch: 'x64',
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.activeBackend, 'creator-extension');
  assert.deepEqual(report.project, { name: 'manifest-name', path: runtime.projectPath, uuid: 'project-uuid', source: 'Editor.Project' });
  assert.deepEqual(report.platform, { os: 'win32', arch: 'x64' });
  assert.equal(report.backends.creatorExtension.exposedOperationCount, 2);
  assert.equal(report.backends.creatorExtension.readOnlyHintCount, 1);
  assert.equal(report.backends.creatorExtension.writeOrStatefulHintCount, 1);
  assert.equal(report.backends.creatorExtension.destructiveHintCount, 1);
  assert.equal(report.backends.creatorExtension.experimentalStatus, 'not_assessed_per_operation');
  assert.equal(report.backends.officialCli.status, 'not_configured');
  assert.equal(report.backends.officialCli.exposedOperationCount, 0);
  assert.deepEqual(report.operationPage.items.map((item) => item.id), ['inspect_asset', 'write_asset']);
  assert.deepEqual(report.operationPage.items.map((item) => item.riskHint), ['read_only', 'destructive']);
  assert.equal(JSON.stringify(report).includes('private-value'), false);
});

test('capability report paginates exposed operations without including disabled tools', () => {
  const first = getBackendCapabilities(runtime, catalog, { offset: 0, limit: 1 });
  const second = getBackendCapabilities(runtime, catalog, { offset: 1, limit: 1 });
  assert.equal(first.operationPage.total, 2);
  assert.equal(first.operationPage.nextOffset, 1);
  assert.deepEqual(first.operationPage.items.map((item) => item.id), ['inspect_asset']);
  assert.equal(second.operationPage.nextOffset, null);
  assert.deepEqual(second.operationPage.items.map((item) => item.id), ['write_asset']);
});

test('capability report rejects unbounded and invalid pages', () => {
  for (const options of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 201 }, { limit: '2' }]) {
    assert.throws(() => getBackendCapabilities(runtime, catalog, options), /(offset|limit) must/);
  }
});

test('capability report marks runtime project fallback and unknown versions', () => {
  const report = getBackendCapabilities({ ...runtime, cocosVersion: 'unknown', config: {} }, catalog);
  assert.equal(report.project.source, 'runtimeContext');
  assert.equal(report.project.uuid, null);
  assert.equal(report.backends.creatorExtension.creatorVersion, null);
  assert.equal(report.backends.creatorExtension.engineVersion, null);
  assert.equal(report.backends.creatorExtension.toolProfile, 'core');
});
