import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {makeLayers} from '../examples/make-layers.mjs';
import {build} from '../skills/render/lib/node.mjs';
import {chromeOptions} from './helpers.mjs';
const TRACE=({mode, fps}) => {
  const source = document.querySelector(`#${mode}-hover`);
  const el = document.createElement('exploded-view');
  el.setAttribute('trigger', 'hover'); el.setAttribute('mode', mode);
  el.setAttribute('scene-json', JSON.stringify(source.scene));
  document.body.append(el);
  // Use the production tick/render path without observers or wall-clock callbacks.
  el.disconnectedCallback(); el.visible = false; el.touring = false;
  let now = 1000; el.last = now; el.clock = 0;
  const snapshot = () => [...el.layers.map(l => l.x), el.cam.t, el.cam.sweep];
  const frames = [], samples = [];
  const advance = seconds => {
    const end = now + seconds * 1000;
    while (now < end - 1e-7) {
      now = Math.min(end, now + 1000 / fps); el.tick(now);
      frames.push(snapshot());
    }
    samples.push(snapshot());
  };
  const initial = snapshot();
  el.setApart(true);
  advance(1 / 60); const onset = el.cam.t;
  advance(.5 - 1 / 60); advance(.5); advance(1.2);
  const opened = snapshot(), openFrames = frames.splice(0);
  el.setApart(false); advance(.5); advance(.5); advance(1.2);
  const closed = snapshot(), closeFrames = frames.splice(0);
  const rest = el.layers.every(l => l.el.style.transform === '') && el.rig.style.transform === '';
  el.setApart(true); advance(.24);
  const before = el.layers.map(l => [l.x, l.v]);
  el.setApart(false);
  const continuous = el.layers.every((l, i) => l.x === before[i][0] && l.v === before[i][1]);
  advance(.18); el.setApart(true); advance(.11); el.setApart(false); advance(2.2);
  const reverseFrames = frames.splice(0);
  // Scrub up, reverse down, then return exactly to the assembled artwork.
  el.hover = false;
  let progress = 0; el.progress = () => progress;
  for (let i = 0; i < fps; i++) { progress = .55 * (i + 1) / fps; advance(1 / fps); }
  for (let i = 0; i < fps; i++) { progress = .55 * (1 - (i + 1) / fps); advance(1 / fps); }
  progress = 0; advance(2.2);
  const scrubRest = el.layers.every(l => l.x === 0 && l.v === 0 && l.el.style.transform === '') && el.rig.style.transform === '';
  const bounded = [...openFrames, ...closeFrames, ...reverseFrames, ...frames]
    .every(row => row.every(x => Number.isFinite(x) && x >= -1e-8 && x <= 1 + 1e-8));
  el.remove();
  return {initial, samples: samples.slice(0, 7), opened, closed, rest, onset, continuous, bounded, scrubRest,
    openMonotonic: openFrames.every((row, i) => !i || row.every((x, j) => x >= openFrames[i-1][j] - 1e-8)),
    closeMonotonic: closeFrames.every((row, i) => !i || row.every((x, j) => x <= closeFrames[i-1][j] + 1e-8))};
};
const work=await mkdtemp(path.join(os.tmpdir(),'render-motion-js-'));
const browser=await chromium.launch(chromeOptions());
try {
 const fixtures=await makeLayers(path.join(work,'inputs'));
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
 for(const [mode,kind]of [['tilt','phone'],['iso','burger']]) {
  const output=path.join(work,kind);await build({input:fixtures[kind],output,product:kind});
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  await page.waitForFunction(()=>document.querySelector('exploded-view')?.cssReady);
  await page.locator('exploded-view').evaluate((el,id)=>{el.id=id;},mode+'-hover');
  const traces={};
  for(const fps of [24,60,120]) {
   const t=traces[fps]=await page.evaluate(TRACE,{mode,fps});
   assert.ok(t.openMonotonic&&t.closeMonotonic&&t.bounded,mode+' '+fps+' monotonic');
   assert.ok(Math.min(...t.opened.slice(0,6))===1&&Math.max(...t.closed)===0&&t.rest&&t.continuous&&t.scrubRest,mode+' '+fps+' settles and reverses');
  }
  let difference=0;
  for(const fps of [24,60])for(let i=0;i<traces[120].samples.length;i++)for(let j=0;j<traces[120].samples[i].length;j++)difference=Math.max(difference,Math.abs(traces[fps].samples[i][j]-traces[120].samples[i][j]));
  assert.ok(difference<1e-7,'refresh rate invariance');
  if(mode==='tilt')assert.ok(traces[60].onset>0&&traces[60].onset<.02);
  console.log('PASS '+mode+': 24/60/120 Hz, no bounce, velocity continuity, exact reassembly (max difference '+difference+')');
 }
} finally {await browser.close();await rm(work,{recursive:true,force:true});}
