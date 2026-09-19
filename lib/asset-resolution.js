'use strict';

const { queryAssetInfo } = require('./assets');

function normalizeAssetTarget(target) {
  const value = String(target || '').trim().replace(/\\/g, '/');
  if (!value) {
    throw new Error('spriteFrameTarget is required.');
  }
  if (value.startsWith('assets/')) return `db://${value}`;
  if (value.startsWith('/assets/')) return `db://${value.slice(1)}`;
  return value;
}

function summarizeAsset(info) {
  return { uuid: info.uuid, url: info.url, type: info.type };
}

function assertImported(info, target) {
  if (!info || !info.uuid || info.imported !== true || info.invalid === true) {
    throw new Error(`Asset is not fully imported: ${target}`);
  }
}

async function resolveSpriteFrameTarget(target, options = {}) {
  const normalized = normalizeAssetTarget(target);
  const queryInfo = options.queryInfo || queryAssetInfo;
  const source = await queryInfo(normalized);
  assertImported(source, normalized);

  if (source.type === 'cc.SpriteFrame') {
    return {
      input: String(target).trim(),
      resolution: 'direct',
      source: summarizeAsset(source),
      spriteFrame: summarizeAsset(source),
    };
  }
  if (source.type !== 'cc.ImageAsset') {
    throw new Error(`Expected cc.SpriteFrame or cc.ImageAsset, got ${source.type || 'unknown'} for ${normalized}. Use the image asset or its SpriteFrame subasset, not a Texture2D.`);
  }

  const candidates = Object.values(source.subAssets || {})
    .filter((asset) => asset && asset.type === 'cc.SpriteFrame' && asset.uuid);
  if (candidates.length === 0) {
    throw new Error(`Image asset has no SpriteFrame subasset: ${normalized}. Set its import type to sprite-frame in Creator and wait for import.`);
  }
  if (candidates.length > 1) {
    throw new Error(`Image asset has multiple SpriteFrame subassets: ${normalized}. Supply the exact SpriteFrame UUID.`);
  }

  const spriteFrame = await queryInfo(candidates[0].uuid);
  assertImported(spriteFrame, candidates[0].uuid);
  if (spriteFrame.type !== 'cc.SpriteFrame' || spriteFrame.uuid !== candidates[0].uuid) {
    throw new Error(`SpriteFrame subasset lookup did not match ${candidates[0].uuid}.`);
  }
  return {
    input: String(target).trim(),
    resolution: 'image-subasset',
    source: summarizeAsset(source),
    spriteFrame: summarizeAsset(spriteFrame),
  };
}

module.exports = { resolveSpriteFrameTarget };
