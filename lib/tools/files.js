'use strict';

const fs = require('fs');
const path = require('path');
const { moveAsset } = require('../asset-move');
const { copyAsset } = require('../asset-copy');
const { createAsset } = require('../asset-creation');
const { saveAsset } = require('../asset-save');
const { reimportAsset } = require('../asset-reimport');
const { importAsset } = require('../asset-import');
const { importFolder } = require('../asset-import-folder');
const { resolveProjectPath } = require('../path-safety');

/**
 * Build a focused, line-numbered snippet around one file line.
 * @param {string} filePath Absolute file path.
 * @param {number} lineNumber One-based target line number.
 * @param {number} contextLines Surrounding lines to include.
 * @returns {string}
 */
function buildSnippet(filePath, lineNumber, contextLines = 3) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const start = Math.max(1, Number(lineNumber || 1) - Math.max(0, contextLines));
  const end = Math.min(lines.length, Number(lineNumber || 1) + Math.max(0, contextLines));
  const snippet = [];
  for (let line = start; line <= end; line += 1) {
    const marker = line === Number(lineNumber || 1) ? '>' : ' ';
    snippet.push(`${marker} ${String(line).padStart(4, ' ')} | ${lines[line - 1]}`);
  }
  return snippet.join('\n');
}

function matchesPattern(fileName, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
}

function searchFiles(rootDir, pattern, limit) {
  const results = [];
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  const stack = [rootDir];
  while (stack.length && results.length < limit) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'temp' || entry.name === 'library') {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (matchesPattern(entry.name, pattern)) {
        results.push(fullPath);
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results;
}

function replaceAllLiteral(content, search, replacement) {
  if (!search) {
    throw new Error('search text is required.');
  }
  return content.split(search).join(replacement);
}

/**
 * Best-effort refresh for Cocos asset database after external file edits.
 * @param {string} projectPath Active Cocos project root.
 * @param {string} targetPath Absolute file or directory path.
 * @returns {Promise<string>}
 */
async function refreshAssets(projectPath, targetPath) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    return 'Asset refresh API is unavailable; Cocos Creator should pick up file changes automatically.';
  }

  const relative = path.relative(path.join(projectPath, 'assets'), targetPath).replace(/\\/g, '/');
  if (!relative.startsWith('..')) {
    const dbUrl = `db://assets/${relative}`;
    try {
      await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);
      return `Refreshed asset database for ${dbUrl}`;
    } catch (error) {
      try {
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
        return `Refreshed asset database after writing ${dbUrl}`;
      } catch (innerError) {
        return `File written, but asset refresh failed: ${innerError.message}`;
      }
    }
  }

  return 'File written outside assets directory; no asset-db refresh was needed.';
}

/**
 * File-system tools. Kept separate from the registry so path safety and asset
 * refresh behavior can be tested and evolved independently.
 */
