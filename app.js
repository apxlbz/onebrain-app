/* OneBrain dashboard — Supabase-native data layer.
 *
 * Reads go straight to PostgREST (RLS enforces tenancy in the database);
 * writes and search go to the api Edge Function with the session token;
 * Realtime streams new facts into the Overview. No app server in sight.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
const SUPA_ORIGIN = "https://epjkzltwyfexiunbmbel.supabase.co";
const cfg = await fetch(`${SUPA_ORIGIN}/functions/v1/api/config`).then((r) => r.json());
const sb = createClient(cfg.supabase_url, cfg.supabase_anon_key);
const FN = cfg.fn_base; // .../functions/v1

let session = (await sb.auth.getSession()).data.session;

async function api(path, body, method = "POST") {
  const r = await fetch(`${FN}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

/* ------------------------------------------------------------- sign-in */
$("google").addEventListener("click", async () => {
  $("signin-status").textContent = "Redirecting to Google…";
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) $("signin-status").textContent = error.message;
});

/* ------------------------------------------------------------ overview */
async function loadOverview() {
  const { data: ov } = await sb.from("org_overview").select("*").maybeSingle();
  if (!ov) return;
  $("org-title").textContent = ov.display_name || ov.name;
  const last = ov.last_ingest
    ? `${Math.max(0, Math.round((Date.now() - new Date(ov.last_ingest)) / 60000))}m ago`
    : "—";
  $("stats").innerHTML = [
    ["facts", ov.facts], ["inputs", ov.raw_inputs], ["entities", ov.entities],
    ["edges", ov.edges], ["unenriched", ov.unenriched], ["last ingest", last],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");

  const { data: recent } = await sb.from("knowledge")
    .select("content,type,created_at")
    .order("created_at", { ascending: false }).limit(12);
  $("recent").innerHTML = (recent ?? []).map(factLi).join("");
}

function factLi(f, fresh = false) {
  const when = new Date(f.created_at).toLocaleString();
  return `<li${fresh ? ' class="new"' : ""}><span class="tag">${f.type ?? "fact"}</span>` +
    `${escapeHtml(f.content)} <span class="dim">· ${when}</span></li>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function watchRealtime() {
  sb.channel("fresh-facts").on("postgres_changes",
    { event: "INSERT", schema: "public", table: "knowledge" },
    (payload) => {
      $("recent").insertAdjacentHTML("afterbegin", factLi(payload.new, true));
      $("live-dot").textContent = "· live";
    }).subscribe((s) => {
      if (s === "SUBSCRIBED") $("live-dot").textContent = "· live";
    });
}

/* -------------------------------------------------------------- search */
$("go").addEventListener("click", doSearch);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
async function doSearch() {
  const query = $("q").value.trim();
  if (!query) return;
  $("search-status").textContent = "Searching…";
  try {
    const { results } = await api("/v1/recall", { query, limit: 10 });
    $("search-status").textContent = results.length ? "" : "Nothing relevant found.";
    $("results").innerHTML = results.map((f) =>
      `<li><span class="tag">${f.type}</span>${escapeHtml(f.content)}` +
      ` <span class="dim">· ${f.source ?? ""}${
        f.entity ? " · " + escapeHtml(f.entity) : ""}</span></li>`).join("");
  } catch (e) {
    $("search-status").textContent = e.message;
  }
}

/* --------------------------------------------------------------- setup */
for (const btn of document.querySelectorAll("[data-g]")) {
  btn.addEventListener("click", async () => {
    const provider = btn.dataset.g;
    const conf = await api("/v1/connect/config", null, "GET");
    if (!conf.google_ready) {
      $("setup-status").textContent =
        "Google connect is not configured on this deployment yet (client id/secret).";
      return;
    }
    sessionStorage.setItem("pending_google", provider);
    const u = new URL(`${cfg.supabase_url}/auth/v1/authorize`);
    u.searchParams.set("provider", "google");
    u.searchParams.set("redirect_to", location.origin + location.pathname);
    u.searchParams.set("scopes", conf.google_scopes[provider]);
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    location.href = u.toString();
  });
}

async function handleGoogleReturn() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const prt = frag.get("provider_refresh_token");
  const pending = sessionStorage.getItem("pending_google");
  if (!frag.has("access_token") || !pending) return;
  history.replaceState(null, "", location.pathname); // scrub before any request
  sessionStorage.removeItem("pending_google");
  showView("setup");
  $("setup-status").textContent = prt
    ? "Verifying the grant with Google…"
    : "Google returned no offline grant — press Connect and approve again.";
  if (!prt) return;
  try {
    await api("/v1/connections/google", { provider: pending, provider_refresh_token: prt });
    $("setup-status").textContent =
      `${pending} connected — ingestion picks it up within a minute.`;
  } catch (e) {
    $("setup-status").textContent = e.message;
  }
}

$("trello-key-save").addEventListener("click", async () => {
  try {
    await api("/v1/org/keys", { trello_api_key: $("trello-key").value.trim() });
    const conf = await api("/v1/connect/config", null, "GET");
    $("trello-open").href = conf.trello_authorize_url;
    $("trello-open").classList.remove("hide");
    $("setup-status").textContent =
      "Key stored. Open the authorize link, press Allow, and paste the token.";
  } catch (e) { $("setup-status").textContent = e.message; }
});
$("trello-save").addEventListener("click", async () => {
  try {
    const res = await api("/v1/connections/trello", { token: $("trello-token").value.trim() });
    $("setup-status").textContent = `Trello connected as ${res.account}.`;
  } catch (e) { $("setup-status").textContent = e.message; }
});

$("k-save").addEventListener("click", async () => {
  try {
    const out = await api("/v1/org/keys", {
      anthropic_api_key: $("k-anthropic").value.trim(),
      voyage_api_key: $("k-voyage").value.trim(),
    });
    $("keys-status").textContent = JSON.stringify(out);
    $("k-anthropic").value = ""; $("k-voyage").value = "";
  } catch (e) { $("keys-status").textContent = e.message; }
});

$("pf-run").addEventListener("click", async () => {
  $("pf-rows").innerHTML = "<li class='dim'>Checking — every row is a live call…</li>";
  const pf = await api("/v1/preflight", null, "GET");
  $("pf-rows").innerHTML = pf.checks.map((c) =>
    `<li><b class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"}</b> ` +
    `${escapeHtml(c.name)}${c.member ? ` <span class="dim">(${escapeHtml(c.member)})</span>` : ""}` +
    ` <span class="dim">${escapeHtml(c.detail ?? "")}${c.fix ? " — " + escapeHtml(c.fix) : ""}</span></li>`)
    .join("");
});

