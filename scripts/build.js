const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const JS_FILES_TO_CHECK = [
  'server.js',
  'lib/auth.js',
  'lib/clinic-store.js',
  'assets/pms/admin-setup.js',
  'api/index.js',
  'scripts/build.js',
];

const STATIC_ENTRIES = [
  'index.html',
  'admin.html',
  '404.html',
  '.nojekyll',
  '_next',
  'assets',
];

for (const rel of JS_FILES_TO_CHECK) {
  const fullPath = path.join(ROOT_DIR, rel);
  execFileSync(process.execPath, ['-c', fullPath], { stdio: 'inherit' });
}

fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

for (const entry of STATIC_ENTRIES) {
  const src = path.join(ROOT_DIR, entry);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(PUBLIC_DIR, entry);
  fs.cpSync(src, dest, { recursive: true });
}

console.log('Build complete: static site prepared in public/ and server syntax verified.');
