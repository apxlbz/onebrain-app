import { FN } from "./env.js?v=1";

/* The API reference renders itself entirely from GET /api/openapi.json —
 * there is no baked-in copy of the spec anywhere in this file, so the page
 * can never show a route the API no longer has (or miss one it grew).
 * "Try it" fires real requests at the live backend with the pasted token;
 * see docs.html's "Other assistants" section for where that token comes from.
 */

'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Calls that write or delete get an inline warning instead of a confirm()
// dialog — the server-side guards (confirm/dry_run/MIN_FORGET_CONTAINS) are
// the real safety net; this just sets expectations before a click.
const WRITES = new Set(['POST /v1/remember', 'POST /v1/import', 'POST /v1/forget']);

const TOKEN_KEY = 'ob_api_ref_token';
const tokInput = $('tok');
tokInput.value = sessionStorage.getItem(TOKEN_KEY) ?? '';
tokInput.addEventListener('input', () => sessionStorage.setItem(TOKEN_KEY, tokInput.value));
$('tok-toggle').addEventListener('click', () => {
  const show = tokInput.type === 'password';
  tokInput.type = show ? 'text' : 'password';
  $('tok-toggle').textContent = show ? 'hide' : 'show';
});

function fieldRows(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, def]) => {
    const type = Array.isArray(def.type) ? def.type.join('|') : (def.type ?? '');
    const req = required.has(name) ? ' (required)' : '';
    return `<div><code>${esc(name)}</code> <span class="muted">${esc(type)}${req}` +
      `${def.description ? ' — ' + esc(def.description) : ''}</span></div>`;
  }).join('');
}

function exampleBody(op) {
  const ex = op.requestBody?.content?.['application/json']?.example;
  return ex ? JSON.stringify(ex, null, 2) : '';
}

async function send(method, path, tryId) {
  const out = $(`${tryId}-out`);
  const btn = $(`${tryId}-send`);
  const token = tokInput.value.trim();
  if (!token) {
    out.className = 'result show';
    out.innerHTML = '<span class="code bad">—</span> paste a bearer token above first';
    return;
  }
  let body;
  if (method === 'post') {
    const raw = $(`${tryId}-body`).value.trim();
    try { body = raw ? JSON.parse(raw) : {}; } catch {
      out.className = 'result show';
      out.innerHTML = '<span class="code bad">—</span> request body is not valid JSON';
      return;
    }
  }
  btn.disabled = true;
  out.className = 'result show';
  out.innerHTML = '<span class="muted">sending&hellip;</span>';
  try {
    const r = await fetch(`${FN}/api${path}`, {
      method: method.toUpperCase(),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'post' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'post' ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
    out.innerHTML = `<span class="code ${r.ok ? 'ok' : 'bad'}">${r.status}</span>` +
      `<pre>${esc(pretty)}</pre>`;
  } catch (e) {
    out.innerHTML = `<span class="code bad">network error</span><pre>${esc(String(e))}</pre>`;
  } finally {
    btn.disabled = false;
  }
}

function renderEndpoint(path, method, op) {
  const tryId = `try-${method}-${path.replace(/[^a-z0-9]+/gi, '-')}`;
  const schema = method === 'post'
    ? op.requestBody?.content?.['application/json']?.schema
    : null;
  const fields = schema ? fieldRows(schema) : '';
  const warn = WRITES.has(`${method.toUpperCase()} ${path}`)
    ? `<p class="warn">This call ${path === '/v1/forget' ? 'deletes' : 'writes to'} your real memory — it runs against the live backend with your token.</p>`
    : '';
  const bodyBox = method === 'post'
    ? `<textarea id="${tryId}-body" rows="6" spellcheck="false">${esc(exampleBody(op) || '{}')}</textarea>`
    : '';
  return `
    <div class="endpoint">
      <div class="head">
        <span class="method ${method}">${method.toUpperCase()}</span>
        <span class="path">${esc(path)}</span>
        <span class="summary">${esc(op.summary ?? '')}</span>
      </div>
      <p class="desc">${esc(op.description ?? '')}</p>
      ${fields ? `<div class="fields">${fields}</div>` : ''}
      ${warn}
      <details class="try">
        <summary>Try it</summary>
        <div class="try-body">
          ${bodyBox}
          <div><button id="${tryId}-send" type="button">Send</button></div>
          <div id="${tryId}-out" class="result"></div>
        </div>
      </details>
    </div>`;
}

async function main() {
  const status = $('status');
  let spec;
  try {
    const r = await fetch(`${FN}/api/openapi.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    spec = await r.json();
  } catch (e) {
    status.textContent = `Couldn't load the spec: ${String(e.message ?? e)}`;
    status.setAttribute('data-err', '');
    return;
  }
  status.remove();
  const container = $('endpoints');
  const cards = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      cards.push({ path, method, op, html: renderEndpoint(path, method, op) });
    }
  }
  container.innerHTML = cards.map((c) => c.html).join('');
  for (const { path, method } of cards) {
    const tryId = `try-${method}-${path.replace(/[^a-z0-9]+/gi, '-')}`;
    $(`${tryId}-send`).addEventListener('click', () => send(method, path, tryId));
  }
}

main();
