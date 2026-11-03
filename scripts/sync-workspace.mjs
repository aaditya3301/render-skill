// Optional checkout integration: public skill is canonical; keep this workspace's builder/engine and installed skill current.
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const repo = fileURLToPath(new URL('../', import.meta.url)), workspace = path.dirname(repo);
if (await readFile(path.join(workspace,'CLAUDE.md'),'utf8').catch(()=>null)) {
  const skill = path.join(repo,'skills/render');
  await mkdir(path.join(workspace,'engine'),{recursive:true});
  for (const file of ['explode.js','explode.css','LICENSE','NOTICE']) await cp(path.join(skill,'assets',file),path.join(workspace,'engine',file));
  for (const file of ['generator.mjs','browser.mjs']) await cp(path.join(skill,'lib',file),path.join(workspace,'engine',file));
  await cp(skill,path.join(workspace,'.agents/skills/render'),{recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')});
  console.log('Synced JavaScript/CSS engine, shared generator, and installed workspace skill.');
} else console.log('Standalone repository: no outer workspace integration needed.');
