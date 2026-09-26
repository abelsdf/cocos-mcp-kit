'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getProjectInfo } = require('../lib/project-info');

const runtime = {
  extensionName: 'cocos-mcp-kit',
  version: '0.1.0',
  projectName: 'folder-name',
  projectPath: 'D:/Game/folder-name',
  cocosVersion: 'unknown',
  config: { toolProfile: 'core' },
};

test('project info uses public Creator fields and retains existing runtime context', () => {
  const info = getProjectInfo(runtime, {
    Project: {
      name: 'manifest-name',
      path: 'D:/Game/folder-name',
      tmpDir: 'D:/Game/folder-name/temp',
      uuid: 'project-uuid',
    },
    App: {
      version: '3.8.8',
      path: 'C:/Creator/app.asar',
      home: 'C:/Users/Test/.CocosCreator',
      temp: 'C:/Temp/Creator',
      dev: false,
      userAgent: 'excluded',
    },
  });
  assert.equal(info.projectName, 'manifest-name');
  assert.equal(info.projectPath, runtime.projectPath);
  assert.equal(info.cocosVersion, '3.8.8');
  assert.equal(info.version, '0.1.0');
  assert.equal(info.config, runtime.config);
  assert.deepEqual(info.project, {
    source: 'Editor.Project', name: 'manifest-name', path: runtime.projectPath,
    tmpDir: 'D:/Game/folder-name/temp', uuid: 'project-uuid',
  });
  assert.deepEqual(info.app, {
    source: 'Editor.App', version: '3.8.8', path: 'C:/Creator/app.asar',
    home: 'C:/Users/Test/.CocosCreator', temp: 'C:/Temp/Creator', dev: false,
  });
  assert.equal('userAgent' in info.app, false);
});

test('project info marks unavailable native fields without inventing values', () => {
  const info = getProjectInfo(runtime, null);
  assert.equal(info.projectName, 'folder-name');
  assert.equal(info.cocosVersion, 'unknown');
  assert.deepEqual(info.project, {
    source: null, name: null, path: null, tmpDir: null, uuid: null,
  });
  assert.deepEqual(info.app, {
    source: null, version: null, path: null, home: null, temp: null, dev: null,
  });
});

test('project info ignores malformed or throwing public fields', () => {
  const info = getProjectInfo(runtime, {
    Project: { name: '  ', path: 42, get uuid() { throw new Error('unavailable'); } },
    App: { version: [], dev: 'false' },
  });
  assert.equal(info.projectName, runtime.projectName);
  assert.equal(info.projectPath, runtime.projectPath);
  assert.equal(info.cocosVersion, runtime.cocosVersion);
  assert.equal(info.project.uuid, null);
  assert.equal(info.app.dev, null);
});
