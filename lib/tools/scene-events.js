'use strict';

function createSceneEventTools({ createSchema, sceneBridge }) {
  return [
    {
      name: 'list_button_click_events',
      profile: 'full',
      description: '[core] List click event bindings on a Cocos Button component.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Button node hierarchy path.' },
          uuid: { type: 'string', description: 'Button node uuid.' },
          name: { type: 'string', description: 'Fallback exact button node name.' },
        },
        []
      ),
      handler: async (args) => sceneBridge.call('listButtonClickEvents', args),
    },
    {
      name: 'bind_button_click_event',
      profile: 'full',
      description: '[core] Bind a Cocos Button click event to a target node component method.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Button node hierarchy path.' },
          uuid: { type: 'string', description: 'Button node uuid.' },
          name: { type: 'string', description: 'Fallback exact button node name.' },
          targetPath: { type: 'string', description: 'Target node path containing the handler component.' },
          targetUuid: { type: 'string', description: 'Target node uuid containing the handler component.' },
          targetName: { type: 'string', description: 'Fallback exact target node name.' },
          componentName: { type: 'string', description: 'Target component class name.' },
          handler: { type: 'string', description: 'Method name to invoke on the target component.' },
          customEventData: { type: 'string', description: 'Optional custom event data string.' },
          replace: { type: 'boolean', description: 'Replace an identical existing binding.' },
        },
        ['componentName', 'handler']
      ),
      handler: async (args) => sceneBridge.call('bindButtonClickEvent', args),
    },
    {
      name: 'unbind_button_click_event',
      profile: 'full',
      annotations: { destructiveHint: true },
      description: 'Remove one Button click binding by its current list index and exact event signature; reject stale or changed bindings.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Button node hierarchy path.' },
          uuid: { type: 'string', description: 'Button node UUID.' },
          name: { type: 'string', description: 'Fallback exact button node name.' },
          eventIndex: { type: 'integer', minimum: 0, description: 'Index returned by list_button_click_events.' },
          expectedEvent: {
            type: 'object',
            description: 'The event returned by list_button_click_events at eventIndex. Its targetUuid, component, handler, and customEventData must still match.',
            properties: {
              targetUuid: { type: 'string' },
              component: { type: 'string' },
              handler: { type: 'string' },
              customEventData: { type: 'string' },
            },
            required: ['targetUuid', 'component', 'handler', 'customEventData'],
          },
        },
        ['eventIndex', 'expectedEvent']
      ),
      handler: async (args) => sceneBridge.call('unbindButtonClickEvent', args),
    },
  ];
}

module.exports = {
  createSceneEventTools,
};
