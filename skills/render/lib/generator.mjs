/** Shared browser/Node build logic. No DOM, filesystem, or image decoder dependency. */
export const VERSION = '2.0.0';
export class InputError extends Error {}
export const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'layer';
export const labelFor = name => name.replace(/\.[^.]+$/, '').replace(/^\d+[-_ .]*/, '').replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()) || 'Layer';
export const naturalCompare = (a, b) => a.localeCompare(b, 'en', {numeric: true, sensitivity: 'base'});
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const jsonForHTML = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function analyzePixels({width, height, data}, name = 'Image') {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000)
    throw new InputError(`${name}: export a canvas below 40 million pixels.`);
  if (data.length !== width * height * 4) throw new InputError(`${name}: expected RGBA pixels.`);
  let transparent = false, count = 0, sx = 0, sy = 0;
  const bounds = [width, height, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = data[(y * width + x) * 4 + 3];
    if (a < 255) transparent = true;
    if (a > 24) {
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x + 1); bounds[3] = Math.max(bounds[3], y + 1);
    }
    if (a > 128) { sx += x; sy += y; count++; }
  }
  if (!transparent) throw new InputError(`${name}: no transparent background. Export with alpha.`);
  if (bounds[2] <= bounds[0]) throw new InputError(`${name}: the layer is empty or too faint to display.`);
  if ([0, width - 1, (height - 1) * width, height * width - 1].every(i => data[i * 4 + 3] >= 250))
    throw new InputError(`${name}: all corners are opaque; remove the baked background.`);
  const center = count ? [sx / count, sy / count] : [(bounds[0] + bounds[2] - 1) / 2, (bounds[1] + bounds[3] - 1) / 2];
  let nearest = Infinity, anchor;
  // Scan only the visible bounds, keeping the label anchor on actual original pixels.
  for (let y = bounds[1]; y < bounds[3]; y++) for (let x = bounds[0]; x < bounds[2]; x++) {
    if (data[(y * width + x) * 4 + 3] <= (count ? 128 : 24)) continue;
    const distance = (x - center[0]) ** 2 + (y - center[1]) ** 2;
    if (distance < nearest) { nearest = distance; anchor = [x, y]; }
  }
  return {name, label: labelFor(name), canvas: [width, height], bounds, center, anchor};
}

export function validateLayers(layers) {
  if (layers.length < 4 || layers.length > 8) throw new InputError(`Found ${layers.length} layers. Supply 4–8 transparent PNG/WebP part layers; six is typical.`);
  if (new Set(layers.map(l => l.canvas.join('x'))).size !== 1)
    throw new InputError('Layer canvases differ. Re-export every layer from the same artboard; do not crop or center parts separately.');
  for (const l of layers) {
    if (!l.bounds || !l.anchor || !l.label?.trim()) throw new InputError(`${l.name}: a visible part, label, and anchor are required.`);
    if (!['png', 'webp'].includes(l.format)) throw new InputError(`${l.name}: use transparent PNG or WebP part layers.`);
  }
}

export function suggestMotion(scene) {
  const layers = scene.layers || [];
  const tokens = new Set([scene.product, ...layers.flatMap(l => [l.label, l.name, l.file])].filter(Boolean).join(' ').toLowerCase().match(/[a-z]+/g) || []);
  const any = words => words.split(' ').some(word => tokens.has(word));
  const food = 'bun brioche sauce tomato lettuce patty beef cheese avocado bacon onion frosting sponge'.split(' ').filter(word => tokens.has(word));
  if (any('burger hamburger sandwich cake bagel pizza taco pastry') || food.length >= 2)
    return {kind: 'vertical', reason: 'Food ingredients detected — lift the layers vertically.'};
  if (any('phone smartphone iphone tablet laptop watch camera battery oled motherboard screen display'))
    return {kind: 'sideways', reason: 'Device parts detected — use a sideways reveal.'};
  const height = scene.canvas?.[1];
  const parts = layers.filter(l => l.bounds?.length === 4 && l.bounds[3] > l.bounds[1]);
  if (height > 0 && parts.length >= 3) {
    const centers = parts.map(l => l.center?.[1] ?? (l.bounds[1] + l.bounds[3]) / 2);
    const flat = parts.filter(l => (l.bounds[2] - l.bounds[0]) / (l.bounds[3] - l.bounds[1]) > 1.6).length / parts.length;
    const ordered = centers.slice(1).filter((y, i) => y >= centers[i] - height * .025).length / (centers.length - 1);
    if (flat >= .65 && (Math.max(...centers) - Math.min(...centers)) / height > .18 && ordered >= .75)
      return {kind: 'vertical', reason: 'Wide layers stacked from top to bottom — use a vertical lift.'};
  }
  return {kind: 'sideways', reason: 'No clear vertical stack detected — use a sideways reveal. You can override it.'};
}

