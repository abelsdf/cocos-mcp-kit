'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createScene, openSceneSafely } = require('../lib/scenes');

function fixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-entry-'));
  fs.mkdirSync(path.join(project, 'assets'));
  const content = id => JSON.stringify([{ __type__: 'cc.SceneAsset', _name: id, scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _id: id, _name: id, _children: [] }]);
  const infos = {};
  const put = (id, url = `db://assets/${id}.scene`, text = content(id)) => {
    infos[id] = { uuid: id, url, type: 'cc.SceneAsset', imported: true };
    fs.writeFileSync(path.join(project, url.slice(5)), text);
    fs.writeFileSync(path.join(project, `${url.slice(5)}.meta`), JSON.stringify({ uuid: id }));
  };
  put('origin'); put('target');
  const state = { uuid: 'origin', dirty: false, mode: 'general', ready: true, multi: false, live: content('origin'), calls: [], hook: null };
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, ...args) => {
    state.calls.push({ channel, method, args });
    if (state.hook) await state.hook(channel, method, ...args);
    if (channel === 'scene') {
      return { 'query-is-ready': state.ready, 'query-current-scene': state.uuid, 'query-dirty': state.dirty,
        'query-scene-mode': state.mode, 'multi-is-multi-edit-mode': state.multi, 'query-scene-json': state.live,
        'multi-scene-query': [{ uuid: state.uuid, dirty: state.dirty, url: infos[state.uuid]?.url, type: state.mode === 'general' ? 'scene' : 'prefab' }] }[method];
    }
    if (method === 'query-ready') return true;
    if (method === 'query-asset-info') return infos[args[0]] || Object.values(infos).find(i => i.url === args[0]);
    if (method === 'open-asset') { state.uuid = args[0]; state.live = fs.readFileSync(path.join(project, infos[state.uuid].url.slice(5)), 'utf8'); return true; }
    if (method === 'create-asset') { const objects = JSON.parse(args[1]); objects[1]._id = 'new'; put('new', args[0], JSON.stringify(objects)); return true; }
    throw new Error(`Unexpected ${channel}:${method}`);
  } } };
  t.after(() => { global.Editor = previous; fs.rmSync(project, { recursive: true, force: true }); });
  const bridge = { call: async (method, args) => {
    assert.equal(method, 'serializeScene');
    return { content: content(args.sceneName), mode: args.mode, source: null, scene: { name: args.sceneName } };
  } };
  const mutations = () => state.calls.filter(c => ['open-asset', 'create-asset', 'save-asset'].includes(c.method));
  return { project, state, infos, put, bridge, mutations };
}

test('safe scene entry verifies target and retained origin, repeated open does not reopen', async t => {
  const f = fixture(t);
  const result = await openSceneSafely(f.project, { target: 'assets/target.scene', expectedSceneUuid: 'origin' });
  assert.equal(result.verified, true); assert.equal(result.uuid, 'target');
  assert.equal(result.previousScene.uuid, 'origin'); assert.equal(result.needsSave, false);
  assert.equal((await openSceneSafely(f.project, { target: 'target' })).alreadyOpen, true);
  assert.equal(f.mutations().length, 1);
});

for (const [name, change] of Object.entries({
  dirty: f => { f.state.dirty = true; },
  unmarked: f => { f.state.live = f.state.live.replace('"_name":"origin","_children"', '"_name":"Edited","_children"'); },
  prefab: f => { f.state.mode = 'prefab'; },
  multi: f => { f.state.multi = true; },
  notReady: f => { f.state.ready = false; },
  missingOrigin: f => { f.state.uuid = ''; },
  badMeta: f => { fs.writeFileSync(path.join(f.project, 'assets/origin.scene.meta'), '{"uuid":"wrong"}'); },
  importing: f => { f.infos.origin.imported = false; },
})) test(`create and open reject ${name} without creating or switching`, async t => {
  const f = fixture(t); change(f);
  await assert.rejects(() => createScene(f.project, f.bridge, { target: 'New', mode: 'ui', openAfterCreate: true, expectedSceneUuid: 'origin' }));
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }));
  assert.equal(f.mutations().length, 0);
});

test('create-only UI scene preserves unsaved origin and does not query switching state', async t => {
  const f = fixture(t); f.state.dirty = true;
  const result = await createScene(f.project, f.bridge, { target: 'New', mode: 'ui' });
  assert.equal(result.created, true); assert.equal(result.opened, null); assert.equal(f.state.uuid, 'origin');
  assert.deepEqual(f.mutations().map(c => c.method), ['create-asset']);
});

