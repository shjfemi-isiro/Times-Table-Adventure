// Grown-ups' area: Clerk sign-in, family set-up, players, consent switches,
// device pairing, history, leaderboards, export, complaints and deletion.
const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};

const BANDS = { little: 'Ages 3 to 5', builders: 'Ages 6 to 7', masters: 'Ages 8 to 10' };
const PURPOSES = [
  ['cloud_sync', 'Back up progress', 'Saves rounds to our servers in London so progress survives a lost device.'],
  ['family_board', 'Family board', 'Shows your players to each other. Can use first names; never public.'],
  ['public_leagues', 'Weekly leagues', 'Ages 6+. Shows only the game name and avatar, ranked by facts learned. Needs backup on.'],
  ['product_emails', 'Product emails', 'Occasional news for grown-ups. Never sent to children.'],
];

async function api(path, opts = {}) {
  const token = await window.Clerk?.session?.getToken();
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.clerk_error?.reason === 'reverification-error') {
    if (confirm('For safety, please sign in again to confirm this change.')) {
      await window.Clerk.signOut();
      location.reload();
    }
    throw new Error('Please confirm it is you.');
  }
  if (!res.ok) throw new Error(data.message || 'Something went wrong.');
  return data;
}

function flash(text, err = false) {
  const m = h('div', { class: `msg${err ? ' err' : ''}`, role: err ? 'alert' : 'status' }, text);
  $('#main').prepend(m);
  setTimeout(() => m.remove(), 6000);
}

async function render() {
  const main = $('#main');
  main.replaceChildren(h('p', {}, 'Loading...'));
  let me;
  try { me = await api('/api/me'); } catch (e) { main.replaceChildren(h('div', { class: 'msg err' }, e.message)); return; }
  if (!me.family) return renderSetup(me);
  main.replaceChildren(
    playersCard(me), consentCard(me), devicesCard(me), historyCard(me), boardsCard(me), rightsCard(me),
  );
}

function renderSetup(me) {
  const sel = h('select', { id: 'country', 'aria-label': 'Country' },
    ...[['GB', 'United Kingdom'], ['NG', 'Nigeria'], ['EG', 'Egypt'], ['US', 'United States'], ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['OTHER', 'Somewhere else']]
      .map(([v, t]) => h('option', { value: v, selected: v === (me.suggestedCountry || 'GB') }, t)));
  $('#main').replaceChildren(h('section', { class: 'card' },
    h('h2', {}, 'Where do you live?'),
    h('p', {}, 'This decides which privacy rules apply to your family. You can change it later.'),
    h('div', { class: 'row' }, sel, h('button', { onclick: async () => {
      const v = sel.value === 'OTHER' ? 'ZZ' : sel.value;
      try { await api('/api/family', { method: 'POST', body: { country: v } }); render(); } catch (e) { flash(e.message, true); }
    } }, 'Continue'))));
}

function playersCard(me) {
  const list = h('div', { class: 'kids' }, ...me.children.map(k => h('div', { class: 'kid' },
    h('b', {}, k.familyLabel || k.gameName), h('div', {}, h('span', { class: 'pill' }, BANDS[k.ageBand])),
    h('div', {}, 'Game name: ', k.gameName), h('div', {}, 'Avatar: ', k.avatarId),
    h('button', { class: 'ghost', onclick: async () => {
      if (!confirm(`Remove ${k.familyLabel || k.gameName} and all their progress?`)) return;
      await api(`/api/children/${k.id}`, { method: 'DELETE' }); render();
    } }, 'Remove'))));
  return h('section', { class: 'card' }, h('h2', {}, 'Players'), list, addChildForm());
}

function addChildForm() {
  const box = h('div', { class: 'row', style: 'margin-top:12px' });
  let names = [], avatars = [];
  const nameSel = h('select', { 'aria-label': 'Game name' });
  const avatarSel = h('select', { 'aria-label': 'Avatar' });
  const bandSel = h('select', { 'aria-label': 'Age band' }, ...Object.entries(BANDS).map(([v, t]) => h('option', { value: v }, t)));
  const modeSel = h('select', { 'aria-label': 'Name shown to the family' },
    h('option', { value: 'avatar' }, 'Family sees: avatar only'), h('option', { value: 'game_name' }, 'Family sees: game name'), h('option', { value: 'first_name' }, 'Family sees: first name'));
  const first = h('input', { placeholder: 'First name (optional)', maxlength: 20, 'aria-label': 'First name' });
  const reroll = async () => {
    const r = await api('/api/game-names?n=4'); names = r.suggestions; avatars = r.avatars;
    nameSel.replaceChildren(...names.map(n => h('option', { value: n.code }, n.name)));
    if (!avatarSel.options.length) avatarSel.replaceChildren(...avatars.map(a => h('option', { value: a }, a)));
  };
  reroll();
  box.append(avatarSel, nameSel, h('button', { class: 'ghost', onclick: reroll }, 'New names'), bandSel, modeSel, first,
    h('button', { onclick: async () => {
      try {
        await api('/api/children', { method: 'POST', body: { avatarId: avatarSel.value, gameNameCode: nameSel.value, ageBand: bandSel.value, displayMode: modeSel.value, ...(first.value.trim() ? { firstName: first.value.trim() } : {}) } });
        render();
      } catch (e) { flash(e.message, true); }
    } }, 'Add player'));
  return box;
}

