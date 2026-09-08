const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['index.html', 'styles.css', 'home-runtime.js', 'favicon.svg', 'og.svg',
  'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'apple-touch-icon.png', 'CNAME']);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((request, response) => {
  let relative;
  try { relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, ''); }
  catch { response.writeHead(400).end(); return; }
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const parts = relative.split('/');
  if (!['GET', 'HEAD'].includes(request.method) || parts.some(part => part.startsWith('.')) ||
      !(allowed.has(relative) || ['arcade', 'assets'].includes(parts[0]))) { response.writeHead(404).end(); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
  fs.realpath(file, (error, real) => {
    if (error || real !== file) { response.writeHead(404).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  });
});
server.listen(Number(process.env.PORT || 8080), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
