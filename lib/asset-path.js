'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeAssetInspectionTarget } = require('./assets');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

function samePath(left, right) {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.uuid && left.url && left.type &&
    left.uuid === right.uuid && left.url === right.url && left.type === right.type);
}

function diskKind(filePath) {
  if (!filePath) return 'unknown';
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function defaultRequest(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; query_asset_path requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

async function queryAssetPath(target, options = {}) {
  const input = normalizeAssetInspectionTarget(target, options.projectPath);
  const request = options.request || defaultRequest;
  const info = await request('query-asset-info', input.target);
  if (info == null) return { found: false, status: 'not_found', input, complete: false };
  if (!info || typeof info.uuid !== 'string' || !info.uuid ||
      typeof info.url !== 'string' || !info.url ||
      typeof info.type !== 'string' || !info.type) {
    throw new Error('asset-db returned an incomplete asset identity.');
  }

  const issues = [];
  const byUuid = await request('query-asset-info', info.uuid);
  const byUrl = await request('query-asset-info', info.url);
  if (!sameIdentity(info, byUuid) || !sameIdentity(info, byUrl)) {
    issues.push('identity_lookup_mismatch');
  }
  if (info.imported !== true || info.invalid === true) issues.push('not_imported');

  const subasset = info.isSubAsset === true || info.uuid.includes('@');
  if (input.kind === 'uuid-or-opaque' && input.target !== info.uuid) {
    issues.push('input_uuid_mismatch');
  } else if (input.kind !== 'uuid-or-opaque' && !subasset && input.target !== info.url) {
    issues.push('input_url_mismatch');
  }
  let sourceInfo = info;
  if (subasset) {
    const parentUuid = info.uuid.split('@')[0];
    const parent = await request('query-asset-info', parentUuid);
    const linked = parent && parent.uuid === parentUuid &&
      Object.values(parent.subAssets || {}).some((child) => child && child.uuid === info.uuid);
    if (!linked) {
      issues.push('parent_asset_unresolved');
      sourceInfo = null;
    } else {
      sourceInfo = parent;
      if (parent.imported !== true || parent.invalid === true) issues.push('parent_not_imported');
    }
  }

  const nativePathByUuid = await request('query-path', info.uuid);
  const nativePathByUrl = await request('query-path', info.url);
  if (typeof nativePathByUuid !== 'string' || !nativePathByUuid ||
      typeof nativePathByUrl !== 'string' || !nativePathByUrl ||
      !samePath(nativePathByUuid, nativePathByUrl)) {
    issues.push('native_path_mismatch');
  }

  let sourcePath = null;
  if (sourceInfo) {
    const nativeSourcePath = subasset
      ? await request('query-path', sourceInfo.uuid) : nativePathByUuid;
    sourcePath = typeof sourceInfo.file === 'string' && sourceInfo.file
      ? sourceInfo.file : nativeSourcePath;
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) ||
        !samePath(sourcePath, nativeSourcePath)) {
      issues.push('source_path_mismatch');
      sourcePath = null;
    } else if (sourceInfo.url.startsWith('db://assets/')) {
      if (!options.projectPath) {
        issues.push('project_path_unavailable');
      } else {
        const expected = resolveProjectFilePath(options.projectPath, sourceInfo.url.slice('db://'.length));
        const assetsRoot = resolveProjectFilePath(options.projectPath, 'assets');
        if (!isPathInside(assetsRoot, expected) || !samePath(sourcePath, expected)) {
          issues.push('source_outside_project_assets');
          sourcePath = null;
        }
      }
    }
  }
  const sourceDiskKind = diskKind(sourcePath);
  if (sourceDiskKind === 'missing' || sourceDiskKind === 'other') issues.push('source_unavailable');
  if (subasset && sourcePath && nativePathByUuid && samePath(sourcePath, nativePathByUuid)) {
    issues.push('subasset_mapping_is_source_path');
  }

  return {
    found: true,
    status: issues.length ? 'incomplete' : 'resolved',
    complete: issues.length === 0,
    input,
    asset: { uuid: info.uuid, url: info.url, type: info.type,
      kind: subasset ? 'subasset' : 'main', imported: info.imported === true,
      invalid: info.invalid === true },
    source: sourceInfo ? { uuid: sourceInfo.uuid, url: sourceInfo.url,
      path: sourcePath, diskKind: sourceDiskKind } : null,
    nativeMapping: { path: typeof nativePathByUuid === 'string' ? nativePathByUuid : null,
      isPhysicalSource: !subasset && ['file', 'directory'].includes(sourceDiskKind) &&
        sourcePath != null && samePath(nativePathByUuid, sourcePath) },
    issues,
  };
}

module.exports = { queryAssetPath };
