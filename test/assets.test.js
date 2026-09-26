'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deleteAsset } = require('../lib/assets');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-delete-'));
  const file = path.join(projectPath, 'assets', 'Delete.prefab');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[]');
  fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid: 'prefab-uuid', importer: 'prefab' }));
  const info = { uuid: 'prefab-uuid', url: 'db://assets/Delete.prefab', type: 'cc.Prefab',
    imported: true, readonly: false, isDirectory: false, file };
  const calls = [];
  const state = { info, deleted: false, assetUsers: [], sceneNodes: [], dbReady: true, sceneReady: true };
  const remove = () => {
    state.deleted = true;
    fs.unlinkSync(file);
    fs.unlinkSync(`${file}.meta`);
  };
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    calls.push({ channel, method, args });
    if (state.request) {
      const override = await state.request(channel, method, ...args);
      if (override !== undefined) return override;
    }
    if (channel === 'scene') {
      if (method === 'query-is-ready') return state.sceneReady;
      if (method === 'query-nodes-by-asset-uuid') return state.sceneNodes;
    }
    assert.equal(channel, 'asset-db');
    if (method === 'query-ready') return state.dbReady;
    if (method === 'query-asset-info') {
      return !state.deleted && [info.uuid, info.url, file.replace(/\\/g, '/')].includes(args[0]) ? state.info : null;
    }
    if (method === 'query-asset-users') {
      assert.deepEqual(args, [info.uuid, 'all']);
      return state.assetUsers;
    }
    if (method === 'query-url') return state.deleted ? null : info.url;
    if (method === 'query-uuid') return state.deleted ? '' : info.uuid;
    if (method === 'delete-asset') {
      if (state.delete) return state.delete(...args);
      remove();
      return info;
    }
    throw new Error(`Unexpected request: ${channel}:${method}`);
  } } };
  t.after(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
  return { projectPath, file, info, calls, state, remove,
    options: { projectPath, retries: 0, retryDelayMs: 0 } };
}

function notDeleted(f) {
  assert.equal(f.calls.some((call) => call.method === 'delete-asset'), false);
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(fs.existsSync(`${f.file}.meta`), true);
}

function regularFixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-regular-delete-'));
  const extension = options.extension || '.png';
  const file = path.join(projectPath, 'assets', `Delete${extension}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const uuid = 'regular-main-uuid';
  const defaults = {
    '.json': { importer: 'json', type: 'cc.JsonAsset' },
    '.txt': { importer: 'text', type: 'cc.TextAsset' },
    '.png': { importer: 'image', type: 'cc.ImageAsset' },
    '.mp3': { importer: 'audio-clip', type: 'cc.AudioClip' },
  }[extension] || { importer: 'unknown', type: 'cc.Asset' };
  const importer = options.importer || defaults.importer;
  const type = options.type || defaults.type;
  const subAssets = options.subAssets || (extension === '.png' ? {
    spriteFrame: { uuid: `${uuid}@sprite`, type: 'cc.SpriteFrame' },
    texture: { uuid: `${uuid}@texture`, type: 'cc.Texture2D' },
  } : {});
  const url = `db://assets/Delete${extension}`;
  const metadata = { ver: '1.0.0', uuid, importer, files: [], subMetas: {}, userData: { quality: 'test' } };
  fs.writeFileSync(file, options.bytes || Buffer.from('delete-me'));
  fs.writeFileSync(`${file}.meta`, JSON.stringify(metadata));
  const info = {
    uuid, url, source: url, type, importer, imported: true, invalid: false,
    readonly: false, isDirectory: false, file, subAssets,
  };
  const calls = [];
  const state = {
    info,
    metadata,
    deleted: false,
    dbReady: true,
    sceneReady: true,
    assetUsers: Object.create(null),
    sceneNodes: Object.create(null),
  };
  if (extension === '.png') {
    state.assetUsers[`${uuid}@texture`] = [`${uuid}@sprite`];
  }
  const remove = () => {
    state.deleted = true;
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(`${file}.meta`)) fs.unlinkSync(`${file}.meta`);
  };
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    calls.push({ channel, method, args });
    if (state.request) {
      const override = await state.request(channel, method, ...args);
      if (override !== undefined) return override;
    }
    if (channel === 'scene') {
      if (method === 'query-is-ready') return state.sceneReady;
      if (method === 'query-nodes-by-asset-uuid') return state.sceneNodes[args[0]] || [];
    }
    assert.equal(channel, 'asset-db');
    if (method === 'query-ready') return state.dbReady;
    if (method === 'query-asset-info') {
      return !state.deleted && [uuid, url, file.replace(/\\/g, '/')].includes(args[0]) ? state.info : null;
    }
    if (method === 'query-asset-meta') return !state.deleted && args[0] === state.info.uuid ? state.metadata : null;
    if (method === 'query-asset-users') return state.assetUsers[args[0]] || [];
    if (method === 'query-url') return state.deleted ? null : url;
    if (method === 'query-uuid') return state.deleted ? '' : uuid;
    if (method === 'delete-asset') {
      assert.deepEqual(args, [uuid]);
      if (state.delete) return state.delete(...args);
      remove();
      return info;
    }
    throw new Error(`Unexpected request: ${channel}:${method}`);
  } } };
  t.after(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
  return {
    projectPath, file, info, metadata, calls, state, remove,
    options: { projectPath, retries: 0, retryDelayMs: 0 },
  };
}

