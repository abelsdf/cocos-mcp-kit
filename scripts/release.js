#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_DIR_NAME = 'cocos-mcp-kit';
const RELEASES_DIR = path.join(ROOT, 'releases');
const TEMP_DIR = path.join(ROOT, '.release-tmp');
const ZIP_PREFIX = 'CocosMcpKit';
const REPOSITORY_URL = '';

const REQUIRED_REPO_FILES = [
  'package.json',
  'README.md',
  'README_CN.md',
  'docs/TOOLS.md',
  'RELEASE_WORKFLOW.md',
  'RELEASE_CHECKLIST.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'bin/cocos-mcp-kit.js',
  'browser.js',
  'scene.js',
  'panel/index.js',
  'i18n/en.js',
  'i18n/zh.js',
  'lib/global-install.js',
  'lib/server.js',
  'lib/tool-registry.js'
];

const PACKAGE_INCLUDES = [
  'package.json',
  'README.md',
  'README_CN.md',
  'docs/BACKEND_CAPABILITY_DESIGN.md',
  'docs/KNOWLEDGE.md',
  'docs/NODE_BATCH_DTO.md',
  'docs/PROJECT_WORKFLOWS.md',
  'docs/SOURCES_AND_LICENSES.md',
  'docs/TOOLS.md',
  'docs/UI_BUILDER.md',
  'docs/UI_TEMPLATES.md',
  'docs/UI_VALIDATION.md',
  'docs/UI_VERIFICATION.md',
  'docs/UI_VIEWPORT.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'RELEASE_WORKFLOW.md',
  'RELEASE_CHECKLIST.md',
  'bin',
  'browser.js',
  'scene.js',
  'panel',
  'i18n',
  'lib'
];

const FORBIDDEN_TRACKED_SEGMENTS = new Set([
  '.idea',
  'node_modules',
  'Library',
  'library',
  'Temp',
  'temp',
  'dist',
  'build',
  'coverage',
  'releases',
  '.release-tmp'
]);

const FORBIDDEN_ARCHIVE_SEGMENTS = new Set([
  '.git',
  '.github',
  '.idea',
  'node_modules',
  'Library',
  'library',
  'Temp',
  'temp',
  'dist',
  'build',
  'coverage',
  'releases',
  '.release-tmp',
  'scripts',
  'test',
  'test-support',
  '.agents',
  '.codex',
  '.claude',
  '.firecrawl',
  'cocos-mcp-server-main',
  'cocos-mcp-v1.8.1-all'
]);

const FORBIDDEN_NAMES = new Set([
  '.DS_Store',
  'AGENTS.md',
  '.npmrc'
]);

