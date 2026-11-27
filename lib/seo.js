const DEFAULT_LASTMOD = '2026-11-27';
const HOST_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/i;
const GOOGLE_VERIFICATION_PATTERN = /^[a-zA-Z0-9_-]{10,128}$/;

function normalizeSiteUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let candidate = raw.trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function resolveSiteUrlFromEnv(env = process.env) {
  if (!env || typeof env !== 'object') return '';
  const candidates = [
    env.SITE_URL,
    env.APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];
  for (const raw of candidates) {
    const normalized = normalizeSiteUrl(raw);
    if (normalized) return normalized;
  }
  return '';
}

function resolveSiteUrlFromRequest(req, env = process.env) {
  if (env && env.SITE_URL) {
    const explicit = normalizeSiteUrl(env.SITE_URL);
    if (explicit) return explicit;
  }

  const forwardedHost = req && typeof req.get === 'function' ? req.get('x-forwarded-host') : '';
  const directHost = req && typeof req.get === 'function' ? req.get('host') : '';
  const rawHost = String(forwardedHost || directHost || '')
    .split(',')[0]
    .trim();

  if (rawHost && HOST_PATTERN.test(rawHost)) {
    const protoHeader = req && typeof req.get === 'function' ? req.get('x-forwarded-proto') : '';
    const rawProto = String(protoHeader || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const isLocal = /^localhost(?::|$)|^127\.0\.0\.1(?::|$)/i.test(rawHost);
    const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : isLocal ? 'http' : 'https';
    return `${proto}://${rawHost}`;
  }

  return resolveSiteUrlFromEnv(env);
}

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlAttrEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildRobotsTxt(siteUrl = '') {
  const cleanOrigin = normalizeSiteUrl(siteUrl);
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin.html',
    'Disallow: /api/',
  ];
  if (cleanOrigin) {
    lines.push('', `Sitemap: ${cleanOrigin}/sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}

function buildSitemapXml(siteUrl = '', lastMod = DEFAULT_LASTMOD) {
  const cleanOrigin = normalizeSiteUrl(siteUrl) || 'https://plateau-medical-sokhna.vercel.app';
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(lastMod || '')) ? lastMod : DEFAULT_LASTMOD;
  const images = [
    {
      loc: `${cleanOrigin}/assets/pms/equipe-fond2.webp`,
      title: 'Équipe médicale du Plateau Médical SOKHNA à Almadies 2, Rufisque, Dakar',
      caption: 'Médecins, spécialistes et personnel soignant du Plateau Médical SOKHNA (Almadies 2, Rufisque, Dakar)',
    },
    {
      loc: `${cleanOrigin}/assets/pms/fondateur.webp`,
      title: 'Dr Moussa Gaye — Médecin radiologue et Fondateur du Plateau Médical SOKHNA',
      caption: 'Fondateur du Plateau Médical SOKHNA à Almadies 2, Rufisque, Dakar',
    },
    {
      loc: `${cleanOrigin}/assets/pms/icon-512.png`,
      title: 'Logo officiel Plateau Médical SOKHNA',
      caption: 'Plateau Médical SOKHNA — Clinique pluridisciplinaire 24h/24 à Almadies 2, Rufisque, Dakar',
    },
    {
      loc: `${cleanOrigin}/assets/pms/optique-logo.webp`,
      title: 'PMS Optique — Boutique de lunetterie médicale à Almadies 2, Rufisque, Dakar',
      caption: 'Boutique d’optique médicale intégrée au Plateau Médical SOKHNA',
    },
  ];

  const imageBlocks = images
    .map(
      (img) =>
        `    <image:image>\n` +
        `      <image:loc>${xmlEscape(img.loc)}</image:loc>\n` +
        `      <image:title>${xmlEscape(img.title)}</image:title>\n` +
        `      <image:caption>${xmlEscape(img.caption)}</image:caption>\n` +
        `    </image:image>`,
    )
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    `  <url>\n` +
    `    <loc>${xmlEscape(cleanOrigin)}/</loc>\n` +
    `    <lastmod>${safeDate}</lastmod>\n` +
    `    <changefreq>weekly</changefreq>\n` +
    `    <priority>1.0</priority>\n` +
    `${imageBlocks}\n` +
    `  </url>\n` +
    `</urlset>\n`
  );
}

function applyRuntimeSeoToHtml(html, siteUrl = '', options = {}) {
  if (typeof html !== 'string' || !html) return html;
  let output = html;
  const cleanOrigin = normalizeSiteUrl(siteUrl);

  if (cleanOrigin) {
    const homeUrl = `${cleanOrigin}/`;
    const ogImageUrl = `${cleanOrigin}/assets/pms/equipe-fond2.webp`;
    const logoUrl = `${cleanOrigin}/assets/pms/icon-512.png`;

    // Upgrade relative social images to absolute URLs for crawlers (WhatsApp, Facebook, X, Google)
    output = output.replace(
      /(<meta\s+(?:property="og:image"|name="twitter:image")\s+content=")\.\/assets\/pms\/equipe-fond2\.webp(")/g,
      `$1${htmlAttrEscape(ogImageUrl)}$2`,
    );

    // Replace existing canonical/og:url/hreflang placeholders or inject right before </head>
    const canonicalTags =
      `<link rel="canonical" href="${htmlAttrEscape(homeUrl)}"/>` +
      `<link rel="alternate" hreflang="fr-SN" href="${htmlAttrEscape(homeUrl)}"/>` +
      `<link rel="alternate" hreflang="x-default" href="${htmlAttrEscape(homeUrl)}"/>` +
      `<meta property="og:url" content="${htmlAttrEscape(homeUrl)}"/>`;

    if (output.includes('<!--PMS_CANONICAL_TAGS-->')) {
      output = output.replace('<!--PMS_CANONICAL_TAGS-->', canonicalTags);
    } else if (!output.includes('rel="canonical"') && output.includes('</head>')) {
      output = output.replace('</head>', `${canonicalTags}</head>`);
    }

    // Populate absolute site origin inside JSON-LD placeholders
    output = output.replace(/__PMS_SITE_ORIGIN__/g, cleanOrigin);
    output = output.replace(/__PMS_LOGO_URL__/g, logoUrl);
    output = output.replace(/__PMS_IMAGE_URL__/g, ogImageUrl);
  } else {
    output = output.replace('<!--PMS_CANONICAL_TAGS-->', '');
    output = output.replace(/__PMS_SITE_ORIGIN__/g, '');
    output = output.replace(/__PMS_LOGO_URL__/g, './assets/pms/icon-512.png');
    output = output.replace(/__PMS_IMAGE_URL__/g, './assets/pms/equipe-fond2.webp');
  }

  const verificationCode = String(options.googleSiteVerification || '').trim();
  if (GOOGLE_VERIFICATION_PATTERN.test(verificationCode) && output.includes('</head>')) {
    const tag = `<meta name="google-site-verification" content="${htmlAttrEscape(verificationCode)}"/>`;
    if (!output.includes('name="google-site-verification"')) {
      output = output.replace('</head>', `${tag}</head>`);
    }
  }

  return output;
}

module.exports = {
  normalizeSiteUrl,
  resolveSiteUrlFromEnv,
  resolveSiteUrlFromRequest,
  buildRobotsTxt,
  buildSitemapXml,
  applyRuntimeSeoToHtml,
};
