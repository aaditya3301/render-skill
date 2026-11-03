#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {build} from '../lib/node.mjs';
import {InputError} from '../lib/generator.mjs';

export function parseArgs(argv) {
  const result = {}, lists = new Set(['images', 'labels']), repeats = new Set(['artwork-license', 'artwork-credit']);
  const singles = new Set(['input', 'output', 'product', 'motion', 'input-mode', 'gap', 'theme', 'accent', 'length']);
  const key = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return {help: true};
    if (!arg.startsWith('--')) throw new InputError(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (lists.has(name)) {
      const values = []; while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) values.push(argv[++i]);
      if (!values.length) throw new InputError(`--${name} requires values.`);
      result[key(name)] = values;
    } else if (name === 'axis') {
      if (argv[i + 2] === undefined) throw new InputError('--axis requires X Y.');
      result.axis = [Number(argv[++i]), Number(argv[++i])];
    } else if (singles.has(name) || repeats.has(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new InputError(`--${name} requires a value.`);
      if (repeats.has(name)) (result[key(name)] ||= []).push(value);
      else result[key(name)] = name === 'gap' ? Number(value) : value;
    } else throw new InputError(`Unknown option: --${name}`);
  }
  if (!result.output || (!result.input && !result.images)) throw new InputError('Supply --input DIR (or --images FILES...) and --output NEW-DIRECTORY.');
  if (result.motion && !['auto', 'vertical', 'sideways'].includes(result.motion)) throw new InputError('Invalid --motion. Choose auto, vertical, or sideways.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log('Render — JavaScript/CSS scroll animation builder\nnode render.mjs --input DIR --output NEW-DIRECTORY [--product NAME]\nOr: --images FILE1 FILE2 ... [--labels LABEL1 LABEL2 ...]\nOptions: --motion auto|vertical|sideways --input-mode auto|tilt|iso --axis X Y\n--gap N --theme dark|light --accent "#ff6a1a" --length 420vh\n--artwork-license FILE --artwork-credit TEXT (repeatable)');
    else console.log(JSON.stringify(await build(args), null, 2));
  } catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 2; }
}
