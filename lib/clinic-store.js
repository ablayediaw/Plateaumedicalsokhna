const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APPOINTMENT_STATUSES = new Set(['pending', 'confirmed', 'done', 'cancelled']);
const APPOINTMENT_SOURCES = new Set(['site', 'whatsapp', 'telephone']);
const QUOTE_STATUSES = new Set(['pending', 'confirmed', 'done', 'cancelled']);
const MESSAGE_STATUSES = new Set(['unread', 'processed', 'archived']);
const GENDERS = new Set(['homme', 'femme', '']);

const ALLOWED_RESOURCES = new Set(['rdvs', 'patients', 'ordonnances', 'messages']);

function cleanText(val, maxLen = 300) {
  if (val == null) return '';
  return String(val).trim().slice(0, maxLen);
}

function cleanOptionalText(val, maxLen = 300) {
  const s = cleanText(val, maxLen);
  return s.length > 0 ? s : null;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function daysAgoIso(days, hoursOffset = 0) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hoursOffset * 60 * 60 * 1000);
  return d.toISOString();
}

function dateYmdOffset(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function createInitialSeedData() {
  const today = dateYmdOffset(0);
  const tomorrow = dateYmdOffset(1);

  return {
    rdvs: [
      {
        id: 'rdv_seed_1',
        name: 'Aminata Diallo',
        phone: '77 412 88 90',
        specialty: 'Cardiologie',
        date: today,
        message: 'Bilan cardiaque annuel et contrôle tension.',
        status: 'pending',
        source: 'site',
        createdAt: daysAgoIso(0, 2),
      },
      {
        id: 'rdv_seed_2',
        name: 'Cheikh Tidiane Ndiaye',
        phone: '78 521 34 11',
        specialty: 'Ophtalmologie',
        date: today,
        message: 'Contrôle vue et renouvellement ordonnance lunettes.',
        status: 'confirmed',
        source: 'whatsapp',
        createdAt: daysAgoIso(1, 3),
      },
      {
        id: 'rdv_seed_3',
        name: 'Fatou Binetou Sow',
        phone: '76 309 45 22',
        specialty: 'Consultation prénatale',
        date: tomorrow,
        message: 'Suivi du 2e trimestre.',
        status: 'pending',
        source: 'site',
        createdAt: daysAgoIso(1, 1),
      },
      {
        id: 'rdv_seed_4',
        name: 'Mamadou Lamine Fall',
        phone: '77 884 19 04',
        specialty: 'Médecine Générale',
        date: dateYmdOffset(-1),
        message: 'Consultation générale.',
        status: 'done',
        source: 'telephone',
        createdAt: daysAgoIso(2, 4),
      },
      {
        id: 'rdv_seed_5',
        name: 'Khady Mbaye',
        phone: '77 655 12 78',
        specialty: 'Échographie',
        date: tomorrow,
        message: 'Échographie abdominale.',
        status: 'confirmed',
        source: 'site',
        createdAt: daysAgoIso(3, 2),
      },
    ],
    ordonnances: [
      {
        id: 'ord_seed_1',
        name: 'Ousmane Ba',
        phone: '77 320 91 44',
        email: 'ousmane.ba@example.sn',
        fileName: 'ordonnance-verres-progressifs.pdf',
        status: 'pending',
        createdAt: daysAgoIso(0, 3),
      },
      {
        id: 'ord_seed_2',
        name: 'Mariama Seck',
        phone: '78 190 66 12',
        email: 'mariama.seck@example.sn',
        fileName: 'prescription-ophtalmo-mars.jpg',
        status: 'pending',
        createdAt: daysAgoIso(1, 5),
      },
      {
        id: 'ord_seed_3',
        name: 'Ibrahima Gueye',
        phone: '77 501 73 80',
        email: null,
        fileName: 'ordonnance-anti-lumiere-bleue.pdf',
        status: 'done',
        createdAt: daysAgoIso(4, 1),
      },
    ],
    patients: [
      {
        id: 'pat_seed_1',
        name: 'Aminata Diallo',
        phone: '77 412 88 90',
        email: 'aminata.diallo@example.sn',
        gender: 'femme',
        birthDate: '14/05/1984',
        address: 'Almadies 2, Dakar',
        notes: 'Suivi tensionnel régulier.',
        deletedAt: null,
        createdAt: daysAgoIso(10),
      },
      {
        id: 'pat_seed_2',
        name: 'Cheikh Tidiane Ndiaye',
        phone: '78 521 34 11',
        email: 'ct.ndiaye@example.sn',
        gender: 'homme',
        birthDate: '22/09/1979',
        address: 'Sangalkam, Dakar',
        notes: 'Porteur de verres correcteurs (PMS Optique).',
        deletedAt: null,
        createdAt: daysAgoIso(7),
      },
      {
        id: 'pat_seed_3',
        name: 'Fatou Binetou Sow',
        phone: '76 309 45 22',
        email: 'fb.sow@example.sn',
        gender: 'femme',
        birthDate: '03/11/1992',
        address: 'Keur Massar, Dakar',
        notes: 'Suivi prénatal.',
        deletedAt: null,
        createdAt: daysAgoIso(5),
      },
    ],
    messages: [
      {
        id: 'msg_seed_1',
        name: 'Ndèye Astou Faye',
        email: 'astou.faye@example.sn',
        phone: '77 219 04 33',
        subject: 'Horaires laboratoire de biologie',
        body: 'Bonjour, effectuez-vous les prélèvements sanguins tôt le matin dès 7h30 ?',
        status: 'unread',
        reply: '',
        createdAt: daysAgoIso(0, 4),
      },
      {
        id: 'msg_seed_2',
        name: 'Samba Dieng',
        email: 'samba.dieng@example.sn',
        phone: '78 442 18 95',
        subject: 'Disponibilité montures homme',
        body: 'Je souhaite savoir si la monture carrée bleue est disponible en boutique.',
        status: 'processed',
        reply: 'Confirmé disponible à la boutique PMS Optique.',
        createdAt: daysAgoIso(2, 1),
      },
    ],
  };
}

function createDefaultSettings() {
  return {
    company_name: 'Plateau Médical SOKHNA',
    company_address: 'Almadies 2, Sortie 9, Péage Rond-Point SEDIMA, Près de la station SHELL, Dakar',
    company_phone: '33 817 73 17',
    company_whatsapp: '77 900 53 62',
    company_email: 'pmssokhna@gmail.com',
    company_hours: 'Ouvert 24h/24 — 7 jours sur 7',
    notify_new_rdv: 'oui',
    notify_new_message: 'oui',
    notify_new_ordonnance: 'oui',
  };
}

function createClinicStore(rootDir = path.resolve(__dirname, '..')) {
  const state = {
    rdvs: [],
    ordonnances: [],
    patients: [],
    messages: [],
    settings: createDefaultSettings(),
    audit: [],
  };

  function recordAudit(actor, action, resource, itemId, summary) {
    const cleanActor = cleanText(actor || 'Admin', 120);
    const cleanSummary = cleanText(summary, 240);
    const cleanResource = cleanText(resource, 40);
    state.audit.unshift({
      id: makeId('aud'),
      actor: cleanActor,
      userEmail: cleanActor,
      action: cleanText(action, 40),
      resource: cleanResource,
      module: cleanResource,
      itemId: cleanText(itemId, 80),
      entityLabel: cleanSummary,
      summary: cleanSummary,
      createdAt: new Date().toISOString(),
    });
    if (state.audit.length > 200) {
      state.audit.length = 200;
    }
  }

  function addAppointment(input, actor = 'Site web') {
    const name = cleanText(input?.name, 140);
    const phone = cleanText(input?.phone, 40);
    if (!name || !phone) {
      return { error: 'Le nom et le téléphone sont obligatoires.' };
    }
    const status = APPOINTMENT_STATUSES.has(input?.status) ? input.status : 'pending';
    const source = APPOINTMENT_SOURCES.has(input?.source) ? input.source : 'site';
    const item = {
      id: makeId('rdv'),
      name,
      phone,
      specialty: cleanText(input?.specialty || 'Médecine Générale', 120),
      date: cleanOptionalText(input?.date, 40),
      message: cleanOptionalText(input?.message, 500),
      status,
      source,
      createdAt: new Date().toISOString(),
    };
    state.rdvs.unshift(item);
    recordAudit(actor, 'create', 'rdvs', item.id, `RDV créé pour ${item.name}`);
    return { item };
  }

  function updateAppointmentStatus(id, status, actor = 'Admin') {
    if (!APPOINTMENT_STATUSES.has(status)) {
      return { error: 'Statut de rendez-vous invalide.' };
    }
    const item = state.rdvs.find((r) => r.id === String(id));
    if (!item) return { notFound: true };
    item.status = status;
    recordAudit(actor, 'update', 'rdvs', item.id, `Statut RDV → ${status}`);
    return { item };
  }

  function addQuote(input, actor = 'Site web') {
    const name = cleanText(input?.name, 140);
    const phone = cleanText(input?.phone, 40);
    if (!name || !phone) {
      return { error: 'Le nom et le téléphone sont obligatoires.' };
    }
    const status = QUOTE_STATUSES.has(input?.status) ? input.status : 'pending';
    const item = {
      id: makeId('ord'),
      name,
      phone,
      email: cleanOptionalText(input?.email, 160),
      fileName: cleanOptionalText(input?.fileName, 200),
      status,
      createdAt: new Date().toISOString(),
    };
    state.ordonnances.unshift(item);
    recordAudit(actor, 'create', 'ordonnances', item.id, `Ordonnance ajoutée pour ${item.name}`);
    return { item };
  }

  function updateQuoteStatus(id, status, actor = 'Admin') {
    if (!QUOTE_STATUSES.has(status)) {
      return { error: 'Statut de devis invalide.' };
    }
    const item = state.ordonnances.find((q) => q.id === String(id));
    if (!item) return { notFound: true };
    item.status = status;
    recordAudit(actor, 'update', 'ordonnances', item.id, `Statut ordonnance → ${status}`);
    return { item };
  }

  function listResource(resourceKey, query = {}) {
    if (!ALLOWED_RESOURCES.has(resourceKey)) return null;
    let rows = [...state[resourceKey]];

    if (resourceKey === 'patients') {
      const showTrash = query.trash === '1' || query.trash === 'true' || query.deleted === 'true';
      rows = rows.filter((r) => (showTrash ? Boolean(r.deletedAt) : !r.deletedAt));
    }

    const q = cleanText(query.q || query.search, 120).toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        Object.values(row).some((val) => val != null && String(val).toLowerCase().includes(q)),
      );
    }

    for (const filterField of ['status', 'source', 'gender']) {
      const fv = cleanText(query[filterField], 60);
      if (fv && fv !== 'all') {
        rows = rows.filter((row) => String(row[filterField] || '') === fv);
      }
    }

    const sortField = cleanText(query.sort || query.sortBy || 'createdAt', 40);
    const sortDir = String(query.dir || query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = a[sortField] == null ? '' : String(a[sortField]);
      const vb = b[sortField] == null ? '' : String(b[sortField]);
      return va.localeCompare(vb) * sortDir;
    });

    const total = rows.length;
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
    const start = (page - 1) * perPage;
    return {
      rows: rows.slice(start, start + perPage),
      total,
      page,
      perPage,
    };
  }

  function createResourceItem(resourceKey, body, actor = 'Admin') {
    if (resourceKey === 'rdvs') return addAppointment(body, actor);
    if (resourceKey === 'ordonnances') return addQuote(body, actor);
    if (resourceKey === 'patients') {
      const name = cleanText(body?.name, 140);
      const phone = cleanText(body?.phone, 40);
      if (!name || !phone) return { error: 'Nom complet et téléphone requis.' };
      const gender = GENDERS.has(body?.gender || '') ? body?.gender || '' : '';
      const item = {
        id: makeId('pat'),
        name,
        phone,
        email: cleanText(body?.email, 160),
        gender,
        birthDate: cleanText(body?.birthDate, 40),
        address: cleanText(body?.address, 200),
        notes: cleanText(body?.notes, 1000),
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      state.patients.unshift(item);
      recordAudit(actor, 'create', 'patients', item.id, `Patient ajouté : ${item.name}`);
      return { item };
    }
    if (resourceKey === 'messages') {
      const name = cleanText(body?.name, 140);
      const msgBody = cleanText(body?.body, 2000);
      if (!name || !msgBody) return { error: 'Nom et message requis.' };
      const status = MESSAGE_STATUSES.has(body?.status) ? body.status : 'unread';
      const item = {
        id: makeId('msg'),
        name,
        email: cleanText(body?.email, 160),
        phone: cleanText(body?.phone, 40),
        subject: cleanText(body?.subject || 'Message', 200),
        body: msgBody,
        status,
        reply: cleanText(body?.reply, 2000),
        createdAt: new Date().toISOString(),
      };
      state.messages.unshift(item);
      recordAudit(actor, 'create', 'messages', item.id, `Message créé : ${item.subject}`);
      return { item };
    }
    return { error: 'Ressource inconnue.' };
  }

  function updateResourceItem(resourceKey, id, body, actor = 'Admin') {
    if (!ALLOWED_RESOURCES.has(resourceKey)) return { notFound: true };
    const list = state[resourceKey];
    const item = list.find((r) => r.id === String(id));
    if (!item) return { notFound: true };

    if (resourceKey === 'patients' && body?.__restore) {
      item.deletedAt = null;
      recordAudit(actor, 'restore', 'patients', item.id, `Patient restauré : ${item.name}`);
      return { item };
    }

    if (resourceKey === 'rdvs') {
      if (body.name !== undefined) item.name = cleanText(body.name, 140) || item.name;
      if (body.phone !== undefined) item.phone = cleanText(body.phone, 40) || item.phone;
      if (body.specialty !== undefined) item.specialty = cleanText(body.specialty, 120);
      if (body.date !== undefined) item.date = cleanOptionalText(body.date, 40);
      if (body.message !== undefined) item.message = cleanOptionalText(body.message, 500);
      if (body.status !== undefined && APPOINTMENT_STATUSES.has(body.status)) item.status = body.status;
      if (body.source !== undefined && APPOINTMENT_SOURCES.has(body.source)) item.source = body.source;
    } else if (resourceKey === 'ordonnances') {
      if (body.name !== undefined) item.name = cleanText(body.name, 140) || item.name;
      if (body.phone !== undefined) item.phone = cleanText(body.phone, 40) || item.phone;
      if (body.email !== undefined) item.email = cleanOptionalText(body.email, 160);
      if (body.fileName !== undefined) item.fileName = cleanOptionalText(body.fileName, 200);
      if (body.status !== undefined && QUOTE_STATUSES.has(body.status)) item.status = body.status;
    } else if (resourceKey === 'patients') {
      if (body.name !== undefined) item.name = cleanText(body.name, 140) || item.name;
      if (body.phone !== undefined) item.phone = cleanText(body.phone, 40) || item.phone;
      if (body.email !== undefined) item.email = cleanText(body.email, 160);
      if (body.gender !== undefined && GENDERS.has(body.gender)) item.gender = body.gender;
      if (body.birthDate !== undefined) item.birthDate = cleanText(body.birthDate, 40);
      if (body.address !== undefined) item.address = cleanText(body.address, 200);
      if (body.notes !== undefined) item.notes = cleanText(body.notes, 1000);
    } else if (resourceKey === 'messages') {
      if (body.name !== undefined) item.name = cleanText(body.name, 140) || item.name;
      if (body.email !== undefined) item.email = cleanText(body.email, 160);
      if (body.phone !== undefined) item.phone = cleanText(body.phone, 40);
      if (body.subject !== undefined) item.subject = cleanText(body.subject, 200);
      if (body.body !== undefined) item.body = cleanText(body.body, 2000);
      if (body.status !== undefined && MESSAGE_STATUSES.has(body.status)) item.status = body.status;
      if (body.reply !== undefined) item.reply = cleanText(body.reply, 2000);
    }

    recordAudit(actor, 'update', resourceKey, item.id, `Modification (${resourceKey})`);
    return { item };
  }

  function deleteResourceItem(resourceKey, id, actor = 'Admin') {
    if (!ALLOWED_RESOURCES.has(resourceKey)) return { notFound: true };
    const list = state[resourceKey];
    const idx = list.findIndex((r) => r.id === String(id));
    if (idx === -1) return { notFound: true };

    if (resourceKey === 'patients' && !list[idx].deletedAt) {
      list[idx].deletedAt = new Date().toISOString();
      recordAudit(actor, 'trash', 'patients', list[idx].id, `Patient déplacé à la corbeille`);
      return { ok: true };
    }

    const [removed] = list.splice(idx, 1);
    recordAudit(actor, 'delete', resourceKey, removed.id, `Élément supprimé (${resourceKey})`);
    return { ok: true };
  }

  function getStats() {
    const today = dateYmdOffset(0);
    const activePatients = state.patients.filter((p) => !p.deletedAt);

    const kpis = {
      rdvsEnAttente: state.rdvs.filter((r) => r.status === 'pending').length,
      rdvsConfirmes: state.rdvs.filter((r) => r.status === 'confirmed').length,
      rdvsAujourdhui: state.rdvs.filter(
        (r) => r.date === today || String(r.createdAt || '').slice(0, 10) === today,
      ).length,
      devisEnAttente: state.ordonnances.filter((o) => o.status === 'pending').length,
      messagesNonLus: state.messages.filter((m) => m.status === 'unread').length,
      patientsTotal: activePatients.length,
    };

    const rdvsParJour = [];
    for (let i = 13; i >= 0; i--) {
      const ymd = dateYmdOffset(-i);
      const dayLabel = ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
      const total = state.rdvs.filter((r) => String(r.createdAt || '').slice(0, 10) === ymd).length;
      rdvsParJour.push({ jour: dayLabel, total });
    }

    const specCounts = new Map();
    for (const r of state.rdvs) {
      const label = r.specialty || 'Autre';
      specCounts.set(label, (specCounts.get(label) || 0) + 1);
    }
    const specialites = Array.from(specCounts.entries())
      .map(([name, count]) => ({ name, label: name, specialty: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const alertes = [];
    if (kpis.rdvsEnAttente > 0) {
      alertes.push({
        id: 'alert_rdvs',
        label: `${kpis.rdvsEnAttente} rendez-vous en attente de confirmation`,
        severity: 'orange',
        href: '/admin#rdvs',
      });
    }
    if (kpis.devisEnAttente > 0) {
      alertes.push({
        id: 'alert_devis',
        label: `${kpis.devisEnAttente} devis / ordonnances optique à traiter`,
        severity: 'bleu',
        href: '/admin#ordonnances',
      });
    }
    if (kpis.messagesNonLus > 0) {
      alertes.push({
        id: 'alert_messages',
        label: `${kpis.messagesNonLus} message${kpis.messagesNonLus > 1 ? 's' : ''} patient non lu${kpis.messagesNonLus > 1 ? 's' : ''}`,
        severity: 'rouge',
        href: '/admin#messages',
      });
    }

    const derniersRdvs = state.rdvs.filter((r) => r.status === 'pending').slice(0, 5);
    const derniersMessages = state.messages.filter((m) => m.status === 'unread').slice(0, 5);
    const activites = state.audit.slice(0, 5);

    return {
      kpis,
      rdvsParJour,
      specialites,
      alertes,
      derniersRdvs,
      derniersMessages,
      activites,
      recentRdvs: state.rdvs.slice(0, 5),
      recentOrdonnances: state.ordonnances.slice(0, 5),
    };
  }

  function searchAll(queryText) {
    const q = cleanText(queryText, 120).toLowerCase();
    if (q.length < 2) return [];
    const results = [];

    for (const r of state.rdvs) {
      if (`${r.name} ${r.phone} ${r.specialty}`.toLowerCase().includes(q)) {
        results.push({
          id: r.id,
          type: 'Rendez-vous',
          module: 'rdvs',
          title: r.name,
          subtitle: `${r.specialty} • ${r.phone}`,
        });
      }
    }
    for (const p of state.patients.filter((x) => !x.deletedAt)) {
      if (`${p.name} ${p.phone} ${p.email}`.toLowerCase().includes(q)) {
        results.push({
          id: p.id,
          type: 'Patients',
          module: 'patients',
          title: p.name,
          subtitle: `${p.phone}${p.email ? ` • ${p.email}` : ''}`,
        });
      }
    }
    for (const o of state.ordonnances) {
      if (`${o.name} ${o.phone} ${o.fileName || ''}`.toLowerCase().includes(q)) {
        results.push({
          id: o.id,
          type: 'Ordonnances',
          module: 'ordonnances',
          title: o.name,
          subtitle: o.fileName || o.phone,
        });
      }
    }
    for (const m of state.messages) {
      if (`${m.name} ${m.subject} ${m.body}`.toLowerCase().includes(q)) {
        results.push({
          id: m.id,
          type: 'Messages',
          module: 'messages',
          title: m.subject || m.name,
          subtitle: m.name,
        });
      }
    }
    return results.slice(0, 25);
  }

  function listMedias(q = '') {
    const pmsDir = path.join(rootDir, 'assets', 'pms');
    const search = cleanText(q, 80).toLowerCase();
    try {
      const files = fs
        .readdirSync(pmsDir)
        .filter((f) => /\.(webp|png|jpg|jpeg|svg)$/i.test(f))
        .filter((f) => !search || f.toLowerCase().includes(search))
        .map((f) => ({
          id: f,
          name: f,
          url: `/assets/pms/${f}`,
          folder: 'pms',
        }));
      return files;
    } catch {
      return [];
    }
  }

  function getSettings() {
    return { ...state.settings };
  }

  function updateSettings(values, actor = 'Admin') {
    if (!values || typeof values !== 'object') return getSettings();
    for (const key of Object.keys(state.settings)) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        state.settings[key] = cleanText(values[key], 300);
      }
    }
    recordAudit(actor, 'update', 'settings', 'settings', 'Paramètres de la clinique mis à jour');
    return getSettings();
  }

  function reseedDemoData(actor = 'Admin') {
    const fresh = createInitialSeedData();
    state.rdvs = fresh.rdvs;
    state.ordonnances = fresh.ordonnances;
    state.patients = fresh.patients;
    state.messages = fresh.messages;
    recordAudit(actor, 'seed', 'system', 'seed', 'Données de démonstration rechargées');
  }

  function clearDemoData(actor = 'Admin') {
    state.rdvs = [];
    state.ordonnances = [];
    state.patients = [];
    state.messages = [];
    state.audit = [];
    recordAudit(actor, 'clear_seed', 'system', 'reset', 'Tableau de bord réinitialisé à zéro');
  }

  function resetDashboard(actor = 'Admin') {
    state.rdvs = [];
    state.ordonnances = [];
    state.patients = [];
    state.messages = [];
    state.audit = [];
    if (actor) {
      recordAudit(actor, 'reset', 'system', 'dashboard', 'Tableau de bord remis à zéro (tous devis et ordonnances supprimés)');
    }
  }

  function listAudit(query = {}) {
    let rows = [...state.audit];
    const itemId = cleanText(query.itemId, 80);
    if (itemId) {
      rows = rows.filter((a) => a.itemId === itemId);
    }
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
    const start = (page - 1) * perPage;
    return {
      rows: rows.slice(start, start + perPage),
      total: rows.length,
    };
  }

  return {
    ALLOWED_RESOURCES,
    getAppointments: () => [...state.rdvs],
    getQuotes: () => [...state.ordonnances],
    addAppointment,
    updateAppointmentStatus,
    addQuote,
    updateQuoteStatus,
    listResource,
    createResourceItem,
    updateResourceItem,
    deleteResourceItem,
    getStats,
    searchAll,
    listMedias,
    getSettings,
    updateSettings,
    reseedDemoData,
    clearDemoData,
    resetDashboard,
    listAudit,
  };
}

module.exports = { createClinicStore };
