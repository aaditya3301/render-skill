import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './helpers.mjs';
test('installed skill includes its executable, shared generator, CSS, references and notices',async()=>{
  const skill=path.join(ROOT,'skills/render');
  for(const file of ['scripts/render.mjs','lib/node.mjs','lib/generator.mjs','lib/browser.mjs','package.json','assets/explode.js','assets/explode.css','assets/LICENSE','assets/NOTICE','references/usage.md','agents/openai.yaml'])assert.ok((await stat(path.join(skill,file))).isFile(),file);
  const text=await readFile(path.join(skill,'SKILL.md'),'utf8');
  for(const [,target]of text.matchAll(/\]\(([^)]+)\)/g))if(!target.startsWith('http'))assert.ok((await stat(path.resolve(skill,target))).isFile(),target);
  assert.deepEqual(await readFile(path.join(ROOT,'LICENSE')),await readFile(path.join(skill,'assets/LICENSE')));
  assert.ok((await readFile(path.join(skill,'agents/openai.yaml'),'utf8')).includes('$render'));
});
