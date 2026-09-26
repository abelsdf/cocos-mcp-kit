'use strict';

const DEFAULT_WAIT_MS = 1500;
const DEFAULT_POLL_MS = 150;

function normalizeTarget(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error('target must be an asset UUID or db URL.');
  const target = value.trim().replace(/\\/g, '/');
  if (!target || target.length > 512 || target.includes('\0') || target.includes('?') || target.includes('#')) {
    throw new Error('target must be an exact asset UUID or db URL.');
  }
  const url = target.startsWith('assets/') || target.startsWith('internal/')
    ? `db://${target}` : target;
  if (url.startsWith('db://')) {
    const segments = url.slice(5).split('/');
    if (!['assets', 'internal'].includes(segments[0]) || segments.length < 2 ||
        segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('target must be an exact db://assets or db://internal asset URL.');
    }
    return url;
  }
  if (!/^[A-Za-z0-9_-]+(?:@[A-Za-z0-9_-]+)?$/.test(url)) {
    throw new Error('target must be an asset UUID or db URL, not a filesystem path.');
  }
  return url;
}

function boundedInteger(value, fallback, name, max) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < 0 || result > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}.`);
  }
  return result;
}

function assetIdentity(info) {
  if (!info || typeof info !== 'object' || !info.uuid || !info.url || !info.type ||
      info.imported !== true || info.invalid === true) return null;
  return { uuid: info.uuid, url: info.url, type: info.type, importer: info.importer || null };
}

async function readSample(request, target) {
  const databaseReady = await request('query-ready') === true;
  if (!databaseReady) return { status: 'database_busy', databaseReady: false, asset: null };
  if (!target) return { status: 'observed', databaseReady: true, asset: null };
  const info = await request('query-asset-info', target);
  if (!info) return { status: 'missing', databaseReady: true, asset: null };
  const asset = assetIdentity(info);
  if (!asset) return { status: 'importing', databaseReady: true, asset: {
    uuid: info.uuid || null, url: info.url || null, type: info.type || null,
    imported: info.imported === true, invalid: info.invalid === true,
  } };
  if (target.startsWith('db://') ? asset.url !== target : asset.uuid !== target) {
    return { status: 'identity_mismatch', databaseReady: true, asset };
  }
  const byUuid = await request('query-asset-info', asset.uuid);
  const byUrl = await request('query-asset-info', asset.url);
  if (JSON.stringify(assetIdentity(byUuid)) !== JSON.stringify(asset) ||
      JSON.stringify(assetIdentity(byUrl)) !== JSON.stringify(asset)) {
    return { status: 'identity_mismatch', databaseReady: true, asset };
  }
  if (await request('query-ready') !== true) {
    return { status: 'database_busy', databaseReady: false, asset };
  }
  return { status: 'observed', databaseReady: true, asset };
}

async function checkAssetReady(options = {}) {
  const target = normalizeTarget(options.target);
  const waitMs = boundedInteger(options.waitMs, DEFAULT_WAIT_MS, 'waitMs', 10000);
  const pollMs = boundedInteger(options.pollMs, DEFAULT_POLL_MS, 'pollMs', 2000);
  if (pollMs === 0 && waitMs > 0) throw new Error('pollMs must be positive when waitMs is positive.');
  const nativeRequest = options.request || ((method, ...args) => {
    if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
      throw new Error('Editor.Message.request is unavailable; check_asset_ready requires Cocos asset-db.');
    }
    return Editor.Message.request('asset-db', method, ...args);
  });
  const request = (method, ...args) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${method} did not answer within 3000 ms.`);
      error.code = 'READINESS_QUERY_TIMEOUT';
      reject(error);
    }, 3000);
    Promise.resolve().then(() => nativeRequest(method, ...args)).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let previousKey = null;
  let stableReads = 0;
  let attempts = 0;
  let sample = { status: 'unknown', databaseReady: false, asset: null };
  do {
    attempts += 1;
    try {
      sample = await readSample(request, target);
    } catch (error) {
      if (error.code === 'READINESS_QUERY_TIMEOUT') {
        sample = { status: 'query_timeout', databaseReady: false, asset: null };
        break;
      }
      throw new Error(`asset-db readiness query failed: ${error.message}`, { cause: error });
    }
    const key = sample.status === 'observed' ? JSON.stringify(sample.asset || { databaseReady: true }) : null;
    stableReads = key && key === previousKey ? stableReads + 1 : key ? 1 : 0;
    previousKey = key;
    if (stableReads >= 2) {
      return { ready: true, status: 'ready', target, databaseReady: true,
        asset: sample.asset, stableReads, attempts, elapsedMs: now() - started,
        scope: target ? 'asset_db_record' : 'asset_db_query',
        guarantee: target ? 'Stable imported asset-db identity; source bytes and importer queue are not verified.'
          : 'Stable asset-db query readiness; importer queue and individual assets are not verified.' };
    }
    if (now() - started >= waitMs) break;
    await sleep(Math.min(pollMs, waitMs - (now() - started)));
  } while (attempts < 80);
  return { ready: false, status: sample.status === 'observed' ? 'unconfirmed' : sample.status,
    target, databaseReady: sample.databaseReady, asset: sample.asset,
    stableReads, attempts, elapsedMs: now() - started,
    timedOut: waitMs > 0 || sample.status === 'query_timeout',
    scope: target ? 'asset_db_record' : 'asset_db_query',
    guarantee: 'Readiness was not established; do not treat a native response as import completion.' };
}

module.exports = { checkAssetReady, normalizeTarget };
