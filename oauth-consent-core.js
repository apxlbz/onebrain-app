/* No token handling here. Only the Auth server may resolve an authorization ID.
 * Dependencies are injected so negative paths run without an account or network. */
export function authorizationId(search) {
  const values = new URLSearchParams(search).getAll('authorization_id');
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(values[0])) {
    throw new Error('request');
  }
  return values[0];
}

export function safeCallback(value, expected) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('redirect');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.hash) throw new Error('redirect');
  if (expected) {
    const base = safeCallback(expected);
    if (url.origin !== base.origin || url.pathname !== base.pathname) throw new Error('redirect');
    for (const key of new Set(base.searchParams.keys())) {
      if (JSON.stringify(url.searchParams.getAll(key)) !== JSON.stringify(base.searchParams.getAll(key))) {
        throw new Error('redirect');
      }
    }
  }
  return url;
}

export function createConsentController({ auth, ui, navigate, search, callbackUrl }) {
  let id, identity, details, pending = false, finished = false;
  const fail = () => {
    finished = true;
    ui.error('This connection request could not be completed. Close this page and start a new connection from your client.');
  };
  async function load() {
    try {
      id = authorizationId(search);
      const userResult = await auth.getUser();
      const user = userResult.data?.user;
      if (!user) {
        ui.signIn();
        return;
      }
      if (userResult.error) throw new Error('identity');
      identity = user;
      const result = await auth.oauth.getAuthorizationDetails(id);
      if (result.error || !result.data) throw new Error('details');
      const data = result.data;
      if (!('authorization_id' in data)) {
        const target = safeCallback(data.redirect_url);
        finished = true;
        ui.previouslyAllowed(identity, target.origin + target.pathname, async () => {
          try {
            const current = await auth.getUser();
            if (current.error || current.data?.user?.id !== identity.id) throw new Error('identity');
            navigate(target.href);
          } catch { fail(); }
        });
        return;
      }
      if (data.authorization_id !== id || !data.client?.id || typeof data.client.name !== 'string' ||
          data.user?.id !== user.id || typeof data.scope !== 'string') throw new Error('details');
      safeCallback(data.redirect_uri);
      details = data;
      ui.consent(identity, details);
    } catch { fail(); }
  }
  async function signIn() {
    if (pending || finished) return;
    pending = true;
    ui.busy(true);
    try {
      // Constructed by the page from its own origin/path and the validated ID.
      const url = new URL(callbackUrl);
      url.search = new URLSearchParams({ authorization_id: id }).toString();
      url.hash = '';
      const result = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo: url.href } });
      if (result.error) throw new Error('signin');
    } catch { fail(); }
    finally { pending = false; ui.busy(finished); }
  }
  async function decide(approve) {
    if (pending || finished || !details || typeof approve !== 'boolean') return;
    pending = true;
    ui.busy(true);
    try {
      // A different tab may have signed out or switched accounts since rendering.
      const current = await auth.getUser();
      if (current.error || current.data?.user?.id !== identity.id) throw new Error('identity');
      const method = approve ? 'approveAuthorization' : 'denyAuthorization';
      const result = await auth.oauth[method](id, { skipBrowserRedirect: true });
      if (result.error || !result.data) throw new Error('decision');
      const target = safeCallback(result.data.redirect_url, details.redirect_uri);
      finished = true;
      navigate(target.href);
    } catch { fail(); }
    finally { pending = false; ui.busy(finished); }
  }
  return { load, signIn, decide };
}
