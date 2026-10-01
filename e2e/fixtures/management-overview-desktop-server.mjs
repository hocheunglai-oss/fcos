import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

await build({ configFile: 'vite.management-overview-desktop.config.js' });
const root = path.resolve('outputs/management-overview-desktop-fixture');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = path.resolve(root, `.${pathname === '/' ? '/e2e/fixtures/management-overview-desktop.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(4199, '127.0.0.1', () => console.log('Management Overview desktop fixture ready on 127.0.0.1:4199'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
