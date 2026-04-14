// ── Supabase client ─────────────────────────────────────────
const CONFIG = {
  supabase: {
    url: 'https://ljsaptrpsyvgcerpzagg.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxqc2FwdHJwc3l2Z2NlcnB6YWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjA0NzYsImV4cCI6MjA5MTYzNjQ3Nn0.fpiRAFbdkWd8frjtrPmPI3pzYQo8RGrCsHrJlIwpO-w',
  },
};

let _sb = null;
function getSB() {
  if (!_sb) _sb = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  return _sb;
}

// ── Auth helpers ────────────────────────────────────────────
const Auth = {
  async signIn(email, password) {
    const { data, error } = await getSB().auth.signInWithPassword({ email, password });
    return { data, error };
  },

  async signUp(email, password, name) {
    const { data, error } = await getSB().auth.signUp({
      email, password,
      options: { data: { name } },
    });
    return { data, error };
  },

  async signOut() {
    await getSB().auth.signOut();
    localStorage.clear();
    location.href = '/';
  },

  async getSession() {
    const { data } = await getSB().auth.getSession();
    return data?.session || null;
  },

  async getProfile() {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    return data || null;
  },

  // Require auth + optional role. Redirects if not met.
  async require(role = null) {
    const session = await Auth.getSession();
    if (!session) { location.href = '/'; return null; }
    const profile = await Auth.getProfile();
    if (!profile) { location.href = '/'; return null; }
    if (role && profile.role !== role) {
      location.href = profile.role === 'runner' ? '/runner' : '/admin';
      return null;
    }
    return profile;
  },

  // Working event context (stored in localStorage)
  setEvent(id, name, status) {
    localStorage.setItem('sf_event_id',     id);
    localStorage.setItem('sf_event_name',   name);
    localStorage.setItem('sf_event_status', status);
  },
  getEventId()     { return localStorage.getItem('sf_event_id'); },
  getEventName()   { return localStorage.getItem('sf_event_name'); },
  getEventStatus() { return localStorage.getItem('sf_event_status'); },

  clearEvent() {
    localStorage.removeItem('sf_event_id');
    localStorage.removeItem('sf_event_name');
    localStorage.removeItem('sf_event_status');
  },
};

// ── Toast helper ────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast-${type}`;
  el.style.opacity = '1';
  el.style.display = '';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 2200);
}
