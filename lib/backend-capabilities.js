'use strict';

const { getProjectInfo } = require('./project-info');

function assertPageOptions(options) {
  const offset = options.offset === undefined ? 0 : options.offset;
  const limit = options.limit === undefined ? 50 : options.limit;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('limit must be an integer from 1 to 200.');
  }
  return { offset, limit };
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getBackendCapabilities(runtimeContext, catalog, options = {}, environment = {}) {
  const { offset, limit } = assertPageOptions(options);
  const info = getProjectInfo(runtimeContext, environment.editor || null);
  const exposed = catalog
    .filter((tool) => tool && tool.enabled === true && typeof tool.name === 'string')
    .map((tool) => ({
      id: tool.name,
      category: nonemptyString(tool.category) || 'other',
      readOnlyHint: tool.annotations && tool.annotations.readOnlyHint === true,
      destructiveHint: tool.annotations && tool.annotations.destructiveHint === true,
      riskHint: tool.annotations && tool.annotations.destructiveHint === true
        ? 'destructive'
        : tool.annotations && tool.annotations.readOnlyHint === true
          ? 'read_only'
          : 'write_or_stateful',
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const profile = runtimeContext.config && runtimeContext.config.toolProfile;
  const creatorVersion = info.app.version || nonemptyString(runtimeContext.cocosVersion);
  const projectPath = info.project.path || nonemptyString(runtimeContext.projectPath);
  const projectName = info.project.name || nonemptyString(runtimeContext.projectName);

  return {
    schemaVersion: 1,
    activeBackend: 'creator-extension',
    project: {
      name: projectName,
      path: projectPath,
      uuid: info.project.uuid,
      source: info.project.path ? 'Editor.Project' : projectPath ? 'runtimeContext' : null,
    },
    platform: {
      os: environment.platform || process.platform,
      arch: environment.arch || process.arch,
    },
    backends: {
      creatorExtension: {
        id: 'creator-extension',
        status: 'available',
        version: nonemptyString(runtimeContext.version),
        creatorVersion: creatorVersion === 'unknown' ? null : creatorVersion,
        engineVersion: null,
        projectPath,
        toolProfile: profile === 'full' || profile === 'custom' ? profile : 'core',
        exposedOperationCount: exposed.length,
        readOnlyHintCount: exposed.filter((tool) => tool.readOnlyHint).length,
        writeOrStatefulHintCount: exposed.filter((tool) => !tool.readOnlyHint).length,
        destructiveHintCount: exposed.filter((tool) => tool.destructiveHint).length,
        verificationStatus: 'tool_exposure_only',
        experimentalStatus: 'not_assessed_per_operation',
        limitations: ['Tool exposure and annotation hints do not verify individual Creator workflows.', 'Engine version is not separately probed.'],
      },
      officialCli: {
        id: 'official-cli',
        status: 'not_configured',
        version: null,
        creatorVersion: null,
        engineVersion: null,
        projectPath: null,
        exposedOperationCount: 0,
        experimentalStatus: 'not_applicable',
        reason: 'No official CLI adapter is configured; installation and compatibility were not probed.',
      },
    },
    operationPage: {
      offset,
      limit,
      total: exposed.length,
      items: exposed.slice(offset, offset + limit),
      nextOffset: offset + limit < exposed.length ? offset + limit : null,
    },
    selectionPolicy: 'Use the Creator extension independently; no automatic official CLI or hybrid routing is configured.',
    verification: 'Tool exposure and MCP annotations do not prove operation success or saved Creator state.',
  };
}

module.exports = { getBackendCapabilities };
