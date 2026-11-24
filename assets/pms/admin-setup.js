(function () {
  'use strict';

  var OVERLAY_ID = 'pms-first-run-setup-overlay';
  var TEAM_MODAL_ID = 'pms-team-manager-overlay';
  var TEAM_FAB_ID = 'pms-team-manager-fab';
  var STYLE_ID = 'pms-first-run-setup-styles';
  var checking = false;
  var fabTimer = null;

  var ROLE_LABELS = {
    super_admin: 'Super admin',
    admin: 'Administrateur',
    secretaire: 'Secrétariat',
    medecin: 'Médecin / Soignant',
    lecteur: 'Lecture seule',
  };

  function isAdminRoute() {
    var p = window.location.pathname || '/';
    return p === '/admin' || p === '/admin.html';
  }

  function isGestionHash() {
    return window.location.hash === '#gestion';
  }

  function isTargetView() {
    return isAdminRoute() || isGestionHash();
  }

  function getActiveGestionCreds() {
    var pass = '';
    var email = '';
    try {
      pass = window.sessionStorage.getItem('pms-admin-pass') || '';
      email = window.sessionStorage.getItem('pms-admin-email') || '';
    } catch (_e) {}

    if (!email) {
      var dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        var emailEl = dialog.querySelector('form input[type="email"], form input[name="email"]');
        if (emailEl && emailEl.value) {
          email = emailEl.value.trim();
        }
      }
    }
    return { email: email, pass: pass };
  }

  // Forward the typed/stored #gestion email as x-admin-email so the server validates
  // each team member's email + unique personal access key as a strict pair.
  (function installGestionEmailHeaderWrapper() {
    try {
      if (typeof window.fetch !== 'function' || window.__pmsFetchWrapped) return;
      var originalFetch = window.fetch.bind(window);

      var wrappedFetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : input && input.url ? input.url : '';
          var isClinicEndpoint =
            url === '/api/appointments' ||
            url === '/api/quotes' ||
            url.indexOf('/api/appointments?') === 0 ||
            url.indexOf('/api/quotes?') === 0;

          if (isClinicEndpoint && init && init.headers) {
            var headers = new Headers(init.headers);
            if (headers.has('x-admin-pass') && !headers.has('x-admin-email')) {
              var creds = getActiveGestionCreds();
              if (creds.email) {
                headers.set('x-admin-email', creds.email);
                var nextInit = Object.assign({}, init, { headers: headers });
                return originalFetch(input, nextInit);
              }
            }
          }
        } catch (_e) {}
        return originalFetch(input, init);
      };

      var ownDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
      if (ownDesc && !ownDesc.configurable && !ownDesc.writable && typeof ownDesc.set !== 'function') {
        return;
      }

      if (ownDesc && (ownDesc.writable || typeof ownDesc.set === 'function')) {
        window.fetch = wrappedFetch;
      } else {
        Object.defineProperty(window, 'fetch', {
          value: wrappedFetch,
          writable: true,
          configurable: true,
          enumerable: ownDesc ? ownDesc.enumerable !== false : true,
        });
      }
      window.__pmsFetchWrapped = true;
    } catch (_e) {
      // Host environment restricts overriding window.fetch; skip wrapping cleanly.
    }
  })();

  function getAdminRequestHeaders(includeJson) {
    var headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (includeJson) headers['Content-Type'] = 'application/json';
    var creds = getActiveGestionCreds();
    if (creds.pass) {
      headers['x-admin-pass'] = creds.pass;
      if (creds.email) headers['x-admin-email'] = creds.email;
    }
    return headers;
  }

  function removeById(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function copyText(text, btn, defaultLabel) {
    var done = function () {
      if (!btn) return;
      btn.textContent = 'Copié !';
      window.setTimeout(function () {
        btn.textContent = defaultLabel;
      }, 1800);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_e) {}
    document.body.removeChild(ta);
  }

  function formatCredentialsPlainText(creds) {
    var lines = [
      'PLATEAU MÉDICAL SOKHNA — ACCÈS ESPACE CLINIQUE (#gestion & /admin)',
      '====================================================================',
      'Conservez cette liste en lieu sûr et partagez chaque accès individuellement.',
      '',
    ];
    for (var i = 0; i < creds.length; i++) {
      var c = creds[i];
      lines.push(
        (i + 1) + '. ' + c.name + (c.title ? ' (' + c.title + ')' : '') +
        '\n   E-mail       : ' + c.email +
        '\n   Clé d\'accès  : ' + c.password +
        '\n   Rôle         : ' + (ROLE_LABELS[c.role] || c.role) + '\n'
      );
    }
    return lines.join('\n');
  }

  function downloadCredentialsFile(creds) {
    var content = formatCredentialsPlainText(creds);
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pms-sokhna-acces-equipe.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.pms-overlay {' +
        'position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;' +
        'padding: 16px; background: rgba(14, 42, 74, 0.84); backdrop-filter: blur(6px); overflow-y: auto;' +
        'font-family: Poppins, Manrope, system-ui, -apple-system, sans-serif; box-sizing: border-box;' +
      '}' +
      '.pms-overlay * { box-sizing: border-box; }' +
      '.pms-card {' +
        'width: 100%; max-width: 480px; max-height: 92vh; overflow-y: auto; background: #ffffff;' +
        'border: 1px solid #e5dfd3; border-radius: 20px; padding: 26px; box-shadow: 0 24px 60px rgba(9, 26, 48, 0.35);' +
      '}' +
      '.pms-card-wide { max-width: 960px; }' +
      '.pms-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }' +
      '.pms-header-left { display: flex; align-items: center; gap: 12px; }' +
      '.pms-logo {' +
        'width: 44px; height: 44px; border-radius: 12px; border: 1px solid #e2e8f0;' +
        'background: #ffffff; object-fit: contain; padding: 2px; flex-shrink: 0;' +
      '}' +
      '.pms-kicker {' +
        'margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.16em;' +
        'text-transform: uppercase; color: #b91c1c;' +
      '}' +
      '.pms-title { margin: 2px 0 0; font-size: 19px; font-weight: 800; color: #0e2a4a; line-height: 1.25; }' +
      '.pms-intro { margin: 12px 0 0; font-size: 13.5px; line-height: 1.55; color: #475569; }' +
      '.pms-notice {' +
        'margin: 14px 0 0; padding: 11px 14px; border-radius: 12px; border: 1px solid #fde68a;' +
        'background: #fffbeb; color: #92400e; font-size: 12.5px; line-height: 1.5; font-weight: 500;' +
      '}' +
      '.pms-form { margin-top: 18px; display: flex; flex-direction: column; gap: 13px; }' +
      '.pms-field { display: flex; flex-direction: column; gap: 5px; }' +
      '.pms-label {' +
        'font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #0e2a4a;' +
      '}' +
      '.pms-input, .pms-select {' +
        'width: 100%; padding: 10px 13px; font-size: 14px; color: #0e2a4a; background: #ffffff;' +
        'border: 1.5px solid #cbd5e1; border-radius: 12px; outline: none; transition: border-color 0.15s, box-shadow 0.15s;' +
      '}' +
      '.pms-input:focus, .pms-select:focus { border-color: #b91c1c; box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.16); }' +
      '.pms-checkbox-row {' +
        'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-radius: 12px;' +
        'background: #f8fafc; border: 1px solid #e2e8f0; cursor: pointer; font-size: 13px; color: #0e2a4a; line-height: 1.45;' +
      '}' +
      '.pms-checkbox-row input { margin-top: 2px; width: 16px; height: 16px; accent-color: #0e2a4a; flex-shrink: 0; }' +
      '.pms-error {' +
        'margin: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid #fecaca;' +
        'background: #fef2f2; color: #b91c1c; font-size: 12.5px; font-weight: 600;' +
      '}' +
      '.pms-error[hidden] { display: none; }' +
      '.pms-success {' +
        'margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; border: 1px solid #bbf7d0;' +
        'background: #f0fdf4; color: #166534; font-size: 12.5px; font-weight: 600;' +
      '}' +
      '.pms-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }' +
      '.pms-actions-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; align-items: center; }' +
      '.pms-btn-primary {' +
        'padding: 11px 16px; border: none; border-radius: 12px; cursor: pointer;' +
        'background: #0e2a4a; color: #ffffff; font-size: 13.5px; font-weight: 700;' +
        'box-shadow: 0 8px 20px rgba(14, 42, 74, 0.22); transition: background 0.15s, opacity 0.15s;' +
      '}' +
      '.pms-btn-primary:hover:not(:disabled) { background: #163a63; }' +
      '.pms-btn-primary:disabled { opacity: 0.65; cursor: wait; }' +
      '.pms-btn-secondary {' +
        'padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 12px; cursor: pointer;' +
        'background: #ffffff; color: #0e2a4a; font-size: 13px; font-weight: 600; transition: background 0.15s;' +
      '}' +
      '.pms-btn-secondary:hover:not(:disabled) { background: #f8fafc; }' +
      '.pms-btn-danger {' +
        'padding: 10px 14px; border: 1px solid #fecaca; border-radius: 12px; cursor: pointer;' +
        'background: #fef2f2; color: #b91c1c; font-size: 12.5px; font-weight: 700; transition: background 0.15s;' +
      '}' +
      '.pms-btn-danger:hover:not(:disabled) { background: #fee2e2; }' +
      '.pms-btn-sm {' +
        'padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer;' +
        'background: #ffffff; color: #0e2a4a; font-size: 12px; font-weight: 600; white-space: nowrap;' +
      '}' +
      '.pms-btn-sm:hover:not(:disabled) { background: #f1f5f9; }' +
      '.pms-table-wrap { margin-top: 14px; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 14px; }' +
      '.pms-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }' +
      '.pms-table th {' +
        'background: #f8fafc; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase;' +
        'letter-spacing: 0.06em; padding: 10px 12px; border-bottom: 1px solid #e2e8f0;' +
      '}' +
      '.pms-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #0f172a; }' +
      '.pms-table tr:last-child td { border-bottom: none; }' +
      '.pms-name { font-weight: 700; color: #0e2a4a; display: block; }' +
      '.pms-sub { font-size: 11.5px; color: #64748b; display: block; margin-top: 1px; }' +
      '.pms-code {' +
        'display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;' +
        'font-weight: 700; color: #0e2a4a; background: #f1f5f9; border: 1px solid #cbd5e1; white-space: nowrap;' +
        'border-radius: 8px; padding: 4px 8px; letter-spacing: 0.02em; user-select: all;' +
      '}' +
      '.pms-status-on { display: inline-block; padding: 3px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 700; background: #dcfce7; color: #166534; }' +
      '.pms-status-off { display: inline-block; padding: 3px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 700; background: #f1f5f9; color: #64748b; }' +
      '.pms-reveal-box {' +
        'margin-top: 14px; padding: 14px; border-radius: 14px; border: 1.5px solid #0e2a4a; background: #f8fafc;' +
      '}' +
      '.pms-grid-add { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 10px; }' +
      '#' + TEAM_FAB_ID + ' {' +
        'position: fixed; right: 20px; bottom: 20px; z-index: 9000; display: inline-flex; align-items: center; gap: 8px;' +
        'padding: 10px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.18); cursor: pointer;' +
        'background: #0e2a4a; color: #ffffff; font-family: Poppins, Manrope, system-ui, sans-serif;' +
        'font-size: 13px; font-weight: 700; box-shadow: 0 10px 28px rgba(14, 42, 74, 0.3); transition: background 0.15s, transform 0.15s;' +
      '}' +
      '#' + TEAM_FAB_ID + ':hover { background: #163a63; transform: translateY(-1px); }';
    document.head.appendChild(style);
  }

  function setNativeInputValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc =
      Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && typeof desc.set === 'function') {
      desc.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submitGestionForm(email, password) {
    var dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    var form = dialog.querySelector('form');
    if (!form) return false;
    var emailInput = form.querySelector('input[type="email"], input[name="email"]');
    var passInput = form.querySelector('input[type="password"]');
    if (!emailInput || !passInput) return false;

    setNativeInputValue(emailInput, email);
    setNativeInputValue(passInput, password);

    window.setTimeout(function () {
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
      } else if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      }
    }, 60);
    return true;
  }

  function buildCredentialsTable(credentials) {
    var wrap = createEl('div', 'pms-table-wrap');
    var table = createEl('table', 'pms-table');
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Membre', 'Adresse e-mail', 'Clé d\'accès / Mot de passe', ''].forEach(function (label) {
      headRow.appendChild(createEl('th', '', label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    credentials.forEach(function (cred) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.appendChild(createEl('span', 'pms-name', cred.name));
      tdName.appendChild(
        createEl('span', 'pms-sub', (cred.title || '') + (cred.isPrimary ? ' · Compte principal' : ''))
      );
      tr.appendChild(tdName);

      var tdEmail = document.createElement('td');
      tdEmail.appendChild(createEl('span', 'pms-code', cred.email));
      tr.appendChild(tdEmail);

      var tdPass = document.createElement('td');
      tdPass.appendChild(createEl('span', 'pms-code', cred.password));
      tr.appendChild(tdPass);

      var tdCopy = document.createElement('td');
      var copyBtn = createEl('button', 'pms-btn-sm', 'Copier');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        copyText(
          cred.name + '\nE-mail : ' + cred.email + '\nClé d\'accès : ' + cred.password,
          copyBtn,
          'Copier'
        );
      });
      tdCopy.appendChild(copyBtn);
      tr.appendChild(tdCopy);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderCredentialsSheetInOverlay(overlay, credentials, primaryEmail, primaryPassword) {
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    var card = createEl('div', 'pms-card pms-card-wide');
    card.id = 'pms-team-credentials-view';

    var header = createEl('div', 'pms-header');
    var headerLeft = createEl('div', 'pms-header-left');
    var logo = document.createElement('img');
    logo.src = './assets/pms/logo.webp';
    logo.alt = 'Logo Plateau Médical SOKHNA';
    logo.width = 44;
    logo.height = 44;
    logo.className = 'pms-logo';
    var brandBox = createEl('div');
    brandBox.appendChild(createEl('p', 'pms-kicker', 'Affichage unique — Accès activés'));
    brandBox.appendChild(
      createEl('h2', 'pms-title', 'Liste des accès de l\'équipe (' + credentials.length + ' membres)')
    );
    headerLeft.appendChild(logo);
    headerLeft.appendChild(brandBox);
    header.appendChild(headerLeft);
    card.appendChild(header);

    card.appendChild(
      createEl(
        'p',
        'pms-notice',
        'Copiez ou téléchargez cette liste maintenant. Par sécurité, les mots de passe sont chiffrés sur le serveur et ne seront plus réaffichés ensuite (vous pourrez générer une nouvelle clé pour n\'importe quel membre depuis « Accès équipe »).'
      )
    );

    card.appendChild(buildCredentialsTable(credentials));

    var actions = createEl('div', 'pms-actions-row');

    var copyAllBtn = createEl('button', 'pms-btn-secondary', 'Copier toute la liste');
    copyAllBtn.type = 'button';
    copyAllBtn.addEventListener('click', function () {
      copyText(formatCredentialsPlainText(credentials), copyAllBtn, 'Copier toute la liste');
    });

    var downloadBtn = createEl('button', 'pms-btn-secondary', 'Télécharger (.txt)');
    downloadBtn.type = 'button';
    downloadBtn.addEventListener('click', function () {
      downloadCredentialsFile(credentials);
    });

    var enterBtn = createEl('button', 'pms-btn-primary', 'Accéder à l\'Espace Clinique');
    enterBtn.type = 'button';
    enterBtn.id = 'pms-enter-clinic-btn';
    enterBtn.style.marginLeft = 'auto';
    enterBtn.addEventListener('click', function () {
      removeById(OVERLAY_ID);
      if (isAdminRoute()) {
        window.location.reload();
      } else {
        window.setTimeout(function () {
          submitGestionForm(primaryEmail, primaryPassword);
          scheduleTeamFabCheck();
        }, 80);
      }
    });

    actions.appendChild(copyAllBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(enterBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
  }

  function renderSetupModal(emailHint, teamDirectory) {
    if (document.getElementById(OVERLAY_ID)) return;
    ensureStyles();

    var overlay = createEl('div', 'pms-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pms-setup-title');

    var card = createEl('div', 'pms-card');

    var header = createEl('div', 'pms-header');
    var headerLeft = createEl('div', 'pms-header-left');
    var logo = document.createElement('img');
    logo.src = './assets/pms/logo.webp';
    logo.alt = 'Logo Plateau Médical SOKHNA';
    logo.width = 44;
    logo.height = 44;
    logo.className = 'pms-logo';

    var brandBox = createEl('div');
    brandBox.appendChild(createEl('p', 'pms-kicker', 'Première configuration'));
    var title = createEl('h2', 'pms-title', 'Activer les accès de l\'équipe');
    title.id = 'pms-setup-title';
    brandBox.appendChild(title);
    headerLeft.appendChild(logo);
    headerLeft.appendChild(brandBox);
    header.appendChild(headerLeft);

    var intro = createEl(
      'p',
      'pms-intro',
      'Choisissez votre compte administrateur et votre mot de passe personnel. L\'application générera ensuite automatiquement une clé d\'accès unique pour chaque membre de l\'équipe PMS SOKHNA.'
    );

    var form = document.createElement('form');
    form.className = 'pms-form';
    form.noValidate = true;

    // Principal account selector
    var roster = Array.isArray(teamDirectory) && teamDirectory.length > 0 ? teamDirectory : [];
    var selectGroup = createEl('div', 'pms-field');
    var selectLabel = createEl('label', 'pms-label', 'Compte administrateur principal');
    selectLabel.htmlFor = 'pms-setup-member-select';
    var memberSelect = createEl('select', 'pms-select');
    memberSelect.id = 'pms-setup-member-select';

    roster.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.email;
      opt.textContent = m.name + ' (' + m.email + ')';
      memberSelect.appendChild(opt);
    });
    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Autre adresse e-mail…';
    memberSelect.appendChild(customOpt);

    var emailGroup = createEl('div', 'pms-field');
    var emailLabel = createEl('label', 'pms-label', 'Adresse e-mail administrateur');
    emailLabel.htmlFor = 'pms-setup-email';
    var emailInput = document.createElement('input');
    emailInput.id = 'pms-setup-email';
    emailInput.type = 'email';
    emailInput.required = true;
    emailInput.autocomplete = 'username';
    emailInput.value = emailHint || (roster[0] ? roster[0].email : 'moussa.gaye@pms.com');
    emailInput.className = 'pms-input';
    emailGroup.appendChild(emailLabel);
    emailGroup.appendChild(emailInput);

    var matchingOpt = roster.some(function (m) {
      return m.email === emailInput.value;
    });
    memberSelect.value = matchingOpt ? emailInput.value : '__custom__';
    emailGroup.hidden = matchingOpt;

    memberSelect.addEventListener('change', function () {
      if (memberSelect.value === '__custom__') {
        emailGroup.hidden = false;
        emailInput.value = '';
        emailInput.focus();
      } else {
        emailGroup.hidden = true;
        emailInput.value = memberSelect.value;
      }
    });

    selectGroup.appendChild(selectLabel);
    selectGroup.appendChild(memberSelect);

    // Password field
    var passGroup = createEl('div', 'pms-field');
    var passLabel = createEl('label', 'pms-label', 'Votre mot de passe personnel');
    passLabel.htmlFor = 'pms-setup-password';
    var passInput = document.createElement('input');
    passInput.id = 'pms-setup-password';
    passInput.type = 'password';
    passInput.required = true;
    passInput.minLength = 8;
    passInput.autocomplete = 'new-password';
    passInput.placeholder = 'Minimum 8 caractères';
    passInput.className = 'pms-input';
    passGroup.appendChild(passLabel);
    passGroup.appendChild(passInput);

    // Confirm field
    var confirmGroup = createEl('div', 'pms-field');
    var confirmLabel = createEl('label', 'pms-label', 'Confirmer votre mot de passe');
    confirmLabel.htmlFor = 'pms-setup-confirm';
    var confirmInput = document.createElement('input');
    confirmInput.id = 'pms-setup-confirm';
    confirmInput.type = 'password';
    confirmInput.required = true;
    confirmInput.minLength = 8;
    confirmInput.autocomplete = 'new-password';
    confirmInput.placeholder = 'Retapez votre mot de passe';
    confirmInput.className = 'pms-input';
    confirmGroup.appendChild(confirmLabel);
    confirmGroup.appendChild(confirmInput);

    // Provision all team checkbox
    var teamCheckLabel = createEl('label', 'pms-checkbox-row');
    var teamCheck = document.createElement('input');
    teamCheck.type = 'checkbox';
    teamCheck.id = 'pms-setup-provision-team';
    teamCheck.checked = true;
    var teamCheckText = createEl(
      'span',
      '',
      'Générer automatiquement un mot de passe différent pour chacun des ' +
        (roster.length || 9) +
        ' membres de l\'équipe et afficher la liste complète.'
    );
    teamCheckLabel.appendChild(teamCheck);
    teamCheckLabel.appendChild(teamCheckText);

    var errorBox = createEl('p', 'pms-error');
    errorBox.hidden = true;
    errorBox.setAttribute('role', 'alert');

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }

    var actions = createEl('div', 'pms-actions');
    var submitBtn = createEl('button', 'pms-btn-primary', 'Activer les accès et afficher la liste');
    submitBtn.type = 'submit';
    submitBtn.style.width = '100%';

    var cancelBtn = createEl('button', 'pms-btn-secondary', 'Retour au site');
    cancelBtn.type = 'button';
    cancelBtn.style.width = '100%';
    cancelBtn.addEventListener('click', function () {
      removeById(OVERLAY_ID);
      if (isAdminRoute()) {
        window.location.href = '/';
      } else {
        window.location.hash = '#accueil';
      }
    });

    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);

    if (roster.length > 0) form.appendChild(selectGroup);
    form.appendChild(emailGroup);
    form.appendChild(passGroup);
    form.appendChild(confirmGroup);
    form.appendChild(teamCheckLabel);
    form.appendChild(errorBox);
    form.appendChild(actions);

    form.addEventListener('submit', function (evt) {
      evt.preventDefault();
      errorBox.hidden = true;

      var email = (memberSelect.value && memberSelect.value !== '__custom__'
        ? memberSelect.value
        : emailInput.value
      ).trim();
      var password = passInput.value;
      var confirm = confirmInput.value;

      if (!email || email.indexOf('@') === -1) {
        showError('Veuillez saisir une adresse e-mail valide.');
        emailInput.focus();
        return;
      }
      if (password.length < 8) {
        showError('Le mot de passe doit contenir au moins 8 caractères.');
        passInput.focus();
        return;
      }
      if (password !== confirm) {
        showError('Les deux mots de passe ne correspondent pas.');
        confirmInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Création des accès sécurisés…';

      fetch('/api/admin/setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          email: email,
          password: password,
          provisionAllTeam: teamCheck.checked,
        }),
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              return { ok: res.ok, status: res.status, data: data };
            });
        })
        .then(function (result) {
          if (!result.ok) {
            showError(result.data.error || 'Impossible d\'activer les accès administrateur.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Activer les accès et afficher la liste';
            return;
          }

          var creds = Array.isArray(result.data.teamCredentials)
            ? result.data.teamCredentials
            : [];
          if (creds.length > 0) {
            renderCredentialsSheetInOverlay(overlay, creds, email, password);
          } else {
            removeById(OVERLAY_ID);
            if (isAdminRoute()) {
              window.location.reload();
            } else {
              window.setTimeout(function () {
                submitGestionForm(email, password);
              }, 80);
            }
          }
        })
        .catch(function () {
          showError('Erreur de connexion au serveur. Veuillez réessayer.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Activer les accès et afficher la liste';
        });
    });

    card.appendChild(header);
    card.appendChild(intro);
    card.appendChild(form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    window.setTimeout(function () {
      passInput.focus();
    }, 50);
  }

  // --- Ongoing Team Access Manager Modal (for authenticated super_admin / admin) ---
  function openTeamManagerModal() {
    if (document.getElementById(TEAM_MODAL_ID)) return;
    ensureStyles();

    var overlay = createEl('div', 'pms-overlay');
    overlay.id = TEAM_MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pms-team-modal-title');

    var card = createEl('div', 'pms-card pms-card-wide');

    var header = createEl('div', 'pms-header');
    var headerLeft = createEl('div', 'pms-header-left');
    var logo = document.createElement('img');
    logo.src = './assets/pms/logo.webp';
    logo.alt = 'Logo PMS';
    logo.width = 40;
    logo.height = 40;
    logo.className = 'pms-logo';
    var brandBox = createEl('div');
    brandBox.appendChild(createEl('p', 'pms-kicker', 'Administration des comptes'));
    var title = createEl('h2', 'pms-title', 'Accès individuels de l\'équipe');
    title.id = 'pms-team-modal-title';
    brandBox.appendChild(title);
    headerLeft.appendChild(logo);
    headerLeft.appendChild(brandBox);

    var closeBtn = createEl('button', 'pms-btn-secondary', 'Fermer');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () {
      removeById(TEAM_MODAL_ID);
    });

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    card.appendChild(header);

    var statusBanner = createEl('p', 'pms-error');
    statusBanner.hidden = true;
    card.appendChild(statusBanner);

    var revealZone = createEl('div');
    card.appendChild(revealZone);

    var topBar = createEl('div', 'pms-actions-row');
    var rotateBtn = createEl('button', 'pms-btn-primary', 'Générer de nouvelles clés pour l\'équipe');
    rotateBtn.type = 'button';

    var resetDashBtn = createEl('button', 'pms-btn-danger', 'Remettre le tableau de bord à zéro');
    resetDashBtn.type = 'button';
    resetDashBtn.style.marginLeft = 'auto';

    topBar.appendChild(rotateBtn);
    topBar.appendChild(resetDashBtn);
    card.appendChild(topBar);

    var tableHost = createEl('div');
    card.appendChild(tableHost);

    // Add member quick form
    var addTitle = createEl('p', 'pms-label', 'Ajouter un nouveau membre');
    addTitle.style.marginTop = '18px';
    card.appendChild(addTitle);

    var addForm = document.createElement('form');
    addForm.className = 'pms-grid-add';
    var addName = createEl('input', 'pms-input');
    addName.placeholder = 'Nom complet (ex. Dr Awa Ndiaye)';
    addName.required = true;
    var addEmail = createEl('input', 'pms-input');
    addEmail.type = 'email';
    addEmail.placeholder = 'prenom.nom@pms.com';
    addEmail.required = true;
    var addRole = createEl('select', 'pms-select');
    ['medecin', 'secretaire', 'admin', 'super_admin', 'lecteur'].forEach(function (r) {
      var o = document.createElement('option');
      o.value = r;
      o.textContent = ROLE_LABELS[r] || r;
      addRole.appendChild(o);
    });
    var addSubmit = createEl('button', 'pms-btn-primary', '+ Créer l\'accès');
    addSubmit.type = 'submit';
    addForm.appendChild(addName);
    addForm.appendChild(addEmail);
    addForm.appendChild(addRole);
    addForm.appendChild(addSubmit);
    card.appendChild(addForm);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function showBanner(msg, isError) {
      statusBanner.textContent = msg;
      statusBanner.className = isError ? 'pms-error' : 'pms-success';
      statusBanner.hidden = false;
    }

    function showRevealedCredentials(creds, headingText) {
      while (revealZone.firstChild) revealZone.removeChild(revealZone.firstChild);
      if (!creds || creds.length === 0) return;
      var box = createEl('div', 'pms-reveal-box');
      box.appendChild(createEl('p', 'pms-kicker', 'Nouvelles clés générées (affichage unique)'));
      box.appendChild(createEl('p', 'pms-intro', headingText));
      box.appendChild(buildCredentialsTable(creds));

      var row = createEl('div', 'pms-actions-row');
      var copyBtn = createEl('button', 'pms-btn-secondary', 'Copier la liste');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        copyText(formatCredentialsPlainText(creds), copyBtn, 'Copier la liste');
      });
      var dlBtn = createEl('button', 'pms-btn-secondary', 'Télécharger (.txt)');
      dlBtn.type = 'button';
      dlBtn.addEventListener('click', function () {
        downloadCredentialsFile(creds);
      });
      row.appendChild(copyBtn);
      row.appendChild(dlBtn);
      box.appendChild(row);
      revealZone.appendChild(box);
    }

    function renderMembers(members) {
      while (tableHost.firstChild) tableHost.removeChild(tableHost.firstChild);
      var wrap = createEl('div', 'pms-table-wrap');
      var table = createEl('table', 'pms-table');
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      ['Membre', 'E-mail de connexion', 'Rôle', 'Statut', 'Actions'].forEach(function (h) {
        hr.appendChild(createEl('th', '', h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      members.forEach(function (m) {
        var tr = document.createElement('tr');

        var tdN = document.createElement('td');
        tdN.appendChild(createEl('span', 'pms-name', m.name));
        if (m.title) tdN.appendChild(createEl('span', 'pms-sub', m.title));
        tr.appendChild(tdN);

        var tdE = document.createElement('td');
        tdE.appendChild(createEl('span', 'pms-code', m.email));
        tr.appendChild(tdE);

        tr.appendChild(createEl('td', '', ROLE_LABELS[m.role] || m.role));

        var tdS = document.createElement('td');
        tdS.appendChild(
          createEl('span', m.active ? 'pms-status-on' : 'pms-status-off', m.active ? 'Actif' : 'Inactif')
        );
        tr.appendChild(tdS);

        var tdA = document.createElement('td');
        var actWrap = createEl('div');
        actWrap.style.display = 'flex';
        actWrap.style.gap = '6px';

        if (m.source !== 'env') {
          var keyBtn = createEl('button', 'pms-btn-sm', m.hasPassword ? 'Nouvelle clé' : 'Activer');
          keyBtn.type = 'button';
          keyBtn.addEventListener('click', function () {
            keyBtn.disabled = true;
            fetch('/api/admin/team/' + encodeURIComponent(m.email) + '/reset-password', {
              method: 'POST',
              credentials: 'same-origin',
              headers: getAdminRequestHeaders(true),
              body: JSON.stringify({}),
            })
              .then(function (r) {
                return r.json().then(function (d) {
                  return { ok: r.ok, data: d };
                });
              })
              .then(function (res) {
                keyBtn.disabled = false;
                if (!res.ok) {
                  showBanner(res.data.error || 'Erreur lors de la génération.', true);
                  return;
                }
                showBanner('Nouvelle clé d\'accès générée pour ' + m.name + '.', false);
                showRevealedCredentials(
                  [res.data.credential],
                  'Partagez cette clé unique avec ' + m.name + ' :'
                );
                if (Array.isArray(res.data.members)) renderMembers(res.data.members);
              })
              .catch(function () {
                keyBtn.disabled = false;
                showBanner('Erreur réseau.', true);
              });
          });
          actWrap.appendChild(keyBtn);

          if (m.hasPassword) {
            var toggleBtn = createEl('button', 'pms-btn-sm', m.active ? 'Suspendre' : 'Réactiver');
            toggleBtn.type = 'button';
            toggleBtn.addEventListener('click', function () {
              toggleBtn.disabled = true;
              fetch('/api/admin/team/' + encodeURIComponent(m.email), {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: getAdminRequestHeaders(true),
                body: JSON.stringify({ active: !m.active }),
              })
                .then(function (r) {
                  return r.json().then(function (d) {
                    return { ok: r.ok, data: d };
                  });
                })
                .then(function (res) {
                  toggleBtn.disabled = false;
                  if (!res.ok) {
                    showBanner(res.data.error || 'Impossible de modifier ce compte.', true);
                    return;
                  }
                  if (Array.isArray(res.data.members)) renderMembers(res.data.members);
                })
                .catch(function () {
                  toggleBtn.disabled = false;
                });
            });
            actWrap.appendChild(toggleBtn);
          }
        } else {
          actWrap.appendChild(createEl('span', 'pms-sub', 'Configuré via Secrets'));
        }

        tdA.appendChild(actWrap);
        tr.appendChild(tdA);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      tableHost.appendChild(wrap);
    }

    function loadMembers() {
      fetch('/api/admin/team', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: getAdminRequestHeaders(false),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          if (!res.ok) {
            showBanner(res.data.error || 'Impossible de charger les comptes.', true);
            return;
          }
          renderMembers(res.data.members || []);
        })
        .catch(function () {
          showBanner('Erreur de connexion.', true);
        });
    }

    rotateBtn.addEventListener('click', function () {
      rotateBtn.disabled = true;
      fetch('/api/admin/team/provision-all', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getAdminRequestHeaders(true),
        body: JSON.stringify({ rotateAll: true }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          rotateBtn.disabled = false;
          if (!res.ok) {
            showBanner(res.data.error || 'Erreur lors de la régénération.', true);
            return;
          }
          var list = res.data.credentials || [];
          showBanner(list.length + ' clés d\'accès uniques générées.', false);
          showRevealedCredentials(
            list,
            'Chaque membre ci-dessous dispose désormais d\'une nouvelle clé personnelle :'
          );
          if (Array.isArray(res.data.members)) renderMembers(res.data.members);
          ensureTeamFab();
        })
        .catch(function () {
          rotateBtn.disabled = false;
          showBanner('Erreur réseau.', true);
        });
    });

    var confirmResetPending = false;
    resetDashBtn.addEventListener('click', function () {
      if (!confirmResetPending) {
        confirmResetPending = true;
        resetDashBtn.textContent = 'Confirmer la remise à zéro ?';
        window.setTimeout(function () {
          confirmResetPending = false;
          resetDashBtn.textContent = 'Remettre le tableau de bord à zéro';
        }, 5000);
        return;
      }
      confirmResetPending = false;
      resetDashBtn.disabled = true;
      fetch('/api/admin/reset-dashboard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getAdminRequestHeaders(true),
        body: JSON.stringify({}),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          resetDashBtn.disabled = false;
          resetDashBtn.textContent = 'Remettre le tableau de bord à zéro';
          if (!res.ok) {
            showBanner(res.data.error || 'Impossible de réinitialiser.', true);
            return;
          }
          showBanner('Tableau de bord remis à zéro : tous les RDV, devis et ordonnances ont été supprimés.', false);
          if (isAdminRoute()) {
            window.setTimeout(function () {
              window.location.reload();
            }, 900);
          }
        })
        .catch(function () {
          resetDashBtn.disabled = false;
          resetDashBtn.textContent = 'Remettre le tableau de bord à zéro';
        });
    });

    addForm.addEventListener('submit', function (evt) {
      evt.preventDefault();
      addSubmit.disabled = true;
      fetch('/api/admin/team', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getAdminRequestHeaders(true),
        body: JSON.stringify({
          name: addName.value.trim(),
          email: addEmail.value.trim(),
          role: addRole.value,
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          addSubmit.disabled = false;
          if (!res.ok) {
            showBanner(res.data.error || 'Impossible de créer le membre.', true);
            return;
          }
          addName.value = '';
          addEmail.value = '';
          showBanner('Compte créé pour ' + res.data.member.name + '.', false);
          showRevealedCredentials(
            [
              {
                name: res.data.member.name,
                title: res.data.member.title,
                email: res.data.member.email,
                role: res.data.member.role,
                password: res.data.password,
              },
            ],
            'Nouveau compte créé — conservez cette clé d\'accès :'
          );
          loadMembers();
        })
        .catch(function () {
          addSubmit.disabled = false;
          showBanner('Erreur réseau.', true);
        });
    });

    loadMembers();
  }

  function replaceStaleAdminDemoHint(emailHint) {
    if (!isAdminRoute()) return;
    var emailInputs = document.querySelectorAll('input[type="email"]');
    for (var j = 0; j < emailInputs.length; j++) {
      if (emailInputs[j].placeholder && emailInputs[j].placeholder.indexOf('pms-sokhna.sn') !== -1) {
        emailInputs[j].placeholder = 'prenom.nom@pms.com';
      }
    }
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = buttons[i].textContent || '';
      if (text.indexOf('pms-admin-2025') !== -1 || text.indexOf('Compte de démonstration') !== -1) {
        if (buttons[i].getAttribute('data-pms-replaced') === '1') continue;
        var note = createEl('div');
        note.setAttribute('data-pms-replaced', '1');
        note.style.marginTop = '12px';
        note.style.padding = '12px 14px';
        note.style.borderRadius = '12px';
        note.style.border = '1px solid #cbd5e1';
        note.style.background = '#f8fafc';
        note.style.color = '#334155';
        note.style.fontSize = '12.5px';
        note.style.lineHeight = '1.5';
        note.textContent =
          'Connectez-vous avec votre adresse e-mail personnelle (@pms.com) et votre clé d\'accès' +
          (emailHint ? ', ou avec le compte administrateur (' + emailHint + ').' : '.');
        if (buttons[i].parentNode) {
          buttons[i].parentNode.replaceChild(note, buttons[i]);
        }
      }
    }
  }

  function isUserLoggedInView() {
    if (isAdminRoute()) {
      return Boolean(document.querySelector('aside') && !document.querySelector('input[type="password"]'));
    }
    if (isGestionHash()) {
      var creds = getActiveGestionCreds();
      var dialog = document.querySelector('[role="dialog"]');
      var hasPassInput = dialog && dialog.querySelector('input[type="password"]');
      return Boolean(creds.pass && dialog && !hasPassInput);
    }
    return false;
  }

  function ensureTeamFab() {
    if (!isTargetView() || !isUserLoggedInView()) {
      removeById(TEAM_FAB_ID);
      return;
    }
    fetch('/api/admin/team', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminRequestHeaders(false),
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.members)) {
          removeById(TEAM_FAB_ID);
          return;
        }
        var pendingCount = data.members.filter(function (m) {
          return !m.hasPassword;
        }).length;
        ensureStyles();
        var fab = document.getElementById(TEAM_FAB_ID);
        if (!fab) {
          fab = createEl('button', '', '');
          fab.id = TEAM_FAB_ID;
          fab.type = 'button';
          fab.addEventListener('click', openTeamManagerModal);
          document.body.appendChild(fab);
        }
        fab.textContent =
          pendingCount > 0
            ? 'Accès équipe (' + pendingCount + ' à activer)'
            : 'Accès équipe (' + data.members.length + ')';
      })
      .catch(function () {
        removeById(TEAM_FAB_ID);
      });
  }

  function scheduleTeamFabCheck() {
    if (fabTimer) window.clearTimeout(fabTimer);
    fabTimer = window.setTimeout(ensureTeamFab, 400);
  }

  var lastEmailHint = '';
  var domObserverStarted = false;

  function startDomWatcher() {
    if (domObserverStarted || typeof MutationObserver === 'undefined') return;
    domObserverStarted = true;
    var observer = new MutationObserver(function () {
      if (!isTargetView()) return;
      if (isAdminRoute()) {
        replaceStaleAdminDemoHint(lastEmailHint);
      }
      if (isUserLoggedInView() && !document.getElementById(TEAM_FAB_ID)) {
        scheduleTeamFabCheck();
      } else if (!isUserLoggedInView() && document.getElementById(TEAM_FAB_ID)) {
        removeById(TEAM_FAB_ID);
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function checkSetupState() {
    if (!isTargetView()) {
      removeById(OVERLAY_ID);
      removeById(TEAM_FAB_ID);
      return;
    }
    if (checking) return;
    checking = true;
    startDomWatcher();

    fetch('/api/admin/setup-status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (data && data.emailHint) {
          lastEmailHint = data.emailHint;
        }
        if (isAdminRoute()) {
          replaceStaleAdminDemoHint(lastEmailHint);
        }
        if (data && data.configured === false && isTargetView()) {
          renderSetupModal(data.emailHint, data.teamDirectory);
        } else {
          removeById(OVERLAY_ID);
          scheduleTeamFabCheck();
        }
      })
      .catch(function () {})
      .finally(function () {
        checking = false;
      });
  }

  window.addEventListener('hashchange', checkSetupState);
  document.addEventListener('submit', function () {
    if (isTargetView()) {
      window.setTimeout(ensureTeamFab, 1000);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSetupState);
  } else {
    checkSetupState();
  }
})();
