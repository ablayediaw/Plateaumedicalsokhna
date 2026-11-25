const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'pms_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const MIN_PASSWORD_LENGTH = 8;
const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'secretaire', 'medecin', 'lecteur']);
const ACCESS_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous chars (5 bits/char)

/**
 * Official Plateau Médical SOKHNA team roster (metadata only — no passwords stored here).
 */
const TEAM_DIRECTORY = Object.freeze([
  Object.freeze({
    email: 'moussa.gaye@pms.com',
    name: 'Dr Moussa Gaye',
    title: 'Médecin radiologue · Fondateur de PMS',
    role: 'super_admin',
  }),
  Object.freeze({
    email: 'mame.diarra.fall@pms.com',
    name: 'Dr Mame Diarra FALL',
    title: 'Médecin chef · Directrice générale',
    role: 'super_admin',
  }),
  Object.freeze({
    email: 'serigne.saliou.fall@pms.com',
    name: 'M. Serigne Saliou FALL',
    title: 'Gestionnaire administratif',
    role: 'admin',
  }),
  Object.freeze({
    email: 'idy.kebe@pms.com',
    name: 'Dr Idy Kébé',
    title: 'Médecin généraliste',
    role: 'medecin',
  }),
  Object.freeze({
    email: 'pape.ndiaye@pms.com',
    name: 'M. Pape Ndiaye',
    title: 'Infirmier',
    role: 'medecin',
  }),
  Object.freeze({
    email: 'djabou.gaye@pms.com',
    name: 'Mme Djabou GAYE',
    title: 'Biologiste',
    role: 'medecin',
  }),
  Object.freeze({
    email: 'adama.diop@pms.com',
    name: 'Mme Adama Diop',
    title: 'Sage-femme',
    role: 'medecin',
  }),
  Object.freeze({
    email: 'awa.gaye@pms.com',
    name: 'Mme Awa Gaye',
    title: 'Sage-femme',
    role: 'medecin',
  }),
  Object.freeze({
    email: 'adja.diop@pms.com',
    name: 'Mme Adja Diop',
    title: 'Sage-femme',
    role: 'medecin',
  }),
]);

function buildMemberKeyPrefix(memberInfo) {
  const rawName =
    (memberInfo && typeof memberInfo === 'object' ? memberInfo.name || memberInfo.email : memberInfo) ||
    'PMS';
  const ascii = String(rawName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('@')[0]
    .replace(/[^a-zA-Z\s.-]/g, ' ');

  const tokens = ascii
    .split(/[\s.-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !['dr', 'm', 'mr', 'mme', 'mlle'].includes(t.toLowerCase()));

  if (tokens.length === 0) return 'PMS';
  const selected = tokens.length <= 2 ? tokens : [tokens[0], tokens[tokens.length - 1]];
  return selected
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .slice(0, 14);
}

function generateAccessKey(existingSet, memberInfo) {
  const prefix = buildMemberKeyPrefix(memberInfo);
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(8);
    let raw = '';
    for (let i = 0; i < 8; i++) {
      raw += ACCESS_KEY_ALPHABET[bytes[i] & 31];
    }
    const key = `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    if (!existingSet || !existingSet.has(key)) {
      if (existingSet) existingSet.add(key);
      return key;
    }
  }
  const fallback = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${fallback.slice(0, 4)}-${fallback.slice(4, 8)}`;
}

function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), saltHex, 64);
  return {
    salt: saltHex,
    hash: derived.toString('hex'),
  };
}