for (const kind of ['uuid', 'url', 'relative', 'backslashes', 'absolute']) {
  test(`prefab deletion resolves an exact ${kind} and verifies database and disk removal`, async (t) => {
    const f = fixture(t);
    const targets = { uuid: f.info.uuid, url: f.info.url, relative: 'assets/Delete.prefab',
      backslashes: 'assets\\Delete.prefab', absolute: f.file };
    const result = await deleteAsset(targets[kind], f.options);
    assert.equal(result.deleted, true);
    assert.equal(result.uuid, f.info.uuid);
    assert.equal(result.url, f.info.url);
    assert.equal(result.method, 'asset-db:delete-asset');
    assert.deepEqual(result.referencePreflight, { assetUserCount: 0, sceneNodeCount: 0 });
    assert.equal(Object.keys(result.verification).length, 6);
    assert.equal(Object.values(result.verification).every((value) => value === true), true);
    assert.deepEqual(f.calls.filter((call) => call.method === 'delete-asset').map((call) => call.args), [[f.info.uuid]]);
  });
}

for (const target of ['', 'db://assets/Delete', 'db://assets/Absent.prefab', 'missing-uuid']) {
  test(`prefab deletion does not guess or silently accept target ${JSON.stringify(target)}`, async (t) => {
    const f = fixture(t);
    await assert.rejects(deleteAsset(target, f.options), /required|not found/i);
    notDeleted(f);
    assert.equal(f.calls.some((call) => call.args[0] === 'db://assets/Delete.scene'), false);
  });
}

for (const [label, change] of [
  ['unimported', { imported: false }], ['invalid', { invalid: true }],
  ['read-only', { readonly: true }], ['directory', { isDirectory: true }],
  ['wrong type', { type: 'cc.TextAsset' }], ['outside assets', { url: 'db://internal/Delete.prefab' }],
  ['traversal', { url: 'db://assets/../Delete.prefab' }],
  ['wrong source path', { file: path.join(os.tmpdir(), 'other.prefab') }],
]) {
  test(`prefab deletion rejects ${label} targets before any deletion`, async (t) => {
    const f = fixture(t);
    Object.assign(f.info, change);
    await assert.rejects(deleteAsset(f.info.uuid, f.options));
    notDeleted(f);
  });
}

test('prefab deletion requires matching metadata and an explicit project root', async (t) => {
  const f = fixture(t);
  await assert.rejects(deleteAsset(f.info.uuid), /project/i);
  fs.writeFileSync(`${f.file}.meta`, JSON.stringify({ uuid: 'different-uuid' }));
  await assert.rejects(deleteAsset(f.info.uuid, f.options), /metadata|meta|UUID/i);
  notDeleted(f);
});

test('prefab deletion refuses a project-local junction leading outside the project', async (t) => {
  const f = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-delete-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'Other.prefab'), '[]');
  const link = path.join(f.projectPath, 'assets', 'Linked');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.info.url = 'db://assets/Linked/Other.prefab';
  f.info.file = path.join(link, 'Other.prefab');
  await assert.rejects(deleteAsset(f.info.uuid, f.options), /outside/i);
  notDeleted(f);
});

