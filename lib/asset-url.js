'use strict';

const { queryAssetUuid } = require('./asset-uuid');
const { normalizeAssetInspectionTarget } = require('./assets');

function sameIdentity(left, right) {
  return Boolean(left && right && left.uuid && left.url && left.type &&
    left.uuid === right.uuid && left.url === right.url && left.type === right.type);
}

function validDbUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('db://')) return false;
  try {
    return normalizeAssetInspectionTarget(value).target === value;
  } catch {
    return false;
  }
}

function defaultRequest(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; query_asset_url requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

async function queryAssetUrl(target, options = {}) {
  const request = options.request || defaultRequest;
  const identity = await queryAssetUuid(target, { ...options, request });
  if (!identity.found) {
    return { found: false, status: 'not_found', complete: false,
      input: identity.input, url: null };
  }
  if (!identity.complete) {
    return { found: true, status: 'incomplete', complete: false,
      input: identity.input, url: null, asset: identity.asset,
      parent: identity.parent, nativeMapping: null, issues: identity.issues };
  }

  const issues = [];
  if (!validDbUrl(identity.asset.url)) issues.push('canonical_url_invalid');
  const nativeUrl = await request('query-url', identity.uuid);
  if (typeof nativeUrl !== 'string' || !nativeUrl) {
    issues.push('native_url_unavailable');
  } else if (!validDbUrl(nativeUrl)) {
    issues.push('native_url_invalid');
  } else {
    const mappedUuid = await request('query-uuid', nativeUrl);
    const mappedInfo = await request('query-asset-info', nativeUrl);
    if (mappedUuid !== identity.uuid || !sameIdentity(identity.asset, mappedInfo)) {
      issues.push('native_url_identity_mismatch');
    }
  }

  const complete = issues.length === 0;
  return {
    found: true,
    status: complete ? 'resolved' : 'incomplete',
    complete,
    input: identity.input,
    url: complete ? identity.asset.url : null,
    asset: identity.asset,
    parent: identity.parent,
    nativeMapping: { url: typeof nativeUrl === 'string' ? nativeUrl : null,
      isCanonical: nativeUrl === identity.asset.url },
    issues,
  };
}

module.exports = { queryAssetUrl };
