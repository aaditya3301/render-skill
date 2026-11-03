import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp, readdir, readFile, stat, rm, realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeLayers} from '../examples/make-layers.mjs';
import {ROOT} from './helpers.mjs';

const work=await mkdtemp(path.join(os.tmpdir(),'render-install-js-'));
try {
  let npm=process.env.npm_execpath;
  if(!npm) {
    const launcher=execFileSync(process.platform==='win32'?'where.exe':'which',['npm'],{encoding:'utf8'}).trim().split(/\r?\n/)[0];
    npm=process.platform==='win32'?path.join(path.dirname(launcher),'node_modules/npm/bin/npm-cli.js'):await realpath(launcher);
  }
  const execute=(script,args,cwd)=>{
    const result=spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8',timeout:180000,env:{...process.env,DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});
    assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);return result;
  };
  const source=process.argv.includes('--source')?process.argv[process.argv.indexOf('--source')+1]:ROOT;
  execute(path.join(path.dirname(npm),'npx-cli.js'),['--yes','skills','add',source,'--skill','render','--agent','codex','--copy','--yes'],work);
  const skill=path.join(work,'.agents/skills/render');
  for(const name of ['scripts/render.mjs','lib/generator.mjs','lib/node.mjs','package.json','assets/explode.js','assets/explode.css','assets/LICENSE','assets/NOTICE'])assert.ok((await stat(path.join(skill,name))).isFile(),name);
  // No dependencies resolved from the source checkout: install inside this isolated copy.
  execute(npm,['install','--prefix',skill,'--omit=dev','--workspaces=false','--no-audit','--no-fund'],work);
  const fixtures=await makeLayers(path.join(work,'inputs'));
  const run=execute(path.join(skill,'scripts/render.mjs'),['--input',fixtures.burger,'--output',path.join(work,'animation'),'--product','Burger'],work);
  const report=JSON.parse(run.stdout);assert.equal(report.motion,'vertical');assert.equal(report.trigger,'scroll');assert.ok((await stat(path.join(work,'animation/render.zip'))).isFile());
  console.log('PASS fresh npx installation and Node build from the installed, self-contained skill.');
} finally {await rm(work,{recursive:true,force:true});}