const FORBIDDEN_CONTENT_PATTERNS = [
  ['npm token', /\bnpm_[A-Za-z0-9]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ['MCP token', /\bmcp_[A-Za-z0-9_-]{32,}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];

function main() {
  const command = process.argv[2] || 'check';
  const options = parseOptions(process.argv.slice(3));

  if (command === 'check') {
    const context = checkRelease(options);
    console.log(`Release check passed for v${context.version}.`);
    return;
  }

  if (command === 'package') {
    const context = checkRelease(options);
    const artifacts = packageRelease(context);
    console.log(`Release package ready: ${path.relative(ROOT, artifacts.releaseDir)}`);
    console.log(`- ${artifacts.zipName}`);
    console.log('- release-manifest.json');
    console.log('- SHA256SUMS.txt');
    console.log('- RELEASE_NOTES.md');
    console.log('- README.md');
    return;
  }

  printUsage();
  process.exitCode = 2;
}

function parseOptions(args) {
  const options = {
    version: '',
    strictTag: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--version' && args[i + 1]) {
      options.version = args[i + 1];
      i += 1;
    } else if (arg === '--strict-tag') {
      options.strictTag = true;
    } else {
      throw new Error(`Unknown release option: ${arg}`);
    }
  }

  return options;
}

function checkRelease(options = {}) {
  const errors = [];
  const packageJson = readJson(path.join(ROOT, 'package.json'), errors);
  const version = options.version || (packageJson && packageJson.version) || '';
  const tag = `v${version}`;

  if (!packageJson) {
    throwErrors(errors);
  }

  if (options.version && options.version !== packageJson.version) {
    errors.push(`--version ${options.version} does not match package.json version ${packageJson.version}.`);
  }

  if (packageJson.name !== 'cocos-mcp-kit') {
    errors.push('package.json name must be cocos-mcp-kit.');
  }

  if (packageJson.license !== 'MIT') errors.push('package.json license must be MIT.');
  if (!Array.isArray(packageJson.files) || packageJson.files.some(p => typeof p !== 'string') ||
      JSON.stringify(['package.json', ...packageJson.files.map(p => p.replace(/\/$/, ''))].sort()) !== JSON.stringify([...PACKAGE_INCLUDES].sort())) {
    errors.push('package.json files must match the extension ZIP include list.');
  }

  if (!Number.isInteger(packageJson.package_version) || packageJson.package_version <= 0) {
    errors.push('package.json package_version must be a positive integer.');
  }

  if (!packageJson.main || !fs.existsSync(path.join(ROOT, packageJson.main))) {
    errors.push('package.json main must point to an existing file.');
  }

  if (!packageJson.bin || packageJson.bin['cocos-mcp-kit'] !== 'bin/cocos-mcp-kit.js') {
    errors.push('package.json bin.cocos-mcp-kit must point to bin/cocos-mcp-kit.js.');
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push(`package.json version must be semver-like, got: ${version}`);
  }

  for (const relative of REQUIRED_REPO_FILES) {
    if (!fs.existsSync(path.join(ROOT, relative))) {
      errors.push(`Missing required repository file: ${relative}`);
    }
  }

  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  if (version && !new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog)) {
    errors.push(`CHANGELOG.md is missing a dated ## [${version}] release section.`);
  }

  const trackedFiles = gitLines(['ls-files']);
  const forbiddenTracked = trackedFiles.filter(isForbiddenTrackedPath);
  if (forbiddenTracked.length > 0) {
    errors.push(`Tracked local/build junk must not be committed:\n- ${forbiddenTracked.join('\n- ')}`);
  }

  for (const relative of PACKAGE_INCLUDES) {
    const fullPath = path.join(ROOT, relative);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Package include path is missing: ${relative}`);
    }
  }

  if (options.strictTag && !gitTagExists(tag)) {
    errors.push(`Git tag ${tag} does not exist. Create it before publishing.`);
  }

  throwErrors(errors);

  validateLicense(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
  const packageFiles = PACKAGE_INCLUDES.flatMap(relative => {
    const fullPath = path.join(ROOT, relative), stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) throw new Error(`Package symlinks are not allowed: ${relative}`);
    return stat.isDirectory() ? collectFiles(fullPath) : [fullPath];
  });
  validateArchivePaths(packageFiles.map(p => `${PACKAGE_DIR_NAME}/${path.relative(ROOT, p).split(path.sep).join('/')}`));
  validateArchiveContent(packageFiles);

  return {
    packageJson,
    version,
    tag,
    changelogNotes: extractChangelogNotes(changelog, 'Unreleased') || extractChangelogNotes(changelog, version),
    gitTag: gitTagExists(tag) ? tag : null,
    gitCommit: gitText(['rev-parse', 'HEAD']).trim(),
    gitDirty: gitText(['status', '--porcelain']).trim() !== ''
  };
}

function packageRelease(context) {
  const windows = process.platform === 'win32';
  ensureCommand(windows ? 'tar.exe' : 'zip', windows ? ['--version'] : ['-v']);
  if (!windows) ensureCommand('unzip', ['-v']);

  const versionDir = path.join(RELEASES_DIR, context.version);
  for (const directory of [RELEASES_DIR, versionDir, TEMP_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Package output links are not allowed: ${directory}`);
  }
  const releaseDir = fs.mkdtempSync(path.join(versionDir, 'candidate-'));
  const stagingDir = fs.mkdtempSync(path.join(TEMP_DIR, 'candidate-'));
  const stagingRoot = path.join(stagingDir, PACKAGE_DIR_NAME);
  const zipName = `${ZIP_PREFIX}.v${context.version}.zip`;
  const zipPath = path.join(releaseDir, zipName);

  try {
    fs.mkdirSync(stagingRoot, { recursive: true });

    for (const relative of PACKAGE_INCLUDES) {
      copyIntoPackage(relative, stagingRoot);
    }

    const stagedFiles = collectFiles(stagingRoot)
      .map((filePath) => path.relative(stagingDir, filePath).split(path.sep).join('/'));
    validateArchivePaths(stagedFiles);
    validateArchiveContent(collectFiles(stagingRoot));

    if (windows) run('tar.exe', ['-a', '-c', '-f', zipPath, '-C', stagingDir, PACKAGE_DIR_NAME]);
    else run('zip', ['-qr', zipPath, PACKAGE_DIR_NAME], { cwd: stagingDir });
    validateZipListing(zipPath, stagedFiles);

    const zipSha256 = sha256File(zipPath);
    const zipSize = fs.statSync(zipPath).size;
    const manifest = buildManifest(context, {
      zipName,
      zipSha256,
      zipSize,
      fileCount: stagedFiles.length
    });

    const manifestPath = path.join(releaseDir, 'release-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const readmePath = path.join(releaseDir, 'README.md');
    fs.writeFileSync(readmePath, buildReleaseReadme(context, manifest));

    const releaseNotesPath = path.join(releaseDir, 'RELEASE_NOTES.md');
    fs.writeFileSync(releaseNotesPath, buildReleaseNotes(context, manifest));

    const checksums = [
      checksumLine(zipPath, zipName),
      checksumLine(manifestPath, 'release-manifest.json'),
      checksumLine(releaseNotesPath, 'RELEASE_NOTES.md'),
      checksumLine(readmePath, 'README.md')
    ].join('');
    fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), checksums);

    return {
      releaseDir,
      zipName
    };
  } catch (error) {
    throw new Error(`${error.message}\nIncomplete candidate retained at: ${releaseDir}`);
  } finally {
    // Delete only this invocation's staging directory, never a version or shared root.
    if (path.dirname(stagingDir) !== TEMP_DIR || fs.lstatSync(TEMP_DIR).isSymbolicLink()) {
      throw new Error(`Refusing unsafe staging cleanup: ${stagingDir}`);
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function copyIntoPackage(relative, stagingRoot) {
  const source = path.join(ROOT, relative);
  const destination = path.join(stagingRoot, relative);
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      const name = path.basename(sourcePath);
      if (FORBIDDEN_NAMES.has(name)) {
        return false;
      }
      const relativeSource = path.relative(ROOT, sourcePath).split(path.sep);
      return !relativeSource.some((part) => FORBIDDEN_ARCHIVE_SEGMENTS.has(part));
    }
  });
}

