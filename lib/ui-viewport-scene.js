'use strict';

const EPSILON = 1e-6;
function validateViewportOptions(options) {
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['sceneUuid', 'nodeUuids'].includes(key)) ||
      !id(options.sceneUuid) || !Array.isArray(options.nodeUuids) || options.nodeUuids.length < 1 || options.nodeUuids.length > 128 ||
      !options.nodeUuids.every(id) || new Set(options.nodeUuids).size !== options.nodeUuids.length) throw new Error('Expected an exact sceneUuid and 1–128 distinct exact nodeUuids only.');
}
function point(value) {
  if (!value || !['x', 'y', 'z'].every(key => Number.isFinite(value[key]))) throw new Error('non_finite_geometry');
  return { x: value.x, y: value.y, z: value.z };
}
function bounds(corners) {
  return { corners, aabb: { minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)),
    maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)) } };
}
function area(points) {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
// Orthographic projection is affine: clipping the actual quad (not its AABB)
// against x/y/depth planes also handles rotation and near/far intersections.
function classifyClipping(points, rect, near, far) {
  const planes = [p => p.x - rect.x, p => rect.x + rect.width - p.x, p => p.y - rect.y,
    p => rect.y + rect.height - p.y, p => p.z - near, p => far - p.z];
  if (area(points) <= EPSILON) return { status: 'unavailable', reason: 'degenerate_projection' };
  if (points.every(p => planes.every(distance => distance(p) >= -EPSILON))) return { status: 'inside' };
  let polygon = points;
  for (const distance of planes) {
    const input = polygon; polygon = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], da = distance(a), db = distance(b);
      if (da >= 0) polygon.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        polygon.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      }
    }
  }
  return { status: polygon.length >= 3 && area(polygon) > EPSILON ? 'partial' : 'outside' };
}

