'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  addReferenceImage,
  clearReferenceImageBinding,
  queryReferenceImages,
  refreshReferenceImage,
  removeReferenceImage,
  selectReferenceImage,
  setReferenceImageParameters,
} = require('../lib/reference-images');

function createNativeReferenceImageHarness() {
  const sceneUuid = 'scene-uuid';
  const state = {
    images: [],
    binding: '',
    is2D: true,
    refreshed: 0,
  };
  const calls = [];

  const request = async (channel, method, ...args) => {
    calls.push([channel, method, ...args]);
    if (channel === 'scene' && method === 'query-is2D') return state.is2D;
    assert.equal(channel, 'reference-image');
    if (method === 'query-config') {
      return {
        images: state.images,
        sceneUUID: { [sceneUuid]: { path: state.binding } },
        scene: sceneUuid,
      };
    }
    if (method === 'query-current') {
      return state.images.find((image) => image.path === state.binding)
        || { path: '', x: 0, y: 0, sx: 1, sy: 1, opacity: 50 };
    }
    if (method === 'add-image') {
      const [paths] = args;
      setTimeout(() => {
        for (const imagePath of paths) {
          if (!state.images.some((image) => image.path === imagePath)) {
            state.images.push({ path: imagePath, x: 0, y: 0, sx: 1, sy: 1, opacity: 50, missing: false });
          }
          state.binding = imagePath;
        }
      }, 5);
      return undefined;
    }
    if (method === 'remove-image') {
      const [paths] = args;
      state.images = state.images.filter((image) => !paths.includes(image.path));
      if (paths.includes(state.binding)) state.binding = '';
      return undefined;
    }
    if (method === 'switch-image') {
      const [imagePath] = args;
      state.binding = imagePath;
      return undefined;
    }
    if (method === 'set-image-data') {
      const [key, value] = args;
      const current = state.images.find((image) => image.path === state.binding);
      if (!current) throw new Error('No current reference image');
      current[key] = value;
      return undefined;
    }
    if (method === 'refresh') {
      state.refreshed += 1;
      return undefined;
    }
    throw new Error(`Unexpected message: ${channel}.${method}`);
  };

  return { calls, request, sceneUuid, state };
}

function createImageFixture(t, extension = '.png') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-reference-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, `reference${extension}`);
  fs.writeFileSync(filePath, 'fixture');
  return filePath;
}

test('queryReferenceImages normalizes Creator 3.8 native state without claiming observable visibility', async () => {
  const harness = createNativeReferenceImageHarness();
  harness.state.images.push({ path: 'C:\\refs\\layout.png', x: 4, y: -2, sx: 0.5, sy: 1.5, opacity: 35, missing: false });
  harness.state.binding = harness.state.images[0].path;

  const result = await queryReferenceImages({ request: harness.request });

  assert.equal(result.backend, 'creator-native-reference-image');
  assert.deepEqual(result.images[0], {
    path: 'C:\\refs\\layout.png',
    x: 4,
    y: -2,
    scaleX: 0.5,
    scaleY: 1.5,
    opacity: 35,
    missing: false,
  });
  assert.equal(result.current.sceneUuid, harness.sceneUuid);
  assert.equal(result.current.imagePath, 'C:\\refs\\layout.png');
  assert.notEqual(result.current.image, result.images[0]);
  assert.deepEqual(result.visibility, {
    is2D: true,
    eligible: true,
    reason: 'eligible',
    effectiveVisible: null,
    observable: false,
  });
  assert.match(result.limitations[0], /native panel/i);
});

test('reference image operations use only the documented Creator native message channel', async (t) => {
  const harness = createNativeReferenceImageHarness();
  const first = createImageFixture(t);
  const second = createImageFixture(t, '.jpg');

  let result = await addReferenceImage(first, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.current.imagePath, first);

  await addReferenceImage(second, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  result = await selectReferenceImage(first, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.current.imagePath, first);

  result = await setReferenceImageParameters(
    { x: 12, y: -8, scaleX: 0.75, scaleY: 1.25, opacity: 40 },
    { request: harness.request, timeoutMs: 200, intervalMs: 1 }
  );
  assert.deepEqual(result.current.image, {
    path: first,
    x: 12,
    y: -8,
    scaleX: 0.75,
    scaleY: 1.25,
    opacity: 40,
    missing: false,
  });

  result = await clearReferenceImageBinding({ request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.current.imagePath, null);
  assert.equal(result.images.length, 2);

  await selectReferenceImage(second, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  result = await refreshReferenceImage({ request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.current.imagePath, second);
  assert.equal(harness.state.refreshed, 1);

  result = await removeReferenceImage(second, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.images.some((image) => image.path === second), false);
  assert.equal(result.current.imagePath, null);

  assert.equal(harness.calls.every(([channel]) => channel === 'reference-image' || channel === 'scene'), true);
  assert.equal(harness.calls.some(([, method, key]) => method === 'set-image-data' && key === 'sx'), true);
  assert.equal(harness.calls.some(([, method, key]) => method === 'set-image-data' && key === 'sy'), true);
});

test('reference image validation rejects unsafe or ambiguous mutations before native messages', async (t) => {
  const harness = createNativeReferenceImageHarness();
  const imagePath = createImageFixture(t);
  const callsBefore = harness.calls.length;

  await assert.rejects(() => addReferenceImage('reference.png', { request: harness.request }), /absolute/);
  await assert.rejects(() => addReferenceImage(`${imagePath}.gif`, { request: harness.request }), /PNG, JPG, or JPEG/);
  await assert.rejects(() => selectReferenceImage(imagePath, { request: harness.request }), /not in the native reference image library/);
  await assert.rejects(() => setReferenceImageParameters({}, { request: harness.request }), /At least one/);
  await assert.rejects(() => setReferenceImageParameters({ x: Number.NaN }, { request: harness.request }), /finite number/);
  await assert.rejects(() => setReferenceImageParameters({ opacity: 101 }, { request: harness.request }), /between 0 and 100/);
  assert.equal(harness.calls.length, callsBefore + 3);
});

test('missing files can be removed from the library but cannot be added', async () => {
  const harness = createNativeReferenceImageHarness();
  const missingPath = path.resolve(os.tmpdir(), `missing-reference-${process.pid}.png`);
  harness.state.images.push({ path: missingPath, x: 0, y: 0, sx: 1, sy: 1, opacity: 50, missing: true });

  await assert.rejects(() => addReferenceImage(missingPath, { request: harness.request }), /does not exist/);
  const result = await removeReferenceImage(missingPath, { request: harness.request, timeoutMs: 200, intervalMs: 1 });
  assert.equal(result.images.length, 0);
});
