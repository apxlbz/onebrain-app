// Per-agent provenance badge (CM-2). Browser mirror of agentBadge() in
// _shared/policy.ts (a test pins that the two agree). Reads the proposed PB-2
// shape metadata.provenance.agent = { id, name, kind }, falls back to the
// stamped `source` label, and ends in an explicit "unknown agent" state.
const KINDS = ["human", "agent", "automation"];
const GENERIC = ["", "note", "unknown", "api", "mcp"];
const CONNECTORS = ["gmail", "google_meet", "google_calendar", "trello"];
const clean = (v, max) => String(v ?? "")
  // deno-lint-ignore no-control-regex
  .replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function agentBadge(r) {
  const meta = r && r.metadata && typeof r.metadata === "object" ? r.metadata : {};
  const make = (id, name, kind) => ({ id, name, kind, label: `${name} · ${kind}`, known: true });
  const a = meta.provenance && meta.provenance.agent;
  const name = a && typeof a === "object" ? clean(a.name, 64) : "";
  if (name) {
    return make(clean(a.id, 128) || null, name, KINDS.includes(String(a.kind)) ? String(a.kind) : "agent");
  }
  const src = clean(r && r.source, 64);
  const low = src.toLowerCase();
  if (CONNECTORS.includes(low) || low.startsWith("mcp:")) {
    return make(null, src.replace(/^mcp:/i, ""), "automation");
  }
  if (GENERIC.includes(low)) {
    return { id: null, name: "Unknown agent", kind: "unknown", label: "Unknown agent", known: false };
  }
  return make(null, src.replace(/^agent:/i, ""), "agent");
}

/** HTML for the badge; `esc` is the page's escaper. */
export function badgeHTML(r, esc) {
  const b = agentBadge(r);
  return `<span class="pill badge-${b.kind}" data-agent-kind="${b.kind}" title="${
    esc(b.known ? `Written by ${b.name} (${b.kind})` : "No agent recorded for this fact")}">${
    esc(b.known ? b.label : b.name)}</span>`;
}
