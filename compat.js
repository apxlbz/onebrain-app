/* Compatibility layer: the classic dashboard's api()/post() contract, served
 * by the new Supabase-native stack. The 1,100 lines of render logic in
 * legacy.js run unmodified; this file translates each old endpoint into
 * PostgREST reads (RLS enforces tenancy), Edge Function calls, or client-side
 * aggregation. Loaded before legacy.js; exposes window.OB.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { FN } from "./env.js?v=1";

const cfg = await fetch(`${FN}/api/config`).then((r) => r.json());
// detectSessionInUrl stays OFF here: the wizard's Google-connect return
// carries a grant in the URL fragment that onboard.js must read itself —
// supabase-js would consume and scrub it first. Only index.html detects.
const sb = createClient(cfg.supabase_url, cfg.supabase_anon_key,
                        { auth: { detectSessionInUrl: false } });
let session = (await sb.auth.getSession()).data.session;
sb.auth.onAuthStateChange((_e, s) => { session = s; });

function needAuth() {
  if (!session) {
    location.href = "./index.html";
    throw new Error("unauthenticated");
  }
}

async function fnCall(path, body, method = "POST") {
  needAuth();
  const r = await fetch(`${FN}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`,
               "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error ?? `HTTP ${r.status}`).slice(0, 200));
  return data;
}

let statsCache = null;
async function stats() {
  if (!statsCache) {
    const { data, error } = await sb.rpc("dashboard_stats");
    if (error) throw new Error(error.message);
    statsCache = data;
    setTimeout(() => { statsCache = null; }, 15_000);
  }
  return statsCache;
}

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

async function memories(params) {
  const q = params.get("q") ?? "";
  const source = params.get("source") ?? "";
  const type = params.get("type") ?? "";
  const history = params.get("history") === "1";
  const offset = Number(params.get("offset")) || 0;
  const limit = Number(params.get("limit")) || 50;
  const order = params.get("order") || "recent";

  let sel = sb.from("knowledge")
    .select("id,content,type,entity,product,topic,system,tags,created_at," +
            "happened_at,is_current,importance,memory_raw!inner(source,metadata)",
            { count: "exact" });
  if (!history) sel = sel.or("is_current.is.null,is_current.is.true");
  if (type) sel = sel.eq("type", type);
  if (source) sel = sel.eq("memory_raw.source", source);
  if (q) sel = sel.ilike("content", `%${q}%`);
  sel = order === "importance"
    ? sel.order("importance", { ascending: false })
    : sel.order("created_at", { ascending: false });
  const { data, count, error } = await sel.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map((f) => ({
      ...f,
      is_current: f.is_current ?? true,
      source: f.memory_raw?.source ?? "note",
    })),
    total: count ?? 0,
    offset,
  };
}

async function factDetail(id) {
  const { data, error } = await sb.from("knowledge")
    .select("*,memory_raw(source,metadata,content,created_at)")
    .eq("id", id).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "not found");
  return {
    ...data,
    is_current: data.is_current ?? true,
    source: data.memory_raw?.source ?? "note",
    title: data.memory_raw?.metadata?.title ?? "",
    raw: data.memory_raw?.content ?? "",
    // Supersession history returns with the quality-layer port; shape kept.
    history: { replaced: [], replaced_by: null },
    siblings: [],
  };
}

async function ops(days) {
  needAuth();
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await sb.from("recall_events")
    .select("query,result_count,latency_ms,created_at")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const lat = rows.map((r) => r.latency_ms).filter((x) => x != null);
  const byQuery = new Map();
  for (const r of rows) {
    const k = r.query.trim().toLowerCase();
    const cur = byQuery.get(k) ?? { query: r.query, n: 0, zero: 0, last_at: r.created_at };
    cur.n++;
    if (!r.result_count) cur.zero++;
    if (r.created_at > cur.last_at) cur.last_at = r.created_at;
    byQuery.set(k, cur);
  }
  const all = [...byQuery.values()];
  const daily = {};
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    daily[day] = (daily[day] ?? 0) + 1;
  }
  return {
    days,
    recalls: rows.length,
    p50_ms: percentile(lat, 0.5),
    p95_ms: percentile(lat, 0.95),
    avg_results: rows.length
      ? (rows.reduce((a, r) => a + (r.result_count ?? 0), 0) / rows.length).toFixed(1)
      : "0",
    zero_results: rows.filter((r) => !r.result_count).length,
    zero_rate: rows.length ? rows.filter((r) => !r.result_count).length / rows.length : 0,
    daily: Object.entries(daily).sort().map(([day, n]) => ({ day, n })),
    empty: all.filter((r) => r.zero).sort((a, b) => b.n - a.n).slice(0, 8),
    top: all.sort((a, b) => b.n - a.n).slice(0, 8),
    slowest: rows.filter((r) => r.latency_ms != null)
      .sort((a, b) => b.latency_ms - a.latency_ms).slice(0, 8),
  };
}

/* Usage page: raw metered events read via PostgREST (RLS scopes them to the
 * member's org), aggregated here exactly like /v1/ops — the server already
 * priced each row at read time through the usage_priced view. */
