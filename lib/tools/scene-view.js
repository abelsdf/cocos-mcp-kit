'use strict';

const {
  alignSelectedNodesWithSceneView,
  querySceneViewState,
  setSceneViewState,
} = require('../scene-view');

function createSceneViewTools({ createSchema }) {
  return [
    {
      name: 'get_scene_view_state',
      profile: 'full',
      category: 'scene-view',
      description: '[specialist] Query Creator 3.8 native Gizmo tool/pivot/coordinate/view mode, 2D/3D mode, grid visibility, and IconGizmo mode/size through public Scene messages.',
      inputSchema: createSchema({}, []),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async () => querySceneViewState(),
    },
    {
      name: 'set_scene_view_state',
      profile: 'full',
      category: 'scene-view',
      description: '[specialist] Set and read back verified Creator 3.8 native Scene-view state. Omitted fields stay unchanged; partial failures roll back fields already applied.',
      inputSchema: createSchema({
        gizmoTool: { type: 'string', enum: ['position', 'rotation', 'scale', 'rect'], description: 'Active transform Gizmo tool.' },
        pivot: { type: 'string', enum: ['pivot', 'center'], description: 'Transform pivot mode.' },
        coordinate: { type: 'string', enum: ['local', 'global'], description: 'Transform coordinate space.' },
        is2D: { type: 'boolean', description: 'Use the native 2D Scene view when true, otherwise 3D.' },
        gridVisible: { type: 'boolean', description: 'Show or hide the native Scene grid.' },
        iconGizmo3D: { type: 'boolean', description: 'Render component IconGizmos in native 3D or 2D mode.' },
        iconGizmoSize: { type: 'number', description: 'Finite native IconGizmo size value; Creator 3.8.8 publishes no numeric range.' },
      }, []),
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) => setSceneViewState(args),
    },
    {
      name: 'align_selected_nodes_with_scene_view',
      profile: 'full',
      category: 'scene-view',
      description: '[specialist] Apply the current native Scene observer camera position and rotation to the currently selected nodes. This changes scene data and requires an explicit save.',
      inputSchema: createSchema({}, []),
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: async () => alignSelectedNodesWithSceneView(),
    },
  ];
}

module.exports = { createSceneViewTools };