function buildManifest(context, artifact) {
  return {
    version: context.version,
    distribution: 'local-candidate',
    generatedAt: new Date().toISOString(),
    repository: REPOSITORY_URL ? { url: REPOSITORY_URL, source: 'github' } : null,
    git: {
      tag: context.gitTag,
      commit: context.gitCommit,
      dirty: context.gitDirty
    },
    package: {
      name: context.packageJson.name,
      version: context.packageJson.version,
      main: context.packageJson.main,
      packageVersion: context.packageJson.package_version
    },
    artifacts: {
      extensionZip: {
        file: artifact.zipName,
        sha256: artifact.zipSha256,
        sizeBytes: artifact.zipSize,
        fileCount: artifact.fileCount,
        installDirectory: 'extensions/cocos-mcp-kit',
        githubDownloadUrl: REPOSITORY_URL ? `${REPOSITORY_URL}/releases/download/${context.tag}/${artifact.zipName}` : null
      }
    },
    notes: firstMeaningfulLine(context.changelogNotes)
  };
}

function buildReleaseReadme(context, manifest) {
  const zip = manifest.artifacts.extensionZip;
  return `# Cocos MCP Kit ${context.tag}

This folder contains local candidate artifacts for Cocos MCP Kit ${context.tag}. No public publication or update channel is enabled. The manifest records the source commit and whether the workspace was dirty; a candidate is not a tagged release.

## Artifacts

- \`${zip.file}\` - Cocos Creator extension package.
- \`release-manifest.json\` - Machine-readable release metadata.
- \`SHA256SUMS.txt\` - SHA-256 checksums for release artifacts.

## Install

1. Unzip \`${zip.file}\`.
2. Close the target Creator project. Back up any old extension outside \`extensions/\`, then place the complete extracted folder at \`<Cocos project>/extensions/${PACKAGE_DIR_NAME}\` without merging old files.
3. Restart Cocos Creator or reload extensions.
4. Open \`Cocos MCP Kit > MCP Server\`.

## Verify

\`\`\`bash
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

On Windows, use \`Get-FileHash -Algorithm SHA256 <artifact>\` and compare each result with \`SHA256SUMS.txt\`.
`;
}

function buildReleaseNotes(context, manifest) {
  const zip = manifest.artifacts.extensionZip;
  return [
    `# Cocos MCP Kit ${context.tag} local candidate`,
    '',
    context.changelogNotes,
    '',
    '## Release Assets',
    '',
    `- \`${zip.file}\` - Cocos Creator extension package.`,
    '- `release-manifest.json` - Machine-readable release metadata.',
    '- `SHA256SUMS.txt` - SHA-256 checksums for release artifacts.',
    '',
    '## Distribution',
    '',
    'Local candidate only. No public publication, npm/Registry upload or update channel is enabled.',
    '',
    '## Verify',
    '',
    '```bash',
    'shasum -a 256 -c SHA256SUMS.txt',
    '```',
    '',
    'Windows: compare `Get-FileHash -Algorithm SHA256 <artifact>` with each entry in `SHA256SUMS.txt`.',
    ''
  ].join('\n');
}

