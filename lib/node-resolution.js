'use strict';

class NodeResolutionError extends Error {
  constructor(code, message, candidates = []) {
    super(message);
    this.name = 'NodeResolutionError';
    this.code = code;
    this.candidates = candidates;
  }
}

function nodePath(root, node) {
  const names = [];
  let current = node;
  while (current && current !== root) {
    names.unshift(current.name);
    current = current.parent;
  }
  if (current !== root) {
    throw new NodeResolutionError('INVALID_NODE', 'Node is outside the active scene.');
  }
  return names.join('/');
}

function describeNode(root, node) {
  return { name: node.name, path: nodePath(root, node), uuid: node.uuid };
}

function walkNodes(root, visitor, includeNode) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node !== root && !includeNode(node)) continue;
    visitor(node);
    const children = Array.isArray(node.children) ? node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
}

function matchingPathNodes(root, path, includeNode) {
  const segments = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (segments[0] === root.name) segments.shift();
  if (segments.length === 0) return [root];

  let matches = [root];
  for (const segment of segments) {
    matches = matches.flatMap((node) => (
      Array.isArray(node.children)
        ? node.children.filter((child) => includeNode(child) && child.name === segment)
        : []
    ));
    if (matches.length === 0) break;
  }
  return matches;
}

function matchingNodes(root, key, value, includeNode) {
  if (key === 'path') return matchingPathNodes(root, value, includeNode);
  const matches = [];
  walkNodes(root, (node) => {
    if (node[key] === value) matches.push(node);
  }, includeNode);
  return matches;
}

function resolveNode(root, selector = {}, options = {}) {
  if (!root) throw new NodeResolutionError('NO_SCENE', 'No active scene is loaded.');
  const includeNode = typeof options.includeNode === 'function' ? options.includeNode : () => true;
  const fields = ['uuid', 'path', 'name']
    .map((key) => [key, selector[key]])
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([key, value]) => [key, String(value).trim()]);
  if (fields.length === 0) return null;

  let candidates = null;
  for (const [key, value] of fields) {
    const matches = matchingNodes(root, key, value, includeNode);
    candidates = candidates === null ? matches : candidates.filter((node) => matches.includes(node));
    if (candidates.length === 0) return null;
  }
  if (candidates.length > 1) {
    const details = candidates.slice(0, 20).map((node) => describeNode(root, node));
    const labels = details.map((node) => `${node.path || '<scene>'} (${node.uuid})`).join(', ');
    const remaining = candidates.length - details.length;
    throw new NodeResolutionError(
      'AMBIGUOUS_NODE',
      `Node selector matched ${candidates.length} nodes. Candidates: ${labels}${remaining ? `, and ${remaining} more` : ''}. Use a node UUID or a more specific path.`,
      details
    );
  }
  return candidates[0];
}

module.exports = { NodeResolutionError, describeNode, nodePath, resolveNode };
