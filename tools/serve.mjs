#!/usr/bin/env node
/**
 * Local preview server, no caching:   node tools/serve.mjs 8770
 *   http://localhost:8770/   the playground (demo/playground.html)
 * Serves the repo folder only (node_modules included: the demo loads three and crashcat from there).
 */
import http from 'node:http';
import { statSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2]) || 8770;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.hdr': 'application/octet-stream' };

/** dev tools save a screenshot: POST /__shot?name=<a-z0-9_-> with a PNG body → _local/shots/<name>.png
 *  (only from this machine, only that folder, only PNGs up to 30 MB) */
function shot(req, res) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
  if (!local || !/^[\w-]{1,80}$/.test(name)) { res.writeHead(403).end('forbidden'); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 30e6) req.destroy(); else chunks.push(c); });
  req.on('end', () => {
    const png = Buffer.concat(chunks);
    if (png.subarray(1, 4).toString() !== 'PNG') { res.writeHead(400).end('not a png'); return; }
    const dir = join(ROOT, '_local', 'shots');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.png`), png);
    res.writeHead(200).end(`_local/shots/${name}.png`);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/__shot')) { shot(req, res); return; }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') { res.writeHead(302, { location: '/demo/playground.html' }).end(); return; }
  const file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end('forbidden'); return; }
  /* never serve hidden files or folders (.env, .git, .claude) or the local-only folder */
  const rel = file.slice(ROOT.length).split(sep);
  if (rel.some((seg) => seg.startsWith('.')) || rel[1] === '_local') { res.writeHead(403).end('forbidden'); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `port ${PORT} is busy (another server running?)` : e.message);
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/`));
