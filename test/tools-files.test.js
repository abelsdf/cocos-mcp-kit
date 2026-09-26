'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSnippet, createFileTools } = require('../lib/tools/files');

function createSchema(properties, required) {
  return { type: 'object', properties, required };
}

function createTools(projectPath, createAssetImpl, copyAssetImpl, moveAssetImpl, saveAssetImpl, reimportAssetImpl, importAssetImpl) {
  return createFileTools({
    createSchema,
    getRuntimeContext: () => ({ projectPath }),
    createAssetImpl,
    copyAssetImpl,
    moveAssetImpl,
    saveAssetImpl,
    reimportAssetImpl,
    importAssetImpl,
  });
}

function getTool(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Expected ${name} to exist`);
  return tool;
}

test('buildSnippet returns focused line-numbered context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-files-'));
  try {
    const filePath = path.join(root, 'sample.ts');
    fs.writeFileSync(filePath, ['alpha', 'beta', 'gamma', 'delta'].join('\n'), 'utf8');

    const snippet = buildSnippet(filePath, 2, 1);

    assert.match(snippet, / 1 \| alpha/);
    assert.match(snippet, />\s+2 \| beta/);
    assert.match(snippet, / 3 \| gamma/);
    assert.doesNotMatch(snippet, /delta/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create_asset exposes the safe asset-db workflow through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', async (projectPath, args) => {
    calls.push({ projectPath, args });
    return { created: true, path: args.target };
  });
  const tool = getTool(tools, 'create_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['target', 'content']);
  assert.deepEqual(await tool.handler({ target: 'assets/data.json', content: '{}' }), {
    created: true,
    path: 'assets/data.json',
  });
  assert.deepEqual(calls, [{
    projectPath: 'C:/project',
    args: { target: 'assets/data.json', content: '{}' },
  }]);
});

test('copy_asset exposes the verified asset-db copy workflow through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', undefined, async (projectPath, args) => {
    calls.push({ projectPath, args });
    return { copied: true, target: args.target };
  });
  const tool = getTool(tools, 'copy_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['source', 'target']);
  assert.deepEqual(await tool.handler({ source: 'source-uuid', target: 'assets/copy.png' }), {
    copied: true,
    target: 'assets/copy.png',
  });
  assert.deepEqual(calls, [{
    projectPath: 'C:/project',
    args: { source: 'source-uuid', target: 'assets/copy.png' },
  }]);
});

test('move_asset exposes the verified asset-db move workflow through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', undefined, undefined, async (projectPath, args) => {
    calls.push({ projectPath, args });
    return { moved: true, target: args.target };
  });
  const tool = getTool(tools, 'move_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['source', 'target']);
  assert.deepEqual(await tool.handler({ source: 'source-uuid', target: 'assets/moved.png' }), {
    moved: true,
    target: 'assets/moved.png',
  });
  assert.deepEqual(calls, [{
    projectPath: 'C:/project',
    args: { source: 'source-uuid', target: 'assets/moved.png' },
  }]);
});

test('save_asset exposes the verified asset-db save workflow through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', undefined, undefined, undefined, async (projectPath, args) => {
    calls.push({ projectPath, args });
    return { saved: true, path: args.target };
  });
  const tool = getTool(tools, 'save_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['target', 'content']);
  assert.deepEqual(await tool.handler({
    target: 'asset-uuid',
    content: '{"value":2}',
    expectedSha256: 'a'.repeat(64),
  }), {
    saved: true,
    path: 'asset-uuid',
  });
  assert.deepEqual(calls, [{
    projectPath: 'C:/project',
    args: {
      target: 'asset-uuid',
      content: '{"value":2}',
      expectedSha256: 'a'.repeat(64),
    },
  }]);
});

test('reimport_asset exposes the verified asset-db reimport workflow through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', undefined, undefined, undefined, undefined, async (projectPath, args) => {
    calls.push({ projectPath, args });
    return { reimported: true, path: args.target };
  });
  const tool = getTool(tools, 'reimport_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['target']);
  assert.deepEqual(await tool.handler({ target: 'asset-uuid' }), { reimported: true, path: 'asset-uuid' });
  assert.deepEqual(calls, [{ projectPath: 'C:/project', args: { target: 'asset-uuid' } }]);
});

test('import_asset exposes a bounded external-file import through the full file tool set', async () => {
  const calls = [];
  const tools = createTools('C:/project', undefined, undefined, undefined, undefined, undefined,
    async (projectPath, args) => {
      calls.push({ projectPath, args });
      return { imported: true, url: args.target };
    });
  const tool = getTool(tools, 'import_asset');
  assert.equal(tool.profile, 'full');
  assert.deepEqual(tool.inputSchema.required, ['source', 'target']);
  const args = { source: 'C:/external/asset.png', target: 'assets/asset.png', expectedSha256: 'a'.repeat(64) };
  assert.deepEqual(await tool.handler(args), { imported: true, url: args.target });
  assert.deepEqual(calls, [{ projectPath: 'C:/project', args }]);
});

test('file tools write, read, replace, search, list, and check project files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-files-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    const tools = createTools(root);

    const writeResult = await getTool(tools, 'write_file').handler({
      path: 'assets/player.ts',
      content: 'const name = "Hero";\nconst clone = "Hero";\n',
    });
    assert.match(writeResult, /Wrote \d+ chars/);

    const readResult = await getTool(tools, 'read_file').handler({ path: 'assets/player.ts' });
    assert.match(readResult, /const name = "Hero"/);

    await getTool(tools, 'replace_in_file').handler({
      path: 'assets/player.ts',
      search: 'Hero',
      replace: 'Player',
      replaceAll: true,
    });
    assert.equal(fs.readFileSync(path.join(root, 'assets', 'player.ts'), 'utf8').includes('Hero'), false);

    const searchResult = await getTool(tools, 'search_files').handler({ pattern: '*.ts', directory: 'assets' });
    assert.deepEqual(searchResult.files, ['assets/player.ts']);

    const listResult = await getTool(tools, 'list_directory').handler({ path: 'assets' });
    assert.deepEqual(listResult.entries, [{ name: 'player.ts', type: 'file' }]);

    const existsResult = await getTool(tools, 'exists').handler({ path: 'assets/player.ts' });
    assert.deepEqual(existsResult, {
      path: 'assets/player.ts',
      exists: true,
      isFile: true,
      isDirectory: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
