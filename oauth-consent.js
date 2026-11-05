import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { FN, SUPA_ORIGIN } from './env.js?v=1';
import { authorizationId, createConsentController } from './oauth-consent-core.js?v=1';

const el = (id) => document.getElementById(id);
const text = (id, value) => { el(id).textContent = value; };
const hidePanels = () => {
  for (const id of ['signin', 'request', 'previous']) el(id).hidden = true;
  text('status', '');
};
const ui = {
  error(message) { hidePanels(); text('error', message); el('error').hidden = false; },
  busy(value) {
    for (const id of ['sign-in', 'approve', 'deny', 'continue']) el(id).disabled = value;
    el('request').setAttribute('aria-busy', String(value));
  },
  signIn() { hidePanels(); el('signin').hidden = false; },
  consent(user, details) {
    hidePanels();
    text('identity', user.email || user.id);
    text('client', details.client.name || 'Unnamed client');
    text('client-id', details.client.id);
    text('redirect', details.redirect_uri);
    const scopes = details.scope.trim().split(/\s+/).filter(Boolean);
    for (const scope of scopes.length ? scopes : ['No named scopes were supplied by the authorization server.']) {
      const item = document.createElement('li');
      item.textContent = scope;
      el('scopes').append(item);
    }
    el('request').hidden = false;
  },
  previouslyAllowed(user, destination, proceed) {
    hidePanels();
    text('previous-identity', `Signed in as ${user.email || user.id}`);
    text('previous-destination', destination);
    el('continue').addEventListener('click', () => { ui.busy(true); proceed(); }, { once: true });
    el('previous').hidden = false;
  },
};
text('environment', location.hostname === 'onebrain.apxlbz.com' ? '' : '(dev)');
try {
  if (window.top !== window.self) throw new Error('embedded');
  // Validate before configuration/auth requests. Never persist or log this ID.
  authorizationId(location.search);
  const response = await fetch(`${FN}/api/config`, { cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('config');
  const cfg = await response.json();
  if (cfg.supabase_url !== SUPA_ORIGIN || typeof cfg.supabase_anon_key !== 'string' || !cfg.supabase_anon_key) {
    throw new Error('config');
  }
  // Same project/storage defaults as home-auth.js; this page consumes its own
  // Google callback instead of sending the request through the home dashboard.
  const sb = createClient(cfg.supabase_url, cfg.supabase_anon_key);
  if (!sb.auth.oauth?.getAuthorizationDetails || !sb.auth.oauth?.approveAuthorization || !sb.auth.oauth?.denyAuthorization) {
    throw new Error('sdk');
  }
  const controller = createConsentController({ auth: sb.auth, ui,
    navigate: (url) => location.assign(url), search: location.search,
    callbackUrl: location.origin + location.pathname });
  el('sign-in').addEventListener('click', () => controller.signIn());
  el('approve').addEventListener('click', () => controller.decide(true));
  el('deny').addEventListener('click', () => controller.decide(false));
  await controller.load();
} catch {
  ui.error('This connection request could not be loaded. Close this page and start a new connection from your client.');
}
