import {readFile, readdir, stat, mkdir, mkdtemp, writeFile, rename, rm, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {InputError, analyzePixels, createPackage, naturalCompare, slug} from './generator.mjs';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
export async function decoder() {
  try { return (await import('sharp')).default; }
  catch { throw new InputError('Image decoding requires sharp. Run npm install --prefix "' + fileURLToPath(new URL('../', import.meta.url)) + '" first.'); }
}
export async function analyzeFile(file) {
  const sharp = await decoder(), data = await readFile(file);
  try {
    const image = sharp(data, {limitInputPixels: 40_000_000, animated: false});
    const meta = await image.metadata();
    if (!['png', 'webp'].includes(meta.format)) throw new InputError(`${path.basename(file)}: use transparent PNG or WebP part layers.`);
    if ((meta.pages || 1) > 1) throw new InputError(`${path.basename(file)}: use a single still image for each layer.`);
    const raw = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const layer = analyzePixels({width: raw.info.width, height: raw.info.height, data: raw.data}, path.basename(file));
    return {...layer, data, format: meta.format, sha256: createHash('sha256').update(data).digest('hex')};
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`${path.basename(file)}: cannot read this image (${error.message}).`);
  }
}

async function noticesFor(paths, options) {
  const found = new Set();
  for (const parent of new Set(paths.map(p => path.dirname(p)))) {
    for (const item of await readdir(parent, {withFileTypes: true})) {
      const ext = path.extname(item.name).toLowerCase(), stem = path.basename(item.name, path.extname(item.name)).toLowerCase();
      if (item.isFile() && ['', '.txt', '.md'].includes(ext) && ['license', 'licence', 'notice', 'attribution', 'credits', 'copyright'].includes(stem)) found.add(path.join(parent, item.name));
    }
  }
  for (const item of options.artworkLicense || []) {
    const file = path.resolve(item);
    if (!(await stat(file).catch(() => null))?.isFile()) throw new InputError(`Artwork notice does not exist: ${file}`);
    found.add(file);
  }
  const notices = [];
  for (const [i, file] of [...found].sort(naturalCompare).entries()) notices.push({name: `artwork/${String(i + 1).padStart(2, '0')}-${slug(path.parse(file).name)}${path.extname(file).toLowerCase()}`, data: await readFile(file)});
  if (options.artworkCredit?.length) notices.push({name: 'artwork/credits.txt', data: options.artworkCredit.join('\n') + '\n'});
  return notices;
}

export async function build(options) {
  if (!options.output) throw new InputError('--output is required.');
  const output = path.resolve(options.output);
  if (await lstat(output).catch(e => { if (e.code !== 'ENOENT') throw e; })) throw new InputError(`Output already exists: ${output}. Choose a new directory; existing files are never replaced.`);
  if (!!options.input === !!options.images) throw new InputError('Supply either --input or --images.');
  let paths;
  if (options.input) {
    const directory = path.resolve(options.input);
    if (!(await stat(directory).catch(() => null))?.isDirectory()) throw new InputError(`Input directory does not exist: ${directory}`);
    paths = (await readdir(directory, {withFileTypes: true})).filter(e => e.isFile() && /\.(png|webp)$/i.test(e.name)).map(e => path.join(directory, e.name)).sort(naturalCompare);
  } else paths = options.images.map(p => path.resolve(p));
  if (paths.length < 4 || paths.length > 8) throw new InputError(`Found ${paths.length} layers. Supply 4–8 transparent PNG/WebP part layers; six is typical.`);
  const normalized = paths.map(p => process.platform === 'win32' ? p.toLowerCase() : p);
  if (new Set(normalized).size !== paths.length) throw new InputError('The same image was supplied more than once. Supply each layer once.');
  if (options.labels && (options.labels.length !== paths.length || options.labels.some(l => !l.trim()))) throw new InputError('--labels must contain one non-empty label per image, in the same order.');
  const layers = [];
  for (const [i, file] of paths.entries()) {
    if (!(await stat(file).catch(() => null))?.isFile()) throw new InputError(`Image does not exist: ${file}`);
    const layer = await analyzeFile(file);
    if (options.labels) layer.label = options.labels[i].trim();
    layers.push(layer);
  }
  const assets = Object.fromEntries(await Promise.all(['explode.js', 'explode.css', 'LICENSE', 'NOTICE'].map(async name => [name, await readFile(path.join(ASSETS, name), 'utf8')])));
  const result = createPackage(layers, assets, options, await noticesFor(paths, options));
  await mkdir(path.dirname(output), {recursive: true});
  const temporary = await mkdtemp(path.join(path.dirname(output), '.render-build-'));
  let claimed = false;
  try {
    const stage = path.join(temporary, 'result');
    await mkdir(stage);
    for (const file of [...result.files, {name: 'render.zip', data: result.zip}]) {
      const target = path.join(stage, file.name);
      await mkdir(path.dirname(target), {recursive: true}); await writeFile(target, file.data);
    }
    // Claim with mkdir: never replace an output another process created while we decoded.
    await mkdir(output); claimed = true;
    for (const item of await readdir(stage)) await rename(path.join(stage, item), path.join(output, item));
  } catch (error) {
    if (claimed) await rm(output, {recursive: true, force: true});
    throw error;
  } finally { await rm(temporary, {recursive: true, force: true}); }
  return {...result.report, output, files: Object.fromEntries(['index.html', 'embed.html', 'scene.json', 'render.zip'].map(name => [name, path.join(output, name)]))};
}
