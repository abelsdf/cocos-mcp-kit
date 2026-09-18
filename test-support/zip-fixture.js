'use strict';

const { spawnSync } = require('node:child_process');

function archiveCommand() {
  return process.platform === 'win32' ? 'tar.exe' : 'zip';
}

function canCreateZip() {
  const command = archiveCommand();
  const args = process.platform === 'win32' ? ['--version'] : ['-v'];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function createZip(sourceRoot, zipPath) {
  const args = process.platform === 'win32'
    ? ['-a', '-c', '-f', zipPath, '-C', sourceRoot, 'cocos-mcp-kit']
    : ['-qr', zipPath, 'cocos-mcp-kit'];
  const result = spawnSync(archiveCommand(), args, {
    cwd: sourceRoot,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || 'zip fixture creation failed');
  }
}

module.exports = { canCreateZip, createZip };
