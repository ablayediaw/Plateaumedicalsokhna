const fs = require('fs');
const path = require('path');
const express = require('express');
const { createAuthManager, isSameOriginMutation } = require('./lib/auth');
const { createClinicStore } = require('./lib/clinic-store');
const {
  resolveSiteUrlFromRequest,
  buildRobotsTxt,
  buildSitemapXml,
  applyRuntimeSeoToHtml,
} = require('./lib/seo');

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const BLOCKED_TOP_LEVEL = new Set([
  'server.js',
  'server.test.js',
  'package.json',
  'package-lock.json',
  'bun.lock',
  'vercel.json',
  'metadata.json',
  'node_modules',
  'workspace',
  'readme.md',
  'lib',
  'api',
  'scripts',
  'public',
]);

function isBlockedPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath || '/');
  } catch {
    return true;
  }

  const normalized = decoded.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  if (segments.some((seg) => seg === '..' || seg.startsWith('.'))) {
    return true;
  }

  const first = segments[0].toLowerCase();
  if (BLOCKED_TOP_LEVEL.has(first)) {
    return true;
  }

  if (first.endsWith('.test.js') || first.endsWith('.test.ts')) {
    return true;
  }

  return false;
}

function createApp(options = {}) {
  const rootDir = typeof options === 'string' ? options : options.rootDir || ROOT_DIR;
  const auth = options.auth || createAuthManager(options.authOptions);
  const store = options.store || createClinicStore(rootDir);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Restore original /api/* path when invoked via Vercel rewrite (/api?__path=... or /api/index.js?__path=...)
  app.use((req, _res, next) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      let rewrittenPath = parsed.searchParams.get('__path');
      if (
        rewrittenPath === null &&
        req.query &&
        typeof req.query.__path === 'string' &&
        (parsed.pathname === '/api' ||
          parsed.pathname === '/api/' ||
          parsed.pathname === '/api/index' ||
          parsed.pathname === '/api/index.js')
      ) {
        rewrittenPath = req.query.__path;
      }
      if (rewrittenPath !== null) {
        parsed.searchParams.delete('__path');
        const qs = parsed.searchParams.toString();
        const cleanPath = String(rewrittenPath).replace(/^\/+/, '');
        req.url = `/api/${cleanPath}${qs ? `?${qs}` : ''}`;
      }
    } catch {
      // Ignore malformed URLs and let Express handle them normally
    }
    return next();
  });

  const jsonParser = express.json({ limit: '100kb' });
  app.use((req, res, next) => {
    if (req.body !== undefined) {
      if (typeof req.body === 'string') {
        const trimmed = req.body.trim();
        if (trimmed && Buffer.byteLength(trimmed, 'utf8') <= 102400) {
          try {
            req.body = JSON.parse(trimmed);
          } catch {
            return res.status(400).json({ error: 'Corps JSON invalide.' });
          }
        } else {
          req.body = {};
        }
        return next();
      }
      if (Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf8').trim();
        if (str && req.body.length <= 102400) {
          try {
            req.body = JSON.parse(str);
          } catch {
            return res.status(400).json({ error: 'Corps JSON invalide.' });
          }
        } else {
          req.body = {};
        }
        return next();
      }
      if (typeof req.body === 'object' && req.body !== null) {
        return next();
      }
    }
    return jsonParser(req, res, next);
  });

  const notFoundPage = path.join(rootDir, '404.html');

  function sendNotFound(res) {
    if (fs.existsSync(notFoundPage)) {
      return res.status(404).sendFile(notFoundPage);
    }
    return res.status(404).send('Not Found');
  }

  function resolveClinicRequestUser(req) {
    const passHeader = req.get('x-admin-pass');
    const emailHeader = req.get('x-admin-email');
    if (passHeader) {
      const matched = auth.verifyAdminPasscode(passHeader, emailHeader);
      if (matched) return { user: matched, viaCookie: false };
      return { user: null, viaCookie: false };
    }
    const sessionUser = auth.getSessionUserFromRequest(req);
    if (sessionUser) {
      return { user: sessionUser, viaCookie: true };
    }
    return { user: null, viaCookie: false };
  }

  function isMutationMethod(req) {
    const m = String(req.method || 'GET').toUpperCase();
    return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
  }

  function requireClinicAccess(req, res, next) {
    const { user, viaCookie } = resolveClinicRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }
    if (viaCookie && !isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    if (isMutationMethod(req) && user.role === 'lecteur') {
      return res.status(403).json({ error: 'Accès en lecture seule.' });
    }
    req.adminUser = user;
    return next();
  }

  function requireAdminSession(req, res, next) {
    const sessionUser = auth.getSessionUserFromRequest(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
    }
    if (!isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    if (isMutationMethod(req) && sessionUser.role === 'lecteur') {
      return res.status(403).json({ error: 'Accès en lecture seule.' });
    }
    req.adminUser = sessionUser;
    return next();
  }

  function requireAdminManager(req, res, next) {
    const { user } = resolveClinicRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
    }
    if (!isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    if (user.role !== 'super_admin' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Action réservée aux administrateurs.' });
    }
    req.adminUser = user;
    return next();
  }

  // --- Dynamic SEO routes (robots.txt & sitemap.xml) ---
  function sendDynamicRobots(req, res) {
    const siteUrl = resolveSiteUrlFromRequest(req);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buildRobotsTxt(siteUrl));
  }

  function sendDynamicSitemap(req, res) {
    const siteUrl = resolveSiteUrlFromRequest(req);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buildSitemapXml(siteUrl));
  }

  app.get('/robots.txt', sendDynamicRobots);
  app.get('/sitemap.xml', sendDynamicSitemap);
  app.get('/api/__seo/robots.txt', sendDynamicRobots);
  app.get('/api/__seo/sitemap.xml', sendDynamicSitemap);

  // Prevent search engines from indexing private API and admin routes
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return next();
  });

  // --- Health & first-run admin setup routes ---
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  });

  app.get('/api/admin/setup-status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(auth.getSetupStatus());
  });

  app.post('/api/admin/setup', (req, res) => {
    if (!isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    const result = auth.claimInitialAdmin({
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name,
      provisionAllTeam: req.body?.provisionAllTeam !== false,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    const token = auth.createSessionToken(result.user);
    res.setHeader('Set-Cookie', auth.buildSessionCookie(token, req, false));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      user: result.user,
      teamCredentials: result.teamCredentials,
    });
  });

  // --- Admin OS authentication routes (/admin) ---
  app.get('/api/admin/auth', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = auth.getSessionUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non authentifié.' });
    }
    return res.json({ user });
  });

  app.post('/api/admin/auth', (req, res) => {
    if (!isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    const status = auth.getSetupStatus();
    if (!status.configured) {
      return res.status(403).json({
        error:
          status.runtime === 'vercel'
            ? 'Variable ADMIN_PASSWORD non configurée sur Vercel. Ajoutez ADMIN_PASSWORD dans Vercel → Settings → Environment Variables puis redéployez.'
            : 'Aucun accès configuré. Utilisez le formulaire de première configuration.',
        setupRequired: true,
        runtime: status.runtime,
      });
    }

    const user = auth.verifyCredentials(req.body?.email, req.body?.password);
    if (!user) {
      return res.status(401).json({
        error: 'Identifiants incorrects. Vérifiez votre e-mail et votre clé d\'accès.',
      });
    }

    const token = auth.createSessionToken(user);
    res.setHeader('Set-Cookie', auth.buildSessionCookie(token, req, false));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ user });
  });

  app.delete('/api/admin/auth', (req, res) => {
    if (!isSameOriginMutation(req)) {
      return res.status(403).json({ error: 'Requête cross-origin refusée.' });
    }
    res.setHeader('Set-Cookie', auth.buildSessionCookie('', req, true));
    return res.status(204).end();
  });

  // --- Team access & dashboard reset routes (super_admin / admin only) ---
  app.get('/api/admin/team', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      members: auth.listTeamAccounts(),
      currentUser: req.adminUser,
    });
  });

  app.post('/api/admin/team', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = auth.createTeamMember({
      email: req.body?.email,
      name: req.body?.name,
      title: req.body?.title,
      role: req.body?.role,
      password: req.body?.password,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.status(201).json({
      member: result.member,
      password: result.password,
    });
  });

  app.post('/api/admin/team/access-keys', requireAdminManager, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const status = auth.getSetupStatus();
    return res.json({
      source: status.source,
      runtime: status.runtime,
      credentials: auth.getActiveDerivedTeamCredentials(),
    });
  });

  app.post('/api/admin/team/provision-all', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rotateAll = Boolean(req.body?.rotateAll);
    const result = auth.provisionTeamAccounts({
      rotateAll,
      excludeEmail: rotateAll ? req.adminUser.email : '',
    });
    return res.json({
      credentials: result.credentials,
      members: auth.listTeamAccounts(),
    });
  });

  app.post('/api/admin/team/:email/reset-password', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = auth.resetMemberPassword(req.params.email, req.body?.password);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json({
      credential: result.credential,
      members: auth.listTeamAccounts(),
    });
  });

  app.patch('/api/admin/team/:email', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = auth.updateMember(req.params.email, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json({
      member: result.member,
      members: auth.listTeamAccounts(),
    });
  });

  app.post('/api/admin/reset-dashboard', requireAdminManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    store.resetDashboard(req.adminUser.email);
    return res.json({ ok: true, stats: store.getStats() });
  });

  // --- Public & Espace Clinique (#gestion) appointment/quote endpoints ---
  app.post('/api/appointments', (req, res) => {
    const result = store.addAppointment(req.body, 'Site web');
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({ appointment: result.item });
  });

  app.get('/api/appointments', requireClinicAccess, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ appointments: store.getAppointments() });
  });

  app.patch('/api/appointments', requireClinicAccess, (req, res) => {
    const { id, status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ error: 'Identifiant et statut requis.' });
    }
    const result = store.updateAppointmentStatus(id, status, req.adminUser.email);
    if (result.notFound) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ appointment: result.item });
  });

  app.post('/api/quotes', (req, res) => {
    const result = store.addQuote(req.body, 'Site web');
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({ quote: result.item });
  });

  app.get('/api/quotes', requireClinicAccess, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ quotes: store.getQuotes() });
  });

  app.patch('/api/quotes', requireClinicAccess, (req, res) => {
    const { id, status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ error: 'Identifiant et statut requis.' });
    }
    const result = store.updateQuoteStatus(id, status, req.adminUser.email);
    if (result.notFound) return res.status(404).json({ error: 'Demande introuvable.' });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ quote: result.item });
  });

  // --- Admin OS protected routes (/api/admin/*) ---
  app.get('/api/admin/stats', requireAdminSession, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(store.getStats());
  });

  app.get('/api/admin/search', requireAdminSession, (req, res) => {
    return res.json({ results: store.searchAll(req.query.q) });
  });

  app.get('/api/admin/settings', requireAdminSession, (_req, res) => {
    return res.json({ values: store.getSettings() });
  });

  app.put('/api/admin/settings', requireAdminManager, (req, res) => {
    const values = store.updateSettings(req.body?.values, req.adminUser.email);
    return res.json({ values });
  });

  app.get('/api/admin/audit', requireAdminSession, (req, res) => {
    return res.json(store.listAudit(req.query));
  });

  app.get('/api/admin/medias', requireAdminSession, (req, res) => {
    const rows = store.listMedias(req.query.q);
    return res.json({ rows, total: rows.length });
  });

  app.post('/api/admin/seed', requireAdminManager, (req, res) => {
    store.reseedDemoData(req.adminUser.email);
    return res.json({ ok: true });
  });

  app.delete('/api/admin/seed', requireAdminManager, (req, res) => {
    store.clearDemoData(req.adminUser.email);
    return res.json({ ok: true });
  });

  app.get('/api/admin/:resource', requireAdminSession, (req, res) => {
    const key = req.params.resource;
    if (!store.ALLOWED_RESOURCES.has(key)) {
      return res.status(404).json({ error: 'Ressource introuvable.' });
    }
    return res.json(store.listResource(key, req.query));
  });

  app.post('/api/admin/:resource', requireAdminSession, (req, res) => {
    const key = req.params.resource;
    if (!store.ALLOWED_RESOURCES.has(key)) {
      return res.status(404).json({ error: 'Ressource introuvable.' });
    }
    const result = store.createResourceItem(key, req.body, req.adminUser.email);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(201).json({ item: result.item });
  });

  app.patch('/api/admin/:resource/:id', requireAdminSession, (req, res) => {
    const key = req.params.resource;
    if (!store.ALLOWED_RESOURCES.has(key)) {
      return res.status(404).json({ error: 'Ressource introuvable.' });
    }
    const result = store.updateResourceItem(key, req.params.id, req.body, req.adminUser.email);
    if (result.notFound) return res.status(404).json({ error: 'Élément introuvable.' });
    return res.json({ item: result.item });
  });

  app.delete('/api/admin/:resource/:id', requireAdminSession, (req, res) => {
    const key = req.params.resource;
    if (!store.ALLOWED_RESOURCES.has(key)) {
      return res.status(404).json({ error: 'Ressource introuvable.' });
    }
    const result = store.deleteResourceItem(key, req.params.id, req.adminUser.email);
    if (result.notFound) return res.status(404).json({ error: 'Élément introuvable.' });
    return res.status(204).end();
  });

  // Catch-all for unknown /api/* routes so they return JSON 404 instead of HTML
  app.use('/api', (_req, res) => {
    return res.status(404).json({ error: 'Route API introuvable.' });
  });

  // --- Static site serving ---
  app.use((req, res, next) => {
    if (isBlockedPath(req.path)) {
      return sendNotFound(res);
    }
    if (req.path === '/admin' || req.path === '/admin.html') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    return next();
  });

  const indexPagePath = path.join(rootDir, 'index.html');
  let cachedIndexHtml = null;
  function getRawIndexHtml() {
    if (cachedIndexHtml === null && fs.existsSync(indexPagePath)) {
      cachedIndexHtml = fs.readFileSync(indexPagePath, 'utf8');
    }
    return cachedIndexHtml;
  }

  app.get(['/', '/index.html'], (req, res, next) => {
    const rawHtml = getRawIndexHtml();
    if (!rawHtml) return next();
    const siteUrl = resolveSiteUrlFromRequest(req);
    const rendered = applyRuntimeSeoToHtml(rawHtml, siteUrl, {
      googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(rendered);
  });

  app.use(
    express.static(rootDir, {
      extensions: ['html'],
      dotfiles: 'ignore',
      index: 'index.html',
      maxAge: 0,
    }),
  );

  app.use((_req, res) => {
    return sendNotFound(res);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { createApp, isBlockedPath };
