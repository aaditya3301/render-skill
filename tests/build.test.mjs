import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {build} from '../skills/render/lib/node.mjs';
import {createScene, zipStore} from '../skills/render/lib/generator.mjs';
import {makeLayers} from '../examples/make-layers.mjs';
import {ROOT, unzip} from './helpers.mjs';

async function setup(t) {
  const work=await mkdtemp(path.join(os.tmpdir(),'render-js-'));
  t.after(()=>rm(work,{recursive:true,force:true}));
  const fixtures=await makeLayers(path.join(work,'inputs'));
  const run=(options={})=>build({input:fixtures.burger,output:path.join(work,'animation'),...options});
  return {work,fixtures,run};
}

test('portable burger package preserves original bytes, anchors, CSS, and a valid ZIP',async t=>{
  const {run,fixtures,work}=await setup(t), report=await run();
  assert.deepEqual([report.motion,report.mode,report.trigger],['vertical','iso','scroll']);
  const scene=JSON.parse(await readFile(path.join(work,'animation/scene.json')));
  assert.deepEqual(scene.axis,[0,-1]);
  const names=(await readdir(fixtures.burger)).sort();
  for(const [i,name]of names.entries()) {
    const data=await readFile(path.join(fixtures.burger,name));
    assert.deepEqual(data,await readFile(path.join(work,'animation/layers',scene.layers[i].file)));
    const {data:pixels,info}=await sharp(data).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const [x,y]=scene.layers[i].anchor;assert.ok(pixels[(y*info.width+x)*4+3]>24);
  }
  const archive=unzip(await readFile(path.join(work,'animation/render.zip')));
  for(const name of ['LICENSE','NOTICE','explode.css','explode.js','index.html','embed.html','scene.json'])assert.ok(archive.has(name));
  assert.ok(!archive.has('render.zip'));
  const html=new TextDecoder().decode(archive.get('index.html'));
  assert.equal((html.match(/data:image\/png;base64,/g)||[]).length,6);
  assert.ok(html.includes('data-render-css="data:text/css;base64,'));
  assert.ok(html.indexOf('<script data-render-css=')>html.indexOf('</exploded-view>'));
});

test('phone automatically chooses sideways tilt',async t=>{
  const {run,fixtures}=await setup(t),report=await run({input:fixtures.phone,product:'Phone'});
  assert.deepEqual([report.motion,report.mode],['sideways','tilt']);
});

test('generic ingredient names use geometry; ambiguous parts report uncertainty',async t=>{
  const {run,fixtures,work}=await setup(t);
  for(const kind of ['burger','phone']) {
    const folder=path.join(work,kind);await mkdir(folder);
    for(const [i,name]of (await readdir(fixtures[kind])).sort().entries())await writeFile(path.join(folder,`${i+1}-part.png`),await readFile(path.join(fixtures[kind],name)));
    const report=await run({input:folder,output:folder+'-result'});
    assert.equal(report.motion,kind==='burger'?'vertical':'sideways');
    if(kind==='phone')assert.ok(report.warnings.some(w=>w.includes('uncertain')));
  }
});

test('explicit attachments keep order and custom axis overrides inference',async t=>{
  const {run,fixtures,work}=await setup(t);
  const images=(await readdir(fixtures.burger)).sort().reverse().map(n=>path.join(fixtures.burger,n));
  const report=await run({input:undefined,images,motion:'sideways',inputMode:'iso',axis:[1,0]});
  assert.deepEqual(report.layers.map(l=>l.name),images.map(n=>path.basename(n)));
  assert.deepEqual(JSON.parse(await readFile(path.join(work,'animation/scene.json'))).axis,[1,0]);
});

test('existing output is never changed',async t=>{
  const {run,work}=await setup(t);await mkdir(path.join(work,'animation'));await writeFile(path.join(work,'animation/user.txt'),'keep');
  await assert.rejects(run(),/already exists/);assert.equal(await readFile(path.join(work,'animation/user.txt'),'utf8'),'keep');
});

