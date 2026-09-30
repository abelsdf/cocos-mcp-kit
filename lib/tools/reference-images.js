'use strict';

const {
  addReferenceImage,
  clearReferenceImageBinding,
  queryReferenceImages,
  refreshReferenceImage,
  removeReferenceImage,
  selectReferenceImage,
  setReferenceImageParameters,
} = require('../reference-images');

function createReferenceImageTools({ createSchema }) {
  return [
    {
      name: 'get_reference_images',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Query the Creator 3.8 native reference-image library, current scene binding, parameters, and 2D eligibility. Native panel effective visibility is explicitly not observable.',
      inputSchema: createSchema({}, []),
      handler: async () => queryReferenceImages(),
    },
    {
      name: 'add_reference_image',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Add an existing absolute local PNG/JPG/JPEG to Creator\'s native reference-image library and bind it to the current scene or prefab.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Absolute local PNG, JPG, or JPEG file path.' },
        },
        ['path']
      ),
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) => addReferenceImage(args.path),
    },
    {
      name: 'remove_reference_image',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Remove one record and its native scene bindings from Creator\'s reference-image library. The original local image file is never deleted.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Absolute path of an existing or missing image record in the native library.' },
        },
        ['path']
      ),
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: async (args) => removeReferenceImage(args.path),
    },
    {
      name: 'select_reference_image',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Bind an existing native reference-image library item to the current scene or prefab.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Absolute path of an existing image in the native library.' },
        },
        ['path']
      ),
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) => selectReferenceImage(args.path),
    },
    {
      name: 'clear_reference_image_binding',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Clear only the current scene or prefab reference-image binding while preserving the native library and other bindings.',
      inputSchema: createSchema({}, []),
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async () => clearReferenceImageBinding(),
    },
    {
      name: 'set_reference_image_parameters',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Persist finite native reference-image position/scale values and opacity from 0 to 100 for the current binding.',
      inputSchema: createSchema(
        {
          x: { type: 'number', description: 'Horizontal offset in 2D scene world units.' },
          y: { type: 'number', description: 'Vertical offset in 2D scene world units.' },
          scaleX: { type: 'number', description: 'Horizontal scale factor.' },
          scaleY: { type: 'number', description: 'Vertical scale factor.' },
          opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Opacity percentage from 0 to 100.' },
        },
        []
      ),
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) => setReferenceImageParameters(args),
    },
    {
      name: 'refresh_reference_image',
      profile: 'full',
      category: 'reference-images',
      description: '[specialist] Reload the current native reference image from its original local path without importing it into AssetDB.',
      inputSchema: createSchema({}, []),
      annotations: { destructiveHint: false, idempotentHint: true },
      handler: async () => refreshReferenceImage(),
    },
  ];
}

module.exports = {
  createReferenceImageTools,
};
