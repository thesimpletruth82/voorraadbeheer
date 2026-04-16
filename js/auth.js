// ══════════════════════════════════════════════════════════
// StockFest — Auth & role helpers
// Loaded on every page. Call `await Auth.require(...)` at the
// top of page-init to gate access + redirect anonymous users.
// ══════════════════════════════════════════════════════════

const Auth = {
  user: null,
  profile: null, // { id, email, platform_role, full_name }
  _inited: false,

  // Load session + profile from Supabase. Idempotent.
  async init() {
    if (this._inited) return;
    this._inited = true;

    const { data: { session } } = await sb().auth.getSession();
    if (!session) return;

    this.user = session.user;
    const { data } = await sb()
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    this.profile = data || null;
  },

  // Force a refresh (after role change, event assignment, etc.)
  async refresh() {
    this._inited = false;
    this.user = null;
    this.profile = null;
    await this.init();
  },

  role()        { return this.profile?.platform_role || null; },
  isSuperuser() { return this.role() === 'superuser'; },
  isAdmin()     { return this.role() === 'admin'; },
  isRunner()    { return this.role() === 'runner'; },
  signedIn()    { return !!this.user; },

  // Page-level guard. Call once near the top of each page.
  //   opts.superuser      : require superuser
  //   opts.runnerForbidden: runners get redirected to /sales
  //   opts.allowRunner    : explicitly allow runner (default: admins+above)
  //   opts.silent         : don't redirect, just return false
  async require(opts = {}) {
    await this.init();
    if (!this.signedIn()) {
      if (!opts.silent) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace('/login?next=' + next);
      }
      return false;
    }
    if (!this.profile) {
      // Signed in but no profile row → shouldn't happen; log out & reset.
      if (!opts.silent) {
        await sb().auth.signOut();
        location.replace('/login');
      }
      return false;
    }
    if (opts.superuser && !this.isSuperuser()) {
      if (!opts.silent) location.replace('/');
      return false;
    }
    if (this.isRunner() && !opts.allowRunner) {
      if (!opts.silent) location.replace('/sales');
      return false;
    }
    return true;
  },

  // Does the current user have access to a specific event?
  async hasEventAccess(eventId) {
    await this.init();
    if (this.isSuperuser()) return true;
    if (!this.user) return false;
    const { data } = await sb()
      .from('event_assignments')
      .select('event_id')
      .eq('event_id', eventId)
      .eq('user_id', this.user.id)
      .maybeSingle();
    return !!data;
  },

  // ── Sign in / up / out ──────────────────────────────────
  async signIn(email, password) {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (!error) await this.refresh();
    return { data, error };
  },

  async signUp(email, password) {
    const { data, error } = await sb().auth.signUp({ email, password });
    // On Supabase projects with email confirmation disabled, a session
    // is returned immediately; otherwise the user must verify first.
    if (!error && data.session) await this.refresh();
    return { data, error };
  },

  async signOut() {
    await sb().auth.signOut();
    this.user = null;
    this.profile = null;
    this._inited = false;
    // Clear active-event context so the next user doesn't inherit it
    Ctx.clear();
    location.replace('/login');
  },
};
