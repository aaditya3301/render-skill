import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, mkdir, readdir, cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {makeLayers} from '../examples/make-layers.mjs';
import {build} from '../skills/render/lib/node.mjs';
import {serve} from '../scripts/serve.mjs';
import {chromeOptions, extract, ROOT} from './helpers.mjs';

export const SCROLL=(el,p)=>{const top=el.getBoundingClientRect().top+scrollY;scrollTo(0,top+p*(el.offsetHeight-innerHeight));};
export async function inspect(page,url,motion) {
  const errors=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',r=>failures.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(()=>{const el=document.querySelector('exploded-view');return el?.cssReady&&el.layers?.length===6&&[...el.root.querySelectorAll('img.face')].every(im=>im.complete&&im.naturalWidth);});
  const el=page.locator('exploded-view');await el.evaluate(SCROLL,0);
  await page.waitForFunction(()=>document.querySelector('exploded-view').layers.every(l=>l.x===0));
  await el.locator('.stage').hover();await page.waitForTimeout(250);
  assert.ok(await el.evaluate(el=>el.trigger==='scroll'&&el.layers.every(l=>l.x===0)&&el.rig.style.transform===''));
  await el.evaluate(SCROLL,.55);
  await page.waitForFunction(()=>document.querySelector('exploded-view').layers.every(l=>l.x>.999));
  assert.ok(await el.evaluate((el,motion)=>el.motion===motion&&(motion==='vertical'?el.cam.t===0&&el.layers.every(l=>l.off[0]===0):el.cam.t>.999),motion));
  await el.locator('.stage').focus();await page.keyboard.press('ArrowRight');assert.equal(await el.evaluate(el=>el.selected),0);
  await el.evaluate(SCROLL,1);
  await page.waitForFunction(()=>{const el=document.querySelector('exploded-view');return el.layers.every(l=>l.x===0&&l.el.style.transform==='')&&el.rig.style.transform==='';});
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  if(url.startsWith('file:'))assert.ok(await page.evaluate(()=>performance.getEntriesByType('resource').every(r=>!r.name.startsWith('http'))));
  console.log(`PASS ${motion}, ${page.viewportSize().width}px, ${url.startsWith('file:')?'offline':'hosted'}`);
}

const work=await mkdtemp(path.join(os.tmpdir(),'render-browser-js-'));
let host,browser;
try {
  const fixtures=await makeLayers(path.join(work,'inputs'));
  for(const kind of ['burger','phone']) {
    await build({input:fixtures[kind],output:path.join(work,kind),product:kind});
    await extract(path.join(work,kind,'render.zip'),path.join(work,kind+'-unpacked'));
  }
  const snippet=await readFile(path.join(work,'burger/embed.html'),'utf8');
  await writeFile(path.join(work,'burger/embedded.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+snippet);
  host=await serve(work);browser=await chromium.launch(chromeOptions());
  await cp(path.join(ROOT,'skills/render/lib'),path.join(work,'lib'),{recursive:true});
  await writeFile(path.join(work,'analysis.html'),'<!doctype html><title>Decoder parity</title>');
  const analysis=await browser.newPage();await analysis.goto(host.url+'/analysis.html');
  for(const kind of ['burger','phone']) {
    const expected=JSON.parse(await readFile(path.join(work,kind,'manifest.json'))).layers;
    const actual=await analysis.evaluate(async kind=>{
      const {analyzeBlob}=await import('./lib/browser.mjs'),names=kind==='burger'?['01-top-bun.png','02-sauce.png','03-tomato.png','04-lettuce.png','05-patty.png','06-bottom-bun.png']:['01-cover-glass.png','02-display.png','03-frame.png','04-board.png','05-battery.png','06-back.png'];
      const result=[];
      for(const name of names){const l=await analyzeBlob(await(await fetch('./inputs/'+kind+'/'+name)).blob(),name);result.push(Object.fromEntries(['name','label','bounds','center','anchor','sha256'].map(k=>[k,l[k]])));l.bmp.close();}
      return result;
    },kind);
    assert.deepEqual(actual,expected);
  }
  await analysis.close();console.log('PASS browser/Node image analysis parity, including alpha holes and transparent glass.');
  for(const [kind,width,reduced] of [['phone',1440,false],['burger',1440,false],['burger',390,false],['phone',390,false],['phone',1440,true]]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'});
    await inspect(page,pathToFileURL(path.join(work,kind+'-unpacked/index.html')).href,kind==='burger'?'vertical':'sideways');await page.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:900}});await inspect(page,host.url+'/burger/embedded.html','vertical');await page.close();
} finally {await browser?.close();await host?.close();await rm(work,{recursive:true,force:true});}
