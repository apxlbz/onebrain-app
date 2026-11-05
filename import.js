import "./compat.js?v=14";
import { FN } from "./env.js?v=1";
import { FORMAT_LABELS, importBatches, parseImport } from "./import_parse.js?v=1";

/* Switch-moment import: paste an existing memory file or an export, parse it
 * in the browser with the PB-4 parser (import_parse.js), and send it in
 * batches to POST /api/v1/import, the same route onboarding's step five uses.
 * The route hashes each line into a source_ref (a repeat is reported as a
 * duplicate, not stored again), runs the single-write gates once per
 * batch, and writes into the signed-in caller's own org. This page only
 * batches, waits and reports.
 *
 * A 429 from the per-minute write brake is not a failure: wait it out and
 * resend the same batch. The daily cap and 402s stop the run with the
 * server's own words.
 */

'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BATCH = 20;           // = IMPORT_BATCH_MAX in _shared/policy.ts
const MAX_WAIT_S = 120;     // longest single pause for a 429

const state = { parsed: null, failed: [], stop: false, running: false };

const setCount = () => {
  const el = $('imp-count');
  el.removeAttribute('data-warn');
  const text = $('imp-text').value;
  state.parsed = text.trim() ? parseImport(text) : null;
  const p = state.parsed;
  if (!p) el.textContent = '';
  else if (p.error) { el.textContent = p.error; el.setAttribute('data-warn', ''); }
  else {
    const n = p.items.length;
    el.textContent = `${FORMAT_LABELS[p.format]}: ${n} ${n === 1 ? 'memory' : 'memories'} found`
      + (p.truncated ? ` — ${p.truncated} more beyond the limit will be left out` : '');
    if (p.truncated) el.setAttribute('data-warn', '');
  }
  $('imp-go').disabled = !(p && !p.error && p.items.length) || state.running;
  $('imp-clear').hidden = !text;
};

/* Seconds to wait after a 429: Retry-After if the server sent one, else the
 * per-minute window. */
const waitSeconds = (r) => {
  const h = Number(r.headers.get('Retry-After'));
  return Math.min(MAX_WAIT_S, h > 0 ? Math.ceil(h) : 60);
};

async function run(batches) {
  state.running = true; state.stop = false;
  const total = { stored: 0, duplicates: 0, gated: 0, failed: 0 };
  const n = batches.reduce((a, b) => a + b.items.length, 0);
  let done = 0, error = '';
  state.failed = [];
  $('imp-text').disabled = true;
  $('imp-go').disabled = true;
  $('imp-res').hidden = true;
  $('imp-prog').hidden = false;
  const paint = (note) => {
    const pct = Math.round((done / n) * 100);
    $('imp-bar').setAttribute('aria-valuenow', pct);
    $('imp-bar').firstElementChild.style.width = `${pct}%`;
    $('imp-pt').textContent = note || `${done} of ${n} read — ${total.stored} stored`;
  };
  paint();
  let b = 0;
  try {
    while (b < batches.length && !state.stop) {
      const token = globalThis.OB.token();
      if (!token) throw new Error('Sign in to import');
      const r = await fetch(`${FN}/api/v1/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batches[b]),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429 && !/per day/.test(String(data.error || ''))) {
        const s = waitSeconds(r);
        for (let i = s; i > 0 && !state.stop; i--) {
          paint(`${done} of ${n} read — pausing ${i}s: big imports go in at a steady pace…`);
          await sleep(1000);
        }
        continue; // resend the same batch; repeats are skipped server-side
      }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      for (const k of Object.keys(total)) total[k] += Number(data[k] || 0);
      done += batches[b].items.length;
      b++; paint();
    }
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 160);
  }
  // Not attempted (stopped or aborted): retryable, and repeats are skipped.
  state.failed = batches.slice(b);
  const notTried = state.failed.reduce((a, x) => a + x.items.length, 0);
  state.running = false;
  $('imp-text').disabled = false;
  $('imp-prog').hidden = true;
  showResult(total, error, notTried, state.stop);
  setCount();
}

function showResult(t, error, notTried, stopped) {
  $('r-stored').textContent = t.stored;
  $('r-dup').textContent = t.duplicates;
  $('r-skip').textContent = t.gated;
  $('r-fail').textContent = t.failed + notTried;
  let msg;
  if (error) {
    msg = /credit|quota|payment/i.test(error)
      ? 'Your organization is out of credit, so the import stopped. Add credit and retry the rest.'
      : `The import stopped (${error}). ${notTried} not attempted. What was saved stays saved; retry the rest below.`;
  } else if (stopped) msg = `Stopped. ${notTried} not attempted.`;
  else if (t.failed) msg = `Imported with ${t.failed} failure${t.failed === 1 ? '' : 's'}. Press Import again to retry; repeats are skipped.`;
  else if (!t.stored && t.duplicates) msg = 'Everything here was already in your memory.';
  else if (!t.stored) msg = 'Nothing durable was found to store. Lines like greetings or one-word notes are skipped.';
  else msg = 'Done. Your memories are searchable now; OneBrain keeps enriching them in the background.';
  $('r-msg').textContent = msg;
  const list = $('r-errs');
  list.hidden = !error;
  list.innerHTML = error ? `<li>${esc(error)}</li>` : '';
  $('r-retry').hidden = !state.failed.length;
  $('imp-res').hidden = false;
  $('live').textContent = msg;
  $('imp-res').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('imp-text').addEventListener('input', setCount);
$('imp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = state.parsed;
  if (state.running || !p || p.error || !p.items.length) return;
  run(importBatches(p, BATCH));
});
$('imp-stop').addEventListener('click', () => { state.stop = true; });
$('imp-clear').addEventListener('click', () => {
  $('imp-text').value = ''; $('imp-res').hidden = true; setCount(); $('imp-text').focus();
});
$('r-again').addEventListener('click', () => {
  $('imp-text').value = ''; $('imp-res').hidden = true; setCount(); $('imp-text').focus();
});
$('r-retry').addEventListener('click', () => {
  if (!state.running && state.failed.length) run(state.failed.slice());
});
$('imp-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 1_000_000) { $('imp-count').textContent = 'That file is over 1 MB — paste the relevant part instead.'; return; }
  $('imp-text').value = await f.text();
  setCount();
});
setCount();
