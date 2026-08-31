import "./compat.js?v=7";

/* OneBrain onboarding.
 *
 * A four-step machine over the same /v1 endpoints the dashboard uses. No
 * framework, no build step, and nothing loaded from any external host: Google
 * consent is a plain navigation through Supabase's own /authorize endpoint, and
 * Trello consent happens on Trello's own page in a new tab.
 *
 * The rule this file follows everywhere: nothing claims success it has not
 * measured. Every state a source can be in comes from a real API response, and
 * "verified" is only ever printed after a live call returned.
 */

'use strict';

document.documentElement.classList.add('js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const announce = (m) => { $('live').textContent = m; };

async function api(path, opts = {}) {
  return await window.OB.api(path, opts);
}
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const SOURCES = [
  { id: 'gmail', label: 'Gmail', pck: 'google-mail',
    what: 'Recent mail, minus promotions and social.' },
  { id: 'google_meet', label: 'Google Meet', pck: 'google-drive',
    what: 'Gemini meeting notes and transcripts from Drive.' },
  { id: 'trello', label: 'Trello', pck: 'trello',
    what: 'Card comments and descriptions across open boards.' },
  { id: 'google_calendar', label: 'Google Calendar', pck: 'google-calendar',
    what: 'Events, attendees and dates.' },
];

/* Brand marks, inline.
 *
 * Inline rather than linked because this page loads nothing from an external
 * host — a CDN logo would be a third-party request on a screen where someone is
 * about to authorize their email. Drawn simply and in each brand's own colours:
 * these are recognisable marks for an integration list, NOT the official brand
 * assets, which every one of these companies distributes under its own brand
 * guidelines. Swap in the official SVGs before this is a public signup page.
 */
const ICON = {
  gmail: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#fff" d="M2 6.5h20v12H2z"/>
    <path fill="#EA4335" d="M2 6.5 12 14 22 6.5v-1A1.5 1.5 0 0 0 20.5 4h-17A1.5 1.5 0 0 0 2 5.5z"/>
    <path fill="#34A853" d="M2 18.5V8l4 3v7.5z"/>
    <path fill="#4285F4" d="M22 18.5V8l-4 3v7.5z"/>
    <path fill="#FBBC04" d="M6 11 12 15.5 18 11v7.5H6z"/></svg>`,
  google_meet: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#00832D" d="M14 8v3l4-2.6v7.2L14 13v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1z"/>
    <path fill="#1A73E8" d="M3 8a1 1 0 0 1 1-1h6v10H4a1 1 0 0 1-1-1z"/>
    <path fill="#FFBA00" d="M18 8.4 20.4 6.9A1 1 0 0 1 22 7.7v8.6a1 1 0 0 1-1.6.8L18 15.6z"/></svg>`,
  trello: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="20" height="20" x="2" y="2" rx="4" fill="#0079BF"/>
    <rect width="5.5" height="12" x="5" y="5" rx="1.4" fill="#fff"/>
    <rect width="5.5" height="7.5" x="13.5" y="5" rx="1.4" fill="#fff"/></svg>`,
  google_calendar: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="18" height="18" x="3" y="3" rx="2.5" fill="#fff" stroke="#DADCE0"/>
    <path fill="#1A73E8" d="M3 5.5A2.5 2.5 0 0 1 5.5 3H8v4H3z"/>
    <path fill="#EA4335" d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V7h-5z"/>
    <text x="12" y="16.6" text-anchor="middle" font-size="8.5"
          font-family="Inter, system-ui, sans-serif" fill="#1A73E8">31</text></svg>`,
};

let state = { step: 0, ob: null, conns: [] };

// ------------------------------------------------------------- step machine

const steps = [...document.querySelectorAll('.step')];

function paintRail() {
  document.querySelectorAll('#obrail li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.toggleAttribute('data-on', i === state.step);
    li.toggleAttribute('data-done', i < state.step);
  });
}

