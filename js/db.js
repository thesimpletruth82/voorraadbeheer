// ── DB — all data access functions ─────────────────────────
const DB = {

  // ── Events ──────────────────────────────────────────────
  async getEvents() {
    const { data } = await getSB().from('events').select('*').order('created_at', { ascending: false });
    return data || [];
  },
  async createEvent(name, date) {
    const { data, error } = await getSB().from('events').insert({ name, date }).select().single();
    return { data, error };
  },
  async updateEventStatus(id, status) {
    const { error } = await getSB().from('events').update({ status }).eq('id', id);
    return { error };
  },
  async deleteEvent(id) {
    const { error } = await getSB().from('events').delete().eq('id', id);
    return { error };
  },
  async getActiveEvent() {
    const { data } = await getSB().from('events').select('*').eq('status', 'active').maybeSingle();
    return data;
  },

  // ── Locations ────────────────────────────────────────────
  async getLocations(eventId) {
    const { data } = await getSB().from('locations').select('*').eq('event_id', eventId).order('order_num');
    return data || [];
  },
  async createLocation(eventId, name) {
    const sb = getSB();
    const { data: existing } = await sb.from('locations').select('id').eq('event_id', eventId);
    const order_num = (existing || []).length;
    const { data, error } = await sb.from('locations').insert({ event_id: eventId, name, order_num }).select().single();
    return { data, error };
  },
  async deleteLocation(id) {
    const { error } = await getSB().from('locations').delete().eq('id', id);
    return { error };
  },

  // ── SKUs ──────────────────────────────────────────────────
  async getSkus() {
    const { data } = await getSB().from('skus').select('*').order('order_num');
    return data || [];
  },
  async createSku(name, unit) {
    const sb = getSB();
    const { data: existing } = await sb.from('skus').select('id');
    const order_num = (existing || []).length;
    const { data, error } = await sb.from('skus').insert({ name, unit, order_num }).select().single();
    return { data, error };
  },
  async deleteSku(id) {
    const { error } = await getSB().from('skus').delete().eq('id', id);
    return { error };
  },

  // ── Location-SKU assignments ──────────────────────────────
  // Returns { locationId: Set<skuId> }
  async getLocationSkuMap(eventId) {
    const locs = await DB.getLocations(eventId);
    if (!locs.length) return {};
    const locIds = locs.map(l => l.id);
    const { data } = await getSB().from('location_skus').select('*').in('location_id', locIds);
    const map = {};
    locs.forEach(l => { map[l.id] = new Set(); });
    (data || []).forEach(row => { map[row.location_id]?.add(row.sku_id); });
    return map;
  },
  async setLocationSku(locationId, skuId, assign) {
    const sb = getSB();
    if (assign) {
      await sb.from('location_skus').upsert({ location_id: locationId, sku_id: skuId });
    } else {
      await sb.from('location_skus').delete().eq('location_id', locationId).eq('sku_id', skuId);
    }
  },
  async assignAllSkusToLocation(locationId, skuIds) {
    const rows = skuIds.map(id => ({ location_id: locationId, sku_id: id }));
    await getSB().from('location_skus').upsert(rows);
  },

  // ── Stock counts ──────────────────────────────────────────
  // Returns { locationId: { skuId: quantity } }
  async getCountMap(eventId, type) {
    const { data } = await getSB()
      .from('stock_counts')
      .select('*')
      .eq('event_id', eventId)
      .eq('type', type);
    const map = {};
    (data || []).forEach(r => {
      if (!map[r.location_id]) map[r.location_id] = {};
      map[r.location_id][r.sku_id] = Number(r.quantity);
    });
    return map;
  },
  async saveCount(eventId, locationId, skuId, quantity, type, userId) {
    // Upsert based on event+location+sku+type
    const sb = getSB();
    // Try to find existing record
    const { data: existing } = await sb.from('stock_counts')
      .select('id')
      .eq('event_id', eventId)
      .eq('location_id', locationId)
      .eq('sku_id', skuId)
      .eq('type', type)
      .maybeSingle();

    if (existing) {
      const { error } = await sb.from('stock_counts')
        .update({ quantity, counted_at: new Date().toISOString(), counted_by: userId })
        .eq('id', existing.id);
      return { error };
    } else {
      const { error } = await sb.from('stock_counts')
        .insert({ event_id: eventId, location_id: locationId, sku_id: skuId, quantity, type, counted_by: userId });
      return { error };
    }
  },

  // ── Movements ─────────────────────────────────────────────
  async getMovements(eventId, limit = 50) {
    const { data } = await getSB()
      .from('movements')
      .select(`*, sku:skus(name,unit), from_loc:locations!from_location_id(name), to_loc:locations!to_location_id(name), runner:profiles!runner_id(name,email)`)
      .eq('event_id', eventId)
      .order('moved_at', { ascending: false })
      .limit(limit);
    return data || [];
  },
  async getMyMovements(eventId, limit = 20) {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return [];
    const { data } = await getSB()
      .from('movements')
      .select(`*, sku:skus(name,unit), from_loc:locations!from_location_id(name), to_loc:locations!to_location_id(name)`)
      .eq('event_id', eventId)
      .eq('runner_id', user.id)
      .order('moved_at', { ascending: false })
      .limit(limit);
    return data || [];
  },
  async createMovement({ eventId, fromLocationId, toLocationId, skuId, quantity, type, notes }) {
    const { data: { user } } = await getSB().auth.getUser();
    const { data, error } = await getSB().from('movements').insert({
      event_id:          eventId,
      from_location_id:  fromLocationId || null,
      to_location_id:    toLocationId || null,
      sku_id:            skuId,
      quantity:          Number(quantity),
      type,
      notes:             notes || null,
      runner_id:         user?.id || null,
    }).select().single();
    return { data, error };
  },

  // ── Current stock (computed) ───────────────────────────────
  // Returns { locationId: { skuId: quantity } }
  async computeCurrentStock(eventId) {
    const [opening, movements] = await Promise.all([
      DB.getCountMap(eventId, 'opening'),
      DB.getMovements(eventId, 2000),
    ]);

    // Deep-clone opening as the base
    const stock = {};
    for (const [locId, skuMap] of Object.entries(opening)) {
      stock[locId] = { ...skuMap };
    }

    const add = (locId, skuId, qty) => {
      if (!stock[locId]) stock[locId] = {};
      stock[locId][skuId] = (stock[locId][skuId] || 0) + qty;
    };

    for (const m of movements) {
      const qty = Number(m.quantity);
      if (m.type === 'delivery' && m.to_location_id) {
        add(m.to_location_id, m.sku_id, qty);
      }
      if (m.type === 'transfer') {
        if (m.from_location_id) add(m.from_location_id, m.sku_id, -qty);
        if (m.to_location_id)   add(m.to_location_id,   m.sku_id, +qty);
      }
    }
    return stock;
  },

  // ── Profiles ──────────────────────────────────────────────
  async getProfiles() {
    const { data } = await getSB().from('profiles').select('*').order('created_at');
    return data || [];
  },
  async updateProfileRole(userId, role) {
    const { error } = await getSB().from('profiles').update({ role }).eq('id', userId);
    return { error };
  },
  async updateProfileName(userId, name) {
    const { error } = await getSB().from('profiles').update({ name }).eq('id', userId);
    return { error };
  },
};
