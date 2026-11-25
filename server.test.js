const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, isBlockedPath } = require('./server');
const { TEAM_DIRECTORY, createAuthManager, hashPassword, verifyPasswordHash } = require('./lib/auth');

function requestJson(baseUrl, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : null;
    const headers = {
      ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      ...(options.headers || {}),
    };

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

test('isBlockedPath blocks internal server/config/lib files and dotfiles', () => {
  assert.equal(isBlockedPath('/server.js'), true);
  assert.equal(isBlockedPath('/server.test.js'), true);
  assert.equal(isBlockedPath('/lib/auth.js'), true);
  assert.equal(isBlockedPath('/package.json'), true);
  assert.equal(isBlockedPath('/package-lock.json'), true);
  assert.equal(isBlockedPath('/metadata.json'), true);
  assert.equal(isBlockedPath('/node_modules/express/package.json'), true);
  assert.equal(isBlockedPath('/.nojekyll'), true);
  assert.equal(isBlockedPath('/.env.example'), true);
  assert.equal(isBlockedPath('/%2e%2e/etc/passwd'), true);

  assert.equal(isBlockedPath('/'), false);
  assert.equal(isBlockedPath('/index.html'), false);
  assert.equal(isBlockedPath('/admin'), false);
  assert.equal(isBlockedPath('/assets/pms/admin-setup.js'), false);
  assert.equal(isBlockedPath('/assets/pms/logo.webp'), false);
});

test('scrypt password hashing verifies valid passwords and rejects invalid ones', () => {
  const { salt, hash } = hashPassword('Sokhna2026!Secure');
  assert.equal(verifyPasswordHash('Sokhna2026!Secure', salt, hash), true);
  assert.equal(verifyPasswordHash('WrongPassword123', salt, hash), false);
});

test('auth manager provisions unique passwords for all 9 team members, locks setup, and honors env override', () => {
  let fakeEnv = {};
  const auth = createAuthManager({ getEnv: () => fakeEnv });

  assert.equal(TEAM_DIRECTORY.length, 9);
  assert.equal(auth.getSetupStatus().configured, false);
  assert.equal(auth.verifyAdminPasscode('anything'), null);

  const tooShort = auth.claimInitialAdmin({ email: 'moussa.gaye@pms.com', password: '123' });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.status, 400);

  const claimed = auth.claimInitialAdmin({
    email: 'moussa.gaye@pms.com',
    password: 'MonMotDePasse2026!',
    provisionAllTeam: true,
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.teamCredentials.length, 9);
  assert.equal(auth.getSetupStatus().configured, true);
  assert.equal(auth.getSetupStatus().source, 'claimed');

  // All 9 emails end with @pms.com and every team member has a distinct name-related password
  assert.ok(claimed.teamCredentials.every((c) => c.email.endsWith('@pms.com')));
  const uniquePasswords = new Set(claimed.teamCredentials.map((c) => c.password));
  assert.equal(uniquePasswords.size, 9);

  // Every team member can log in with their own credentials, and NOT with another member's password
  const drKebe = claimed.teamCredentials.find((c) => c.email === 'idy.kebe@pms.com');
  const mmeAdama = claimed.teamCredentials.find((c) => c.email === 'adama.diop@pms.com');
  assert.ok(drKebe && mmeAdama);
  assert.ok(drKebe.password.startsWith('IdyKebe-'));
  assert.ok(mmeAdama.password.startsWith('AdamaDiop-'));
  assert.equal(auth.verifyCredentials(drKebe.email, drKebe.password).role, 'medecin');
  assert.equal(auth.verifyCredentials(drKebe.email, mmeAdama.password), null);
  assert.equal(auth.verifyCredentials(drKebe.email, 'MonMotDePasse2026!'), null);

  // Second claim must be locked
  const secondClaim = auth.claimInitialAdmin({ email: 'other@pms.com', password: 'AnotherPassword99' });
  assert.equal(secondClaim.ok, false);
  assert.equal(secondClaim.status, 409);

  // Configured env passcode always overrides that admin email
  fakeEnv = { ADMIN_EMAIL: 'moussa.gaye@pms.com', ADMIN_PASSWORD: 'EnvSecretPassword99!' };
  assert.equal(auth.getSetupStatus().source, 'env');
  assert.equal(auth.verifyCredentials('moussa.gaye@pms.com', 'MonMotDePasse2026!'), null);
  assert.ok(auth.verifyCredentials('moussa.gaye@pms.com', 'EnvSecretPassword99!'));
});

test('Express clinic API starts at zero, enforces per-member auth, RBAC, team management, and dashboard reset', async (t) => {
  const app = createApp({ authOptions: { getEnv: () => ({}) } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // Static routes & blocked paths
  const home = await requestJson(baseUrl, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Plateau Médical SOKHNA/);
  assert.equal((await requestJson(baseUrl, '/lib/auth.js')).status, 404);

  // Protected routes fail closed before setup
  assert.equal((await requestJson(baseUrl, '/api/appointments')).status, 401);
  assert.equal((await requestJson(baseUrl, '/api/admin/stats')).status, 401);

  // Cross-origin setup rejected (CSRF)
  const crossOriginSetup = await requestJson(baseUrl, '/api/admin/setup', {
    method: 'POST',
    headers: { Origin: 'https://evil.example.com' },
    body: { email: 'moussa.gaye@pms.com', password: 'ClinicPassword2026!' },
  });
  assert.equal(crossOriginSetup.status, 403);

  // Valid same-origin setup provisions all 9 team accounts
  const setupRes = await requestJson(baseUrl, '/api/admin/setup', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: {
      email: 'moussa.gaye@pms.com',
      password: 'ClinicPassword2026!',
      provisionAllTeam: true,
    },
  });
  assert.equal(setupRes.status, 200);
  assert.equal(setupRes.json.user.email, 'moussa.gaye@pms.com');
  assert.equal(setupRes.json.teamCredentials.length, 9);

  const setCookie = Array.isArray(setupRes.headers['set-cookie'])
    ? setupRes.headers['set-cookie'][0]
    : setupRes.headers['set-cookie'];
  assert.ok(setCookie && setCookie.includes('HttpOnly'));
  const adminCookie = setCookie.split(';')[0];

  // Dashboard starts completely at zero (0 RDVs, 0 devis/ordonnances, 0 patients, 0 messages)
  const initialStats = await requestJson(baseUrl, '/api/admin/stats', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(initialStats.status, 200);
  assert.equal(initialStats.json.kpis.rdvsEnAttente, 0);
  assert.equal(initialStats.json.kpis.rdvsConfirmes, 0);
  assert.equal(initialStats.json.kpis.devisEnAttente, 0);
  assert.equal(initialStats.json.kpis.messagesNonLus, 0);
  assert.equal(initialStats.json.kpis.patientsTotal, 0);
  assert.equal(initialStats.json.alertes.length, 0);
  assert.equal(initialStats.json.derniersRdvs.length, 0);

  const initialQuotes = await requestJson(baseUrl, '/api/quotes', {
    headers: {
      'x-admin-email': 'moussa.gaye@pms.com',
      'x-admin-pass': 'ClinicPassword2026!',
    },
  });
  assert.equal(initialQuotes.status, 200);
  assert.equal(initialQuotes.json.quotes.length, 0);

  // Second team member (Dr Idy Kébé) logs in with his own unique email + password
  const drKebeCred = setupRes.json.teamCredentials.find((c) => c.email === 'idy.kebe@pms.com');
  assert.ok(drKebeCred);
  assert.ok(drKebeCred.password.startsWith('IdyKebe-'));

  // Mismatched email + password on #gestion is rejected
  const mismatchRes = await requestJson(baseUrl, '/api/appointments', {
    headers: {
      'x-admin-email': drKebeCred.email,
      'x-admin-pass': 'ClinicPassword2026!',
    },
  });
  assert.equal(mismatchRes.status, 401);

  // Valid member email + personal access key works on #gestion
  const memberGestionRes = await requestJson(baseUrl, '/api/appointments', {
    headers: {
      'x-admin-email': drKebeCred.email,
      'x-admin-pass': drKebeCred.password,
    },
  });
  assert.equal(memberGestionRes.status, 200);
  assert.equal(memberGestionRes.json.appointments.length, 0);

  // Valid member login on /admin returns medecin role and blocks admin-only team/reset routes (403)
  const memberLogin = await requestJson(baseUrl, '/api/admin/auth', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: { email: drKebeCred.email, password: drKebeCred.password },
  });
  assert.equal(memberLogin.status, 200);
  assert.equal(memberLogin.json.user.role, 'medecin');
  const memberSetCookie = Array.isArray(memberLogin.headers['set-cookie'])
    ? memberLogin.headers['set-cookie'][0]
    : memberLogin.headers['set-cookie'];
  const memberCookie = memberSetCookie.split(';')[0];

  const memberTeamAttempt = await requestJson(baseUrl, '/api/admin/team', {
    headers: { Cookie: memberCookie },
  });
  assert.equal(memberTeamAttempt.status, 403);

  const memberResetAttempt = await requestJson(baseUrl, '/api/admin/reset-dashboard', {
    method: 'POST',
    headers: { Cookie: memberCookie, Origin: baseUrl },
    body: {},
  });
  assert.equal(memberResetAttempt.status, 403);

  // Admin can list team members (without leaking password hashes), rotate a member's key, and reset dashboard
  const teamList = await requestJson(baseUrl, '/api/admin/team', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(teamList.status, 200);
  assert.equal(teamList.json.members.length, 9);
  assert.equal(teamList.body.includes('hash'), false);

  const rotated = await requestJson(
    baseUrl,
    `/api/admin/team/${encodeURIComponent(drKebeCred.email)}/reset-password`,
    {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: {},
    },
  );
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.json.credential.password, drKebeCred.password);

  // Old password stops working, new password works
  const oldPassAttempt = await requestJson(baseUrl, '/api/admin/auth', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: { email: drKebeCred.email, password: drKebeCred.password },
  });
  assert.equal(oldPassAttempt.status, 401);

  const newPassAttempt = await requestJson(baseUrl, '/api/admin/auth', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: { email: drKebeCred.email, password: rotated.json.credential.password },
  });
  assert.equal(newPassAttempt.status, 200);

  // Deactivating a member immediately invalidates their existing session cookie
  const suspendRes = await requestJson(
    baseUrl,
    `/api/admin/team/${encodeURIComponent(drKebeCred.email)}`,
    {
      method: 'PATCH',
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: { active: false },
    },
  );
  assert.equal(suspendRes.status, 200);
  const revokedCheck = await requestJson(baseUrl, '/api/admin/stats', {
    headers: { Cookie: memberCookie },
  });
  assert.equal(revokedCheck.status, 401);

  // Add a quote + appointment, then verify reset-dashboard wipes them back to 0
  await requestJson(baseUrl, '/api/appointments', {
    method: 'POST',
    body: { name: 'Awa Ndiaye', phone: '77 111 22 33', specialty: 'Pédiatrie' },
  });
  await requestJson(baseUrl, '/api/quotes', {
    method: 'POST',
    body: { name: 'Moussa Diop', phone: '77 222 33 44', fileName: 'ordonnance.pdf' },
  });

  const resetRes = await requestJson(baseUrl, '/api/admin/reset-dashboard', {
    method: 'POST',
    headers: { Cookie: adminCookie, Origin: baseUrl },
    body: {},
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.json.stats.kpis.rdvsEnAttente, 0);
  assert.equal(resetRes.json.stats.kpis.devisEnAttente, 0);

  const quotesAfterReset = await requestJson(baseUrl, '/api/quotes', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(quotesAfterReset.status, 200);
  assert.equal(quotesAfterReset.json.quotes.length, 0);
});

test('Vercel entrypoint, config, stateless derived 9-member keys, and proxy CSRF checks work cleanly', async (t) => {
  const fs = require('fs');
  const path = require('path');

  for (const blocked of ['/vercel.json', '/api/index.js', '/scripts/build.js', '/public/index.html', '/bun.lock']) {
    assert.equal(isBlockedPath(blocked), true, `Expected ${blocked} to be blocked`);
  }

  const vercelCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  assert.equal(vercelCfg.outputDirectory, 'public');
  assert.equal(vercelCfg.buildCommand, 'npm run build');
  assert.equal(vercelCfg.installCommand, 'npm install');
  assert.equal(vercelCfg.cleanUrls, true);
  assert.equal(vercelCfg.trailingSlash, false);
  assert.ok(
    Array.isArray(vercelCfg.rewrites) &&
      vercelCfg.rewrites.some((r) => r.destination === '/api?__path=$1'),
  );

  // Two independent app instances simulating two separate Vercel serverless containers
  const vercelEnv = () => ({
    VERCEL: '1',
    ADMIN_EMAIL: 'admin@pms-sokhna.com',
    ADMIN_PASSWORD: 'MasterClinicKey-2026!',
  });

  const appA = createApp({ authOptions: { getEnv: vercelEnv } });
  const appB = createApp({ authOptions: { getEnv: vercelEnv } });

  const serverA = await new Promise((resolve) => {
    const s = appA.listen(0, '127.0.0.1', () => resolve(s));
  });
  const serverB = await new Promise((resolve) => {
    const s = appB.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    serverA.close();
    serverB.close();
  });

  const baseA = `http://127.0.0.1:${serverA.address().port}`;
  const baseB = `http://127.0.0.1:${serverB.address().port}`;

  const health = await requestJson(baseA, '/api?__path=health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const setupStatus = await requestJson(baseA, '/api?__path=admin/setup-status');
  assert.equal(setupStatus.status, 200);
  assert.equal(setupStatus.json.configured, true);
  assert.equal(setupStatus.json.runtime, 'vercel');
  assert.equal(setupStatus.json.emailHint, 'moussa.gaye@pms.com');

  // Admin logs in on Container A behind Vercel proxy headers (x-forwarded-host + origin)
  const adminLogin = await requestJson(baseA, '/api?__path=admin/auth', {
    method: 'POST',
    headers: {
      'X-Forwarded-Host': 'pms-sokhna.vercel.app',
      Origin: 'https://pms-sokhna.vercel.app',
    },
    body: { email: 'moussa.gaye@pms.com', password: ' MasterClinicKey-2026! ' },
  });
  assert.equal(adminLogin.status, 200);
  const adminSetCookie = Array.isArray(adminLogin.headers['set-cookie'])
    ? adminLogin.headers['set-cookie'][0]
    : adminLogin.headers['set-cookie'];
  const adminCookie = adminSetCookie.split(';')[0];

  // Session cookie issued by Container A is accepted by Container B (stateless Vercel)
  const statsOnB = await requestJson(baseB, '/api?__path=admin/stats', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(statsOnB.status, 200);

  // Admin retrieves all 9 permanent derived team keys on Container B
  const keysRes = await requestJson(baseB, '/api?__path=admin/team/access-keys', {
    method: 'POST',
    headers: { Cookie: adminCookie, Origin: baseB },
    body: {},
  });
  assert.equal(keysRes.status, 200);
  assert.equal(keysRes.json.credentials.length, 9);

  // Every single one of the 9 team members can log in on BOTH /admin and /#gestion on Container A
  const uniqueDerivedKeys = new Set();
  for (const cred of keysRes.json.credentials) {
    uniqueDerivedKeys.add(cred.password);
    const loginRes = await requestJson(baseA, '/api?__path=admin/auth', {
      method: 'POST',
      headers: { Origin: baseA },
      body: { email: cred.email, password: cred.password },
    });
    assert.equal(loginRes.status, 200, `Expected /admin login 200 for ${cred.email}`);
    assert.equal(loginRes.json.user.email, cred.email);

    const gestionRes = await requestJson(baseA, '/api?__path=appointments', {
      headers: {
        'x-admin-email': cred.email,
        'x-admin-pass': cred.password,
      },
    });
    assert.equal(gestionRes.status, 200, `Expected /#gestion 200 for ${cred.email}`);

    // Non-admin member cannot call /api/admin/team/access-keys
    if (cred.role === 'medecin') {
      const mCookie = (
        Array.isArray(loginRes.headers['set-cookie'])
          ? loginRes.headers['set-cookie'][0]
          : loginRes.headers['set-cookie']
      ).split(';')[0];
      const forbiddenKeys = await requestJson(baseB, '/api?__path=admin/team/access-keys', {
        method: 'POST',
        headers: { Cookie: mCookie, Origin: baseB },
        body: {},
      });
      assert.equal(forbiddenKeys.status, 403);
    }
  }
  assert.equal(uniqueDerivedKeys.size, 9);

  // Wrong password or cross-origin POST is rejected
  const badPass = await requestJson(baseA, '/api?__path=admin/auth', {
    method: 'POST',
    headers: { Origin: baseA },
    body: { email: 'moussa.gaye@pms.com', password: 'WrongPassword!' },
  });
  assert.equal(badPass.status, 401);

  const crossOrigin = await requestJson(baseA, '/api?__path=admin/auth', {
    method: 'POST',
    headers: {
      'X-Forwarded-Host': 'pms-sokhna.vercel.app',
      Origin: 'https://evil.example.com',
    },
    body: { email: 'moussa.gaye@pms.com', password: 'MasterClinicKey-2026!' },
  });
  assert.equal(crossOrigin.status, 403);

  // Unconfigured Vercel returns clear French guidance mentioning ADMIN_PASSWORD
  const unconfiguredVercel = createApp({ authOptions: { getEnv: () => ({ VERCEL: '1' }) } });
  const serverC = await new Promise((resolve) => {
    const s = unconfiguredVercel.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => serverC.close());
  const baseC = `http://127.0.0.1:${serverC.address().port}`;
  const unconfLogin = await requestJson(baseC, '/api?__path=admin/auth', {
    method: 'POST',
    headers: { Origin: baseC },
    body: { email: 'moussa.gaye@pms.com', password: 'SomePassword123' },
  });
  assert.equal(unconfLogin.status, 403);
  assert.match(unconfLogin.json.error, /ADMIN_PASSWORD/);

  // Verify api/index.js module exports an Express app cleanly
  const vercelApp = require('./api/index.js');
  assert.equal(typeof vercelApp, 'function');
});


