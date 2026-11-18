// Tiny static server for local development: serves the repo root so that
// /v2/ can reach the shared icons. Usage: npm run serve  ->  http://localhost:8080/v2/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

export function createAppServer({ root = defaultRoot } = {}) {
  return createServer(async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    let file = resolve(join(root, normalize(path)));
    // Must stay inside the served folder (the trailing separator stops "/root-evil" matching "/root").
    if (file !== root && !file.startsWith(root + sep)) return send(res, 403, 'Forbidden');
    if (path.endsWith('/')) file = join(file, 'index.html');

    try {
      // Read first, then write headers once: a missing file must never leave a half-sent response.
      const body = await readFile(file);
      return send(res, 200, body, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch {
      return send(res, 404, 'Not found');
    }
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.env.PORT) || 8080;
  createAppServer().listen(port, () => console.log(`http://localhost:${port}/v2/`));
}
