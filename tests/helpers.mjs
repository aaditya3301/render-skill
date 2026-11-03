import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32} from '../skills/render/lib/generator.mjs';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const chromeOptions=()=>process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.platform==='win32'&&existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{};
export function unzip(data) {
  data=new Uint8Array(data);const view=new DataView(data.buffer,data.byteOffset,data.byteLength),files=new Map();let offset=0;
  while(offset+30<=data.length&&view.getUint32(offset,true)===0x04034b50) {
    if(view.getUint16(offset+8,true)!==0)throw new Error('Expected stored ZIP entry');
    const size=view.getUint32(offset+18,true),n=view.getUint16(offset+26,true),e=view.getUint16(offset+28,true);
    const name=new TextDecoder().decode(data.subarray(offset+30,offset+30+n)),start=offset+30+n+e,content=data.slice(start,start+size);
    if(name.startsWith('/')||name.split('/').includes('..'))throw new Error('Unsafe archive path');
    if(crc32(content)!==view.getUint32(offset+14,true))throw new Error('ZIP CRC mismatch');
    files.set(name,content);offset=start+size;
  }
  if(view.getUint32(offset,true)!==0x02014b50||!files.size)throw new Error('Missing ZIP directory');
  return files;
}
export async function extract(zip,destination) {
  for(const [name,data] of unzip(await readFile(zip))) {const file=path.join(destination,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);}
}
