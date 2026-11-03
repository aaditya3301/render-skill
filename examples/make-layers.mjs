/** Original schematic fixtures, rendered to transparent PNG by the Node image decoder. */
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function makeLayers(destination) {
  const directories = Object.fromEntries(['phone','burger'].map(k => [k,path.resolve(destination,k)]));
  for (const folder of Object.values(directories)) await mkdir(folder,{recursive:true});
  const phone = [['cover-glass','#c0daf0'],['display','#486df0'],['frame','#94a0b0'],['board','#216d4e'],['battery','#30313a'],['back','#171b25']];
  for (const [i,[name,color]] of phone.entries()) {
    const shape = name === 'frame' ? '<path fill-rule="evenodd" d="M205 75H395Q440 75 440 120V680Q440 725 395 725H205Q160 725 160 680V120Q160 75 205 75ZM210 100Q185 100 185 125V675Q185 700 210 700H390Q415 700 415 675V125Q415 100 390 100Z"/>' : `<rect x="160" y="75" width="280" height="650" rx="45"/>`;
    const details = name === 'board' ? [140,240,340,440,540,640].map(y=>`<rect x="210" y="${y}" width="60" height="50" fill="#173329" stroke="#d9b35a" stroke-width="3"/>`).join('') : '';
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><g fill="${color}" opacity="${name==='cover-glass'?.22:1}">${shape}${details}</g></svg>`)).png().toFile(path.join(directories.phone,`${String(i+1).padStart(2,'0')}-${name}.png`));
  }
  const food = [['top-bun',140,95,320,110,'#df9b40'],['sauce',145,190,310,35,'#e6b84b'],['tomato',135,225,330,50,'#e44d36'],['lettuce',125,270,350,45,'#69a941'],['patty',135,310,330,65,'#64412c'],['bottom-bun',140,370,320,60,'#d59442']];
  for (const [i,[name,x,y,w,h,color]] of food.entries()) {
    const shape = name === 'top-bun' ? '<path d="M140 205A160 110 0 0 1 460 205Z"/>' : name === 'lettuce' ? '<path d="M125 285L155 270 190 287 225 271 265 287 305 270 345 286 385 272 430 287 475 280 455 315 140 313Z"/>' : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/>`;
    const seeds = name === 'top-bun' ? [[200,160],[260,130],[320,150],[370,175],[295,180]].map(([sx,sy])=>`<ellipse cx="${sx}" cy="${sy}" rx="5" ry="2" fill="#fff1ca"/>`).join('') : '';
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><g fill="${color}">${shape}${seeds}</g></svg>`)).png().toFile(path.join(directories.burger,`${String(i+1).padStart(2,'0')}-${name}.png`));
  }
  return directories;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output=process.argv[process.argv.indexOf('--output')+1];
  if (!process.argv.includes('--output') || !output) throw new Error('Use --output DIRECTORY');
  console.log(JSON.stringify(await makeLayers(output),null,2));
}
