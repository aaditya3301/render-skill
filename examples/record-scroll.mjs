/** Capture a GIF from native scrolling of real engine output. */
import {chromium} from 'playwright';
import sharp from 'sharp';
import gifenc from 'gifenc';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromeOptions} from '../tests/helpers.mjs';
const {GIFEncoder,quantize,applyPalette}=gifenc;
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>{if(v.startsWith('--'))a.push([v.slice(2),all[i+1]]);return a;},[]));
if(!args.html||!args.output)throw new Error('Use --html GENERATED-INDEX --output ANIMATION.gif');
const browser=await chromium.launch(chromeOptions());
try {
  const page=await browser.newPage({viewport:{width:960,height:760}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(args.html)).href);
  await page.waitForFunction(()=>{const el=document.querySelector('exploded-view');return el?.cssReady&&[...el.root.querySelectorAll('img.face')].every(im=>im.complete&&im.naturalWidth);});
  const view=page.locator('exploded-view');assert.ok(await view.evaluate(el=>el.trigger==='scroll'));
  const progress=[...Array(8).fill(0),...Array.from({length:34},(_,i)=>.55*(i+1)/34),...Array(10).fill(.55),...Array.from({length:34},(_,i)=>.55+.45*(i+1)/34),...Array(10).fill(1)];
  const gif=GIFEncoder();
  for(const p of progress) {
    await view.evaluate((el,p)=>{const top=el.getBoundingClientRect().top+scrollY;scrollTo(0,top+p*(el.offsetHeight-innerHeight));},p);
    await page.waitForTimeout(45);
    const png=await view.locator('.card').screenshot(),{data,info}=await sharp(png).resize({width:720,height:560,fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const palette=quantize(data,256),index=applyPalette(data,palette);
    gif.writeFrame(index,info.width,info.height,{palette,delay:80,repeat:0});
  }
  await page.waitForFunction(()=>document.querySelector('exploded-view').layers.every(l=>l.x===0));assert.deepEqual(errors,[]);
  gif.finish();await mkdir(path.dirname(path.resolve(args.output)),{recursive:true});await writeFile(args.output,gif.bytes());console.log(`Recorded ${progress.length} real engine frames: ${path.resolve(args.output)}`);
} finally {await browser.close();}
