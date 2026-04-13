const AUTH_KEYS = {
  eventId: 'fvb_event_id',
  eventName: 'fvb_event_name',
  barId: 'fvb_bar_id',
  barName: 'fvb_bar_name',
};

const Auth = {
  async loadActiveEvent() {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('events')
      .select('id, name, date')
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) return false;
    localStorage.setItem(AUTH_KEYS.eventId, data.id);
    localStorage.setItem(AUTH_KEYS.eventName, data.name);
    return true;
  },

  getEventId()   { return localStorage.getItem(AUTH_KEYS.eventId); },
  getEventName() { return localStorage.getItem(AUTH_KEYS.eventName); },

  setBar(id, name) {
    localStorage.setItem(AUTH_KEYS.barId, id);
    localStorage.setItem(AUTH_KEYS.barName, name);
  },

  getBarId()   { return localStorage.getItem(AUTH_KEYS.barId); },
  getBarName() { return localStorage.getItem(AUTH_KEYS.barName); },

  clearBar() {
    localStorage.removeItem(AUTH_KEYS.barId);
    localStorage.removeItem(AUTH_KEYS.barName);
  },
};

let _supabaseClient = null;
function getSupabase() {
  if (!_supabaseClient) {
    _supabaseClient = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  }
  return _supabaseClient;
}
