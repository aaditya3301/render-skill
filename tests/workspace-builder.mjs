/** Integration checks for the surrounding builder, original demos, and real artwork when present. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,readdir,mkdir,writeFile,stat,mkdtemp,rm,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {serve} from '../scripts/serve.mjs';
import {build} from '../skills/render/lib/node.mjs';
import {ROOT,chromeOptions,unzip,extract} from './helpers.mjs';
const workspace=path.dirname(ROOT),work=await mkdtemp(path.join(os.tmpdir(),'render-builder-js-'));
if(!(await stat(path.join(workspace,'builder/index.html')).catch(()=>null))) { console.log('Workspace builder is not present in this standalone checkout.');process.exit(0); }
let server,browser;
try {
  server=await serve(workspace);browser=await chromium.launch(chromeOptions());
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url+'/builder/');
  await page.locator('#sampleBurger').click();
  await page.waitForFunction(()=>document.querySelector('#snippet').value.includes('"motion":"vertical"'));
  const frame=page.frameLocator('#preview');await frame.locator('exploded-view').waitFor();
  await frame.locator('exploded-view').evaluate(async el=>{while(!el.cssReady||!el.layers?.length)await new Promise(r=>setTimeout(r,20));});
  await frame.locator('.stage').hover();await page.waitForTimeout(250);
  assert.ok(await frame.locator('exploded-view').evaluate(el=>el.layers.every(l=>l.x===0)));
  // Use a real wheel inside the iframe: this must scroll the story, not activate hover.
  await page.mouse.wheel(0,900);await page.waitForTimeout(500);
  assert.ok(await frame.locator('exploded-view').evaluate(el=>el.layers.some(l=>l.x>.1)));
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#pack').click()]);
  const archivePath=path.join(work,'builder.zip');await download.saveAs(archivePath);
  const archive=unzip(await readFile(archivePath)),scene=JSON.parse(new TextDecoder().decode(archive.get('scene.json')));
  const nodeReport=await build({input:path.join(workspace,'engine/layers-burger'),output:path.join(work,'node-burger'),product:'Burger'});
  const nodeScene=JSON.parse(await readFile(path.join(work,'node-burger/scene.json')));
  assert.deepEqual(scene.axis,nodeScene.axis);assert.equal(scene.motion,nodeScene.motion);assert.equal(scene.gap,nodeScene.gap);
  for(const [i,part]of scene.layers.entries()) {
    assert.deepEqual(archive.get('layers/'+part.file),new Uint8Array(await readFile(path.join(workspace,'engine/layers-burger',(await readdir(path.join(workspace,'engine/layers-burger'))).filter(n=>/^\d.*\.png$/.test(n)).sort()[i]))));
  }
  for(const name of ['explode.css','LICENSE','NOTICE','manifest.json','index.html'])assert.ok(archive.has(name));
  await extract(archivePath,path.join(work,'builder-unpacked'));
  await page.goto(pathToFileURL(path.join(work,'builder-unpacked/index.html')).href);
  await page.waitForFunction(()=>document.querySelector('exploded-view')?.cssReady);
  assert.equal(await page.locator('exploded-view').evaluate(el=>el.trigger),'scroll');
  console.log('PASS builder upload analysis, real wheel, shared settings, unchanged PNGs, valid ZIP, and offline export.');
  await page.goto(server.url+'/builder/');
  // Invalid uploads must disable export and surface the actual validation issue.
  const invalid=path.join(work,'opaque.png');
  const sharp=(await import('sharp')).default;
  await sharp({create:{width:600,height:600,channels:4,background:'#ff0000'}}).png().toFile(invalid);
  await page.locator('#file').setInputFiles([invalid]);await page.waitForFunction(()=>document.querySelector('#checks').textContent.includes('transparent'));
  assert.ok(await page.locator('#pack').isDisabled());
  assert.deepEqual(errors,[]);await page.close();
  const out=path.join(workspace,'deliverables/javascript-render');await mkdir(out,{recursive:true});
  for(const [kind,input,product]of [
    ['burger',path.join(workspace,'engine/layers-burger'),'Burger'],
    ['iphone',path.join(workspace,'deliverables/iphone-18-pro-burgundy-layers/layers'),'iPhone 18 Pro Burgundy']
  ]) {
    if(!(await stat(input).catch(()=>null)))continue;
    // Unique versioned outputs leave previous user artifacts intact.
    const destination=path.join(out,`${kind}-${Date.now()}`);
    const report=await build({input,output:destination,product});
    for(const [width,reduced]of [[1440,false],[390,false],[1440,true]]) {
      const check=await browser.newPage({viewport:{width,height:1000},reducedMotion:reduced?'reduce':'no-preference'});
      await check.goto(pathToFileURL(path.join(destination,'index.html')).href);
      await check.waitForFunction(()=>{const e=document.querySelector('exploded-view');return e?.cssReady&&[...e.root.querySelectorAll('img.face')].every(im=>im.complete&&im.naturalWidth);});
      const el=check.locator('exploded-view');
      const scroll=(el,p)=>{const top=el.getBoundingClientRect().top+scrollY;scrollTo(0,top+p*(el.offsetHeight-innerHeight));};
      await el.evaluate(scroll,0);await check.waitForFunction(()=>document.querySelector('exploded-view').layers.every(l=>l.x===0));
      await el.locator('.card').screenshot({path:path.join(destination,`${width}-${reduced?'reduced-':''}start.png`)});
      await el.evaluate(scroll,.55);await check.waitForFunction(()=>document.querySelector('exploded-view').layers.every(l=>l.x>.999));
      await el.locator('.card').screenshot({path:path.join(destination,`${width}-${reduced?'reduced-':''}open.png`)});
      await el.evaluate(scroll,1);await check.waitForFunction(()=>{const e=document.querySelector('exploded-view');return e.layers.every(l=>l.x===0&&l.el.style.transform==='')&&e.rig.style.transform==='';});
      await el.locator('.card').screenshot({path:path.join(destination,`${width}-${reduced?'reduced-':''}end.png`)});
      await check.close();
    }
    console.log(`PASS real ${kind} desktop/mobile/reduced-motion endpoints: ${destination}`);
  }
  // Original direct embeds use the same CSS sidecar, including legacy input modes.
  const demo=await browser.newPage({viewport:{width:1440,height:900}});await demo.goto(server.url+'/engine/');
  await demo.waitForFunction(()=>[...document.querySelectorAll('exploded-view')].every(e=>e.cssReady&&e.layers?.length));
  assert.ok(await demo.locator('exploded-view').count()>=4);await demo.close();
  console.log('PASS original direct engine demos load the extracted CSS.');
} finally {await browser?.close();await server?.close();await rm(work,{recursive:true,force:true});}