function createUIViewportMethods({ cc, getScene, findNode }) {
  const fail = code => { throw new Error(code); };
  const member = (node, scene) => {
    for (let current = node; current; current = current.parent) {
      if (current._objFlags & (cc.CCObjectFlags?.DontSave || 8)) return false;
      if (current === scene) return true;
    }
    return false;
  };
  function localCorners(ui) {
    const size = ui.contentSize, anchor = ui.anchorPoint;
    if (!size || !anchor || ![size.width, size.height, anchor.x, anchor.y].every(Number.isFinite) || size.width <= 0 || size.height <= 0) fail('invalid_ui_rectangle');
    const x = -anchor.x * size.width, y = -anchor.y * size.height;
    return [new cc.Vec3(x, y, 0), new cc.Vec3(x + size.width, y, 0), new cc.Vec3(x + size.width, y + size.height, 0), new cc.Vec3(x, y + size.height, 0)];
  }
  const nonsingular = node => {
    const determinant = cc.Mat4.determinant(node.worldMatrix);
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) fail('degenerate_transform');
  };
  function canvasViewport(camera, canvasUI, rect) {
    try {
      const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]].map(([x, y]) => {
        const ray = camera.screenPointToRay(x, y);
        const origin = point(canvasUI.convertToNodeSpaceAR(ray.o));
        const next = point(canvasUI.convertToNodeSpaceAR(new cc.Vec3(ray.o.x + ray.d.x, ray.o.y + ray.d.y, ray.o.z + ray.d.z)));
        const dz = next.z - origin.z;
        if (Math.abs(dz) <= 1e-12) fail('canvas_plane_parallel_to_camera');
        const t = -origin.z / dz;
        const hit = new cc.Vec3(ray.o.x + ray.d.x * t, ray.o.y + ray.d.y * t, ray.o.z + ray.d.z * t);
        const depth = -cc.Vec3.transformMat4(new cc.Vec3(), hit, camera.camera.matView).z;
        if (t < 0 || depth < camera.near - EPSILON || depth > camera.far + EPSILON) fail('canvas_plane_outside_clip');
        return point(canvasUI.convertToNodeSpaceAR(hit));
      });
      return { available: true, coordinateSpace: 'canvas_local_ui', ...bounds(corners) };
    } catch (error) { return { available: false, reason: String(error.message || error).slice(0, 200) }; }
  }
  function inspect(nodeUuid, scene) {
    const result = { nodeUuid, available: false, clipping: { status: 'unavailable' } };
    try {
      const node = findNode({ uuid: nodeUuid });
      if (!node || !cc.isValid(node) || node === scene || !member(node, scene)) fail('node_not_found');
      result.name = node.name;
      const ui = node.getComponent(cc.UITransform);
      if (!ui) fail('missing_ui_transform');
      nonsingular(node);
      const local = localCorners(ui), world = local.map(p => point(ui.convertToWorldSpaceAR(p)));
      result.bounds = { local: bounds(local.map(point)), world: bounds(world) };
      let canvasNode = node;
      while (canvasNode && !canvasNode.getComponent(cc.Canvas)) canvasNode = canvasNode.parent;
      if (!canvasNode) fail('missing_canvas');
      const canvas = canvasNode.getComponent(cc.Canvas), canvasUI = canvasNode.getComponent(cc.UITransform);
      if (!canvasUI) fail('missing_canvas_ui_transform');
      nonsingular(canvasNode);
      result.canvas = { uuid: canvasNode.uuid, alignCanvasWithScreen: canvas.alignCanvasWithScreen, content: bounds(localCorners(canvasUI).map(point)) };
      result.bounds.canvas = bounds(world.map(p => point(canvasUI.convertToNodeSpaceAR(new cc.Vec3(p.x, p.y, p.z)))));
      const camera = canvas.cameraComponent;
      if (!camera || !(camera instanceof cc.Camera) || !cc.isValid(camera)) fail('missing_camera');
      const r = camera.rect;
      result.camera = { uuid: camera.uuid, nodeUuid: camera.node.uuid, projection: camera.projection, near: camera.near, far: camera.far,
        orthoHeight: camera.orthoHeight, visibility: camera.visibility, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      if (!member(camera.node, scene)) fail('camera_outside_scene');
      nonsingular(camera.node);
      if (!node.activeInHierarchy) fail('inactive_target');
      if (!canvas.enabledInHierarchy) fail('inactive_canvas');
      if (!camera.enabledInHierarchy) fail('inactive_camera');
      if (node.layer === 0 || ((camera.visibility & node.layer) >>> 0) !== (node.layer >>> 0)) fail('layer_not_visible');
      if (camera.targetTexture) fail('render_texture_unsupported');
      if (camera.projection !== cc.Camera.ProjectionType.ORTHO) fail('perspective_unsupported');
      const render = camera.camera;
      if (!render || ![render.width, render.height, camera.near, camera.far, camera.orthoHeight, r.x, r.y, r.width, r.height].every(Number.isFinite) ||
          render.width <= 0 || render.height <= 0 || camera.near < 0 || camera.far <= camera.near || camera.orthoHeight <= 0 ||
          r.width <= 0 || r.height <= 0 || r.x < 0 || r.y < 0 || r.x + r.width > 1 + EPSILON || r.y + r.height > 1 + EPSILON) fail('invalid_camera_geometry');
      // Edit-mode cameras may not render a frame after a property change.
      // Refresh only the public derived matrices, never authored scene data.
      if (typeof render.update !== 'function') fail('camera_matrix_refresh_unavailable');
      render.update(true);
      const viewport = { x: r.x * render.width, y: r.y * render.height, width: r.width * render.width, height: r.height * render.height };
      result.camera.renderSize = { width: render.width, height: render.height };
      result.camera.viewportPixels = viewport;
      const projected = world.map(p => {
        const screen = point(camera.worldToScreen(new cc.Vec3(p.x, p.y, p.z)));
        // Z for clipping is camera-space distance, not world Z or screen pixels.
        const view = point(cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(p.x, p.y, p.z), render.matView));
        return { x: screen.x, y: screen.y, z: -view.z };
      });
      result.bounds.screen = bounds(projected);
      result.clipping = classifyClipping(projected, viewport, camera.near, camera.far);
      result.canvas.viewport = canvasViewport(camera, canvasUI, viewport);
      result.available = result.clipping.status !== 'unavailable';
      if (!result.available) result.reason = result.clipping.reason;
    } catch (error) { result.reason = String(error.message || error).slice(0, 200); }
    return result;
  }
  function getUIViewport(options) {
    validateViewportOptions(options);
    const scene = getScene();
    if (!scene || scene.uuid !== options.sceneUuid) throw new Error('Viewport scene UUID does not match the active scene.');
    const nodes = options.nodeUuids.map(uuid => inspect(uuid, scene));
    return { sceneUuid: scene.uuid, scope: 'edit_scene_camera', complete: nodes.every(n => n.available && n.canvas.viewport.available), nodes,
      coordinates: { local: 'node anchor-relative UI units', canvas: 'Canvas anchor-relative UI units', world: 'scene world units',
        screen: 'edit-scene camera render-buffer pixels; origin bottom-left; z is camera-space depth' },
      warnings: ['Own UITransform rectangle only; descendants, masks, occlusion, text glyphs and input are not visibility-tested.',
        'Edit-scene associated camera pixels are not the Scene observer view, Game View, browser CSS pixels or device pixels. No preview/device viewport is inferred.'] };
  }
  return { getUIViewport };
}

module.exports = { validateViewportOptions, classifyClipping, createUIViewportMethods };
