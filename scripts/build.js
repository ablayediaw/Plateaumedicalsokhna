const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  resolveSiteUrlFromEnv,
  buildRobotsTxt,
  buildSitemapXml,
  applyRuntimeSeoToHtml,
} = require('../lib/seo');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const JS_FILES_TO_CHECK = [
  'server.js',
  'lib/auth.js',
  'lib/clinic-store.js',
  'lib/seo.js',
  'assets/pms/admin-setup.js',
  'api/index.js',
  'scripts/build.js',
];

const STATIC_ENTRIES = [
  'index.html',
  'admin.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
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

// Stamp live deployment URL & optional Google verification tag into static public/ SEO files
const buildSiteUrl = resolveSiteUrlFromEnv(process.env);
const builtIndexPath = path.join(PUBLIC_DIR, 'index.html');
if (fs.existsSync(builtIndexPath)) {
  const rawHtml = fs.readFileSync(builtIndexPath, 'utf8');
  const stampedHtml = applyRuntimeSeoToHtml(rawHtml, buildSiteUrl, {
    googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION,
  });
  fs.writeFileSync(builtIndexPath, stampedHtml, 'utf8');
}
if (buildSiteUrl) {
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), buildRobotsTxt(buildSiteUrl), 'utf8');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), buildSitemapXml(buildSiteUrl), 'utf8');
}

console.log('Build complete: static site prepared in public/ and server syntax verified.');