/* ------------------------------------------------------------ settings */
async function loadSettings() {
  $("invite").textContent = location.origin + location.pathname;
  const { data: people } = await sb.from("members").select("*")
    .order("last_seen", { ascending: false });
  $("people").innerHTML = (people ?? []).map((m) =>
    `<tr><td>${escapeHtml(m.email)}</td><td>${new Date(m.last_seen).toLocaleString()}</td>` +
    `<td class="mono">${escapeHtml(m.last_surface)}</td><td>${m.recalls}</td><td>${m.remembers}</td></tr>`)
    .join("") || "<tr><td colspan=5 class='dim'>nobody yet</td></tr>";

  const { data: bal } = await sb.from("org_balance").select("balance_usd").maybeSingle();
  const { data: usage } = await sb.from("usage_priced").select("*")
    .order("at", { ascending: false }).limit(200);
  const spend = (usage ?? []).reduce((a, u) => a + Number(u.usd ?? 0), 0);
  $("balance").textContent =
    `Balance: $${Number(bal?.balance_usd ?? 0).toFixed(4)} · recent spend shown below ` +
    `($${spend.toFixed(4)} across the last ${usage?.length ?? 0} calls).`;
  const byDay = {};
  for (const u of usage ?? []) {
    const day = String(u.at).slice(0, 10);
    const key = `${day}|${u.operation}|${u.provider}`;
    byDay[key] = byDay[key] ??
      { day, op: u.operation, prov: u.provider, tin: 0, tout: 0, usd: 0 };
    byDay[key].tin += Number(u.tokens_in); byDay[key].tout += Number(u.tokens_out);
    byDay[key].usd += Number(u.usd ?? 0);
  }
  $("usage").innerHTML = Object.values(byDay).map((r) =>
    `<tr><td>${r.day}</td><td>${r.op}</td><td class="mono">${r.prov}</td>` +
    `<td>${r.tin.toLocaleString()}</td><td>${r.tout.toLocaleString()}</td>` +
    `<td>$${r.usd.toFixed(5)}</td></tr>`).join("") ||
    "<tr><td colspan=6 class='dim'>no usage yet</td></tr>";

  $("mcp-cmd").textContent =
    `claude mcp add --scope user --transport http \\\n  onebrain ${FN}/mcp`;
}

$("ob-done").addEventListener("click", async () => {
  try {
    await api("/v1/onboarding", { complete: true });
    $("ob-status").textContent = "Setup marked complete.";
  } catch (e) { $("ob-status").textContent = e.message; }
});

$("mint").addEventListener("click", async () => {
  try {
    const res = await api("/v1/me/token");
    $("hooks-cfg").classList.remove("hide");
    $("hooks-cfg").textContent =
      `mkdir -p ~/.config/onebrain\ncat > ~/.config/onebrain/config <<'EOF'\n` +
      `export ONEBRAIN_URL=${FN}/api\nexport ONEBRAIN_TOKEN=${res.token}\nEOF`;
  } catch (e) { $("hooks-cfg").classList.remove("hide"); $("hooks-cfg").textContent = e.message; }
});

/* ------------------------------------------------------------ app shell */
function showView(name) {
  for (const s of document.querySelectorAll("[data-view]")) {
    s.classList.toggle("hide", s.dataset.view !== name);
  }
  for (const b of document.querySelectorAll("#nav button")) {
    b.classList.toggle("on", b.dataset.v === name);
  }
  if (name === "settings") loadSettings();
  if (name === "overview") loadOverview();
}
$("nav").addEventListener("click", (e) => {
  if (e.target.dataset.v) showView(e.target.dataset.v);
});

async function boot() {
  // Returning from an OAuth redirect, supabase-js absorbs the session fragment.
  session = (await sb.auth.getSession()).data.session;
  if (!session) {
    sb.auth.onAuthStateChange((_e, s) => { if (s) { session = s; boot(); } });
    return;
  }
  $("signin").classList.add("hide");
  $("app").classList.remove("hide");
  $("me").textContent = session.user.email;
  if (location.hash === "#setup") {
    showView("setup");
  } else {
    // First-run nudge: an org that hasn't finished setup lands on Setup,
    // once per browser session (never a persistent gate).
    try {
      const { data: ob } = await sb.from("onboarding").select("completed_at").maybeSingle();
      if (!(ob && ob.completed_at) && !sessionStorage.getItem("ob_nudged")) {
        sessionStorage.setItem("ob_nudged", "1");
        location.href = "./onboard.html"; return;
      }
    } catch { /* the overview still stands */ }
  }
  await handleGoogleReturn();
  await loadOverview();
  watchRealtime();
}
boot();
