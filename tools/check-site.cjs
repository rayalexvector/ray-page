const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
let references = 0;
for (const file of new Set(files)) {
  if (file.startsWith('.local-secrets/') || file.includes('/node_modules/')) throw new Error('Private/generated file tracked: ' + file);
  if (!fs.existsSync(path.join(root, file))) continue;
  if (/\.(?:js|cjs)$/.test(file) && !file.includes('/vendor/')) {
    const source = fs.readFileSync(file, 'utf8');
    if (/^\s*(?:import |export )/m.test(source)) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: source });
    else new vm.Script(source, { filename: file });
  }
  if (!file.endsWith('.html')) continue;
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
    const value = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
    const clean = decodeURIComponent(value.split(/[?#]/)[0]);
    const target = clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(path.join(root, file)), clean);
    if (!target.startsWith(root + '/') || !fs.existsSync(target)) throw new Error(`${file}: missing resource ${value}`);
    references++;
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|application\/ld\+json|type=["']module/i.test(match[1])) continue;
    new vm.Script(match[2], { filename: file + ':inline' });
  }
}
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{32,}\b/];
for (const file of new Set(files)) {
  if (!/\.(?:js|cjs|json|html|css|md|yml|yaml|py|toml|env)$/.test(file) || !fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (patterns.some(pattern => pattern.test(text))) throw new Error('Potential secret in ' + file);
}
console.log(`Syntax, ${references} local resource references, and secret-pattern checks passed`);
