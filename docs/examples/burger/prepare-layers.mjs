/** Prepare the licensed source cutouts on the original shared canvas. */
import sharp from 'sharp';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),output=path.resolve(process.argv[2]||path.join(here,'../../../output/burger-layers'));
await mkdir(output,{recursive:true});
const parts=[['bun_top','01-top-bun',-100],['sauce','02-sauce',-50],['tomato','03-tomato',-15],['lettuce','04-lettuce',22],['burger','05-patty',65],['bun_bottom','06-bottom-bun',115]];
for(const [source,name,y]of parts) {
  const original=await readFile(path.join(here,'source',source+'.png')),meta=await sharp(original).metadata();
  const width=Math.round(meta.width*3.2),height=Math.round(meta.height*3.2),left=Math.round((1800-width)/2),top=Math.round(750+y*3.2-height/2);
  const resized=await sharp(original).resize(width,height).png().toBuffer();
  await sharp({create:{width:1800,height:1500,channels:4,background:'#00000000'}}).composite([{input:resized,left,top}]).png().toFile(path.join(output,name+'.png'));
}
await copyFile(path.join(here,'ARTWORK-LICENSE'),path.join(output,'LICENSE'));console.log(output);
