'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { queryAssetInfo } = require('./assets');

function requestAssetDb(method, dbUrl, content) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; serialized assets require Cocos asset-db persistence.');
  }
  return Editor.Message.request('asset-db', method, dbUrl, content);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function matchesSerializedContent(requested, saved, kind, importedUuid) {
  const expected = JSON.parse(requested);
  if (kind === 'scene' && Array.isArray(expected) && Array.isArray(saved)) {
    const scene = saved.find((entry) => entry && entry.__type__ === 'cc.Scene');
    const expectedScene = expected.find((entry) => entry && entry.__type__ === 'cc.Scene');
    // Creator assigns the imported scene asset UUID to the serialized root scene.
    if (scene && expectedScene && scene._id === importedUuid) {
      expectedScene._id = importedUuid;
    }
  }
  return isDeepStrictEqual(saved, expected);
}

async function persistSerializedAsset(target, content, options = {}) {
  const existed = fs.existsSync(target.filePath);
  if (existed && options.overwrite !== true) {
    throw new Error(`Target ${options.kind} already exists: ${target.projectRelative}`);
  }

  const request = options.request || requestAssetDb;
  const queryInfo = options.queryInfo || queryAssetInfo;
  const retries = options.retries === undefined ? 10 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  const method = existed ? 'save-asset' : 'create-asset';
  const expectedType = options.kind === 'scene' ? 'cc.SceneAsset' : 'cc.Prefab';

  if (!options.request && (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function')) {
    throw new Error('Editor.Message.request is unavailable; serialized assets require Cocos asset-db persistence.');
  }

  fs.mkdirSync(path.dirname(target.filePath), { recursive: true });

  let verificationError = '';
  let info = null;
  const maxSaveAttempts = existed ? 2 : 1;
  for (let saveAttempt = 1; saveAttempt <= maxSaveAttempts; saveAttempt += 1) {
    let result;
    try {
      result = await request(method, target.dbUrl, content);
    } catch (error) {
      const fileNote = fs.existsSync(target.filePath)
        ? ' A file exists at the target; inspect it in Creator before retrying.'
        : '';
      throw new Error(`asset-db:${method} failed for ${target.dbUrl}: ${error.message}.${fileNote}`, { cause: error });
    }

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (!fs.existsSync(target.filePath)) {
        verificationError = 'the asset file is missing';
      } else {
        try {
          const saved = JSON.parse(fs.readFileSync(target.filePath, 'utf8'));
          info = await queryInfo(target.dbUrl);
          if (!info || !info.uuid || info.url !== target.dbUrl || info.type !== expectedType || info.imported !== true) {
            verificationError = 'asset-db did not return a matching, fully imported asset with UUID, URL, and type';
          } else if (!matchesSerializedContent(content, saved, options.kind, info.uuid)) {
            verificationError = 'the saved content differs from the requested content';
          } else {
            await delay(settleDelayMs);
            const settled = JSON.parse(fs.readFileSync(target.filePath, 'utf8'));
            info = await queryInfo(target.dbUrl);
            if (!info || !info.uuid || info.url !== target.dbUrl || info.type !== expectedType || info.imported !== true) {
              verificationError = 'asset-db did not retain a matching, fully imported asset';
            } else if (!matchesSerializedContent(content, settled, options.kind, info.uuid)) {
              verificationError = 'the saved content changed after asset-db initially reported success';
            } else {
              return {
                created: !existed,
                overwritten: existed,
                method: `asset-db:${method}`,
                saveAttempts: saveAttempt,
                result,
                dbUrl: target.dbUrl,
                path: target.projectRelative,
                fileExists: true,
                info,
              };
            }
          }
        } catch (error) {
          verificationError = `verification failed: ${error.message}`;
        }
      }
      if (attempt < retries) await delay(retryDelayMs);
    }
    if (saveAttempt < maxSaveAttempts && (
      verificationError === 'the saved content differs from the requested content' ||
      verificationError === 'the saved content changed after asset-db initially reported success'
    )) {
      await delay(retryDelayMs);
      continue;
    }
    break;
  }

  throw new Error(`asset-db:${method} returned for ${target.dbUrl}, but ${verificationError}. Check the file and asset database before retrying.`);
}

module.exports = { persistSerializedAsset };
