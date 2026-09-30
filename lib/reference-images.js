'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REFERENCE_IMAGE_CHANNEL = 'reference-image';
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const DEFAULT_SETTLE_TIMEOUT_MS = 2000;
const DEFAULT_SETTLE_INTERVAL_MS = 50;

function defaultRequest(channel, method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable in this Cocos extension host.');
  }
  return Editor.Message.request(channel, method, ...args);
}

function normalizeAbsoluteImagePath(value, options = {}) {
  const imagePath = typeof value === 'string' ? value.trim() : '';
  if (!imagePath) throw new Error('Reference image path is required.');
  if (!path.isAbsolute(imagePath)) throw new Error('Reference image path must be absolute.');
  if (!SUPPORTED_EXTENSIONS.has(path.extname(imagePath).toLowerCase())) {
    throw new Error('Reference image must be a PNG, JPG, or JPEG file.');
  }
  const normalized = path.normalize(imagePath);
  if (options.mustExist === true) {
    let stat;
    try {
      stat = fs.statSync(normalized);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Reference image does not exist: ${normalized}`);
      }
      throw error;
    }
    if (!stat.isFile()) throw new Error(`Reference image is not a file: ${normalized}`);
  }
  return normalized;
}

function samePath(left, right) {
  const a = path.normalize(String(left || ''));
  const b = path.normalize(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function finiteOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeImage(value) {
  if (!value || typeof value.path !== 'string' || !value.path) return null;
  return {
    path: value.path,
    x: finiteOrDefault(value.x, 0),
    y: finiteOrDefault(value.y, 0),
    scaleX: finiteOrDefault(value.sx, 1),
    scaleY: finiteOrDefault(value.sy, 1),
    opacity: finiteOrDefault(value.opacity, 50),
    missing: value.missing === true,
  };
}

function normalizeReferenceImageState(config, current, is2D) {
  const images = Array.isArray(config && config.images)
    ? config.images.map(normalizeImage).filter(Boolean)
    : [];
  const sceneUuid = config && typeof config.scene === 'string' && config.scene ? config.scene : null;
  const imagePath = current && typeof current.path === 'string' && current.path ? current.path : null;
  const libraryImage = imagePath
    ? images.find((candidate) => samePath(candidate.path, imagePath))
    : null;
  const image = libraryImage ? { ...libraryImage } : imagePath ? normalizeImage(current) : null;

  let reason = 'eligible';
  if (!is2D) reason = 'not-2d';
  else if (!imagePath) reason = 'unbound';
  else if (image && image.missing) reason = 'missing';

  return {
    backend: 'creator-native-reference-image',
    channel: REFERENCE_IMAGE_CHANNEL,
    images,
    current: { sceneUuid, imagePath, image },
    visibility: {
      is2D: Boolean(is2D),
      eligible: reason === 'eligible',
      reason,
      effectiveVisible: null,
      observable: false,
    },
    limitations: [
      'Creator 3.8.8 does not expose the native panel visibility checkbox through the public reference-image messages, so effective visibility is not observable or writable here.',
    ],
  };
}

async function queryReferenceImages(options = {}) {
  const request = options.request || defaultRequest;
  let config;
  let current;
  let is2D;
  try {
    [config, current, is2D] = await Promise.all([
      request(REFERENCE_IMAGE_CHANNEL, 'query-config'),
      request(REFERENCE_IMAGE_CHANNEL, 'query-current'),
      request('scene', 'query-is2D'),
    ]);
  } catch (error) {
    throw new Error(`Creator native reference-image messages are unavailable: ${error.message}`);
  }
  return normalizeReferenceImageState(config, current, is2D);
}

function validateReferenceImageParameters(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Reference image parameters are required.');
  }
  const patch = {};
  for (const key of ['x', 'y', 'scaleX', 'scaleY', 'opacity']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw new Error(`${key} must be a finite number.`);
    }
    if (key === 'opacity' && (value[key] < 0 || value[key] > 100)) {
      throw new Error('opacity must be between 0 and 100.');
    }
    patch[key] = value[key];
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one reference image parameter is required.');
  }
  return patch;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReferenceImageState(predicate, options, action) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : DEFAULT_SETTLE_TIMEOUT_MS;
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(1, options.intervalMs) : DEFAULT_SETTLE_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let state;
  do {
    state = await queryReferenceImages(options);
    if (predicate(state)) return state;
    if (Date.now() >= deadline) break;
    await delay(intervalMs);
  } while (true);
  const error = new Error(`Creator did not settle the native reference image state after ${action}.`);
  error.state = state;
  throw error;
}

function findLibraryImage(state, imagePath) {
  return state.images.find((image) => samePath(image.path, imagePath));
}

async function addReferenceImage(value, options = {}) {
  const imagePath = normalizeAbsoluteImagePath(value, { mustExist: true });
  const request = options.request || defaultRequest;
  await request(REFERENCE_IMAGE_CHANNEL, 'add-image', [imagePath]);
  return waitForReferenceImageState(
    (state) => Boolean(findLibraryImage(state, imagePath)) && samePath(state.current.imagePath, imagePath),
    options,
    'add-image'
  );
}

async function removeReferenceImage(value, options = {}) {
  const requestedPath = normalizeAbsoluteImagePath(value);
  const before = await queryReferenceImages(options);
  const existing = findLibraryImage(before, requestedPath);
  if (!existing) throw new Error(`Reference image is not in the native reference image library: ${requestedPath}`);
  const request = options.request || defaultRequest;
  await request(REFERENCE_IMAGE_CHANNEL, 'remove-image', [existing.path]);
  return waitForReferenceImageState(
    (state) => !findLibraryImage(state, existing.path),
    options,
    'remove-image'
  );
}

async function selectReferenceImage(value, options = {}) {
  const requestedPath = normalizeAbsoluteImagePath(value);
  const before = await queryReferenceImages(options);
  const existing = findLibraryImage(before, requestedPath);
  if (!existing) throw new Error(`Reference image is not in the native reference image library: ${requestedPath}`);
  normalizeAbsoluteImagePath(existing.path, { mustExist: true });
  const request = options.request || defaultRequest;
  await request(REFERENCE_IMAGE_CHANNEL, 'switch-image', existing.path, before.current.sceneUuid);
  return waitForReferenceImageState(
    (state) => samePath(state.current.imagePath, existing.path),
    options,
    'switch-image'
  );
}

async function clearReferenceImageBinding(options = {}) {
  const before = await queryReferenceImages(options);
  if (!before.current.imagePath) return before;
  if (!before.current.sceneUuid) throw new Error('No scene or prefab is currently open.');
  const request = options.request || defaultRequest;
  await request(REFERENCE_IMAGE_CHANNEL, 'switch-image', '', before.current.sceneUuid);
  return waitForReferenceImageState(
    (state) => state.current.sceneUuid === before.current.sceneUuid && state.current.imagePath === null,
    options,
    'clear binding'
  );
}

async function setReferenceImageParameters(value, options = {}) {
  const patch = validateReferenceImageParameters(value);
  const before = await queryReferenceImages(options);
  if (!before.current.image) {
    throw new Error('The current scene or prefab has no reference image binding.');
  }
  const request = options.request || defaultRequest;
  const nativeKeys = { x: 'x', y: 'y', scaleX: 'sx', scaleY: 'sy', opacity: 'opacity' };
  for (const [key, number] of Object.entries(patch)) {
    await request(REFERENCE_IMAGE_CHANNEL, 'set-image-data', nativeKeys[key], number);
  }
  return waitForReferenceImageState(
    (state) => state.current.image && Object.entries(patch).every(([key, number]) => state.current.image[key] === number),
    options,
    'set-image-data'
  );
}

async function refreshReferenceImage(options = {}) {
  const before = await queryReferenceImages(options);
  if (!before.current.imagePath) {
    throw new Error('The current scene or prefab has no reference image binding.');
  }
  const request = options.request || defaultRequest;
  await request(REFERENCE_IMAGE_CHANNEL, 'refresh');
  const after = await queryReferenceImages(options);
  if (!samePath(after.current.imagePath, before.current.imagePath)) {
    throw new Error('Creator changed the current reference image binding while refreshing.');
  }
  return after;
}

module.exports = {
  REFERENCE_IMAGE_CHANNEL,
  addReferenceImage,
  clearReferenceImageBinding,
  normalizeAbsoluteImagePath,
  normalizeReferenceImageState,
  queryReferenceImages,
  refreshReferenceImage,
  removeReferenceImage,
  selectReferenceImage,
  setReferenceImageParameters,
  validateReferenceImageParameters,
  waitForReferenceImageState,
};