function consentCard(me) {
  const fam = me.consents.family || {};
  return h('section', { class: 'card' }, h('h2', {}, 'Choices'),
    h('p', {}, 'Everything starts off. Turning something on records a dated receipt you can download.'),
    ...PURPOSES.map(([p, title, help]) => {
      const box = h('input', { type: 'checkbox', checked: !!fam[p], 'aria-label': title, onchange: async ev => {
        try { await api('/api/consents', { method: 'POST', body: { purpose: p, granted: ev.target.checked } }); flash(`${title} ${ev.target.checked ? 'on' : 'off'}.`); render(); }
        catch (e) { ev.target.checked = !ev.target.checked; flash(e.message, true); }
      } });
      return h('label', { class: 'switch' }, h('span', {}, title, h('small', {}, help)), box);
    }));
}

function devicesCard(me) {
  return h('section', { class: 'card' }, h('h2', {}, 'Play devices'),
    h('p', {}, 'Pair a family tablet so it can back up rounds without you staying signed in.'),
    h('table', {}, h('tbody', {}, ...me.devices.map(d => h('tr', {}, h('td', {}, d.label), h('td', {}, d.last_sync_at ? `Last backup ${new Date(d.last_sync_at).toLocaleString()}` : 'Not backed up yet'),
      h('td', {}, h('button', { class: 'ghost', onclick: async () => { await api(`/api/devices/${d.id}`, { method: 'DELETE' }); render(); } }, 'Remove')))))),
    h('button', { onclick: async () => {
      const label = prompt('Name this device', 'Family tablet'); if (!label) return;
      try {
        const r = await api('/api/devices', { method: 'POST', body: { label } });
        try { localStorage.setItem('tta.deviceToken', r.token); } catch {}
        flash('This device is paired.'); render();
      } catch (e) { flash(e.message, true); }
    } }, 'Pair this device'));
}

function historyCard(me) {
  const out = h('div');
  const sel = h('select', { 'aria-label': 'Player' }, ...me.children.map(k => h('option', { value: k.id }, k.familyLabel || k.gameName)));
  const load = async () => {
    if (!sel.value) return;
    const r = await api(`/api/history?child=${sel.value}&limit=20`);
    const mastered = (r.facts || []).filter(f => f.mastered_at).length;
    out.replaceChildren(
      h('p', {}, `${mastered} facts known. ${r.pending.length ? r.pending.length + ' rounds still on their way.' : ''}`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Bridge'), h('th', {}, 'Right first time'), h('th', {}, 'Learning points'))),
        h('tbody', {}, ...r.sessions.map(s => h('tr', {}, h('td', {}, new Date(s.started_at).toLocaleString()), h('td', {}, s.bridge), h('td', {}, `${s.first_try_correct} of ${s.answered}`), h('td', {}, s.learning_points))))));
  };
  sel.addEventListener('change', load); load();
  return h('section', { class: 'card' }, h('h2', {}, 'Game history'), sel, out);
}

function boardsCard(me) {
  const out = h('div');
  api('/api/leaderboards/family').then(r => out.replaceChildren(h('table', {}, h('tbody', {}, ...r.entries.map(e =>
    h('tr', {}, h('td', {}, `#${e.rank}`), h('td', {}, e.familyLabel || e.gameName), h('td', {}, `${e.points} points this week`))))))).catch(() => {});
  return h('section', { class: 'card' }, h('h2', {}, 'Family board'), h('p', {}, 'Points come from facts getting faster or becoming known.'), out);
}

function rightsCard(me) {
  const msg = h('textarea', { rows: 3, style: 'width:100%', maxlength: 2000, 'aria-label': 'Complaint' });
  return h('section', { class: 'card' }, h('h2', {}, 'Your data'),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: async () => {
        const data = await api('/api/export');
        const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'times-table-adventure-data.json' });
        a.click();
      } }, 'Download everything'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete your family, every player and all progress? This cannot be undone.')) return;
        try { await api('/api/account', { method: 'DELETE' }); await window.Clerk.signOut(); location.href = '/'; } catch (e) { flash(e.message, true); }
      } }, 'Delete account')),
    h('h2', { style: 'margin-top:16px' }, 'Make a complaint'),
    h('p', {}, 'We acknowledge within 30 days. You can also contact your regulator, such as the ICO in the UK.'),
    msg, h('button', { onclick: async () => {
      try { const r = await api('/api/complaints', { method: 'POST', body: { category: 'privacy', message: msg.value } }); msg.value = ''; flash(`Received. We will reply by ${r.acknowledgeBy}.`); }
      catch (e) { flash(e.message, true); }
    } }, 'Send'));
}

async function start() {
  $('#env-tag').textContent = document.body.dataset.env === 'production' ? '' : `Environment: ${document.body.dataset.env}`;
  const wait = () => new Promise(r => { const t = setInterval(() => { if (window.Clerk) { clearInterval(t); r(); } }, 50); });
  await wait();
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: {
      variables: { colorPrimary: '#1A5FCC', fontFamily: 'Nunito, system-ui, sans-serif', borderRadius: '12px' },
      // Clerk's card is 400px wide by default; let it shrink to fit a phone.
      elements: { rootBox: { width: '100%' }, cardBox: { width: '100%', maxWidth: '100%' }, card: { width: 'auto' } },
      // Staging runs on Clerk's development instance; its orange 'Development mode' badge
      // fails colour contrast. The page footer already says 'Environment: staging'.
      layout: { unsafe_disableDevelopmentModeWarnings: true },
    },
  });
  if (!window.Clerk.user) {
    // Staging runs Clerk in waitlist mode: testers request access, a grown-up approves them.
    if (location.hash.startsWith('#waitlist')) window.Clerk.mountWaitlist($('#signin'), { afterJoinWaitlistUrl: '/parents/' });
    else window.Clerk.mountSignIn($('#signin'), { routing: 'hash', forceRedirectUrl: '/parents/', signUpForceRedirectUrl: '/parents/', waitlistUrl: '/parents/#waitlist' });
    return;
  }
  window.Clerk.mountUserButton($('#user'));
  render();
}
start().catch(e => flash(e.message, true));