/* Swaps panels with an out/in pair rather than a cross-fade: two headlines
 * visible at once, at this size, reads as a glitch. */
function show(next, { back = false } = {}) {
  const cur = steps[state.step];
  const to = steps[next];
  if (cur === to) return;
  const swap = () => {
    cur.hidden = true; cur.removeAttribute('data-anim');
    to.hidden = false;
    to.setAttribute('data-anim', 'in');
    state.step = next;
    paintRail();
    // Focus the new heading so a screen reader and the keyboard both land in
    // the step that just appeared, not back at the top of the document.
    const h = to.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' });
    announce(h ? h.textContent : '');
    onEnter(next, { back });
  };
  if (reduced.matches) return swap();
  cur.setAttribute('data-anim', 'out');
  setTimeout(swap, 160);
}

function onEnter(i) {
  if (i === 1) renderSources();
  if (i === 2) renderPlans();
  if (i === 3) { runChecks(); }
  if (i === 4) renderDone();
}

// ------------------------------------------------------------------ step 1

async function saveOrg() {
  await post('/v1/onboarding', {
    display_name: $('ob-name').value,
    steps: { team: $('ob-team').value, goal: $('ob-goal').value.trim() },
  });
}

// ------------------------------------------------------------------ step 2

const STATE_LABEL = {
  ok: 'Verified', pending: 'Saved, not yet verified', error: 'Needs attention',
};

function renderSources() {
  const by = Object.fromEntries(state.conns.map((c) => [c.provider, c]));
  $('srcgrid').innerHTML = SOURCES.map((s) => {
    const c = by[s.id];
    const on = !c ? '0' : c.status === 'ok' ? '1' : c.status === 'error' ? 'err' : 'p';
    const label = !c ? 'Not connected'
      : (STATE_LABEL[c.status] || 'Connected');
    return `<button class="srccard" data-src="${esc(s.id)}" data-pck="${esc(s.pck)}"
              data-on="${on}" aria-label="${esc(c ? `Reconnect ${s.label}` : `Connect ${s.label}`)}">
        <span class="srcname"><span class="srcicon" aria-hidden="true">${ICON[s.id] || ''}</span>${esc(s.label)}<span class="sd" aria-hidden="true"></span></span>
        <span class="srcwhat">${esc(s.what)}</span>
        <span class="srcstate">${esc(label)}</span>
      </button>`;
  }).join('');

  $('srcgrid').querySelectorAll('[data-src]').forEach((b) => {
    b.addEventListener('click', () => connect(b));
  });
}

/* Connecting a Google source is a plain navigation through Supabase Auth's own
 * /authorize endpoint — the identical GoTrue flow the login page uses, with two
 * additions Google requires for a refresh token (access_type=offline,
 * prompt=consent) and the one read-only scope this source needs. No SDK, no
 * widget, no third-party script: the browser leaves, consents, and comes back
 * to this page with the grant in the URL fragment.
 *
 * Scopes are requested at CONNECT time, never at sign-in — folding
 * gmail.readonly into login would show every colleague a Gmail consent screen
 * just to open the dashboard.
 */
