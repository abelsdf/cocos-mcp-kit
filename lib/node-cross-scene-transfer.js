'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { openSceneSafely: defaultOpenSceneSafely } = require('./scenes');
const { createNodeBatch: defaultCreateNodeBatch } = require('./node-batch-create');

function createCrossSceneTransferManager(dependencies = {}) {
  const openSceneSafely = dependencies.openSceneSafely || defaultOpenSceneSafely;
  const createNodeBatch = dependencies.createNodeBatch || defaultCreateNodeBatch;
  const request = dependencies.request || ((channel, method, ...args) => Editor.Message.request(channel, method, ...args));
  const getCreatorVersion = dependencies.getCreatorVersion || (() => global.Editor?.App?.version);
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const transfers = new Map();
  const pending = new Set();
  const uncertain = new Set();

  const runExclusive = async (projectPath, operation) => {
    const projectKey = path.resolve(projectPath);
    if (uncertain.has(projectKey)) throw new Error('A prior cut has uncertain native history. Inspect the source scene and safely restart Creator before another transfer.');
    if (pending.has(projectKey)) throw new Error('A cross-scene transfer is already in progress for this project.');
    pending.add(projectKey);
    try { return await operation(projectKey); }
    finally { pending.delete(projectKey); }
  };

  async function copy(projectPath, sceneBridge, options = {}) {
    return runExclusive(projectPath, async projectKey => {
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
          Object.keys(options).some(key => !['sourceSceneUuid', 'rootUuids', 'targetScene', 'targetParentPath', 'externalPolicy', 'prepareCut'].includes(key)) ||
          typeof options.sourceSceneUuid !== 'string' || !options.sourceSceneUuid.trim() ||
          !Array.isArray(options.rootUuids) || options.rootUuids.length < 1 || options.rootUuids.length > 128 ||
          new Set(options.rootUuids).size !== options.rootUuids.length || options.rootUuids.some(uuid => typeof uuid !== 'string' || !uuid.trim()) ||
          typeof options.targetScene !== 'string' || !options.targetScene.trim() ||
          typeof options.targetParentPath !== 'string' || !options.targetParentPath.trim() ||
          options.externalPolicy !== undefined && !['reject', 'clear'].includes(options.externalPolicy) ||
          options.prepareCut !== undefined && typeof options.prepareCut !== 'boolean') {
        throw new Error('Expected sourceSceneUuid, 1-128 rootUuids, targetScene, targetParentPath and optional reject/clear externalPolicy and prepareCut.');
      }
      if (options.prepareCut && transfers.size >= 32) throw new Error('At most 32 staged cuts may be retained in one extension session. Finalize or restart before staging another.');
      const externalPolicy = options.externalPolicy || 'reject';
      const exported = await sceneBridge.call('exportNodeBatch', {
        sceneUuid: options.sourceSceneUuid, rootUuids: options.rootUuids, externalPolicy,
      });
      if (options.prepareCut && exported.incomingReferenceCount) {
        throw new Error(`Source batch is referenced outside the transfer (${exported.incomingReferenceCount}); copy is allowed, but safe cut staging is refused.`);
      }
      const opened = await openSceneSafely(projectPath, {
        target: options.targetScene, expectedSceneUuid: options.sourceSceneUuid,
      });
      if (!opened?.verified || opened.uuid === options.sourceSceneUuid) throw new Error('Destination must be a different verified scene.');
      const parent = await sceneBridge.call('resolveNodeBatchParent', {
        sceneUuid: opened.uuid, parentPath: options.targetParentPath,
      });
      const created = await createNodeBatch(projectPath, sceneBridge, {
        sceneUuid: opened.uuid, parentUuid: parent.parentUuid, batch: exported.batch,
      });
      if (created.created !== true || created.verified !== true) {
        return { copied: false, sourceDeleted: false, sourceSceneUuid: options.sourceSceneUuid,
          targetSceneUuid: opened.uuid, phase: created.phase || 'create', error: created.error || 'Destination batch was not verified.',
          destination: created };
      }
      let transferId = null;
      if (options.prepareCut) {
        transferId = randomUUID();
        transfers.set(transferId, {
          projectKey, externalPolicy, batch: exported.batch,
          source: { sceneUuid: options.sourceSceneUuid, parentUuid: exported.source.parentUuid,
            rootUuids: exported.source.rootUuids.slice() },
          target: { sceneUuid: opened.uuid, parentUuid: parent.parentUuid,
            rootUuids: created.rootUuids.slice() },
        });
      }
      return { copied: true, verified: true, sourceDeleted: false, needsSave: true,
        sourceSceneUuid: options.sourceSceneUuid, targetSceneUuid: opened.uuid,
        targetParentUuid: parent.parentUuid, rootUuids: created.rootUuids,
        nodeCount: created.nodeCount, componentCount: created.componentCount,
        referenceCount: created.referenceCount, fidelity: exported.fidelity,
        cutPrepared: Boolean(transferId), ...(transferId ? { transferId } : {}),
        undo: created.undo };
    });
  }

  async function finalizeCut(projectPath, sceneBridge, options = {}) {
    return runExclusive(projectPath, async projectKey => {
      if (!options || Object.keys(options).some(key => key !== 'transferId') ||
          typeof options.transferId !== 'string' || !options.transferId.trim()) throw new Error('An exact transferId is required.');
      const transfer = transfers.get(options.transferId);
      if (!transfer || transfer.projectKey !== projectKey) throw new Error('The staged cut does not exist in this extension session.');
      if (getCreatorVersion() !== '3.8.8') throw new Error('Cut finalization requires the verified Creator 3.8.8 native recording path. Copy remains available.');

      const target = await sceneBridge.call('exportNodeBatch', {
        sceneUuid: transfer.target.sceneUuid, rootUuids: transfer.target.rootUuids,
        externalPolicy: transfer.externalPolicy,
      });
      if (!isDeepStrictEqual(target.batch, transfer.batch) || target.source.parentUuid !== transfer.target.parentUuid) {
        throw new Error('Destination target batch changed after copy; refusing cut.');
      }
      await openSceneSafely(projectPath, {
        target: transfer.source.sceneUuid, expectedSceneUuid: transfer.target.sceneUuid,
      }).catch(error => { throw new Error(`Destination must be explicitly saved, clean and unchanged before cut finalization. ${error.message}`); });
      const source = await sceneBridge.call('exportNodeBatch', {
        sceneUuid: transfer.source.sceneUuid, rootUuids: transfer.source.rootUuids,
        externalPolicy: transfer.externalPolicy,
      });
      if (!isDeepStrictEqual(source.batch, transfer.batch) || source.source.parentUuid !== transfer.source.parentUuid ||
          !isDeepStrictEqual(source.source.rootUuids, transfer.source.rootUuids)) {
        throw new Error('Source batch changed after copy; refusing cut deletion.');
      }
      if (source.incomingReferenceCount) throw new Error('Source batch became referenced outside the transfer; refusing cut deletion.');

      let recordingId;
      try {
        recordingId = await request('scene', 'begin-recording', transfer.source.parentUuid);
        if (typeof recordingId !== 'string' || !recordingId.trim()) throw new Error('Creator did not return a recording identity.');
      } catch (error) {
        throw new Error(`Source recovery recording could not be established; nothing was deleted. ${error.message}`);
      }
      let deleted;
      try {
        deleted = await sceneBridge.call('deleteNodeBatchRoots', {
          sceneUuid: transfer.source.sceneUuid, parentUuid: transfer.source.parentUuid,
          rootUuids: transfer.source.rootUuids, batch: transfer.batch,
        });
      } catch (error) {
        uncertain.add(projectKey);
        throw new Error(`${error.message}. The delete reply was lost, so source state and native history are uncertain; no cancellation or retry was attempted. The saved source scene remains the recovery copy. Inspect it and safely restart Creator.`);
      }
      if (deleted?.deleted !== true) {
        try {
          const reply = await request('scene', 'cancel-recording', recordingId);
          if (reply !== undefined && reply !== null) throw new Error('Unexpected recording cancellation reply.');
        }
        catch (cancelError) {
          uncertain.add(projectKey);
          throw new Error(`${deleted?.error || 'Source deletion failed.'} Native recording cancellation also failed: ${cancelError.message}. The saved source scene remains the recovery copy; inspect it and safely restart Creator.`);
        }
        throw new Error(`${deleted?.error || 'Source deletion failed.'}. The saved source scene remains the recovery copy and was not overwritten.`);
      }
      try {
        const reply = await request('scene', 'end-recording', recordingId);
        if (reply !== undefined && reply !== null) throw new Error('Unexpected recording finalization reply.');
      }
      catch (error) {
        uncertain.add(projectKey);
        throw new Error(`Source nodes were deleted but native recording finalization is uncertain: ${error.message}. The saved source scene remains the recovery copy; inspect it before saving and safely restart Creator.`);
      }
      transfers.delete(options.transferId);
      return { completed: true, sourceDeleted: true, needsSave: true,
        sourceSceneUuid: transfer.source.sceneUuid, targetSceneUuid: transfer.target.sceneUuid,
        rootUuids: transfer.source.rootUuids.slice(), nodeCount: deleted.nodeCount,
        undo: { supported: true, recorded: true, scope: 'source_parent', recordingId },
        sourceRecovery: 'saved_scene_unchanged_until_explicit_save' };
    });
  }

  return { copy, finalizeCut };
}

const manager = createCrossSceneTransferManager();
module.exports = { createCrossSceneTransferManager,
  copyNodesBetweenScenes: manager.copy,
  finalizeCrossSceneCut: manager.finalizeCut };