function verifyPasswordHash(password, saltHex, expectedHashHex) {
  if (!password || !saltHex || !expectedHashHex) return false;
  const derived = crypto.scryptSync(String(password), saltHex, 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function safeCompareString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidEmail(email) {
  const trimmed = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 160;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isSameOriginMutation(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const expectedHost = (req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!expectedHost) return false;

  const origin = req.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      return parsed.host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      const parsed = new URL(referer);
      return parsed.host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  return Boolean(req.get('x-requested-with'));
}

function createAuthManager(options = {}) {
  const getEnv = options.getEnv || (() => process.env);
  const envNow = getEnv();
  const signingSecret =
    (envNow.SESSION_SECRET && String(envNow.SESSION_SECRET).trim()) ||
    (envNow.ADMIN_PASSWORD && String(envNow.ADMIN_PASSWORD).trim()
      ? crypto
          .createHmac('sha256', 'pms-sokhna-session-v1')
          .update(`${envNow.ADMIN_EMAIL || ''}:${envNow.ADMIN_PASSWORD.trim()}`)
          .digest('hex')
      : crypto.randomBytes(32).toString('hex'));

  // Map<lowercaseEmail, { email, name, title, role, active, salt, hash, updatedAt }>
  const accounts = new Map();
  let initialClaimed = false;

  function getEnvConfig() {
    const env = getEnv();
    const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD.trim() : '';
    const email =
      (typeof env.ADMIN_EMAIL === 'string' && env.ADMIN_EMAIL.trim().toLowerCase()) ||
      TEAM_DIRECTORY[0].email;

    const envTeam = [];
    if (typeof env.TEAM_ACCOUNTS_JSON === 'string' && env.TEAM_ACCOUNTS_JSON.trim()) {
      try {
        const parsed = JSON.parse(env.TEAM_ACCOUNTS_JSON);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (
              entry &&
              isValidEmail(entry.email) &&
              typeof entry.password === 'string' &&
              entry.password.length >= MIN_PASSWORD_LENGTH
            ) {
              const lower = entry.email.trim().toLowerCase();
              const dirMatch = TEAM_DIRECTORY.find((m) => m.email === lower);
              envTeam.push({
                email: lower,
                password: entry.password,
                name: String(entry.name || dirMatch?.name || lower).trim().slice(0, 100),
                title: String(entry.title || dirMatch?.title || 'Équipe PMS SOKHNA').trim().slice(0, 120),
                role: ALLOWED_ROLES.has(entry.role) ? entry.role : dirMatch?.role || 'medecin',
              });
            }
          }
        }
      } catch {
        // Ignore malformed optional TEAM_ACCOUNTS_JSON
      }
    }

    return { email, password, envTeam };
  }

  function findDirectoryMember(email) {
    const lower = String(email || '').trim().toLowerCase();
    return TEAM_DIRECTORY.find((m) => m.email === lower) || null;
  }

  function getSetupStatus() {
    const envCfg = getEnvConfig();
    if (envCfg.password) {
      return {
        configured: true,
        source: 'env',
        emailHint: envCfg.email,
        teamDirectory: TEAM_DIRECTORY,
      };
    }
    if (initialClaimed && accounts.size > 0) {
      const firstActive = Array.from(accounts.values()).find((a) => a.active);
      return {
        configured: true,
        source: 'claimed',
        emailHint: firstActive ? firstActive.email : TEAM_DIRECTORY[0].email,
        teamDirectory: TEAM_DIRECTORY,
      };
    }
    return {
      configured: false,
      source: 'unconfigured',
      emailHint: envCfg.email,
      teamDirectory: TEAM_DIRECTORY,
    };
  }

  function claimInitialAdmin({ email, password, name, provisionAllTeam = true }) {
    const status = getSetupStatus();
    if (status.configured) {
      return { ok: false, status: 409, error: 'Un accès administrateur est déjà configuré.' };
    }

    const cleanEmail = String(email || TEAM_DIRECTORY[0].email).trim().toLowerCase();
    const cleanPass = String(password || '');
    if (!isValidEmail(cleanEmail)) {
      return { ok: false, status: 400, error: 'Veuillez renseigner une adresse e-mail valide.' };
    }
    if (cleanPass.length < MIN_PASSWORD_LENGTH || cleanPass.length > 128) {
      return {
        ok: false,
        status: 400,
        error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      };
    }

    const dirMatch = findDirectoryMember(cleanEmail);
    const primaryName =
      String(name || dirMatch?.name || 'Direction PMS SOKHNA').trim().slice(0, 100) ||
      'Direction PMS SOKHNA';
    const primaryTitle = dirMatch?.title || 'Direction · Administrateur principal';
    const now = new Date().toISOString();

    const primaryHashed = hashPassword(cleanPass);
    accounts.set(cleanEmail, {
      email: cleanEmail,
      name: primaryName,
      title: primaryTitle,
      role: 'super_admin',
      active: true,
      salt: primaryHashed.salt,
      hash: primaryHashed.hash,
      updatedAt: now,
    });

    const teamCredentials = [
      {
        email: cleanEmail,
        name: primaryName,
        title: primaryTitle,
        role: 'super_admin',
        password: cleanPass,
        isPrimary: true,
      },
    ];

    if (provisionAllTeam !== false) {
      const issuedKeys = new Set([cleanPass]);
      for (const member of TEAM_DIRECTORY) {
        if (member.email === cleanEmail) continue;
        const memberPass = generateAccessKey(issuedKeys, member);
        const hashed = hashPassword(memberPass);
        accounts.set(member.email, {
          email: member.email,
          name: member.name,
          title: member.title,
          role: member.role,
          active: true,
          salt: hashed.salt,
          hash: hashed.hash,
          updatedAt: now,
        });
        teamCredentials.push({
          email: member.email,
          name: member.name,
          title: member.title,
          role: member.role,
          password: memberPass,
          isPrimary: false,
        });
      }
    }

    initialClaimed = true;

    return {
      ok: true,
      user: {
        email: cleanEmail,
        name: primaryName,
        role: 'super_admin',
      },
      teamCredentials,
    };
  }

  function verifyCredentials(email, password) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPass = String(password || '');
    if (!cleanEmail || !cleanPass) return null;

    const envCfg = getEnvConfig();
    if (envCfg.password && cleanEmail === envCfg.email) {
      if (safeCompareString(cleanPass, envCfg.password)) {
        const dirMatch = findDirectoryMember(cleanEmail);
        return {
          email: cleanEmail,
          name: dirMatch ? dirMatch.name : 'Direction PMS SOKHNA',
          role: 'super_admin',
        };
      }
      return null;
    }

    for (const envAcc of envCfg.envTeam) {
      if (envAcc.email === cleanEmail) {
        if (safeCompareString(cleanPass, envAcc.password)) {
          return {
            email: envAcc.email,
            name: envAcc.name,
            role: envAcc.role,
          };
        }
        return null;
      }
    }

    const account = accounts.get(cleanEmail);
    if (!account || !account.active) return null;
    if (verifyPasswordHash(cleanPass, account.salt, account.hash)) {
      return {
        email: account.email,
        name: account.name,
        role: account.role,
      };
    }
    return null;
  }

  function verifyAdminPasscode(passcode, optionalEmail) {
    if (!passcode || typeof passcode !== 'string') return null;

    if (optionalEmail && String(optionalEmail).trim()) {
      return verifyCredentials(optionalEmail, passcode);
    }

    const envCfg = getEnvConfig();
    if (envCfg.password && safeCompareString(passcode, envCfg.password)) {
      const dirMatch = findDirectoryMember(envCfg.email);
      return {
        email: envCfg.email,
        name: dirMatch ? dirMatch.name : 'Direction PMS SOKHNA',
        role: 'super_admin',
      };
    }

    for (const envAcc of envCfg.envTeam) {
      if (safeCompareString(passcode, envAcc.password)) {
        return {
          email: envAcc.email,
          name: envAcc.name,
          role: envAcc.role,
        };
      }
    }

    for (const account of accounts.values()) {
      if (!account.active) continue;
      if (verifyPasswordHash(passcode, account.salt, account.hash)) {
        return {
          email: account.email,
          name: account.name,
          role: account.role,
        };
      }
    }

    return null;
  }

  function listTeamAccounts() {
    const envCfg = getEnvConfig();
    const seen = new Set();
    const list = [];

    for (const dir of TEAM_DIRECTORY) {
      seen.add(dir.email);
      const isEnvAdmin = Boolean(envCfg.password && envCfg.email === dir.email);
      const envTeamMatch = envCfg.envTeam.find((e) => e.email === dir.email);
      const localAcc = accounts.get(dir.email);

      if (isEnvAdmin) {
        list.push({
          email: dir.email,
          name: dir.name,
          title: dir.title,
          role: 'super_admin',
          active: true,
          hasPassword: true,
          source: 'env',
          updatedAt: null,
        });
      } else if (envTeamMatch) {
        list.push({
          email: dir.email,
          name: envTeamMatch.name,
          title: envTeamMatch.title,
          role: envTeamMatch.role,
          active: true,
          hasPassword: true,
          source: 'env',
          updatedAt: null,
        });
      } else if (localAcc) {
        list.push({
          email: localAcc.email,
          name: localAcc.name,
          title: localAcc.title,
          role: localAcc.role,
          active: localAcc.active,
          hasPassword: true,
          source: 'server',
          updatedAt: localAcc.updatedAt,
        });
      } else {
        list.push({
          email: dir.email,
          name: dir.name,
          title: dir.title,
          role: dir.role,
          active: false,
          hasPassword: false,
          source: 'directory',
          updatedAt: null,
        });
      }
    }

    for (const acc of accounts.values()) {
      if (seen.has(acc.email)) continue;
      seen.add(acc.email);
      list.push({
        email: acc.email,
        name: acc.name,
        title: acc.title,
        role: acc.role,
        active: acc.active,
        hasPassword: true,
        source: 'server',
        updatedAt: acc.updatedAt,
      });
    }

    if (envCfg.password && !seen.has(envCfg.email)) {
      list.unshift({
        email: envCfg.email,
        name: 'Direction PMS SOKHNA',
        title: 'Administrateur principal',
        role: 'super_admin',
        active: true,
        hasPassword: true,
        source: 'env',
        updatedAt: null,
      });
    }

    return list;
  }

  function createTeamMember({ email, name, title, role, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      return { ok: false, status: 400, error: 'Adresse e-mail invalide.' };
    }
    const cleanName = String(name || '').trim().slice(0, 100);
    if (!cleanName) {
      return { ok: false, status: 400, error: 'Le nom du membre est obligatoire.' };
    }
    const cleanRole = ALLOWED_ROLES.has(role) ? role : 'medecin';
    const cleanTitle = String(title || 'Équipe PMS SOKHNA').trim().slice(0, 120);

    let chosenPass = typeof password === 'string' && password.trim() ? password.trim() : '';
    if (chosenPass && (chosenPass.length < MIN_PASSWORD_LENGTH || chosenPass.length > 128)) {
      return {
        ok: false,
        status: 400,
        error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      };
    }
    if (!chosenPass) {
      chosenPass = generateAccessKey(null, { name: cleanName, email: cleanEmail });
    }

    const hashed = hashPassword(chosenPass);
    const now = new Date().toISOString();
    accounts.set(cleanEmail, {
      email: cleanEmail,
      name: cleanName,
      title: cleanTitle,
      role: cleanRole,
      active: true,
      salt: hashed.salt,
      hash: hashed.hash,
      updatedAt: now,
    });
    initialClaimed = true;

    return {
      ok: true,
      member: {
        email: cleanEmail,
        name: cleanName,
        title: cleanTitle,
        role: cleanRole,
        active: true,
        hasPassword: true,
        source: 'server',
        updatedAt: now,
      },
      password: chosenPass,
    };
  }

  function resetMemberPassword(email, customPassword) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      return { ok: false, status: 400, error: 'Adresse e-mail invalide.' };
    }

    const existing = accounts.get(cleanEmail);
    const dirMatch = findDirectoryMember(cleanEmail);
    if (!existing && !dirMatch) {
      return { ok: false, status: 404, error: 'Membre introuvable.' };
    }

    let newPass = typeof customPassword === 'string' && customPassword.trim() ? customPassword.trim() : '';
    if (newPass && (newPass.length < MIN_PASSWORD_LENGTH || newPass.length > 128)) {
      return {
        ok: false,
        status: 400,
        error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      };
    }
    const memberInfo = {
      name: existing ? existing.name : dirMatch.name,
      email: cleanEmail,
    };
    if (!newPass) {
      newPass = generateAccessKey(null, memberInfo);
    }

    const hashed = hashPassword(newPass);
    const now = new Date().toISOString();
    const record = {
      email: cleanEmail,
      name: existing ? existing.name : dirMatch.name,
      title: existing ? existing.title : dirMatch.title,
      role: existing ? existing.role : dirMatch.role,
      active: true,
      salt: hashed.salt,
      hash: hashed.hash,
      updatedAt: now,
    };
    accounts.set(cleanEmail, record);
    initialClaimed = true;

    return {
      ok: true,
      credential: {
        email: record.email,
        name: record.name,
        title: record.title,
        role: record.role,
        password: newPass,
      },
    };
  }

  function provisionTeamAccounts({ rotateAll = false, excludeEmail = '' } = {}) {
    const envCfg = getEnvConfig();
    const excludeLower = String(excludeEmail || '').trim().toLowerCase();
    const issuedKeys = new Set();
    const credentials = [];
    const now = new Date().toISOString();

    for (const member of TEAM_DIRECTORY) {
      if (envCfg.password && envCfg.email === member.email) continue;
      if (envCfg.envTeam.some((e) => e.email === member.email)) continue;
      if (excludeLower && member.email === excludeLower) continue;

      const existing = accounts.get(member.email);
      if (existing && existing.active && !rotateAll) continue;

      const newPass = generateAccessKey(issuedKeys, existing || member);
      const hashed = hashPassword(newPass);
      accounts.set(member.email, {
        email: member.email,
        name: existing ? existing.name : member.name,
        title: existing ? existing.title : member.title,
        role: existing ? existing.role : member.role,
        active: true,
        salt: hashed.salt,
        hash: hashed.hash,
        updatedAt: now,
      });
      credentials.push({
        email: member.email,
        name: existing ? existing.name : member.name,
        title: existing ? existing.title : member.title,
        role: existing ? existing.role : member.role,
        password: newPass,
      });
    }

    if (credentials.length > 0) {
      initialClaimed = true;
    }

    return { ok: true, credentials };
  }

  function updateMember(email, patch = {}) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const existing = accounts.get(cleanEmail);
    if (!existing) {
      return { ok: false, status: 404, error: 'Compte non activé ou introuvable.' };
    }

    if (patch.active === false) {
      const otherActiveAdmins = Array.from(accounts.values()).filter(
        (a) => a.email !== cleanEmail && a.active && (a.role === 'super_admin' || a.role === 'admin'),
      );
      const envCfg = getEnvConfig();
      if (otherActiveAdmins.length === 0 && !envCfg.password) {
        return {
          ok: false,
          status: 400,
          error: 'Impossible de désactiver le dernier administrateur actif.',
        };
      }
      existing.active = false;
    } else if (patch.active === true) {
      existing.active = true;
    }

    if (patch.role && ALLOWED_ROLES.has(patch.role)) {
      existing.role = patch.role;
    }
    if (typeof patch.name === 'string' && patch.name.trim()) {
      existing.name = patch.name.trim().slice(0, 100);
    }
    if (typeof patch.title === 'string' && patch.title.trim()) {
      existing.title = patch.title.trim().slice(0, 120);
    }
    existing.updatedAt = new Date().toISOString();

    return {
      ok: true,
      member: {
        email: existing.email,
        name: existing.name,
        title: existing.title,
        role: existing.role,
        active: existing.active,
        hasPassword: true,
        source: 'server',
        updatedAt: existing.updatedAt,
      },
    };
  }

  function createSessionToken(user) {
    const payload = {
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', signingSecret)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = crypto
      .createHmac('sha256', signingSecret)
      .update(encoded)
      .digest('base64url');
    if (!safeCompareString(sig, expectedSig)) return null;

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload || typeof payload.exp !== 'number') return null;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      if (!payload.email || !payload.role) return null;

      // Reject revoked/deactivated accounts immediately
      const localAcc = accounts.get(String(payload.email).toLowerCase());
      if (localAcc && !localAcc.active) return null;

      return {
        email: String(payload.email),
        name: String(payload.name || payload.email),
        role: String(payload.role),
      };
    } catch {
      return null;
    }
  }

  function getSessionUserFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      const user = verifySessionToken(token);
      if (user) return user;
    }
    return null;
  }

  function buildSessionCookie(token, req, clear = false) {
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
    const isSecureContext =
      req.secure ||
      req.get('x-forwarded-proto') === 'https' ||
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1');

    const attrs = [
      `${SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      clear ? 'Max-Age=0' : `Max-Age=${SESSION_TTL_SECONDS}`,
    ];

    if (isSecureContext) {
      attrs.push('SameSite=None', 'Secure', 'Partitioned');
    } else {
      attrs.push('SameSite=Lax');
    }

    return attrs.join('; ');
  }

  return {
    SESSION_COOKIE_NAME,
    TEAM_DIRECTORY,
    getSetupStatus,
    claimInitialAdmin,
    verifyAdminPasscode,
    verifyCredentials,
    listTeamAccounts,
    createTeamMember,
    resetMemberPassword,
    provisionTeamAccounts,
    updateMember,
    createSessionToken,
    verifySessionToken,
    getSessionUserFromRequest,
    buildSessionCookie,
  };
}

module.exports = {
  TEAM_DIRECTORY,
  createAuthManager,
  generateAccessKey,
  hashPassword,
  verifyPasswordHash,
  isValidEmail,
  parseCookies,
  isSameOriginMutation,
};
