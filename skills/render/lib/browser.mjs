import {analyzePixels, InputError} from './generator.mjs';

export async function analyzeBlob(blob, name) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const png = data.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => data[i] === v);
  const text = (start, end) => String.fromCharCode(...data.subarray(start, end));
  const webp = text(0,4) === 'RIFF' && text(8,12) === 'WEBP';
  if (!png && !webp) throw new InputError(`${name}: use transparent PNG or WebP part layers.`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = png ? 8 : 12; at + 8 <= data.length;) {
    const size = view.getUint32(at + (png ? 0 : 4), !png), type = text(at + (png ? 4 : 0), at + (png ? 8 : 4));
    if (['acTL','ANIM','ANMF'].includes(type)) throw new InputError(`${name}: use a single still image for each layer.`);
    at += png ? size + 12 : size + 8 + (size & 1);
  }
  const bmp = await createImageBitmap(blob), {width, height} = bmp;
  if (width * height > 40_000_000) { bmp.close(); throw new InputError(`${name}: export a canvas below 40 million pixels.`); }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(bmp, 0, 0);
  const analysis = analyzePixels({width, height, data: ctx.getImageData(0, 0, width, height).data}, name);
  // Small alpha map is only for thumbnail picking; analysis above uses the original coordinates.
  const aw = Math.min(300, width), ah = Math.max(1, Math.round(aw * height / width));
  canvas.width = aw; canvas.height = ah; ctx.drawImage(bmp, 0, 0, aw, ah);
  const rgba = ctx.getImageData(0,0,aw,ah).data, a = new Uint8Array(aw * ah);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  const digest = await crypto.subtle.digest('SHA-256', data);
  return {...analysis, format: png ? 'png' : 'webp', data, sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join(''), bmp, alpha: {a, w: aw, h: ah}};
}

export async function loadAssets(base) {
  return Object.fromEntries(await Promise.all(['explode.js','explode.css','LICENSE','NOTICE'].map(async name => {
    const response = await fetch(new URL(name, base));
    if (!response.ok) throw new InputError(`Could not load ${name}: HTTP ${response.status}`);
    return [name, await response.text()];
  })));
}
