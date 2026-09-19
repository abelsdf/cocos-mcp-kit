'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveSpriteFrameTarget } = require('../lib/asset-resolution');

const imageUrl = 'db://assets/icons/arrow.png';
const frameUrl = `${imageUrl}/spriteFrame`;
const frame = { uuid: 'image-uuid@frame', url: frameUrl, type: 'cc.SpriteFrame', imported: true };
const image = {
  uuid: 'image-uuid', url: imageUrl, type: 'cc.ImageAsset', imported: true,
  subAssets: {
    texture: { uuid: 'image-uuid@texture', type: 'cc.Texture2D', imported: true },
    frame: { ...frame },
  },
};

test('resolveSpriteFrameTarget selects the imported SpriteFrame from an image path or main UUID', async () => {
  const calls = [];
  const queryInfo = async (target) => {
    calls.push(target);
    return target === frame.uuid ? frame : image;
  };
  const byPath = await resolveSpriteFrameTarget('assets/icons/arrow.png', { queryInfo });
  const byUuid = await resolveSpriteFrameTarget(image.uuid, { queryInfo });
  assert.equal(byPath.resolution, 'image-subasset');
  assert.equal(byPath.source.type, 'cc.ImageAsset');
  assert.equal(byPath.spriteFrame.uuid, frame.uuid);
  assert.equal(byUuid.spriteFrame.url, frameUrl);
  assert.deepEqual(calls, [imageUrl, frame.uuid, image.uuid, frame.uuid]);
});

test('resolveSpriteFrameTarget accepts an exact SpriteFrame without looking up its parent', async () => {
  const calls = [];
  const result = await resolveSpriteFrameTarget(frame.uuid, {
    queryInfo: async (target) => { calls.push(target); return frame; },
  });
  assert.equal(result.resolution, 'direct');
  assert.deepEqual(result.source, result.spriteFrame);
  assert.deepEqual(calls, [frame.uuid]);
});

test('resolveSpriteFrameTarget rejects textures, missing frames, and ambiguous frames', async () => {
  await assert.rejects(
    () => resolveSpriteFrameTarget('image-uuid@texture', {
      queryInfo: async () => ({ uuid: 'image-uuid@texture', type: 'cc.Texture2D', imported: true }),
    }),
    /not a Texture2D/
  );
  await assert.rejects(
    () => resolveSpriteFrameTarget(imageUrl, {
      queryInfo: async () => ({ ...image, subAssets: { texture: image.subAssets.texture } }),
    }),
    /no SpriteFrame subasset/
  );
  await assert.rejects(
    () => resolveSpriteFrameTarget(imageUrl, {
      queryInfo: async () => ({ ...image, subAssets: { first: frame, second: { ...frame, uuid: 'other-frame' } } }),
    }),
    /multiple SpriteFrame subassets/
  );
});

test('resolveSpriteFrameTarget requires a fully imported and matching subasset', async () => {
  await assert.rejects(
    () => resolveSpriteFrameTarget(imageUrl, { queryInfo: async () => ({ ...image, imported: false }) }),
    /not fully imported/
  );
  await assert.rejects(
    () => resolveSpriteFrameTarget(imageUrl, { queryInfo: async (target) => target === frame.uuid ? { ...frame, imported: false } : image }),
    /not fully imported/
  );
  await assert.rejects(
    () => resolveSpriteFrameTarget(imageUrl, { queryInfo: async (target) => target === frame.uuid ? { ...frame, uuid: 'wrong-frame' } : image }),
    /did not match/
  );
});
