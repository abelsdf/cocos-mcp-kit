'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function createScene() {
  class SpriteFrame {
    constructor(uuid) { this.uuid = uuid; }
  }
  class Sprite {
    constructor(frame) { this.spriteFrame = frame; }
  }
  const previous = new SpriteFrame('old-frame');
  const next = new SpriteFrame('new-frame');
  const sprite = new Sprite(previous);
  const scene = { name: 'Scene', uuid: 'scene', parent: null, children: [], _objFlags: 0 };
  const node = {
    name: 'Icon', uuid: 'icon', parent: scene, children: [], _objFlags: 0,
    getComponent: (type) => type === Sprite ? sprite : null,
  };
  scene.children.push(node);
  const assets = new Map([['new-frame', next], ['texture', { uuid: 'texture' }]]);
  const sceneFile = path.resolve(__dirname, '../scene.js');
  const localRequire = createRequire(sceneFile);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(sceneFile, 'utf8'), {
    Editor: { App: { path: '' } },
    module: { paths: [] },
    exports,
    require: (id) => id === 'cc' ? {
      Sprite, SpriteFrame,
      CCObjectFlags: { DontSave: 8 },
      director: { getScene: () => scene },
      assetManager: { loadAny: (uuid, callback) => {
        if (!assets.has(uuid)) callback(new Error(`Asset not found: ${uuid}`));
        else callback(null, assets.get(uuid));
      } },
    } : localRequire(id),
    console,
  }, { filename: sceneFile });
  return { methods: exports.methods, sprite, previous, next };
}

test('setSpriteFrame replaces the asset and reports the old and new UUIDs', async () => {
  const { methods, sprite, next } = createScene();
  const result = await methods.setSpriteFrame({ path: 'Icon', spriteFrameUuid: 'new-frame' });
  assert.equal(result.updated, true);
  assert.equal(result.previousSpriteFrameUuid, 'old-frame');
  assert.equal(result.spriteFrameUuid, 'new-frame');
  assert.equal(sprite.spriteFrame, next);
});

test('setSpriteFrame leaves the old reference intact when loading or type checks fail', async () => {
  const { methods, sprite, previous } = createScene();
  await assert.rejects(
    () => methods.setSpriteFrame({ path: 'Icon', spriteFrameUuid: 'texture' }),
    /must resolve to a cc.SpriteFrame/
  );
  await assert.rejects(
    () => methods.setSpriteFrame({ path: 'Icon', spriteFrameUuid: 'missing' }),
    /Asset not found/
  );
  await assert.rejects(
    () => methods.setSpriteFrame({ path: 'Missing', spriteFrameUuid: 'new-frame' }),
    /Target node was not found/
  );
  assert.equal(sprite.spriteFrame, previous);
});
