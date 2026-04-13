const AUTH_KEYS = {
  adminAuthed: 'fvb_admin_authed',
  eventId: 'fvb_event_id',
  eventName: 'fvb_event_name',
  eventPassword: 'fvb_event_password',
  barId: 'fvb_bar_id',
  barName: 'fvb_bar_name',
};

const Auth = {
  loginAdmin(password) {
    if (password === CONFIG.adminPassword) {
      sessionStorage.setItem(AUTH_KEYS.adminAuthed, '1');
      return true;
    }
    return false;
  },

  isAdminAuthed() {
    return sessionStorage.getItem(AUTH_KEYS.adminAuthed) === '1';
  },

  async loginEvent(password) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('events')
      .select('id, name, date, is_active')
      .eq('staff_password', password)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) return false;
    localStorage.setItem(AUTH_KEYS.eventId, data.id);
    localStorage.setItem(AUTH_KEYS.eventName, data.name);
    localStorage.setItem(AUTH_KEYS.eventPassword, password);
    return true;
  },

  async revalidateEvent() {
    const storedPw = localStorage.getItem(AUTH_KEYS.eventPassword);
    if (!storedPw) return false;
    return await Auth.loginEvent(storedPw);
  },

  isEventAuthed() {
    return !!localStorage.getItem(AUTH_KEYS.eventId);
  },

  getEventId() { return localStorage.getItem(AUTH_KEYS.eventId); },
  getEventName() { return localStorage.getItem(AUTH_KEYS.eventName); },

  setBar(id, name) {
    localStorage.setItem(AUTH_KEYS.barId, id);
    localStorage.setItem(AUTH_KEYS.barName, name);
  },

  getBarId() { return localStorage.getItem(AUTH_KEYS.barId); },
  getBarName() { return localStorage.getItem(AUTH_KEYS.barName); },

  logoutEvent() {
    [AUTH_KEYS.eventId, AUTH_KEYS.eventName, AUTH_KEYS.eventPassword, AUTH_KEYS.barId, AUTH_KEYS.barName]
      .forEach(k => localStorage.removeItem(k));
  },

  logoutAdmin() {
    sessionStorage.removeItem(AUTH_KEYS.adminAuthed);
  }
};

let _supabaseClient = null;
function getSupabase() {
  if (!_supabaseClient) {
    _supabaseClient = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  }
  return _supabaseClient;
}