function createFileTools({
  createSchema,
  getRuntimeContext,
  createAssetImpl = createAsset,
  copyAssetImpl = copyAsset,
  moveAssetImpl = moveAsset,
  saveAssetImpl = saveAsset,
  reimportAssetImpl = reimportAsset,
  importAssetImpl = importAsset,
  importFolderImpl = importFolder,
}) {
  return [
    {
      name: 'read_file',
      profile: 'full',
      description: '[core] Read a file from the Cocos project.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute file path.' },
        },
        ['path']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const fullPath = resolveProjectPath(projectPath, args.path);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${args.path}`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return content.length > 12000 ? `${content.slice(0, 12000)}\n... (truncated)` : content;
      },
    },
    {
      name: 'get_file_snippet',
      profile: 'full',
      description: '[core] Read a focused snippet around a file line number.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute file path.' },
          line: { type: 'number', description: 'Target line number, starting at 1.' },
          contextLines: { type: 'number', description: 'Number of surrounding context lines.' },
        },
        ['path', 'line']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const fullPath = resolveProjectPath(projectPath, args.path);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${args.path}`);
        }
        return buildSnippet(fullPath, args.line, Number.isFinite(args.contextLines) ? args.contextLines : 3);
      },
    },
    {
      name: 'move_asset',
      profile: 'full',
      description: '[specialist] Safely move or rename a JSON, text, image, or audio main asset through Cocos asset-db, refusing overwrite and verifying removed source paths, preserved main/subasset UUIDs, bytes, metadata settings, and settled import state.',
      inputSchema: createSchema(
        {
          source: { type: 'string', description: 'Exact source UUID, db://assets URL, assets path, or absolute file path inside project assets.' },
          target: { type: 'string', description: 'New target path inside assets with the same extension. Its parent directory must already exist.' },
        },
        ['source', 'target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await moveAssetImpl(projectPath, args);
      },
    },
    {
      name: 'copy_asset',
      profile: 'full',
      description: '[specialist] Safely copy a JSON, text, image, or audio main asset through Cocos asset-db, refusing overwrite and verifying unchanged source bytes, distinct UUIDs, metadata settings, subassets, and settled import state.',
      inputSchema: createSchema(
        {
          source: { type: 'string', description: 'Exact source UUID, db://assets URL, assets path, or absolute file path inside project assets.' },
          target: { type: 'string', description: 'New target path inside assets with the same extension. Its parent directory must already exist.' },
        },
        ['source', 'target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await copyAssetImpl(projectPath, args);
      },
    },
    {
      name: 'create_asset',
      profile: 'full',
      description: '[specialist] Safely create a new JSON or text asset through Cocos asset-db, refusing overwrite and verifying source content, metadata, UUID, importer, type, and settled import state.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'New .json or .txt path inside assets. Its parent directory must already exist.' },
          content: { type: 'string', description: 'UTF-8 source content, limited to 1 MiB. JSON content must parse.' },
        },
        ['target', 'content']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await createAssetImpl(projectPath, args);
      },
    },
    {
      name: 'save_asset',
      profile: 'full',
      description: '[specialist] Safely save an existing imported JSON or text main asset through Cocos asset-db, with optional SHA-256 conflict detection and verification of exact content, UUID, importer, metadata, and settled import state.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Exact UUID, db://assets URL, assets path, or absolute path of an existing imported .json or .txt main asset.' },
          content: { type: 'string', description: 'Replacement UTF-8 source content, limited to 1 MiB. JSON content must parse.' },
          expectedSha256: { type: 'string', description: 'Optional SHA-256 of the current source. A mismatch refuses the save before mutation.' },
        },
        ['target', 'content']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await saveAssetImpl(projectPath, args);
      },
    },
    {
      name: 'reimport_asset',
      profile: 'full',
      description: '[specialist] Reimport an imported JSON, text, image, or audio main asset through Cocos asset-db; verify source bytes, UUID, import settings, subassets, readiness, and settled state.',
      inputSchema: createSchema(
        {
          target: { type: 'string', description: 'Exact UUID, db://assets URL, assets path, or absolute path of an imported JSON, text, image, or audio main asset.' },
        },
        ['target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await reimportAssetImpl(projectPath, args);
      },
    },
    {
      name: 'import_asset',
      profile: 'full',
      description: '[specialist] Import one external JSON, text, image, or audio file into a new project asset through Cocos asset-db, refusing overwrite and verifying exact bytes, metadata, subassets, and settled import state.',
      inputSchema: createSchema(
        {
          source: { type: 'string', description: 'Absolute path of a regular external file without a .meta sidecar; maximum 64 MiB.' },
          target: { type: 'string', description: 'New exact path inside project assets with the same extension; parent directory must already exist.' },
          expectedSha256: { type: 'string', description: 'Optional SHA-256 of the external source; a mismatch refuses the import before mutation.' },
        },
        ['source', 'target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await importAssetImpl(projectPath, args);
      },
    },
    {
      name: 'import_folder',
      profile: 'full',
      description: '[specialist] Import one bounded external folder into a new project asset directory through one Cocos asset-db request, refusing overwrite and verifying exact tree, bytes, directory and file UUIDs, metadata, subassets, and settled import state.',
      inputSchema: createSchema(
        {
          source: { type: 'string', description: 'Absolute path of a local external directory without .meta sidecars or symbolic links; at most 64 files, 16 directories, 4 levels, and 64 MiB total.' },
          target: { type: 'string', description: 'New directory path under project assets; its parent must already exist.' },
        },
        ['source', 'target']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        return await importFolderImpl(projectPath, args);
      },
    },
    {
      name: 'write_file',
      profile: 'full',
      description: '[core] Write or overwrite a project file through the filesystem. This does not prove Cocos asset persistence; use save_asset or a type-specific save workflow for resources.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute file path.' },
          content: { type: 'string', description: 'File content to write.' },
        },
        ['path', 'content']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const fullPath = resolveProjectPath(projectPath, args.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content, 'utf8');
        return `Wrote ${args.content.length} chars to ${args.path}\n${await refreshAssets(projectPath, fullPath)}`;
      },
    },
    {
      name: 'replace_in_file',
      profile: 'full',
      description: '[core] Replace text in a project file through the filesystem, useful for script auto-fix loops. This does not prove Cocos asset persistence.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute file path.' },
          search: { type: 'string', description: 'Literal text to search for.' },
          replace: { type: 'string', description: 'Replacement text.' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of only the first.' },
        },
        ['path', 'search', 'replace']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const fullPath = resolveProjectPath(projectPath, args.path);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${args.path}`);
        }

        const original = fs.readFileSync(fullPath, 'utf8');
        if (!original.includes(args.search)) {
          throw new Error(`Search text was not found in ${args.path}`);
        }

        const updated = args.replaceAll
          ? replaceAllLiteral(original, args.search, args.replace)
          : original.replace(args.search, args.replace);

        fs.writeFileSync(fullPath, updated, 'utf8');
        return `Updated ${args.path} (${args.replaceAll ? 'all matches' : 'first match'})\n${await refreshAssets(projectPath, fullPath)}`;
      },
    },
    {
      name: 'search_files',
      profile: 'full',
      description: '[core] Search project files by simple wildcard pattern.',
      inputSchema: createSchema(
        {
          pattern: { type: 'string', description: "Wildcard file pattern such as '*.ts' or 'Player*'." },
          directory: { type: 'string', description: 'Project-relative search root. Defaults to assets.' },
          limit: { type: 'number', description: 'Maximum number of results to return.' },
        },
        ['pattern']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const searchRoot = resolveProjectPath(projectPath, args.directory || 'assets');
        if (!fs.existsSync(searchRoot)) {
          throw new Error(`Directory not found: ${args.directory || 'assets'}`);
        }

        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(500, args.limit)) : 100;
        const results = searchFiles(searchRoot, args.pattern, limit).map((fullPath) =>
          path.relative(projectPath, fullPath).replace(/\\/g, '/')
        );
        return {
          count: results.length,
          files: results,
        };
      },
    },
    {
      name: 'list_directory',
      profile: 'full',
      description: '[core] List files and directories inside a project directory.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute directory path.' },
        },
        ['path']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const targetPath = resolveProjectPath(projectPath, args.path);
        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
          throw new Error(`Directory not found: ${args.path}`);
        }

        const entries = fs
          .readdirSync(targetPath, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith('.'))
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
          }));
        return {
          path: args.path,
          entries,
        };
      },
    },
    {
      name: 'exists',
      profile: 'full',
      description: '[core] Check whether a project file or directory exists.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Project-relative or absolute path.' },
        },
        ['path']
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const targetPath = resolveProjectPath(projectPath, args.path);
        return {
          path: args.path,
          exists: fs.existsSync(targetPath),
          isFile: fs.existsSync(targetPath) ? fs.statSync(targetPath).isFile() : false,
          isDirectory: fs.existsSync(targetPath) ? fs.statSync(targetPath).isDirectory() : false,
        };
      },
    },
    {
      name: 'refresh_assets',
      profile: 'full',
      description: '[core] Best-effort asset database refresh for a file or the assets root.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Optional project-relative file path to refresh.' },
        },
        []
      ),
      handler: async (args) => {
        const { projectPath } = getRuntimeContext();
        const targetPath = resolveProjectPath(projectPath, args.path || 'assets');
        return await refreshAssets(projectPath, targetPath);
      },
    },
  ];
}

module.exports = {
  buildSnippet,
  createFileTools,
  refreshAssets,
};
