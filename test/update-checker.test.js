'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkForUpdate, compareVersions, LATEST_RELEASE_URL, normalizeVersion, selectReleaseAssets } = require('../lib/update-checker');

test('fork update check does not contact an unconfigured upstream channel', async () => {
  assert.equal(LATEST_RELEASE_URL, '');
  const result = await checkForUpdate({ currentVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.equal(result.source, '');
  assert.equal(result.updateAvailable, false);
  assert.match(result.error, /no release source configured/i);
});

test('normalizeVersion removes release tag prefixes and metadata', () => {
  assert.equal(normalizeVersion('v1.2.3-beta+build'), '1.2.3');
});

test('compareVersions compares semantic version numbers', () => {
  assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0);
});

test('selectReleaseAssets finds extension zip, checksums, and manifest', () => {
  const selected = selectReleaseAssets('0.4.1', [
    { name: 'README.md', browser_download_url: 'https://example.test/readme' },
    { name: 'CocosMcpKit.v0.4.1.zip', browser_download_url: 'https://example.test/package.zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/sums' },
    { name: 'release-manifest.json', browser_download_url: 'https://example.test/manifest' },
  ]);

  assert.equal(selected.extensionAsset.name, 'CocosMcpKit.v0.4.1.zip');
  assert.equal(selected.checksumAsset.name, 'SHA256SUMS.txt');
  assert.equal(selected.manifestAsset.name, 'release-manifest.json');
  assert.equal(selected.assets.length, 4);
});