async function usageSummary() {
  needAuth();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [ev, led, billing] = await Promise.all([
    sb.from("usage_priced")
      .select("at,operation,provider,model,tokens_in,tokens_out,usd")
      .gte("at", since).order("at", { ascending: false }).limit(5000),
    sb.from("credit_ledger").select("at,delta_usd,reason")
      .order("at", { ascending: false }).limit(50),
    fnCall("/v1/billing", null, "GET"),
  ]);
  if (ev.error) throw new Error(ev.error.message);
  const daily = {}; const byOp = new Map(); const byModel = new Map();
  for (const r of ev.data ?? []) {
    const t = (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
    const u = Number(r.usd ?? 0);
    const day = r.at.slice(0, 10);
    daily[day] = (daily[day] ?? 0) + t;
    const o = byOp.get(r.operation) ?? { operation: r.operation, tokens: 0, usd: 0, n: 0 };
    o.tokens += t; o.usd += u; o.n++; byOp.set(r.operation, o);
    const mk = `${r.provider}/${r.model}`;
    const m = byModel.get(mk) ?? { model: mk, tokens: 0, usd: 0 };
    m.tokens += t; m.usd += u; byModel.set(mk, m);
  }
  const plan = billing.subscription
    ? { ...(billing.plans.find((x) => x.code === billing.subscription.plan_code) ?? {}),
        ...billing.subscription }
    : null;
  return {
    days: 30,
    balance_usd: billing.balance_usd,
    month_tokens: billing.month_tokens,
    month_spend_usd: billing.month_spend_usd,
    plan,
    events: (ev.data ?? []).length,
    daily: Object.entries(daily).sort().map(([day, cnt]) => ({ day, n: cnt })),
    by_op: [...byOp.values()].sort((a, b) => b.usd - a.usd),
    by_model: [...byModel.values()].sort((a, b) => b.usd - a.usd),
    ledger: led.data ?? [],
  };
}

async function routeGet(path) {
  const [p, qsRaw] = path.split("?");
  const params = new URLSearchParams(qsRaw ?? "");

  if (p === "/auth/me") {
    return session
      ? { authenticated: true, email: session.user.email,
          org: session.user.email.split("@").pop() }
      : { authenticated: false, login_enabled: true };
  }
  if (p === "/v1/stats") return await stats();
  if (p === "/v1/health") {
    const s = await stats();
    const issues = [];
    if (Number(s.unenriched) > 0) {
      issues.push({ level: "warn", key: "unenriched", count: s.unenriched,
        title: `${s.unenriched} input(s) not yet turned into facts`,
        detail: "The self-heal sweep retries these automatically every cycle.",
        action: "" });
    }
    return { issues };
  }
  if (p === "/v1/onboarding") {
    needAuth();
    const { data } = await sb.from("onboarding").select("*").maybeSingle();
    const { data: org } = await sb.from("orgs").select("name,display_name").maybeSingle();
    return { ...(data ?? { completed_at: null }),
             org: org?.display_name || org?.name || "" };
  }
  if (p === "/v1/memory-types") {
    const s = await stats();
    return {
      sources: (s.by_source ?? []).map((r) => ({ source: r.source, count: r.n })),
      types: (s.by_type ?? []).map((r) => ({ type: r.type, count: r.n })),
    };
  }
  if (p === "/v1/memories") { needAuth(); return await memories(params); }
  if (p.startsWith("/v1/memories/")) {
    needAuth();
    return await factDetail(decodeURIComponent(p.slice("/v1/memories/".length)));
  }
  if (p.startsWith("/v1/ops")) return await ops(Number(params.get("days")) || 14);
  if (p === "/v1/org") {
    needAuth();
    const { data } = await sb.from("org_overview").select("*").maybeSingle();
    return { name: data?.name, raw: data?.raw_inputs ?? 0,
             facts: data?.facts ?? 0, entities: data?.entities ?? 0, tokens: 0 };
  }
  if (p === "/v1/members") {
    needAuth();
    const { data } = await sb.from("members").select("*")
      .order("last_seen", { ascending: false });
    const { data: conns } = await sb.from("connections")
      .select("provider,member_email").eq("provider", "gmail");
    const mine = new Set((conns ?? []).map((c) => c.member_email));
    return { members: (data ?? []).map((m) => ({
      ...m, gmail_connected: mine.has(m.email) })) };
  }
  if (p === "/v1/billing") return await fnCall("/v1/billing", null, "GET");
  if (p === "/v1/insights") return await fnCall("/v1/insights", null, "GET");
  if (p === "/v1/usage") return await usageSummary();
  if (p === "/v1/preflight") return await fnCall("/v1/preflight", null, "GET");
  if (p === "/v1/connect/config") return await fnCall("/v1/connect/config", null, "GET");
  if (p === "/v1/connections") {
    needAuth();
    const { data } = await sb.from("connections")
      .select("provider,member_email,connection_id,status,last_ok_at,last_error");
    return { connections: data ?? [] };
  }
  throw new Error(`this view isn't wired to the new engine yet (${p})`);
}

window.OB = {
  token: () => session?.access_token ?? null,
  async api(path, opts = {}) {
    if (!opts.method || opts.method === "GET") return await routeGet(path);
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (path === "/v1/recall") return await fnCall("/v1/recall", body);
    if (path === "/v1/who-knows") return await fnCall("/v1/who-knows", body);
    if (path === "/v1/me/token") return await fnCall("/v1/me/token", body);
    if (path === "/v1/feedback") return await fnCall("/v1/feedback", body);
    if (path === "/v1/org/keys") return await fnCall("/v1/org/keys", body);
    if (path === "/v1/onboarding") return await fnCall("/v1/onboarding", body);
    if (path === "/v1/billing/plan") return await fnCall("/v1/billing/plan", body);
    if (path === "/v1/insights") return await fnCall("/v1/insights", body);
    if (path === "/v1/billing/checkout") return await fnCall("/v1/billing/checkout", body);
    if (path === "/v1/billing/portal") return await fnCall("/v1/billing/portal", body);
    if (path === "/v1/connections/google") return await fnCall("/v1/connections/google", body);
    if (path === "/v1/connections/trello") return await fnCall("/v1/connections/trello", body);
    throw new Error(`this action isn't wired to the new engine yet (${path})`);
  },
  signout() { sb.auth.signOut().then(() => { location.href = "./index.html"; }); },
};
