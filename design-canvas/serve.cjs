// Read-only, loopback-only static server. No uploads, telemetry or remote service calls.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const base=__dirname,port=Number(process.env.AFT_DESIGN_PORT||4178);
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/methodology','methodology.html'],['/methodology.html','methodology.html'],['/studio.css','studio.css'],['/screens.css','screens.css'],['/screens.js','screens.js'],['/review-state.js','review-state.js'],['/studio.js','studio.js']]);
allowed.set('/evidence/browser-audit.md','../docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.md':'text/markdown; charset=utf-8'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end('Read-only design server');}
  let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400);return res.end('Bad URL');}
  const file=allowed.get(url.pathname);if(!file){res.writeHead(404);return res.end('Not found');}
  fs.readFile(path.join(base,file),(error,data)=>{if(error){res.writeHead(500);return res.end('Design asset unavailable');}res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:data);});
});
server.on('error',e=>{console.error('Design server failed:',e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`AI Footprint Tracker design canvas: http://127.0.0.1:${port}`));
