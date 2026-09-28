'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const electron = require('./electron-tools');
const { selectCaptureWindow, panelRegionScript } = require('./screenshot-target');
const { resolveProjectFilePath } = require('./path-safety');
const preview = require('./preview-runtime');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function exec(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function captureDesktopScreenshot(projectPath, options = {}) {
  const outputDir = path.join(projectPath, 'temp', 'mcp-captures');
  ensureDir(outputDir);
  const filePath = path.join(outputDir, options.fileName || `desktop-${Date.now()}.png`);

  if (process.platform === 'darwin') {
    await exec('screencapture', ['-x', filePath]);
  } else if (process.platform === 'win32') {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
    await exec('powershell', ['-NoProfile', '-Command', script]);
  } else {
    try {
      await exec('gnome-screenshot', ['-f', filePath]);
    } catch (error) {
      await exec('import', ['-window', 'root', filePath]);
    }
  }

  const data = fs.readFileSync(filePath).toString('base64');
  return {
    filePath,
    dataUri: `data:image/png;base64,${data}`,
    size: fs.statSync(filePath).size,
    platform: os.platform(),
  };
}

async function captureEditorWindowScreenshot(projectPath, options = {}) {
  return captureWindow(projectPath, options);
}

async function capturePanelScreenshot(projectPath, options = {}) {
  return captureWindow(projectPath, options, options.panel || 'scene');
}

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Screenshot query/capture timed out after 5 seconds; no fallback was attempted.')), 5000); })]); }
  finally { clearTimeout(timer); }
}

async function captureWindow(projectPath, options, panel) {
  if (Object.keys(options).some(k => !['fileName', 'windowId', 'titleContains', 'windowKind', 'panel'].includes(k))) throw new Error('Unknown screenshot option.');
  const name = options.fileName ?? `${panel || 'editor'}-${Date.now()}-${crypto.randomUUID()}.png`;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.png$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('fileName must be a plain PNG basename, without paths or reserved device names.');
  const filePath = resolveProjectFilePath(projectPath, path.join('temp', 'mcp-captures', name));
  if (fs.existsSync(filePath)) throw new Error('Screenshot output already exists; overwriting is not allowed.');
  const target = selectCaptureWindow(options);
  const read = async () => {
    if (selectCaptureWindow(options) !== target) throw new Error('Screenshot window identity changed.');
    const zoom = target.webContents.getZoomFactor();
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Window zoom factor is unavailable.');
    const runtime = panel === 'game' ? await bounded(preview.controlPreviewToolbar({ action: 'state' })) : undefined;
    if (runtime && (!runtime.running || runtime.mode !== 'gameView' || runtime.busy || !runtime.toolbarSynchronized)) throw new Error('Start a stable Game View preview explicitly before capturing it.');
    const region = panel ? await bounded(electron.executeJavaScript(target, panelRegionScript(panel))) : null;
    return { title: target.getTitle(), zoom, region, runtime };
  };
  const before = await read();
  const r = before.region;
  const bounds = r ? { x: Math.ceil(r.x * before.zoom), y: Math.ceil(r.y * before.zoom),
    width: Math.floor((r.x + r.width) * before.zoom) - Math.ceil(r.x * before.zoom),
    height: Math.floor((r.y + r.height) * before.zoom) - Math.ceil(r.y * before.zoom) } : undefined;
  if (bounds && (bounds.width < 1 || bounds.height < 1)) throw new Error('Screenshot crop is empty after zoom conversion.');
  const image = await bounded(target.capturePage(bounds));
  if (!isDeepStrictEqual(before, await read())) throw new Error('Screenshot view changed during capture; image withheld.');
  if (image.isEmpty()) throw new Error('Creator returned an empty screenshot.');
  const png = image.toPNG();
  if (png.length < 24 || png.length > 20 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Screenshot is not a bounded PNG image.');
  const pixelSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (!pixelSize.width || !pixelSize.height) throw new Error('Screenshot PNG dimensions are empty.');
  // wx also protects an existing file/symlink that appeared during capture.
  resolveProjectFilePath(projectPath, filePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, png, { flag: 'wx' });
  return { filePath, dataUri: `data:image/png;base64,${png.toString('base64')}`, size: png.length, pixelSize,
    windowId: target.id, title: before.title, source: panel === 'game' ? 'creator_game_view' : panel === 'scene' ? 'creator_scene_view' : 'creator_editor_window',
    capturedAt: new Date().toISOString(), bounds, cropUnits: 'device_independent_pixels', region: before.region, zoomFactor: before.zoom,
    ...(before.runtime ? { runtime: before.runtime, runtimeSceneIdentity: 'not_verified' } : {}), visualValidation: 'not_run' };
}

module.exports = {
  captureDesktopScreenshot,
  captureEditorWindowScreenshot,
  capturePanelScreenshot,
};
