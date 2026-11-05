import { FN } from "./env.js?v=1";

/* OneBrain public status page: backend health + incident history +
 * subscribe-to-updates. No auth, no session — everything here is public by
 * design, so every call is a plain fetch against the api function. */

const API = `${FN}/api`;

function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function severityLabel(sev) {
  return sev === "critical" ? "Critical" : sev === "major" ? "Major" : "Minor";
}

function renderIncident(inc) {
  const li = document.createElement("li");
  const strong = document.createElement("strong");
  strong.textContent = severityLabel(inc.severity);
  li.append(strong, document.createTextNode(` — ${inc.title} `));
  const span = document.createElement("span");
  span.className = "muted";
  span.textContent = `(${fmtDate(inc.started_at)}, ` +
    (inc.resolved_at ? `resolved ${fmtDate(inc.resolved_at)})` : "ongoing)");
  li.append(span);
  if (inc.body) {
    const p = document.createElement("p");
    p.textContent = inc.body;
    li.append(p);
  }
  return li;
}

async function loadStatus() {
  const dot = document.querySelector("[data-dot]");
  const label = document.querySelector("[data-label]");
  const checked = document.querySelector("[data-checked]");
  const list = document.querySelector("[data-incidents]");
  try {
    const res = await fetch(`${API}/v1/status`);
    const data = await res.json();
    const ok = data.ok !== false;
    dot.className = `dot ${ok ? "ok" : "down"}`;
    label.textContent = ok ? "All systems operational" : "Backend unavailable";
    checked.textContent = data.backend?.checked_at ? `Checked ${fmtDate(data.backend.checked_at)}` : "";
    const incidents = Array.isArray(data.incidents) ? data.incidents : [];
    list.textContent = "";
    if (!incidents.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No incidents in the last 90 days.";
      list.append(li);
    } else {
      for (const inc of incidents) list.append(renderIncident(inc));
    }
  } catch {
    dot.className = "dot down";
    label.textContent = "Status unavailable right now";
    checked.textContent = "";
    list.textContent = "";
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Could not load incident history.";
    list.append(li);
  }
}

document.querySelector("[data-subscribe]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = form.querySelector("[data-msg]");
  msg.textContent = "Submitting…";
  try {
    const res = await fetch(`${API}/v1/status/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email.value.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.ok
      ? "Subscribed — check your email for a confirmation with an unsubscribe link."
      : (data.error ?? "Something went wrong.");
    if (res.ok) form.reset();
  } catch {
    msg.textContent = "Something went wrong — try again.";
  }
});

loadStatus();