test('adjacent artwork licenses, extra notices, and credits survive export',async t=>{
  const {run,fixtures,work}=await setup(t);
  await writeFile(path.join(fixtures.burger,'LICENSE'),'Original artwork license');
  const extra=path.join(work,'other-license.txt');await writeFile(extra,'Extra notice');
  const report=await run({artworkLicense:[extra],artworkCredit:['Artwork by Example Author']});
  const archive=unzip(await readFile(path.join(work,'animation/render.zip')));
  const contents=report.artwork_notices.map(n=>new TextDecoder().decode(archive.get(n)).trim());
  assert.ok(contents.includes('Original artwork license'));assert.ok(contents.includes('Extra notice'));assert.ok(contents.includes('Artwork by Example Author'));
});

test('opaque, empty, mismatched, and corrupt inputs fail before writing output',async t=>{
  const {run,fixtures,work}=await setup(t),first=path.join(fixtures.burger,'01-top-bun.png');
  const original=await readFile(first);
  const cases=[
    [await sharp({create:{width:600,height:600,channels:4,background:'#ff0000'}}).png().toBuffer(),/transparent/],
    [await sharp({create:{width:600,height:600,channels:4,background:'#00000000'}}).png().toBuffer(),/empty/],
    [await sharp(original).resize(500,600).png().toBuffer(),/canvases/],
    [Buffer.from('not a png'),/cannot read/]
  ];
  for(const [data,message]of cases){await writeFile(first,data);await assert.rejects(run(),message);assert.ok(!(await readdir(work)).includes('animation'));}
});

test('count, duplicate paths, and invalid settings fail safely',async t=>{
  const {run,fixtures}=await setup(t),images=(await readdir(fixtures.burger)).map(n=>path.join(fixtures.burger,n));
  await assert.rejects(run({input:undefined,images:images.slice(0,2)}),/4–8/);
  await assert.rejects(run({input:undefined,images:Array(6).fill(images[0])}),/more than once/);
  for(const options of [{gap:NaN},{gap:0},{motion:'sideways',inputMode:'iso',axis:[0,0]},{axis:[1,0]},{accent:'red'},{length:'90vh'},{labels:['Only one']}])await assert.rejects(run(options));
});

test('WebP bytes and untrusted text remain safe',async t=>{
  const {run,fixtures,work}=await setup(t),images=[];
  for(const name of (await readdir(fixtures.burger)).sort()) {
    const dest=path.join(work,name.replace('.png','.webp'));await sharp(path.join(fixtures.burger,name)).webp({lossless:true}).toFile(dest);images.push(dest);
  }
  const product='</script><script>window.INJECTED=1</script>';
  const report=await run({input:undefined,images,product});assert.equal(report.product,product);
  const html=await readFile(path.join(work,'animation/index.html'),'utf8');assert.ok(!html.includes(product));assert.ok(html.includes('\\u003c/script>'));assert.ok(html.includes('data:image/webp;base64,'));
});

test('natural directory order puts 2 before 10',async t=>{
  const {run,fixtures,work}=await setup(t),folder=path.join(work,'numbered');await mkdir(folder);
  const names=(await readdir(fixtures.phone)).sort();
  for(const [i,n]of [11,2,10,1,4,3].entries())await writeFile(path.join(folder,`${n}-part.png`),await readFile(path.join(fixtures.phone,names[i])));
  const report=await run({input:folder});assert.deepEqual(report.layers.map(l=>l.name),['1-part.png','2-part.png','3-part.png','4-part.png','10-part.png','11-part.png']);
});

test('CLI returns actionable JSON errors and exit code 2',()=>{
  for(const args of [[],['--wat'],['--input','missing','--output','nowhere'],['--input','missing','--output','nowhere','--labels']]){
    const result=spawnSync(process.execPath,[path.join(ROOT,'skills/render/scripts/render.mjs'),...args],{encoding:'utf8'});
    assert.equal(result.status,2);assert.ok(JSON.parse(result.stderr).error);
  }
});

test('browser-independent generator rejects unsafe ZIP paths',()=>{
  assert.throws(()=>zipStore([{name:'../outside',data:new Uint8Array()}]),/Unsafe/);
});