export function createScene(layers, options = {}) {
  validateLayers(layers);
  const product = options.product?.trim() || 'Product';
  const requested = options.motion || 'auto';
  if (!['auto', 'vertical', 'sideways', 'custom'].includes(requested)) throw new InputError('Invalid --motion.');
  const suggestion = suggestMotion({product, canvas: layers[0].canvas, layers});
  const motion = requested === 'auto' ? suggestion.kind : requested;
  const inputMode = options.inputMode || 'auto';
  if (!['auto', 'tilt', 'iso'].includes(inputMode)) throw new InputError('Invalid --input-mode.');
  const mode = motion === 'vertical' ? 'iso' : inputMode === 'auto' ? 'tilt' : inputMode;
  const theme = options.theme || 'dark', accent = options.accent || '#ff6a1a', length = options.length || '420vh';
  if (!['dark', 'light'].includes(theme)) throw new InputError('Invalid --theme.');
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new InputError('--accent must be a six-digit hex color, such as #ff6a1a.');
  const match = /^(\d+(?:\.\d+)?)vh$/.exec(length);
  if (!match || +match[1] < 200 || +match[1] > 1200) throw new InputError('--length must be between 200vh and 1200vh.');
  const axis = options.axis;
  if (axis && mode !== 'iso') throw new InputError('--axis requires --input-mode iso (or vertical motion).');
  if (axis && (axis.length !== 2 || !axis.every(Number.isFinite) || !axis.some(Boolean))) throw new InputError('Axis must contain two finite values and cannot be 0 0.');
  if (axis && motion === 'vertical' && (axis[0] !== 0 || axis[1] !== -1)) throw new InputError('Vertical motion uses axis 0 -1.');
  const [width, height] = layers[0].canvas;
  const gap = options.gap ?? Math.round(height * (motion === 'vertical' ? .1467 : mode === 'iso' ? .2 : .253));
  if (!Number.isFinite(gap) || gap <= 0) throw new InputError('--gap must be a positive finite number.');
  const scene = {product, fig: options.fig || 'Layers', mode, motion, trigger: 'scroll', base: options.base ?? 'layers/', canvas: [width, height], gap, hint: 'Scroll to take it apart', layers: []};
  if (options.caption) scene.caption = options.caption;
  if (mode === 'iso') {
    scene.axis = motion === 'vertical' ? [0, -1] : axis || [-.67, -.2];
    const boxes = layers.map(l => l.bounds);
    scene.bounds = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  } else scene.preset = options.preset || 'fan';
  scene.layers = layers.map((l, i) => ({file: `${String(i + 1).padStart(2, '0')}-${slug(l.label)}.${l.format}`, label: l.label, anchor: l.anchor,
    ...(mode === 'tilt' ? {thickness: l.thickness ?? 3} : {}), ...(l.say ? {say: l.say} : {})}));
  const warnings = [];
  if (height < 1200) warnings.push('These images are low-resolution; the output preserves them without upscaling.');
  if (layers.some(l => !/^\d+[-_ .]/.test(l.name))) warnings.push('Directory order uses filenames. Number layers front to back or pass --images in the intended order.');
  if (requested === 'auto' && suggestion.reason.startsWith('No clear')) warnings.push('Motion inference is uncertain; inspect the preview or choose --motion explicitly.');
  return {scene, theme, accent, length, report: {version: VERSION, product, motion, mode, trigger: 'scroll', reason: requested === 'auto' ? suggestion.reason : `${motion} motion explicitly selected.`, canvas: [width, height], warnings,
    layers: layers.map(({name, label, bounds, center, anchor, sha256}) => ({name, label, bounds, center, anchor, sha256}))}};
}

