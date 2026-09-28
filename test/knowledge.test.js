'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readKnowledge } = require('../lib/knowledge');
const { ResourceProvider } = require('../lib/resources');
const root = 'cocos://knowledge/';
const read = (suffix) => JSON.parse(readKnowledge(root + suffix));

test('knowledge index is compact, versioned and contains no topic bodies', () => {
  const result = read('index');
  assert.equal(result.knowledgeVersion, '1.0.0');
  assert.equal(result.appliesTo, 'Cocos Creator 3.8.x');
  assert.equal(result.sourceReviewedAt, '2026-09-28');
  assert.equal(result.topics.length, 6);
  assert.equal(new Set(result.topics.map(t => t.id)).size, 6);
  assert.ok(readKnowledge(root + 'index').length < 6000);
  for (const topic of result.topics) {
    assert.ok(topic.summary); assert.ok(topic.components.length); assert.equal(topic.guidance, undefined);
    assert.equal(topic.uri, root + 'topic/' + topic.id);
  }
});

test('each topic is bounded, original guidance with official sources and project limits', () => {
  for (const item of read('index').topics) {
    const result = read('topic/' + item.id);
    assert.equal(result.topic.id, item.id);
    assert.ok(result.topic.guidance.length > 0);
    assert.ok(result.topic.projectNotes.length > 0);
    assert.ok(result.topic.sources.length > 0);
    for (const source of result.topic.sources) assert.ok(source.startsWith('https://docs.cocos.com/creator/3.8/'));
    assert.ok(readKnowledge(root + 'topic/' + item.id).length < 6000);
  }
});

test('component names select compact related topic links, not arbitrary class discovery', () => {
  for (const component of ['UITransform', 'Node', 'Canvas', 'Camera', 'Widget', 'Layout', 'Label', 'Sprite', 'SpriteFrame', 'Button', 'Component']) {
    const result = read('component/' + component);
    assert.equal(result.component, 'cc.' + component);
    assert.ok(result.topics.length > 0);
    assert.deepEqual(read('component/cc.' + component), result);
    assert.deepEqual(read('component/' + encodeURIComponent('cc.' + component)), result);
    assert.ok(readKnowledge(root + 'component/' + component).length < 6000);
    for (const topic of result.topics) assert.equal(topic.guidance, undefined);
  }
});

for (const suffix of ['', 'topic', 'topic/', 'topic/nope', 'component/Unknown', 'component/__proto__',
  'component/constructor', 'component/label', 'topic/../index', 'topic/%2e%2e%2findex', 'topic/%',
  'topic/label-fonts?extra=1', 'index#fragment', 'index/extra', 'topic/' + 'a'.repeat(300)]) {
  test(`knowledge rejects invalid or unknown route ${suffix.slice(0, 65)}`, () => {
    assert.throws(() => readKnowledge(root + suffix), /knowledge/i);
  });
}

test('knowledge reads are deterministic and do not require Editor or project context', async () => {
  const provider = new ResourceProvider(() => { throw Error('Must not inspect project'); },
    { call() { throw Error('Must not query scene'); } });
  for (const uri of [root + 'index', root + 'topic/widget-layout', root + 'component/Widget']) {
    const result = await provider.readResource(uri);
    assert.equal(result.contents[0].uri, uri);
    assert.equal(result.contents[0].text, readKnowledge(uri));
    assert.equal(result.contents[0].text, (await provider.readResource(uri)).contents[0].text);
  }
  assert.equal(readKnowledge('cocos://scene/active'), null);
});

test('resource discovery retains existing endpoints and adds knowledge entry points', async () => {
  const provider = new ResourceProvider(() => ({ projectName: 'Test' }), { call: async () => ({ name: 'Scene' }) });
  const resources = provider.listResources().map(r => r.uri);
  assert.ok(resources.includes(root + 'index')); assert.ok(resources.includes('cocos://scene/active'));
  const templates = provider.listResourceTemplates().map(t => t.uriTemplate);
  assert.ok(templates.includes(root + 'topic/{topic}')); assert.ok(templates.includes(root + 'component/{component}'));
  assert.ok(templates.includes('cocos://asset/info/{uuid_or_path}'));
  assert.match((await provider.readResource('cocos://scene/active')).contents[0].text, /Scene/);
});