function validateArchivePaths(paths) {
  const bad = [];
  const prefix = `${PACKAGE_DIR_NAME}/`;

  for (const archivePath of paths) {
    const normalized = archivePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (!normalized.startsWith(prefix)) {
      bad.push(`${archivePath} (must stay under ${PACKAGE_DIR_NAME}/)`);
      continue;
    }
    if (parts.some((part) => part === '..' || part === '.')) {
      bad.push(`${archivePath} (contains unsafe relative path segments)`);
      continue;
    }
    if (parts.some((part) => FORBIDDEN_ARCHIVE_SEGMENTS.has(part) || FORBIDDEN_NAMES.has(part) || /^\.env(?:\.|$)/.test(part))) {
      bad.push(`${archivePath} (contains forbidden release content)`);
      continue;
    }
    const relative = normalized.slice(prefix.length), isDirectory = normalized.endsWith('/');
    if (relative === '') continue;
    const allowed = PACKAGE_INCLUDES.some(include => relative === include ||
      ['bin', 'lib', 'panel', 'i18n'].includes(include) && relative.startsWith(`${include}/`) && (isDirectory || relative.endsWith('.js')) ||
      isDirectory && `${include}/`.startsWith(relative));
    if (!allowed) {
      bad.push(`${archivePath} (outside runtime/user-documentation include list)`);
    }
  }

  if (bad.length > 0) {
    throw new Error(`Release archive contains invalid paths:\n- ${bad.join('\n- ')}`);
  }
}

function validateLicense(text) {
  // Preserve the complete upstream block; additional notices may be appended.
  const required = `MIT License

Copyright (c) 2026 Funplay

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
  if (!String(text).replace(/\s+/g, ' ').trim().includes(required.replace(/\s+/g, ' ').trim())) {
    throw new Error('LICENSE must preserve the complete Funplay MIT copyright, permission and disclaimer.');
  }
}

function validateZipListing(zipPath, expectedFiles) {
  const listing = (process.platform === 'win32'
    ? run('tar.exe', ['-tf', zipPath])
    : run('unzip', ['-Z1', zipPath]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  validateArchivePaths(listing);
  const actualFiles = listing.filter(p => !p.endsWith('/')).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) {
    throw new Error('Release archive file listing does not match staged files.');
  }
}

function validateArchiveContent(filePaths) {
  const bad = [];
  for (const filePath of filePaths) {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) {
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      continue;
    }
    const text = buffer.toString('utf8');
    for (const [label, pattern] of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(text)) {
        bad.push(`${path.relative(ROOT, filePath)} (${label})`);
      }
    }
  }

  if (bad.length > 0) {
    throw new Error(`Release archive contains sensitive-looking content:\n- ${bad.join('\n- ')}`);
  }
}

function isForbiddenTrackedPath(relative) {
  const parts = relative.split('/');
  return parts.some((part) => FORBIDDEN_TRACKED_SEGMENTS.has(part) || FORBIDDEN_NAMES.has(part));
}

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(ROOT, filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    } else {
      throw new Error(`Package links or special files are not allowed: ${fullPath}`);
    }
  }
  return files;
}

function extractChangelogNotes(changelog, version) {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]${version === 'Unreleased' ? '' : ' - \\d{4}-\\d{2}-\\d{2}'}[ \\t]*$`, 'm');
  const match = heading.exec(changelog);
  if (!match) {
    return '';
  }
  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/^## /m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function firstMeaningfulLine(text) {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('#'));
  return line ? line.replace(/^- /, '') : '';
}

function checksumLine(filePath, displayName) {
  return `${sha256File(filePath)}  ${displayName}\n`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureCommand(name, args) {
  const result = childProcess.spawnSync(name, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Required command unavailable: ${name}: ${result.error?.message || result.stderr || result.stdout}`);
  }
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function gitLines(args) {
  const text = gitText(args);
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function gitText(args) {
  const result = childProcess.spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    return '';
  }
  return result.stdout;
}

function gitTagExists(tag) {
  const result = childProcess.spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return result.status === 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwErrors(errors) {
  if (errors.length > 0) {
    throw new Error(`Release validation failed:\n- ${errors.join('\n- ')}`);
  }
}

function printUsage() {
  console.error(`Usage:
  node scripts/release.js check [--version <version>] [--strict-tag]
  node scripts/release.js package [--version <version>] [--strict-tag]`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { PACKAGE_INCLUDES, validateLicense, validateArchivePaths };
