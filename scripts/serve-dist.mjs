// Tiny static server that applies dist/_headers, for CI browser checks only.
import http from 'node:http'; import { readFileSync, existsSync, statSync } from 'node:fs'; import { join, extname } from 'node:path';
const root = process.argv[2];
const hdr = Object.fromEntries(readFileSync(join(root, '_headers'), 'utf8').split('\n/*.html')[0].split('\n').slice(1).filter(Boolean).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };
http.createServer((q, s) => { let p = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { ...hdr, 'content-type': types[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p)); }).listen(Number(process.argv[3] || 4599));
