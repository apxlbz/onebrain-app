/* Sign-in and routing for the OneBrain home page. Extracted from index.html
 * (F8: inline scripts moved out so a strict Content-Security-Policy can
 * forbid inline script execution). The page is the front door for everyone:
 * a visitor reads it, a member signs in from the button top right. Someone
 * who already has a session is NOT bounced away — the buttons simply become
 * "Open OneBrain" — because a home page that vanishes the moment you are
 * logged in is a page nobody can ever show a colleague. The one exception is
 * the return leg of Google sign-in itself: that visit exists only to land you
 * in the product, on Settings, where minting a token and copying an install
 * line is the whole setup. The Google-sources wizard is never the front door. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FN, SUPA_ORIGIN } from "./env.js?v=1";

// Per-environment endpoints for the "Wire it up" snippets. The install script
// follows the same hostname split as env.js: prod host → prod script, every
// other host → the dev script, which matches the dev project a minted token
// belongs to.
const MCP = `${SUPA_ORIGIN}/functions/v1/mcp`;
const API = `${SUPA_ORIGIN}/functions/v1/api`;
const INSTALL_SH = location.hostname === "onebrain.apxlbz.com"
  ? "https://onebrain.apxlbz.com/agent-install.sh"
  : "https://onebrain-dev.apxlbz.com/agent-install.sh";
document.querySelectorAll("[data-mcp-url]").forEach((el) => { el.textContent = MCP; });
document.querySelectorAll("[data-api-url]").forEach((el) => { el.textContent = API; });
document.querySelectorAll("[data-install-sh]").forEach((el) => { el.textContent = INSTALL_SH; });
document.querySelectorAll("[data-copy]").forEach((el) => {
  el.dataset.copy = el.dataset.copy
    .replace(/__MCP_URL__/g, MCP)
    .replace(/__API_URL__/g, API)
    .replace(/__INSTALL_SH__/g, INSTALL_SH);
});

const returning = /access_token=|provider_token=/.test(location.hash);
const buttons = [...document.querySelectorAll("[data-signin]")];
const cfg = await fetch(`${FN}/api/config`).then((r) => r.json());
const sb = createClient(cfg.supabase_url, cfg.supabase_anon_key);

// Fresh Google sign-in lands on Settings (mint + copy). An existing session
// opening the product from the home page goes to the dashboard. Neither path
// consults onboarding state — agents and people are never sent through the wizard.
const DASHBOARD = "./app.html";
const CONNECT = "./app.html#settings";

function showSignedIn(dest) {
  for (const b of buttons) {
    b.setAttribute("href", dest);
    b.textContent = b.classList.contains("cta") ? "Open OneBrain" : "Open OneBrain";
    b.removeAttribute("data-signin");
  }
}

buttons.forEach((b) => b.addEventListener("click", async (e) => {
  if (!b.hasAttribute("data-signin")) return;     // already routed: a plain link
  e.preventDefault();
  b.setAttribute("aria-busy", "true");
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) { b.removeAttribute("aria-busy"); alert(error.message); }
}));

const { data: { session } } = await sb.auth.getSession();
if (session) {
  if (returning) { location.replace(CONNECT); } else { showSignedIn(DASHBOARD); }
} else if (returning) {
  // The hash is being consumed by supabase-js; route once the session lands.
  sb.auth.onAuthStateChange((_e, s) => { if (s) location.replace(CONNECT); });
}