const encoder = new TextEncoder();
export const bytes = value => typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
export function base64(data) {
  if (typeof Buffer !== 'undefined') return Buffer.from(data).toString('base64');
  let binary = '';
  for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
  return btoa(binary);
}

export function embed(scene, {theme = 'dark', accent = '#ff6a1a', length = '420vh', engineURL = 'explode.js'} = {}) {
  return `<script src="${escapeHTML(engineURL)}" defer></script>\n<exploded-view trigger="scroll" mode="${scene.mode}" theme="${escapeHTML(theme)}" accent="${escapeHTML(accent)}" length="${escapeHTML(length)}">\n<script type="application/json">${jsonForHTML(scene)}</script>\n</exploded-view>\n`;
}

export function portableHTML(scene, layers, engine, styles, options = {}) {
  const offline = {...scene, base: './', layers: scene.layers.map((l, i) => ({...l, file: `data:image/${layers[i].format};base64,${base64(layers[i].data)}`}))};
  const {theme = 'dark', accent = '#ff6a1a', length = '420vh'} = options;
  const background = theme === 'dark' ? '#0b0b0c' : '#f3f1ec', ink = theme === 'dark' ? '#e8e6e1' : '#1b1b19';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(scene.product)} · Render</title><link rel="icon" href="data:,"><style>html,body{margin:0;background:${background};color:${ink};font:15px/1.6 system-ui,sans-serif}header,footer{max-width:1100px;margin:auto;padding:24px}h1{font-size:24px;font-weight:500;margin:0 0 4px}p{margin:0;opacity:.7}a{color:inherit}</style></head><body>\n<header><h1>${escapeHTML(scene.product)}</h1><p>Scroll down to take it apart and assemble it again. Scroll up to reverse.</p></header>\n<exploded-view trigger="scroll" mode="${scene.mode}" theme="${theme}" accent="${accent}" length="${length}"><script type="application/json">${jsonForHTML(offline)}</script></exploded-view>\n<footer><p>Made with Render. Engine license and attribution: LICENSE and NOTICE in the download.</p></footer>\n<script data-render-css="data:text/css;base64,${base64(encoder.encode(styles))}">${engine.replace(/<\/script/gi, '<\\/script')}</script>\n</body></html>\n`;
}

const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(data) { let c = 0xffffffff; for (const b of data) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
  // Standard ZIP "store" entries. PNG/WebP are already compressed; use the same bytes in both hosts.
  const parts = [], central = []; let offset = 0;
  for (const file of files) {
    if (file.name.startsWith('/') || file.name.includes('\\') || file.name.split('/').includes('..')) throw new InputError('Unsafe archive path.');
    const name = encoder.encode(file.name), data = bytes(file.data), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name); offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, p) => sum + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const chunks = [...parts, ...central, new Uint8Array(end.buffer)], result = new Uint8Array(offset + size + 22);
  let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; } return result;
}

export function createPackage(layers, assets, options = {}, notices = []) {
  const settings = createScene(layers, options), {scene, report} = settings;
  report.artwork_notices = notices.map(n => n.name);
  const files = layers.map((l, i) => ({name: 'layers/' + scene.layers[i].file, data: bytes(l.data)}));
  for (const name of ['explode.js', 'explode.css', 'LICENSE', 'NOTICE']) {
    if (assets[name] == null) throw new InputError(`Missing bundled asset: ${name}`);
    files.push({name, data: bytes(assets[name])});
  }
  const text = (name, data) => files.push({name, data: encoder.encode(data)});
  files.push(...notices.map(n => ({name: n.name, data: bytes(n.data)})));
  text('scene.json', JSON.stringify(scene, null, 2) + '\n');
  text('manifest.json', JSON.stringify(report, null, 2) + '\n');
  text('embed.html', embed(scene, settings));
  text('index.html', portableHTML(scene, layers, assets['explode.js'], assets['explode.css'], settings));
  text('README.txt', 'Open index.html directly to play the portable scroll animation. It embeds its engine, CSS, and images.\n\nFor a website, copy explode.js, explode.css, and layers/ to public assets, then insert embed.html. Keep the CSS beside the script. Keep LICENSE and NOTICE with the engine. Input artwork retains its own license.\nscene.json is editable hosted configuration; rebuild the portable snapshot after changing it.\n');
  return {...settings, files, zip: zipStore(files)};
}