for (const [key, value, message] of [
  ['assetUsers', ['saved-scene-uuid'], /saved-scene-uuid/],
  ['sceneNodes', ['unsaved-instance-uuid'], /unsaved-instance-uuid/],
  ['dbReady', false, /ready/i], ['sceneReady', false, /ready/i],
  ['assetUsers', null, /reference|query/i], ['sceneNodes', {}, /reference|query/i],
  ['assetUsers', [null], /reference|query/i],
]) {
  test(`prefab deletion fails closed for ${key}=${JSON.stringify(value)}`, async (t) => {
    const f = fixture(t);
    f.state[key] = value;
    await assert.rejects(deleteAsset(f.info.uuid, f.options), message);
    notDeleted(f);
  });
}

for (const failingMethod of ['query-asset-users', 'query-nodes-by-asset-uuid']) {
  test(`prefab deletion does not swallow ${failingMethod} errors`, async (t) => {
    const f = fixture(t);
    f.state.request = (channel, method) => { if (method === failingMethod) throw new Error('lookup unavailable'); };
    await assert.rejects(deleteAsset(f.info.uuid, f.options), /lookup unavailable/);
    notDeleted(f);
  });
}

test('prefab deletion rechecks identity after reference queries', async (t) => {
  const f = fixture(t);
  f.state.request = (channel, method) => {
    if (method === 'query-nodes-by-asset-uuid') f.state.info = { ...f.info, uuid: 'replacement-uuid' };
  };
  await assert.rejects(deleteAsset(f.info.uuid, f.options), /changed|identity|UUID/i);
  notDeleted(f);
});

for (const result of [null, true]) {
  test(`prefab deletion rejects a ${result} acknowledgement when nothing was removed`, async (t) => {
    const f = fixture(t);
    f.state.delete = () => result;
    await assert.rejects(deleteAsset(f.info.uuid, f.options), /not confirmed|not complete/i);
    assert.equal(fs.existsSync(f.file), true);
    assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
  });
}

for (const remaining of ['file', 'meta', 'uuid-info', 'url-info', 'uuid-url', 'url-uuid']) {
  test(`prefab deletion rejects incomplete removal with remaining ${remaining}`, async (t) => {
    const f = fixture(t);
    f.state.delete = () => {
      f.remove();
      if (remaining === 'file') fs.writeFileSync(f.file, '[]');
      if (remaining === 'meta') fs.writeFileSync(`${f.file}.meta`, '{}');
      return f.info;
    };
    f.state.request = (channel, method, target) => {
      if (!f.state.deleted) return;
      if (remaining === 'uuid-info' && method === 'query-asset-info' && target === f.info.uuid) return f.info;
      if (remaining === 'url-info' && method === 'query-asset-info' && target === f.info.url) return { ...f.info, uuid: 'replacement' };
      if (remaining === 'uuid-url' && method === 'query-url') return f.info.url;
      if (remaining === 'url-uuid' && method === 'query-uuid') return f.info.uuid;
    };
    await assert.rejects(deleteAsset(f.info.uuid, f.options), /not confirmed|not complete/i);
    assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
  });
}

test('prefab deletion waits for completion without repeating the destructive message', async (t) => {
  const f = fixture(t);
  let polls = 0;
  let requested = false;
  f.state.delete = () => { requested = true; return null; };
  f.state.request = (channel, method, target) => {
    if (requested && method === 'query-asset-info' && target === f.info.uuid && ++polls === 2) f.remove();
  };
  const result = await deleteAsset(f.info.uuid, { ...f.options, retries: 3 });
  assert.equal(result.deleted, true);
  assert.equal(polls, 2);
  assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
});

test('prefab deletion reports post-delete query errors as unconfirmed instead of absence', async (t) => {
  const f = fixture(t);
  f.state.request = (channel, method) => {
    if (f.state.deleted && method === 'query-asset-info') throw new Error('database disconnected');
  };
  await assert.rejects(deleteAsset(f.info.uuid, f.options), /not confirmed.*database disconnected/i);
  assert.equal(fs.existsSync(f.file), false);
});

test('prefab deletion propagates asset-db failure without filesystem fallback or retry', async (t) => {
  const f = fixture(t);
  f.state.delete = () => { throw new Error('delete refused'); };
  await assert.rejects(deleteAsset(f.info.uuid, f.options), /delete refused/);
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
});

