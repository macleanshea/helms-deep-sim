// Zero-dependency static file server for local play:  node server.js [port]
// Listens on localhost only (set HOST=0.0.0.0 to share it on your network) and serves only the
// site itself: hidden files and folders such as .git are never handed out.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = +(process.argv[2] || process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const headers = { 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function send(res, code, type, body) {
  res.writeHead(code, { ...headers, 'content-type': type });
  res.end(body);
}

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || file.slice(root.length).split(sep).some((part) => part.startsWith('.'))) throw new Error('forbidden');
    const body = await readFile(file);
    send(res, 200, types[extname(file)] || 'application/octet-stream', req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, 'text/plain', 'Not found');
  }
}).listen(port, host, () => console.log(`Helm's Deep simulator → http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
