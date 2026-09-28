'use strict';
const electron = require('./electron-tools');

function validateCaptureTarget(options) {
  if (options.windowId !== undefined && (!Number.isInteger(options.windowId) || options.windowId < 1)) throw new Error('windowId must be a positive Electron window ID.');
  if (options.titleContains !== undefined && (typeof options.titleContains !== 'string' || !options.titleContains.trim() || options.titleContains.length > 256)) throw new Error('titleContains must contain 1..256 characters.');
  if (options.windowKind !== undefined && !['editor', 'focused'].includes(options.windowKind)) throw new Error('Only the Creator editor / embedded Game View is supported; external browser and simulator capture is unavailable.');
}

function selectCaptureWindow(options = {}) {
  validateCaptureTarget(options);
  const candidates = electron.getAllWindows().filter(w => {
    const url = w.webContents?.getURL?.() || '';
    return /^file:\/\/.*\/windows\/main\.html(?:[?#]|$)/i.test(url) && w.isVisible() && !w.isMinimized()
      && (options.windowId === undefined || w.id === options.windowId)
      && (options.titleContains === undefined || w.getTitle().toLowerCase().includes(options.titleContains.trim().toLowerCase()));
  });
  if (candidates.length !== 1) throw new Error('A unique visible, non-minimized Creator main window is required. Use list_editor_windows and an exact windowId; no fallback capture was attempted.');
  return candidates[0];
}

// Serialized into the main renderer. Only the observed Creator 3.8 Scene webview
// adapter is supported; unknown layouts must fail rather than capture another panel.
function locatePanelRegion(panel) {
  const parent = e => e.parentElement || e.getRootNode?.().host;
  const visible = e => {
    for (let n = e; n; n = parent(n)) {
      const s = window.getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false;
    }
    const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4;
  };
  const collect = root => {
    const all = [];
    for (const e of root.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) all.push(...collect(e.shadowRoot)); }
    return all;
  };
  const frames = collect(document).filter(e => e.tagName === 'PANEL-FRAME' && e.getAttribute('name') === 'scene' && visible(e));
  if (frames.length !== 1) throw new Error('A unique visible scene panel is required; open its tab and retry.');
  const frame = frames[0], children = collect(frame);
  if (frame.shadowRoot) children.push(...collect(frame.shadowRoot));
  const views = [...new Set(children)].filter(e => e.tagName === 'WEBVIEW' && visible(e));
  if (views.length !== 1) throw new Error('A unique visible Creator scene webview is required.');
  const view = views[0], src = decodeURIComponent(view.getAttribute('src') || '').replace(/\\/g, '/');
  const suffix = panel === 'game' ? 'preview' : 'preload';
  if (!src.startsWith('packages://scene/static/template/3d-webview.html?url=') || !src.endsWith(`/scene/dist/script/3d/preload/web/${suffix}.js`)) {
    throw new Error(`The visible panel is not the requested ${panel} view. Select Scene or start Game View explicitly; no fallback capture was attempted.`);
  }
  let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
  const intersect = e => { const r = e.getBoundingClientRect(); left = Math.max(left, r.left); top = Math.max(top, r.top); right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom); };
  intersect(frame); intersect(view);
  for (let e = parent(view); e; e = parent(e)) {
    const s = window.getComputedStyle(e), r = e.getBoundingClientRect();
    if (/hidden|clip|auto|scroll/.test(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
    if (/hidden|clip|auto|scroll/.test(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
  }
  const x = Math.ceil(left), y = Math.ceil(top), width = Math.floor(right) - x, height = Math.floor(bottom) - y;
  if (![x, y, width, height].every(Number.isFinite) || width < 4 || height < 4) throw new Error('The requested view has no usable visible crop.');
  const full = view.getBoundingClientRect();
  return { x, y, width, height, source: panel, panel: 'scene', adapter: 'creator-3.8-scene-webview', units: 'css_pixels',
    clipped: left > full.left + 1 || top > full.top + 1 || right < full.right - 1 || bottom < full.bottom - 1,
    viewWidth: full.width, viewHeight: full.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
}
function panelRegionScript(panel) {
  if (!['scene', 'game'].includes(panel)) throw new Error('Screenshot panel must be scene or game.');
  return `(${locatePanelRegion.toString()})(${JSON.stringify(panel)})`;
}

module.exports = { validateCaptureTarget, selectCaptureWindow, panelRegionScript };
