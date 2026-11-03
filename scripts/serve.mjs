import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function serve(root, port = 0) {
  root = path.resolve(root);
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif'};
  const server=http.createServer(async (req,res)=>{
    try {
      const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
      if (target!==root && !target.startsWith(root+path.sep)) { res.writeHead(403).end(); return; }
      const file=(await stat(target)).isDirectory()?path.join(target,'index.html'):target;
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))})));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {url}=await serve(process.argv[2]||'.',Number(process.argv[3]||8765));console.log(url);
}
