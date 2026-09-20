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
      description: '[core] Bind a Cocos Button click event to one target component and a declared callable method. Reject engine lifecycle methods, duplicate component instances, and non-string custom data; save and reopen to verify persistence.',
      inputSchema: createSchema(
        {
          path: { type: 'string', description: 'Button node hierarchy path.' },
          uuid: { type: 'string', description: 'Button node uuid.' },
          name: { type: 'string', description: 'Fallback exact button node name.' },
          targetPath: { type: 'string', description: 'Target node path containing the handler component.' },
          targetUuid: { type: 'string', description: 'Target node uuid containing the handler component.' },
          targetName: { type: 'string', description: 'Fallback exact target node name.' },
          componentName: { type: 'string', minLength: 1, maxLength: 128, description: 'Target component class name; exactly one instance of this class must be on the target node.' },
          handler: { type: 'string', minLength: 1, maxLength: 128, description: 'Target component method declared outside Cocos Component base methods and lifecycle hooks.' },
          customEventData: { type: 'string', maxLength: 1024, description: 'Optional literal custom event data string; values are not coerced.' },
          replace: { type: 'boolean', description: 'Replace an identical existing binding.' },
        },
        ['componentName', 'handler']
      ),
      handler: async (args) => sceneBridge.call('bindButtonClickEvent', args),
    },
    {
      name: 'batch_bind_button_click_events',
      profile: 'full',
      description: 'Bind 1-50 ordered Button click events using the same validation as bind_button_click_event. Report bound, duplicate, and failed steps with stop or continue policy. Successful steps remain changed; save the scene to persist them.',
      inputSchema: createSchema(
        {
          bindings: {
            type: 'array', minItems: 1, maxItems: 50,
            description: 'Ordered Button event bindings; each entry requires exactly one Button selector and one target selector.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Button node hierarchy path.' },
                uuid: { type: 'string', description: 'Button node UUID.' },
                name: { type: 'string', description: 'Fallback exact Button node name.' },
                targetPath: { type: 'string', description: 'Target node hierarchy path.' },
                targetUuid: { type: 'string', description: 'Target node UUID.' },
                targetName: { type: 'string', description: 'Fallback exact target node name.' },
                componentName: { type: 'string', minLength: 1, maxLength: 128, description: 'Unique target component class.' },
                handler: { type: 'string', minLength: 1, maxLength: 128, description: 'Declared callable target method.' },
                customEventData: { type: 'string', maxLength: 1024, description: 'Optional literal string.' },
                replace: { type: 'boolean', description: 'Replace an identical binding.' },
              },
              required: ['componentName', 'handler'],
              additionalProperties: false,
            },
          },
          onError: { type: 'string', enum: ['stop', 'continue'], description: 'Default stop; continue attempts later bindings after a failed step.' },
        },
        ['bindings']
      ),
      handler: async (args) => sceneBridge.call('batchBindButtonClickEvents', args),
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