test('regular asset deletion verifies references for main and subassets and confirms all disk/database removals', async (t) => {
  const f = regularFixture(t);
  const result = await deleteAsset(f.info.uuid, f.options);
  assert.equal(result.deleted, true);
  assert.equal(result.uuid, f.info.uuid);
  assert.equal(result.url, f.info.url);
  assert.equal(result.type, 'cc.ImageAsset');
  assert.equal(result.referencePreflight.identitiesChecked, 3);
  assert.equal(result.referencePreflight.internalAssetUserCount, 1);
  assert.equal(Object.values(result.verification).every(Boolean), true);
  assert.match(result.warnings[0], /string or path-based/);
  assert.deepEqual(
    f.calls.filter((call) => call.method === 'query-asset-users').map((call) => call.args[0]),
    ['regular-main-uuid', 'regular-main-uuid@sprite', 'regular-main-uuid@texture']
  );
  assert.deepEqual(f.calls.filter((call) => call.method === 'delete-asset').map((call) => call.args), [[f.info.uuid]]);
});

test('regular asset deletion supports imported JSON, text, image, and audio main assets', async (t) => {
  for (const extension of ['.json', '.txt', '.png', '.mp3']) {
    const f = regularFixture(t, { extension });
    const result = await deleteAsset(f.info.uuid, f.options);
    assert.equal(result.deleted, true);
    assert.equal(result.type, f.info.type);
    assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
  }
});

test('regular asset deletion refuses main and imported-subasset references before deletion', async (t) => {
  const main = regularFixture(t);
  main.state.assetUsers[main.info.uuid] = ['db://assets/UsesImage.prefab'];
  await assert.rejects(() => deleteAsset(main.info.uuid, main.options), /main regular-main-uuid.*UsesImage/);
  notDeleted(main);

  const child = regularFixture(t);
  child.state.sceneNodes[`${child.info.uuid}@sprite`] = ['scene-sprite-node'];
  await assert.rejects(() => deleteAsset(child.info.uuid, child.options), /subasset:spriteFrame.*scene-sprite-node/);
  notDeleted(child);
});

test('regular asset deletion rejects unsupported identities, paths, metadata, sizes, and retry bounds', async (t) => {
  const mutations = [
    (f) => { f.state.info.type = 'cc.SceneAsset'; },
    (f) => { f.state.info.uuid = 'regular-main-uuid@child'; f.state.info.source = 'db://assets/Delete.png'; },
    (f) => { f.state.info.readonly = true; },
    (f) => { f.state.info.imported = false; },
    (f) => { f.state.info.file = path.join(os.tmpdir(), 'outside.png'); },
    (f) => { fs.writeFileSync(`${f.file}.meta`, JSON.stringify({ ...f.metadata, uuid: 'other' })); },
    (f) => { fs.truncateSync(f.file, (64 * 1024 * 1024) + 1); },
  ];
  for (const mutate of mutations) {
    const f = regularFixture(t);
    mutate(f);
    await assert.rejects(() => deleteAsset(f.info.uuid, f.options));
    notDeleted(f);
  }
  const bounds = regularFixture(t);
  await assert.rejects(() => deleteAsset(bounds.info.uuid, { ...bounds.options, retries: -1 }), /retries/);
  notDeleted(bounds);
  await assert.rejects(() => deleteAsset(bounds.info.uuid, { ...bounds.options, retryDelayMs: -1 }), /retryDelayMs/);
  notDeleted(bounds);
});

test('regular asset deletion requires ready asset and scene databases', async (t) => {
  const assetDb = regularFixture(t);
  assetDb.state.dbReady = false;
  await assert.rejects(() => deleteAsset(assetDb.info.uuid, assetDb.options), /must be ready/);
  notDeleted(assetDb);

  const scene = regularFixture(t);
  scene.state.sceneReady = false;
  await assert.rejects(() => deleteAsset(scene.info.uuid, scene.options), /must be ready/);
  notDeleted(scene);
});

test('regular asset deletion fails closed for invalid reference query results and lookup errors', async (t) => {
  const invalid = regularFixture(t);
  invalid.state.assetUsers[invalid.info.uuid] = [null];
  await assert.rejects(() => deleteAsset(invalid.info.uuid, invalid.options), /invalid asset users/);
  notDeleted(invalid);

  const unavailable = regularFixture(t);
  unavailable.state.request = (channel, method) => {
    if (channel === 'scene' && method === 'query-nodes-by-asset-uuid') throw new Error('scene reference lookup unavailable');
  };
  await assert.rejects(() => deleteAsset(unavailable.info.uuid, unavailable.options), /lookup unavailable/);
  notDeleted(unavailable);
});

