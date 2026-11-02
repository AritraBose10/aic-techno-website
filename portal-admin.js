/**
 * portal-admin.js
 * "Startup Portal" tab of booking-dashboard.html — the CMS side of the startup portal.
 *
 * Firestore collections (project aic-techno-cms):
 *   startups/{email}          registered startups; doc id = lowercase login email
 *   meetings/{id}             personal meetings, linked to a startup by startupEmail
 *   portalEvents/{id}         events shown to every registered startup
 *   portalNotifications/{id}  AIC Techno updates shown to every registered startup
 *
 * Each section is described by a config (fields + table columns) and rendered by the
 * same form/table code. Writes are gated by the admin allowlist in the Firestore rules.
 */
(function () {
  const STAGES = ['Pre-incubation', 'Incubation', 'Acceleration', 'Alumni'];

  const SECTIONS = {
    startups: {
      collection: 'startups',
      noun: 'startup',
      hint: "Register startups that have been accepted. Each one gets an email with a link to set their password, then signs in at /startup-login. Only startups listed here with access turned on can use the portal.",
      newTitle: 'Register a startup',
      editTitle: 'Edit startup',
      submitNew: 'Register & send invite',
      fields: [
        { key: 'name', label: 'Startup name', type: 'text', required: true },
        { key: 'founderName', label: 'Founder name', type: 'text' },
        { key: 'email', label: 'Login email', type: 'email', required: true, lockOnEdit: true,
          help: "They'll get an email from Firebase to set their password." },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'stage', label: 'Programme stage', type: 'select', options: STAGES },
        { key: 'active', label: 'Portal access on', type: 'checkbox', default: true }
      ],
      columns: [
        { label: 'Startup', render: function (d) { return [d.name || '—', d.founderName]; } },
        { label: 'Login email', render: function (d) { return [d.email || d.id, d.phone]; } },
        { label: 'Stage', render: function (d) { return pill(d.stage || '—'); } },
        { label: 'Access', render: function (d) { return d.active === false ? pill('Off', 'off') : pill('On', 'on'); } },
        { label: 'Invited', render: function (d) { return fmtDate(d.invitedAt); } }
      ],
      search: ['name', 'founderName', 'email', 'phone', 'stage'],
      sort: function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); },
      actions: function (d) {
        return [
          ['Edit', function () { startEdit(d); }],
          ['Resend invite', function (btn) { resendInvite(d, btn); }],
          [d.active === false ? 'Turn access on' : 'Turn access off', function () { patch(d, { active: d.active === false }); }]
        ];
      }
    },

    meetings: {
      collection: 'meetings',
      noun: 'meeting',
      hint: 'Meetings are private: each startup only sees the meetings scheduled for them, on their portal timeline.',
      newTitle: 'Schedule a meeting',
      editTitle: 'Edit meeting',
      submitNew: 'Schedule meeting',
      fields: [
        { key: 'startupEmail', label: 'Startup', type: 'select', required: true, options: startupOptions },
        { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Mentoring session' },
        { key: 'startAt', label: 'Date & time', type: 'datetime', required: true },
        { key: 'durationMins', label: 'Duration (minutes)', type: 'number', default: 30 },
        { key: 'mode', label: 'Mode', type: 'select', options: ['In person', 'Online'], default: 'In person' },
        { key: 'location', label: 'Location', type: 'text', placeholder: 'AIC Techno, Offbeat CCU' },
        { key: 'meetingLink', label: 'Meeting link', type: 'url', help: 'Zoom / Google Meet link for online meetings.' },
        { key: 'host', label: 'With (AIC team member / mentor)', type: 'text' },
        { key: 'agenda', label: 'Agenda / notes (visible to the startup)', type: 'textarea' },
        { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' }
      ],
      columns: [
        { label: 'When', render: function (d) { return [fmtDateTime(d.startAt), d.durationMins ? d.durationMins + ' min' : '']; } },
        { label: 'Startup', render: function (d) { return [d.startupName || d.startupEmail, d.startupEmail]; } },
        { label: 'Meeting', render: function (d) { return [d.title || '—', d.host ? 'With ' + d.host : '']; } },
        { label: 'Mode', render: function (d) { return d.mode || '—'; } },
        { label: 'Status', render: function (d) {
          const s = d.status || 'scheduled';
          return pill(cap(s), s === 'cancelled' ? 'off' : s === 'completed' ? '' : 'on');
        } }
      ],
      search: ['title', 'startupName', 'startupEmail', 'host', 'agenda', 'location'],
      sort: function (a, b) { return tsMillis(b.startAt) - tsMillis(a.startAt); },
      muted: function (d) { return d.status === 'cancelled'; },
      beforeSave: function (values) {
        const s = state.startups.find(function (x) { return x.id === values.startupEmail; });
        values.startupName = s ? (s.name || '') : '';
      },
      actions: function (d) {
        const acts = [['Edit', function () { startEdit(d); }]];
        if ((d.status || 'scheduled') === 'scheduled') acts.push(['Cancel', function () { if (confirm('Cancel this meeting? The startup will see it as cancelled.')) patch(d, { status: 'cancelled' }); }]);
        acts.push(['Delete', function () { remove(d); }, 'danger']);
        return acts;
      }
    },

    events: {
      collection: 'portalEvents',
      noun: 'event',
      hint: 'Events are shown to every registered startup on their timeline. Untick "Visible to startups" to hide one without deleting it.',
      newTitle: 'Post an event',
      editTitle: 'Edit event',
      submitNew: 'Post event',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'startAt', label: 'Starts', type: 'datetime', required: true },
        { key: 'endAt', label: 'Ends', type: 'datetime' },
        { key: 'location', label: 'Location', type: 'text', placeholder: 'AIC Techno, Offbeat CCU / Online' },
        { key: 'link', label: 'Link (registration or details)', type: 'url' },
        { key: 'linkLabel', label: 'Link button text', type: 'text', placeholder: 'Register' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'active', label: 'Visible to startups', type: 'checkbox', default: true }
      ],
      columns: [
        { label: 'When', render: function (d) { return [fmtDateTime(d.startAt), d.endAt ? 'to ' + fmtDateTime(d.endAt) : '']; } },
        { label: 'Event', render: function (d) { return [d.title || '—', d.location]; } },
        { label: 'Visible', render: function (d) { return d.active === false ? pill('Hidden', 'off') : pill('Visible', 'on'); } }
      ],
      search: ['title', 'location', 'description'],
      sort: function (a, b) { return tsMillis(b.startAt) - tsMillis(a.startAt); },
      muted: function (d) { return d.active === false; },
      actions: function (d) {
        return [
          ['Edit', function () { startEdit(d); }],
          [d.active === false ? 'Show' : 'Hide', function () { patch(d, { active: d.active === false }); }],
          ['Delete', function () { remove(d); }, 'danger']
        ];
      }
    },

    notifications: {
      collection: 'portalNotifications',
      noun: 'notification',
      hint: 'Notifications appear in "Updates from AIC Techno" for every registered startup, newest first. Pinned ones stay at the top.',
      newTitle: 'Post a notification',
      editTitle: 'Edit notification',
      submitNew: 'Post notification',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'body', label: 'Message', type: 'textarea', required: true },
        { key: 'link', label: 'Link (optional)', type: 'url' },
        { key: 'linkLabel', label: 'Link text', type: 'text', placeholder: 'Learn more' },
        { key: 'pinned', label: 'Pin to top', type: 'checkbox', default: false },
        { key: 'active', label: 'Visible to startups', type: 'checkbox', default: true }
      ],
      columns: [
        { label: 'Posted', render: function (d) { return fmtDateTime(d.createdAt) || 'Just now'; } },
        { label: 'Notification', render: function (d) { return [d.title || '—', trunc(d.body, 110)]; } },
        { label: 'Status', render: function (d) {
          const out = [d.active === false ? pill('Hidden', 'off') : pill('Visible', 'on')];
          if (d.pinned) out.push(pill('Pinned', 'red'));
          return out;
        } }
      ],
      search: ['title', 'body'],
      sort: function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || tsMillis(b.createdAt) - tsMillis(a.createdAt); },
      muted: function (d) { return d.active === false; },
      actions: function (d) {
        return [
          ['Edit', function () { startEdit(d); }],
          [d.pinned ? 'Unpin' : 'Pin', function () { patch(d, { pinned: !d.pinned }); }],
          [d.active === false ? 'Show' : 'Hide', function () { patch(d, { active: d.active === false }); }],
          ['Delete', function () { remove(d); }, 'danger']
        ];
      }
    }
  };

  const state = { startups: [], meetings: [], events: [], notifications: [] };
  let db = null;
  let firebaseConfig = null;
  let current = 'startups';
  let editing = null;          // doc being edited, or null for "new"
  let unsubs = [];
  let started = false;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pill(text, kind) { const p = el('span', 'pill' + (kind ? ' ' + kind : ''), text); return p; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function toDate(v) { return v && v.toDate ? v.toDate() : null; }
  function tsMillis(v) { const d = toDate(v); return d ? d.getTime() : 0; }
  function fmtDate(v) {
    const d = toDate(v);
    return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }
  function fmtDateTime(v) {
    const d = toDate(v);
    return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  }
  function toLocalInput(v) {
    const d = toDate(v);
    if (!d) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function isHttpUrl(s) {
    try { return /^https?:$/.test(new URL(s).protocol); } catch (e) { return false; }
  }
  function startupOptions() {
    return state.startups
      .filter(function (s) { return s.active !== false || (editing && editing.startupEmail === s.id); })
      .slice().sort(SECTIONS.startups.sort)
      .map(function (s) { return { value: s.id, label: (s.name || s.id) + ' — ' + s.id }; });
  }
  function setStatus(text, kind) {
    const s = $('pfStatus');
    if (!s) return;
    s.textContent = text || '';
    s.className = 'pf-status' + (kind ? ' ' + kind : '');
  }
  function errText(err) {
    if (err && err.code === 'permission-denied') return "Permission denied — this account isn't in the admin list in the Firestore rules.";
    return (err && err.message) ? err.message : 'Something went wrong.';
  }

  /* ---------- data ---------- */
  function subscribe() {
    Object.keys(SECTIONS).forEach(function (key) {
      const cfg = SECTIONS[key];
      unsubs.push(db.collection(cfg.collection).onSnapshot(function (snap) {
        state[key] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        if (key === current) renderTable();
        // The meeting form's startup list depends on the startups collection.
        if (key === 'startups' && current === 'meetings' && !editing) renderForm();
      }, function (err) {
        if (key === current) showEmpty(errText(err));
      }));
    });
  }

  async function patch(d, fields) {
    try {
      fields.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection(SECTIONS[current].collection).doc(d.id).update(fields);
    } catch (err) { alert("Couldn't update: " + errText(err)); }
  }

  async function remove(d) {
    const cfg = SECTIONS[current];
    if (!confirm('Delete this ' + cfg.noun + '? This can’t be undone.')) return;
    try {
      await db.collection(cfg.collection).doc(d.id).delete();
      if (editing && editing.id === d.id) { editing = null; renderForm(); }
    } catch (err) { alert("Couldn't delete: " + errText(err)); }
  }

  /* ---------- startup accounts ---------- */
  // Creates the Firebase Auth login on a throwaway app instance so the admin stays signed in.
  async function provisionLogin(email) {
    const app = firebase.apps.find(function (a) { return a.name === 'provisioner'; }) ||
      firebase.initializeApp(firebaseConfig, 'provisioner');
    const auth = app.auth();
    await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const tempPassword = btoa(String.fromCharCode.apply(null, bytes)) + 'Aa1!';
    try {
      await auth.createUserWithEmailAndPassword(email, tempPassword);
      await auth.signOut();
      return 'created';
    } catch (err) {
      if (err && err.code === 'auth/email-already-in-use') return 'exists';
      throw err;
    }
  }

  // The "set your password" invite is Firebase's password-reset email.
  async function sendInvite(email) {
    const settings = { url: location.origin + '/startup-login.html' };
    try {
      await firebase.auth().sendPasswordResetEmail(email, settings);
    } catch (err) {
      if (err && /continue-uri|unauthorized-domain/.test(err.code || '')) await firebase.auth().sendPasswordResetEmail(email);
      else throw err;
    }
  }

  async function resendInvite(d, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    try {
      await provisionLogin(d.id);
      await sendInvite(d.id);
      await db.collection('startups').doc(d.id).update({ invitedAt: firebase.firestore.FieldValue.serverTimestamp() });
      btn.textContent = 'Sent ✓';
    } catch (err) {
      alert("Couldn't send the invite: " + errText(err));
      btn.textContent = original;
    }
    setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2000);
  }

  /* ---------- form ---------- */
  function renderForm() {
    const cfg = SECTIONS[current];
    const form = $('portalForm');
    form.innerHTML = '';
    form.appendChild(el('h2', null, editing ? cfg.editTitle : cfg.newTitle));

    cfg.fields.forEach(function (f) {
      const wrap = el('div', 'pf-field' + (f.type === 'checkbox' ? ' pf-check' : ''));
      const id = 'pf_' + f.key;
      const value = editing ? editing[f.key] : f.default;
      let input;

      if (f.type === 'textarea') {
        input = el('textarea');
        input.value = value || '';
      } else if (f.type === 'select') {
        input = el('select');
        const opts = typeof f.options === 'function' ? f.options() : f.options.map(function (o) { return { value: o, label: cap(o) }; });
        if (f.required || !f.default) {
          const o = el('option', null, f.required ? 'Select…' : '—');
          o.value = '';
          input.appendChild(o);
        }
        opts.forEach(function (o) {
          const opt = el('option', null, o.label);
          opt.value = o.value;
          input.appendChild(opt);
        });
        input.value = value || '';
      } else if (f.type === 'checkbox') {
        input = el('input');
        input.type = 'checkbox';
        input.checked = !!(value == null ? f.default : value);   // missing field = the default (e.g. active)
      } else {
        input = el('input');
        input.type = f.type === 'datetime' ? 'datetime-local' : f.type;
        input.value = f.type === 'datetime' ? toLocalInput(value) : (value != null ? value : '');
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.type === 'number') { input.min = '5'; input.step = '5'; }
      }
      input.id = id;
      input.dataset.key = f.key;
      if (editing && f.lockOnEdit) input.disabled = true;

      const label = el('label', null, f.label);
      label.htmlFor = id;
      if (f.required) { label.appendChild(document.createTextNode(' ')); label.appendChild(el('span', 'req', '*')); }

      if (f.type === 'checkbox') { wrap.appendChild(input); wrap.appendChild(label); }
      else { wrap.appendChild(label); wrap.appendChild(input); }
      if (f.help) wrap.appendChild(el('div', 'pf-help', f.help));
      form.appendChild(wrap);
    });

    if (current === 'meetings' && !state.startups.length) {
      form.appendChild(el('div', 'pf-help', 'Register a startup first (Startups tab) to schedule meetings with them.'));
    }

    const actions = el('div', 'pf-actions');
    const submit = el('button', null, editing ? 'Save changes' : cfg.submitNew);
    submit.type = 'submit';
    submit.id = 'pfSubmit';
    actions.appendChild(submit);
    if (editing) {
      const cancel = el('button', 'secondary', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { editing = null; renderForm(); });
      actions.appendChild(cancel);
    }
    form.appendChild(actions);
    const status = el('p', 'pf-status');
    status.id = 'pfStatus';
    status.setAttribute('role', 'status');
    form.appendChild(status);
  }

  function startEdit(d) {
    editing = d;
    renderForm();
    $('portalForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readForm() {
    const cfg = SECTIONS[current];
    const values = {};
    let firstBad = null;
    cfg.fields.forEach(function (f) {
      const input = $('pf_' + f.key);
      input.removeAttribute('aria-invalid');
      if (editing && f.lockOnEdit) return;
      let v;
      if (f.type === 'checkbox') v = input.checked;
      else if (f.type === 'datetime') v = input.value ? firebase.firestore.Timestamp.fromDate(new Date(input.value)) : null;
      else if (f.type === 'number') v = input.value ? Number(input.value) : null;
      else v = input.value.trim();
      if (f.type === 'email' && v) v = v.toLowerCase();

      const bad = (f.required && (v === '' || v == null)) ||
        (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ||
        (f.type === 'url' && v && !isHttpUrl(v));
      if (bad) { input.setAttribute('aria-invalid', 'true'); firstBad = firstBad || input; }
      values[f.key] = v === '' ? null : v;
    });
    if (current === 'events' && values.startAt && values.endAt && values.endAt.toMillis() < values.startAt.toMillis()) {
      $('pf_endAt').setAttribute('aria-invalid', 'true');
      firstBad = firstBad || $('pf_endAt');
    }
    if (firstBad) { firstBad.focus(); return null; }
    return values;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const cfg = SECTIONS[current];
    const values = readForm();
    if (!values) { setStatus('Please fix the highlighted fields.', 'error'); return; }
    if (cfg.beforeSave) cfg.beforeSave(values);

    const btn = $('pfSubmit');
    btn.disabled = true;
    setStatus('Saving…');
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const col = db.collection(cfg.collection);
    try {
      if (editing) {
        values.updatedAt = now;
        await col.doc(editing.id).update(values);
        editing = null;
        renderForm();
        setStatus('Saved.', 'ok');
        return;
      }

      if (current === 'startups') {
        const email = values.email;
        if (state.startups.some(function (s) { return s.id === email; })) {
          throw new Error(email + ' is already registered. Use Edit or Resend invite on its row.');
        }
        setStatus('Creating login…');
        await provisionLogin(email);
        values.createdAt = now;
        values.invitedAt = now;
        await col.doc(email).set(values);
        setStatus('Sending invite email…');
        await sendInvite(email);
        renderForm();
        setStatus('Registered. Invite sent to ' + email + '.', 'ok');
        return;
      }

      values.createdAt = now;
      await col.add(values);
      renderForm();
      setStatus(cap(cfg.noun) + (current === 'meetings' ? ' scheduled.' : ' posted.'), 'ok');
    } catch (err) {
      setStatus(errText(err), 'error');
    } finally {
      const b = $('pfSubmit');
      if (b) b.disabled = false;
    }
  }

  /* ---------- table ---------- */
  function showEmpty(text) {
    $('portalTable').style.display = 'none';
    const empty = $('portalEmpty');
    empty.textContent = text;
    empty.style.display = 'block';
  }

  function renderTable() {
    const cfg = SECTIONS[current];
    const q = $('portalSearch').value.trim().toLowerCase();
    const rows = state[current].filter(function (d) {
      if (!q) return true;
      return cfg.search.some(function (k) { return String(d[k] || '').toLowerCase().indexOf(q) !== -1; });
    }).sort(cfg.sort);

    const head = $('portalHead');
    head.innerHTML = '';
    const htr = el('tr');
    cfg.columns.forEach(function (c) { htr.appendChild(el('th', null, c.label)); });
    htr.appendChild(el('th', null, ''));
    head.appendChild(htr);

    $('portalCount').textContent = rows.length + ' ' + cfg.noun + (rows.length === 1 ? '' : 's');
    const body = $('portalBody');
    body.innerHTML = '';
    if (!rows.length) {
      showEmpty(state[current].length ? 'Nothing matches your search.' : 'No ' + cfg.noun + 's yet. Use the form to add the first one.');
      return;
    }
    $('portalEmpty').style.display = 'none';
    $('portalTable').style.display = 'table';

    rows.forEach(function (d) {
      const tr = el('tr', cfg.muted && cfg.muted(d) ? 'is-muted' : '');
      cfg.columns.forEach(function (c, i) {
        const td = el('td', i === 0 && current === 'startups' ? 'name-cell' : '');
        const out = c.render(d);
        if (Array.isArray(out)) {
          out.forEach(function (part, j) {
            if (part instanceof Node) { td.appendChild(part); td.appendChild(document.createTextNode(' ')); }
            else if (j === 0) td.appendChild(document.createTextNode(part || '—'));
            else if (part) td.appendChild(el('span', 'sub', part));
          });
        } else if (out instanceof Node) {
          td.appendChild(out);
        } else {
          td.textContent = out || '—';
        }
        tr.appendChild(td);
      });
      const tdAct = el('td');
      const acts = el('div', 'row-actions');
      cfg.actions(d).forEach(function (a) {
        const b = el('button', a[2] || '', a[0]);
        b.type = 'button';
        b.addEventListener('click', function () { a[1](b); });
        acts.appendChild(b);
      });
      tdAct.appendChild(acts);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    });
  }

  /* ---------- section switching ---------- */
  function showSection(key) {
    current = key;
    editing = null;
    document.querySelectorAll('#portalView .sub-tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.section === key));
    });
    $('portalHint').textContent = SECTIONS[key].hint;
    $('portalSearch').value = '';
    renderForm();
    renderTable();
  }

  function init() {
    if (started) return;
    started = true;
    document.querySelectorAll('#portalView .sub-tab').forEach(function (b) {
      b.addEventListener('click', function () { showSection(b.dataset.section); });
    });
    $('portalForm').addEventListener('submit', onSubmit);
    $('portalSearch').addEventListener('input', renderTable);
    showSection('startups');
  }

  window.PortalAdmin = {
    // Called by the dashboard whenever the Firebase admin sign-in changes.
    setUser: function (user, config) {
      unsubs.forEach(function (u) { u(); });
      unsubs = [];
      Object.keys(state).forEach(function (k) { state[k] = []; });
      if (!user) return;
      firebaseConfig = config;
      db = firebase.firestore();
      init();
      subscribe();
    }
  };
})();
