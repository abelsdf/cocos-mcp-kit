'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectUuidReferences } = require('../lib/tools/assets-advanced');

test('collectUuidReferences reports only explicit asset references in Cocos JSON', () => {
  const refs = collectUuidReferences(JSON.stringify({
    __type__: 'cc.Prefab',
    sprite: { __uuid__: '2d3KcYpS5HCKb6wU0v5c9x' },
    nested: [{ assetUuid: '550e8400-e29b-41d4-a716-446655440000' }],
    nodeUuid: '4c+LMU6MlMDqkp7NfvG1lO',
    uuid: '550e8400-e29b-41d4-a716-446655440001',
    fileId: 'nestedPrefabInstanceRoots',
  }));

  assert.deepEqual(refs.map((ref) => ref.uuid), [
    '2d3KcYpS5HCKb6wU0v5c9x',
    '550e8400-e29b-41d4-a716-446655440000',
  ]);
  assert.ok(refs.every((ref) => ref.source === 'structured'));
});

test('collectUuidReferences scans full UUIDs in non-JSON text without treating node IDs as assets', () => {
  const refs = collectUuidReferences('asset: 550e8400-e29b-41d4-a716-446655440000@f9941 node: 4c+LMU6MlMDqkp7NfvG1lO');
  assert.deepEqual(refs.map((ref) => ref.uuid), ['550e8400-e29b-41d4-a716-446655440000@f9941']);
});