async function connectGoogle(btn) {
  const provider = btn.dataset.src;
  const st = btn.querySelector('.srcstate');
  st.textContent = 'Redirecting to Google…';
  try {
    const cfg = await api('/v1/connect/config');
    if (!cfg.google_ready) {
      st.textContent = 'Google connect is not configured on this server';
      return;
    }
    sessionStorage.setItem('ob_connect_provider', provider);
    const u = new URL(`${cfg.supabase_url}/auth/v1/authorize`);
    u.searchParams.set('provider', 'google');
    u.searchParams.set('redirect_to', `${location.origin}${location.pathname}`);
    u.searchParams.set('scopes', cfg.google_scopes[provider]);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    /* include_granted_scopes is deliberately ABSENT: with it, Google's Allow
     * click 500s ("Something went wrong") whenever the user already granted
     * another scope — reproduced 2026-08-31. Each source keeps its own
     * refresh token, so merged grants buy nothing anyway. */
    location.href = u.toString();
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

/* Trello, one hop: its /1/authorize page bounces the token straight back in
 * the URL fragment (return_url + callback_method=fragment) — the same return
 * shape as Google, so the wizard catches it and verifies with a live call.
 * No copy-paste. The org's (free) app key is the only one-time ask. */
function trelloAuthorize(cfg) {
  sessionStorage.setItem('ob_connect_provider', 'trello');
  const u = new URL(cfg.trello_authorize_url);
  u.searchParams.set('return_url', location.origin + location.pathname);
  u.searchParams.set('callback_method', 'fragment');
  location.href = u.toString();
}

async function connectTrello(btn) {
  const st = btn.querySelector('.srcstate');
  try {
    const cfg = await api('/v1/connect/config');
    state.cfg = cfg;
    if (cfg.trello_authorize_url) {
      st.textContent = 'Heading to Trello\u2026';
      trelloAuthorize(cfg);
      return;
    }
    const box = $('trello-attach');
    box.hidden = false;
    st.textContent = 'One-time setup \u2014 your organization\u2019s API key';
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth',
                         block: 'nearest' });
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

async function connect(btn) {
  if (btn.dataset.src === 'trello') return connectTrello(btn);
  return connectGoogle(btn);
}

// ---------------------------------------------------------------- step 3
// The plan is not optional: Continue stays disabled until a tier is chosen.
// Choosing writes the subscription immediately (no payment yet — Stripe
// activates it later), so a refresh or a return visit remembers it.

async function renderPlans() {
  const grid = $('plangrid'); const out = $('plan-out');
  try {
    const b = await api('/v1/billing');
    const chosen = b.subscription?.plan_code || '';
    grid.innerHTML = b.plans.map((pl) => `
      <button class="srccard" role="radio" data-plan="${esc(pl.code)}"
              aria-checked="${pl.code === chosen}" data-on="${pl.code === chosen ? '1' : '0'}">
        <span class="srcname">${esc(pl.name)}<span class="sd" aria-hidden="true"></span></span>
        <span class="srcwhat">$${Number(pl.usd_month)}/month &mdash; ${esc(pl.display_tokens)} included, rolls over</span>
        <span class="srcstate">${pl.code === chosen ? 'Selected' : 'Choose'}</span>
      </button>`).join('');
    out.textContent = `Balance: $${Number(b.balance_usd).toFixed(2)} — this month’s use: `
      + `${(b.month_tokens / 1e6).toFixed(2)}M tokens ($${Number(b.month_spend_usd).toFixed(4)})`;
    $('plan-next').disabled = !chosen;
    grid.querySelectorAll('[data-plan]').forEach((card) => {
      card.addEventListener('click', async () => {
        card.querySelector('.srcstate').textContent = 'Saving…';
        try {
          await post('/v1/billing/plan', { plan: card.dataset.plan });
          await renderPlans();
        } catch (e) {
          card.querySelector('.srcstate').textContent = String(e.message || e).slice(0, 60);
        }
      });
    });
  } catch (e) {
    out.textContent = String(e.message || e).slice(0, 120);
  }
}

/* Returning from Google: Supabase puts the grant in the URL fragment. The
 * fragment is scrubbed from the URL and history BEFORE any network call, so
 * tokens never survive in the address bar, a bookmark, or a shared screen. */
async function handleConnectReturn() {
  // The inline stash in onboard.html wins over location.hash: by module
  // time another consumer may already have scrubbed the URL.
  const rawHash = window.__ob_hash || location.hash;
  window.__ob_hash = '';
  const frag = new URLSearchParams(rawHash.slice(1));
  const prt = frag.get('provider_refresh_token');
  const trelloToken = frag.get('token');
  const hadTokens = frag.has('access_token') || frag.has('provider_token')
    || frag.has('token');
  const provider = sessionStorage.getItem('ob_connect_provider');
  if (!hadTokens || !provider) return false;
  history.replaceState(null, '', location.pathname);
  sessionStorage.removeItem('ob_connect_provider');
  state.step = 1;                       // land back on the sources step
  steps.forEach((el, i) => { el.hidden = i !== 1; });
  paintRail();
  if (provider === 'trello') {
    try {
      const res = await post('/v1/connections/trello', { token: trelloToken || '' });
      announce(res.boards > 0
        ? `Trello connected as ${res.account || 'your account'} \u2014 `
          + `${res.boards} open board${res.boards === 1 ? '' : 's'} visible`
        : `Trello verified as ${res.account || 'your account'} \u2014 `
          + 'no open boards visible yet');
    } catch (e) {
      announce('Connecting Trello failed');
      try { await refresh(); } catch { /* render what we have */ }
      renderSources();
      const card = document.querySelector('[data-src="trello"] .srcstate');
      if (card) card.textContent = String(e.message || e).slice(0, 120);
      return true;
    }
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    return true;
  }
  if (!prt) {
    announce('Google did not return offline access');
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) {
      card.textContent = 'Google returned no offline grant — press Connect and '
        + 'approve again';
    }
    return true;
  }
  try {
    await post('/v1/connections/google', {
      provider, provider_refresh_token: prt,
    });
    announce('Source connected and verified');
  } catch (e) {
    announce('Connecting failed');
    try { await refresh(); } catch { /* fall through to render */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) card.textContent = String(e.message || e).slice(0, 120);
    return true;
  }
  try { await refresh(); } catch { /* render what we have */ }
  renderSources();
  return true;
}

// ------------------------------------------------------------------ step 3

const ROW = (ok, name, detail, fix, pending, steps) => `
  <div class="vrow">
    ${pending ? '<span class="spinner" aria-hidden="true"></span>'
              : `<span class="sd" aria-hidden="true" style="margin-top:6px;background:${
                  ok ? 'var(--color-deep-verdant)' : 'var(--color-coral)'}"></span>`}
    <div>
      <b>${esc(name)}</b> <span class="vdetail">${esc(detail || '')}</span>
      ${!ok && fix ? `<p class="vfix">${esc(fix)}</p>` : ''}
      ${!ok && (steps || []).length ? `<ol class="vsteps">
        ${steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>` : ''}
    </div>
  </div>`;

/* Failed platform KEY rows get a paste field — for the operating org only.
 * The key is verified with a real provider call server-side before it is
 * stored (in Vault) and applied live, so no redeploy and no "saved but
 * broken" state. Other tenants keep the read-only hand-off view. */
const KEY_FIELDS = {
  'Anthropic API key': 'anthropic_api_key',
  'Voyage API key': 'voyage_api_key',
};

function keyForm(c) {
  const field = KEY_FIELDS[c.name];
  if (!field) return '';
  /* Keys are PER-ORG: every organization pastes its own and pays its own
   * bills, so there is no admin gate — you can only ever set yours. The ask is
   * ALWAYS present: a missing key asks plainly, a set one offers replacement
   * (self-serve rotation). Only a key entered HERE (provenance "org") counts
   * as set — the deployment's env keys are a bootstrap fallback, and a fresh
   * onboarding must not silently ride on them. Verify-before-store means a bad
   * paste can never displace a working key. */
  const replacing = c.ok && c.provenance === 'org';
  return `<div class="mrow keyform" data-field="${esc(field)}">
      <input class="fi" type="password"
             placeholder="${replacing ? 'paste a new key to replace the current one'
                                      : 'paste the key here'}"
             spellcheck="false" autocomplete="off"
             aria-label="${esc(c.name)}" />
      <button class="ghostpill" data-keysave>${replacing
        ? 'Verify &amp; replace' : 'Verify &amp; apply'}</button>
      <p class="fh" role="status"></p>
    </div>`;
}

function wireKeyForms() {
  document.querySelectorAll('.keyform').forEach((f) => {
    const btn = f.querySelector('[data-keysave]');
    const input = f.querySelector('input');
    const out = f.querySelector('[role="status"]');
    btn.addEventListener('click', async () => {
      const val = input.value.trim();
      if (!val) { out.textContent = 'Paste the key first.'; return; }
      btn.disabled = true; out.textContent = 'Verifying with the provider…';
      try {
        await post('/v1/org/keys', { [f.dataset.field]: val });
        input.value = '';
        out.textContent = 'Verified and applied — re-running the checks…';
        await runChecks();
      } catch (e) {
        out.textContent = String(e.message || e).slice(0, 180);
        btn.disabled = false;
      }
    });
  });
}

async function runChecks() {
  const box = $('vrows');
  $('vtitle').textContent = 'Checking…';
  box.innerHTML = ROW(true, 'Contacting your sources', '', '', true);
  try {
    const res = await api('/v1/preflight');
    /* Both audiences, clearly separated. Your sources first — the rows this org
     * can act on. Then the platform group: the keys and storage the deployment
     * runs on, live-verified here too, because during first setup the person
     * onboarding usually IS the person running the deployment. The label tells
     * everyone else who to hand a red row to, and each failure carries its own
     * numbered walkthrough. */
    const checks = res.checks || [];
    const mine = checks.filter((c) => c.scope === 'org' && c.name !== 'Sources');
    /* Platform = failing infrastructure only. The keys are the ORG's now — they
     * live in the group above with everything else this org sets up. Green
     * infra (sign-in, Vault, database) is noise here and stays in Operations;
     * a FAILING piece always surfaces, because "everything answered" over a
     * dead database would be a lie. */
    const platform = checks.filter((c) => c.scope !== 'org').filter((c) => !c.ok);
    /* A key row is only "done" when this ORG set its own key; the deployment's
     * env keys keep things RUNNING (fallback) but keep the ask OPEN. */
    const keyDone = (c) => KEY_FIELDS[c.name] === undefined
      ? c.ok : (c.ok && c.provenance === 'org');
    const okMine = mine.every((c) => keyDone(c) || !c.required);
    const okPlat = platform.length === 0;
    const onlyEnvKeys = !okMine
      && mine.every((c) => c.ok || !c.required);
    $('vtitle').textContent = !okPlat ? 'The platform needs attention'
      : !okMine ? (onlyEnvKeys ? 'Set your organization\u2019s keys'
                               : 'Some sources need attention')
      : mine.length ? 'Everything answered' : 'Nothing connected yet';
    box.innerHTML = (mine.length
        ? mine.map((c) => {
            const done = keyDone(c);
            const detail = done ? (KEY_FIELDS[c.name] !== undefined
                                     ? (c.detail || 'ok') : 'verified')
              : (c.ok ? 'not set for your organization — running on the '
                        + 'deployment\u2019s fallback key for now'
                      : c.detail);
            return ROW(done, c.name, detail, done ? '' : c.fix, false,
                       done ? [] : c.steps) + keyForm(c);
          }).join('')
        : ROW(true, 'Nothing connected',
              'Connect any source above whenever you want it ingested.', '', false))
      + (platform.length
        ? '<div class="vsub">Platform — what this deployment runs on. Fixed by '
          + 'whoever operates it, not per organization.</div>'
          + platform.map((c) => ROW(false, c.name, c.detail, c.fix, false,
                                    c.steps)).join('')
        : '');
    wireKeyForms();
    announce($('vtitle').textContent);
  } catch (e) {
    $('vtitle').textContent = 'Could not run the checks';
    box.innerHTML = ROW(false, 'Check failed', String(e.message || e).slice(0, 160),
      'Reload the page; if it persists the server may be down.');
  }
}

// ------------------------------------------------------------------ step 4

function renderDone() {
  const live = state.conns.filter((c) => c.status === 'ok').length;
  const name = ($('ob-name').value || '').trim() || (state.ob && state.ob.org) || '';
  $('donesum').textContent = live
    ? `${name} is connected to ${live} source${live === 1 ? '' : 's'}, and OneBrain `
      + 'starts collecting within the minute.'
    : `${name} is ready. Nothing is ingesting automatically yet — connect a source `
      + 'from Settings whenever you want it filled for you.';
  /* The team invite: sign-in is genuinely all a colleague needs, and /welcome
   * walks them through the two optional minutes (their own mailbox, Claude). */
  const invite = $('done-invite');
  if (invite) invite.textContent = `${location.origin}${location.pathname.replace(/onboard\.html$/, "")}index.html`;
  post('/v1/onboarding', { complete: true }).catch(() => {});
}

// ------------------------------------------------------------------- boot

async function refresh() {
  const [ob, conns, cfg] = await Promise.all([
    api('/v1/onboarding'),
    api('/v1/connections').catch(() => ({ connections: [] })),
    api('/v1/connect/config').catch(() => null),
  ]);
  state.ob = ob;
  state.conns = conns.connections || [];
  if (cfg) state.cfg = cfg;
  return ob;
}

/* Controls are wired BEFORE any await. Attaching them after the first fetch
 * meant the page painted a Continue button that silently did nothing until the
 * API came back — the click was simply dropped, which reads as a broken page. */
function wire() {
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    if (state.step === 0) {
      b.disabled = true;
      try { await saveOrg(); } catch { /* naming is not worth blocking setup */ }
      b.disabled = false;
    }
    if (state.step === 1) { try { await refresh(); } catch { /* keep going */ } }
    if (state.step === 2 && $('plan-next').disabled) return;
    show(Math.min(state.step + 1, steps.length - 1));
  }));
  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => show(Math.max(state.step - 1, 0), { back: true })));

  $('vrun').addEventListener('click', runChecks);

  $('tr-origin')?.addEventListener('click', async () => {
    const b = $('tr-origin');
    try {
      await navigator.clipboard.writeText('https://apxlbz.github.io');
      const was = b.innerHTML;
      b.textContent = 'Copied \u2713';
      setTimeout(() => { b.innerHTML = was; }, 1600);
    } catch { /* clipboard blocked: the text is still selectable */ }
  });

  $('tr-key-save').addEventListener('click', async () => {
    const out = $('tr-key-out'); const btn = $('tr-key-save');
    const key = $('tr-key').value.trim();
    if (!key) { out.textContent = 'Paste the API key first.'; return; }
    btn.disabled = true; out.textContent = 'Saving\u2026';
    try {
      await post('/v1/org/keys', { trello_api_key: key });
      $('tr-key').value = '';
      const cfg = await api('/v1/connect/config');
      state.cfg = cfg;
      out.textContent = 'Saved \u2014 heading to Trello to approve\u2026';
      trelloAuthorize(cfg);
    } catch (e) {
      out.textContent = `Failed: ${String(e.message || e).slice(0, 140)}`;
      btn.disabled = false;
    }
  });
}

async function boot() {
  wire();
  paintRail();
  const returned = await handleConnectReturn();
  let ob;
  try { ob = await refresh(); } catch { return; }   // 401 already redirected
  $('ob-domain').textContent = ob.org || '';
  if (ob.display_name) $('ob-name').value = ob.display_name;
  $('ob-name').placeholder = ob.org || 'Acme Inc.';
  if (ob.steps) {
    if (ob.steps.team) $('ob-team').value = ob.steps.team;
    if (ob.steps.goal) $('ob-goal').value = ob.steps.goal;
  }
  document.querySelectorAll('.reveal, [data-words]').forEach((el) => el.classList.add('in'));
  if (returned) renderSources();

  // Already finished? Say so rather than walking them through it again.
  if (ob.completed_at) $('exit').textContent = 'Back to dashboard';
}

boot();
