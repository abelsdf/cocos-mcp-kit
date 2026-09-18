'use strict';

const path = require('path');
const { resolveProjectPath } = require('./path-safety');
const { persistSerializedAsset } = require('./serialized-asset-persistence');

function normalizeSceneTarget(projectPath, target) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error('target is required.');
  }

  let relative = raw;
  if (relative.startsWith('db://assets/')) {
    relative = relative.slice('db://'.length);
  } else if (relative.startsWith('/assets/')) {
    relative = relative.slice(1);
  } else if (!relative.startsWith('assets/')) {
    relative = `assets/${relative}`;
  }

  if (!relative.endsWith('.scene')) {
    relative = `${relative}.scene`;
  }

  const filePath = resolveProjectPath(projectPath, relative);
  const assetsRoot = path.join(projectPath, 'assets');
  const relativeToAssets = path.relative(assetsRoot, filePath);
  if (relativeToAssets.startsWith('..') || path.isAbsolute(relativeToAssets)) {
    throw new Error('target must be inside the Cocos assets directory.');
  }

  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return {
    filePath,
    projectRelative,
    dbUrl: `db://${projectRelative}`,
    sceneName: path.basename(filePath, '.scene'),
  };
}

async function saveSceneContent(projectPath, options = {}) {
  const target = normalizeSceneTarget(projectPath, options.target);
  const content = String(options.content || '');
  if (!content) {
    throw new Error('content is required.');
  }

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed) || !parsed.some((entry) => entry && entry.__type__ === 'cc.SceneAsset')) {
    throw new Error('content must contain a serialized cc.SceneAsset.');
  }

  const result = await persistSerializedAsset(target, content, {
    kind: 'scene',
    overwrite: options.overwrite,
    request: options.request,
    queryInfo: options.queryInfo,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    settleDelayMs: options.settleDelayMs,
  });
  return { ...result, sceneName: target.sceneName };
}

module.exports = {
  normalizeSceneTarget,
  saveSceneContent,
};