for (const options of [{ openAfterCreate: true }, { openAfterCreate: 'true' }, { mode: 'ui', overwrite: true },
  { mode: 'invalid' }, { expectedSceneUuid: 'origin' }, { target: 'origin', mode: 'ui' }]) {
  test(`invalid create contract rejected before mutation: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t);
    await assert.rejects(() => createScene(f.project, f.bridge, { target: 'New', ...options }));
    assert.equal(f.mutations().length, 0);
  });
}

test('create/open verifies original identity before creation', async t => {
  const f = fixture(t);
  await assert.rejects(() => createScene(f.project, f.bridge, { target: 'New', openAfterCreate: true, expectedSceneUuid: 'wrong' }), /expected/i);
  assert.equal(f.mutations().length, 0);
});

test('create/open returns verified scene without implicit save', async t => {
  const f = fixture(t);
  const result = await createScene(f.project, f.bridge, { target: 'New', mode: 'ui', openAfterCreate: true, expectedSceneUuid: 'origin' });
  assert.equal(result.opened.uuid, 'new'); assert.equal(result.opened.verified, true);
  assert.deepEqual(f.mutations().map(c => c.method), ['create-asset', 'open-asset']);
});

test('origin changed during asset creation is retained; new file remains but is not opened', async t => {
  const f = fixture(t);
  f.state.hook = async (_channel, method) => { if (method === 'create-asset') f.state.live = f.state.live.replace('"_children":[]', '"_children":[],"changed":true'); };
  await assert.rejects(() => createScene(f.project, f.bridge, { target: 'New', mode: 'ui', openAfterCreate: true, expectedSceneUuid: 'origin' }), /created.*New.scene.*not.*automatically/i);
  assert.deepEqual(f.mutations().map(c => c.method), ['create-asset']);
  assert.ok(fs.existsSync(path.join(f.project, 'assets/New.scene')));
});

test('unconfirmed native open is never retried, saved, or rolled back', async t => {
  const f = fixture(t);
  f.state.hook = async (_channel, method) => { if (method === 'open-asset') throw new Error('transport failure'); };
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }), /may.*opened.*No automatic/i);
  assert.deepEqual(f.mutations().map(c => c.method), ['open-asset']);
});

test('wrong target type is rejected before opening', async t => {
  const f = fixture(t); f.infos.target.type = 'cc.Prefab';
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }));
  assert.equal(f.mutations().length, 0);
});

test('post-open serialized mismatch is not reported as success or rolled back', async t => {
  const f = fixture(t);
  f.state.hook = async (_channel, method) => { if (method === 'query-scene-json' && f.state.uuid === 'target') f.state.live = '{}'; };
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }));
  assert.deepEqual(f.mutations().map(c => c.method), ['open-asset']);
});

test('stable load-time changes are reported as unsaved without automatic save', async t => {
  const f = fixture(t);
  f.state.hook = async (_channel, method) => { if (method === 'query-scene-json' && f.state.uuid === 'target') f.state.live = f.state.live.replace('"_name":"target","_children"', '"_name":"Initialized","_children"'); };
  const result = await openSceneSafely(f.project, { target: 'target' });
  assert.equal(result.verified, true); assert.equal(result.contentMatchesSource, false); assert.equal(result.needsSave, true);
  assert.deepEqual(f.mutations().map(c => c.method), ['open-asset']);
  await assert.rejects(() => openSceneSafely(f.project, { target: 'origin' }), /unsaved serialized/);
});

test('create/open never overwrites the active scene even with overwrite permission', async t => {
  const f = fixture(t);
  await assert.rejects(() => createScene(f.project, f.bridge, { target: 'origin', overwrite: true, openAfterCreate: true, expectedSceneUuid: 'origin' }), /active scene/);
  assert.equal(f.mutations().length, 0);
});

test('create refuses orphan metadata without invoking serializer', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'assets/New.scene.meta'), '{}');
  await assert.rejects(() => createScene(f.project, { call: () => assert.fail('No serialization') }, { target: 'New', mode: 'ui' }), /metadata already/);
  assert.equal(f.mutations().length, 0);
});

test('origin file changed during native open is reported uncertain without retry', async t => {
  const f = fixture(t);
  f.state.hook = async (_channel, method) => { if (method === 'open-asset') fs.appendFileSync(path.join(f.project, 'assets/origin.scene'), '\n'); };
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }), /original scene changed.*may already have opened/);
  assert.deepEqual(f.mutations().map(c => c.method), ['open-asset']);
});

test('target identity change during preflight prevents native open', async t => {
  const f = fixture(t); let reads = 0;
  f.state.hook = async (_channel, method, target) => { if (method === 'query-asset-info' && target === 'target' && ++reads === 2) f.infos.target.uuid = 'different'; };
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }));
  assert.equal(f.mutations().length, 0);
});

test('unstable post-open content is not reported as verified', async t => {
  const f = fixture(t); let readCount = 0;
  f.state.hook = async (_channel, method) => { if (method === 'query-scene-json' && f.state.uuid === 'target' && ++readCount === 2) f.state.live = f.state.live.replace('"_children":[]', '"_children":[],"changed":true'); };
  await assert.rejects(() => openSceneSafely(f.project, { target: 'target' }), /changed during verification/);
  assert.equal(f.mutations().length, 1);
});
