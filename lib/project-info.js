'use strict';

function publicString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function publicBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function getPublicField(owner, key, normalize) {
  if (!owner) return null;
  try {
    return normalize(owner[key]);
  } catch {
    return null;
  }
}

function getProjectInfo(runtimeContext, editor) {
  const projectApi = editor && editor.Project;
  const appApi = editor && editor.App;
  const project = {
    source: projectApi ? 'Editor.Project' : null,
    name: getPublicField(projectApi, 'name', publicString),
    path: getPublicField(projectApi, 'path', publicString),
    tmpDir: getPublicField(projectApi, 'tmpDir', publicString),
    uuid: getPublicField(projectApi, 'uuid', publicString),
  };
  const app = {
    source: appApi ? 'Editor.App' : null,
    version: getPublicField(appApi, 'version', publicString),
    path: getPublicField(appApi, 'path', publicString),
    home: getPublicField(appApi, 'home', publicString),
    temp: getPublicField(appApi, 'temp', publicString),
    dev: getPublicField(appApi, 'dev', publicBoolean),
  };

  return {
    ...runtimeContext,
    projectName: project.name || runtimeContext.projectName,
    projectPath: project.path || runtimeContext.projectPath,
    cocosVersion: app.version || runtimeContext.cocosVersion,
    project,
    app,
  };
}

module.exports = { getProjectInfo };
