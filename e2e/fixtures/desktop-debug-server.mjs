import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

await build({ configFile: 'vite.desktop-debug.config.js' });
const root = path.resolve('outputs/desktop-debug-fixture');
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = path.resolve(root, `.${name === '/' ? '/e2e/fixtures/desktop-debug.html' : name}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(4198, '127.0.0.1', () => console.log('Synthetic desktop fixture ready on 127.0.0.1:4198'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
