'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getRecentProjectLogs, searchProjectLogs } = require('../lib/logs');

test('project log helpers read and search common project log files', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-logs-'));
  const logDir = path.join(projectPath, 'temp', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'editor.log'), 'first line\nError: broken scene\nlast line\n', 'utf8');

  const recent = getRecentProjectLogs(projectPath, { limit: 5, lines: 2 });
  assert.equal(recent.length, 1);
  assert.match(recent[0].text, /broken scene/);

  const matches = searchProjectLogs(projectPath, { query: 'broken', limit: 5 });
  assert.equal(matches.count, 1);
  assert.equal(matches.matches[0].path, 'temp/logs/editor.log');
});

test('unreadable project.log does not hide other project logs', (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-unreadable-log-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const logDir = path.join(projectPath, 'temp', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'project.log'), 'private log');
  fs.writeFileSync(path.join(logDir, 'editor.log'), 'Error: visible failure');

  const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', (filePath, ...args) => {
    if (filePath.endsWith('project.log')) {
      throw Object.assign(new Error('access denied'), { code: 'EPERM' });
    }
    return openSync(filePath, ...args);
  });

  const recent = getRecentProjectLogs(projectPath, { directory: 'temp/logs' });
  assert.equal(recent.length, 2);
  assert.match(recent.find((entry) => entry.path.endsWith('project.log')).readError, /EPERM/);
  assert.match(recent.find((entry) => entry.path.endsWith('editor.log')).text, /visible failure/);

  const searched = searchProjectLogs(projectPath, { directory: 'temp/logs', query: 'Error' });
  assert.equal(searched.count, 1);
  assert.deepEqual(searched.skipped.map((entry) => entry.path), ['temp/logs/project.log']);
});

test('a project.log rejected by stat remains visible as an unreadable log', (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-log-stat-denied-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const logDir = path.join(projectPath, 'temp', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'project.log'), 'protected');
  fs.writeFileSync(path.join(logDir, 'mcp-debug.log'), 'visible');

  const statSync = fs.statSync;
  t.mock.method(fs, 'statSync', (filePath, ...args) => {
    if (filePath.endsWith('project.log')) {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    }
    return statSync(filePath, ...args);
  });

  const recent = getRecentProjectLogs(projectPath, { directory: 'temp/logs' });
  assert.equal(recent.length, 2);
  const projectLog = recent.find((entry) => entry.path.endsWith('project.log'));
  assert.equal(projectLog.size, null);
  assert.equal(projectLog.mtime, null);
  assert.match(projectLog.readError, /^EPERM:/);
  assert.match(recent.find((entry) => entry.path.endsWith('mcp-debug.log')).text, /visible/);

  const searched = searchProjectLogs(projectPath, { directory: 'temp/logs', query: 'visible' });
  assert.equal(searched.count, 1);
  assert.deepEqual(searched.skipped.map((entry) => entry.path), ['temp/logs/project.log']);
});
