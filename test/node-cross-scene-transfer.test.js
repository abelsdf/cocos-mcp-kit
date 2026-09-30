'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrossSceneTransferManager } = require('../lib/node-cross-scene-transfer');

const sourceBatch = {
  schemaVersion: 1,
  roots: ['n1'],
  nodes: [{ id: 'n1', parentId: null, name: 'Moved', active: true,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 }, components: [] }],
  references: [],
  externalPolicy: 'reject',
};

function fixture() {
  const calls = [];
  const state = { current: 'source-scene', targetSaved: false, sourceChanged: false, targetChanged: false };
  const clone = value => JSON.parse(JSON.stringify(value));
  const sceneBridge = { call: async (method, args) => {
    calls.push(`bridge:${method}`);
    if (method === 'exportNodeBatch') {
      if (state.current === 'source-scene') return {
        batch: state.sourceChanged ? { ...clone(sourceBatch), roots: ['changed'] } : clone(sourceBatch),
        source: { sceneUuid: 'source-scene', parentUuid: 'source-parent', rootUuids: ['source-root'], nodeCount: 1 },
        incomingReferences: [],
      };
      return {
        batch: state.targetChanged ? { ...clone(sourceBatch), nodes: [{ ...sourceBatch.nodes[0], name: 'Changed' }] } : clone(sourceBatch),
        source: { sceneUuid: 'target-scene', parentUuid: 'target-parent', rootUuids: ['target-root'], nodeCount: 1 },
        incomingReferences: [],
      };
    }
    if (method === 'resolveNodeBatchParent') return { sceneUuid: 'target-scene', parentUuid: 'target-parent', path: 'Canvas' };
    if (method === 'deleteNodeBatchRoots') {
      if (state.failDelete) return { deleted: false, error: 'delete failed', needsSave: null };
      if (state.loseDeleteReply) throw new Error('transport lost');
      return { deleted: true, nodeCount: 1, rootUuids: args.rootUuids, needsSave: true };
    }
    throw new Error(`Unexpected bridge call: ${method}`);
  } };
  const openSceneSafely = async (_projectPath, options) => {
    calls.push(`open:${options.expectedSceneUuid}->${options.target}`);
    if (options.expectedSceneUuid === 'target-scene' && !state.targetSaved) throw new Error('Switching requires one ready, saved, clean scene.');
    state.current = options.target;
    return { uuid: options.target, url: `db://assets/${options.target}.scene`, opened: true, verified: true, needsSave: false };
  };
  const createNodeBatch = async (_projectPath, _bridge, args) => {
    calls.push('create');
    assert.equal(state.current, 'target-scene');
    assert.equal(args.parentUuid, 'target-parent');
    return { created: true, verified: true, needsSave: true, sceneUuid: 'target-scene',
      rootUuids: ['target-root'], nodeCount: 1, componentCount: 0, referenceCount: 0,
      undo: { supported: true, recorded: true } };
  };
  const request = async (_channel, method, value) => {
    calls.push(`record:${method}${value ? `:${value}` : ''}`);
    if (method === 'begin-recording') return 'record-1';
    return undefined;
  };
  const manager = createCrossSceneTransferManager({ openSceneSafely, createNodeBatch,
    request, getCreatorVersion: () => '3.8.8', randomUUID: () => 'transfer-1' });
  const options = { sourceSceneUuid: 'source-scene', rootUuids: ['source-root'],
    targetScene: 'target-scene', targetParentPath: 'Canvas', prepareCut: true };
  return { manager, sceneBridge, state, calls, options };
}

test('cross-scene copy switches only after export and stages cut without deleting source', async () => {
  const f = fixture();
  const result = await f.manager.copy('C:/project', f.sceneBridge, f.options);
  assert.equal(result.copied, true);
  assert.equal(result.sourceDeleted, false);
  assert.equal(result.transferId, 'transfer-1');
  assert.equal(result.needsSave, true);
  assert.deepEqual(f.calls, ['bridge:exportNodeBatch', 'open:source-scene->target-scene',
    'bridge:resolveNodeBatchParent', 'create']);
});

test('cut finalization refuses an unsaved target before returning to or deleting the source', async () => {
  const f = fixture(); await f.manager.copy('C:/project', f.sceneBridge, f.options);
  f.calls.length = 0;
  await assert.rejects(() => f.manager.finalizeCut('C:/project', f.sceneBridge, { transferId: 'transfer-1' }), /saved, clean/i);
  assert.deepEqual(f.calls, ['bridge:exportNodeBatch', 'open:target-scene->source-scene']);
  assert.equal(f.calls.some(value => value.includes('delete')), false);
});

test('cut finalization verifies both scenes, records one Undo and leaves source dirty for explicit save', async () => {
  const f = fixture(); await f.manager.copy('C:/project', f.sceneBridge, f.options);
  f.state.targetSaved = true; f.calls.length = 0;
  const result = await f.manager.finalizeCut('C:/project', f.sceneBridge, { transferId: 'transfer-1' });
  assert.equal(result.completed, true);
  assert.equal(result.needsSave, true);
  assert.equal(result.sourceRecovery, 'saved_scene_unchanged_until_explicit_save');
  assert.deepEqual(f.calls, ['bridge:exportNodeBatch', 'open:target-scene->source-scene',
    'bridge:exportNodeBatch', 'record:begin-recording:source-parent',
    'bridge:deleteNodeBatchRoots', 'record:end-recording:record-1']);
});

test('cut finalization refuses target or source drift before deletion', async () => {
  const target = fixture(); await target.manager.copy('C:/project', target.sceneBridge, target.options);
  target.state.targetSaved = true; target.state.targetChanged = true;
  await assert.rejects(() => target.manager.finalizeCut('C:/project', target.sceneBridge, { transferId: 'transfer-1' }), /target.*changed/i);
  assert.equal(target.calls.some(value => value.includes('delete')), false);

  const source = fixture(); await source.manager.copy('C:/project', source.sceneBridge, source.options);
  source.state.targetSaved = true; source.state.sourceChanged = true;
  await assert.rejects(() => source.manager.finalizeCut('C:/project', source.sceneBridge, { transferId: 'transfer-1' }), /source.*changed/i);
  assert.equal(source.calls.some(value => value.includes('begin-recording')), false);
});

test('a delete failure cancels the recording and preserves the saved source as recovery', async () => {
  const f = fixture(); await f.manager.copy('C:/project', f.sceneBridge, f.options);
  f.state.targetSaved = true; f.state.failDelete = true; f.calls.length = 0;
  await assert.rejects(() => f.manager.finalizeCut('C:/project', f.sceneBridge, { transferId: 'transfer-1' }), /delete failed.*saved source/i);
  assert.deepEqual(f.calls.slice(-3), ['record:begin-recording:source-parent',
    'bridge:deleteNodeBatchRoots', 'record:cancel-recording:record-1']);
});

test('a lost delete reply is quarantined without racing native recording cancellation', async () => {
  const f = fixture(); await f.manager.copy('C:/project', f.sceneBridge, f.options);
  f.state.targetSaved = true; f.state.loseDeleteReply = true; f.calls.length = 0;
  await assert.rejects(() => f.manager.finalizeCut('C:/project', f.sceneBridge, { transferId: 'transfer-1' }), /transport lost.*uncertain/i);
  assert.equal(f.calls.some(value => value.includes('cancel-recording')), false);
});