test('regular asset deletion rechecks identity, source bytes, metadata, and subassets after reference queries', async (t) => {
  for (const mutation of ['identity', 'source', 'metadata', 'subassets']) {
    const f = regularFixture(t);
    let changed = false;
    f.state.request = (channel, method, target) => {
      if (!changed && channel === 'scene' && method === 'query-nodes-by-asset-uuid' && target === `${f.info.uuid}@texture`) {
        changed = true;
        if (mutation === 'identity') f.state.info = { ...f.info, uuid: 'replacement-uuid' };
        if (mutation === 'source') fs.appendFileSync(f.file, 'changed');
        if (mutation === 'metadata') f.state.metadata = { ...f.metadata, userData: { changed: true } };
        if (mutation === 'subassets') f.state.info = { ...f.info, subAssets: {
          ...f.info.subAssets,
          texture: { uuid: 'replacement@texture', type: 'cc.Texture2D' },
        } };
      }
    };
    await assert.rejects(() => deleteAsset(f.info.uuid, f.options), /changed during deletion preflight/);
    notDeleted(f);
  }
});

test('regular asset deletion never repeats a destructive request and rejects incomplete removal', async (t) => {
  const f = regularFixture(t);
  f.state.delete = () => {
    f.remove();
    fs.writeFileSync(f.file, 'remaining');
    return f.info;
  };
  await assert.rejects(() => deleteAsset(f.info.uuid, f.options), /not confirmed.*fileAbsent/);
  assert.equal(f.calls.filter((call) => call.method === 'delete-asset').length, 1);
});

test('regular asset deletion waits for completion, but reports native and post-delete query failures as uncertain', async (t) => {
  const delayed = regularFixture(t);
  let requested = false;
  let polls = 0;
  delayed.state.delete = () => { requested = true; return null; };
  delayed.state.request = (channel, method, target) => {
    if (requested && channel === 'asset-db' && method === 'query-asset-info' && target === delayed.info.uuid && ++polls === 2) {
      delayed.remove();
    }
  };
  const result = await deleteAsset(delayed.info.uuid, { ...delayed.options, retries: 3 });
  assert.equal(result.deleted, true);
  assert.equal(delayed.calls.filter((call) => call.method === 'delete-asset').length, 1);

  const native = regularFixture(t);
  native.state.delete = () => { throw new Error('native refused'); };
  await assert.rejects(() => deleteAsset(native.info.uuid, native.options), /result may be uncertain/);
  assert.equal(native.calls.filter((call) => call.method === 'delete-asset').length, 1);
  assert.equal(fs.existsSync(native.file), true);

  const query = regularFixture(t);
  query.state.delete = () => { query.remove(); return null; };
  query.state.request = (channel, method) => {
    if (query.state.deleted && channel === 'asset-db' && method === 'query-asset-info') throw new Error('database disconnected');
  };
  await assert.rejects(() => deleteAsset(query.info.uuid, query.options), /not confirmed.*database disconnected/);
  assert.equal(query.calls.filter((call) => call.method === 'delete-asset').length, 1);
});

test('delete_asset registry supplies the project root and wraps verified deletion or refusal', async (t) => {
  const f = fixture(t);
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ config: { toolProfile: 'full' }, projectPath: f.projectPath }),
    interactionLog: { add() {} }, runtimeLog: { add() {}, list: () => [], clear() {} },
    sceneBridge: { call: async () => assert.fail('Use native scene reference queries') },
  });
  f.state.sceneNodes = ['active-prefab-root'];
  await assert.rejects(registry.callToolDetailed('delete_asset', { target: f.info.url }), (error) => {
    assert.equal(error.toolEnvelope.ok, false);
    assert.match(error.toolEnvelope.data.message, /active-prefab-root/);
    return true;
  });
  notDeleted(f);
  f.state.sceneNodes = [];
  const { value } = await registry.callToolDetailed('delete_asset', { target: f.info.url });
  assert.equal(value.ok, true);
  assert.equal(value.data.deleted, true);
  assert.equal(value.data.verification.metaAbsent, true);
});
