// ── DB — all data access functions ─────────────────────────
const DB = {

  // ── Events ──────────────────────────────────────────────
  async getEvents() {
    const { data } = await sb().from('events').select('*').order('date', { ascending: false });
    return data || [];
  },
  async createEvent(fields) {
    const { data, error } = await sb().from('events').insert(fields).select().single();
    return { data, error };
  },
  async updateEvent(id, fields) {
    const { error } = await sb().from('events').update(fields).eq('id', id);
    return { error };
  },
  async updateEventStatus(id, status) {
    const { error } = await sb().from('events').update({ status }).eq('id', id);
    return { error };
  },
  async deleteEvent(id) {
    const { error } = await sb().from('events').delete().eq('id', id);
    return { error };
  },

  // ── Locations ───────────────────────────────────────────
  async getLocations(eventId) {
    const { data } = await sb().from('locations').select('*').eq('event_id', eventId).order('name');
    return data || [];
  },
  async getAllLocationNames() {
    const { data } = await sb().from('locations').select('name');
    const unique = [...new Set((data || []).map(r => r.name))].sort();
    return unique;
  },

  async createLocation(eventId, name) {
    const { data, error } = await sb().from('locations').insert({ event_id: eventId, name }).select().single();
    return { data, error };
  },
  async deleteLocation(id) {
    const { error } = await sb().from('locations').delete().eq('id', id);
    return { error };
  },

  // ── SKUs ────────────────────────────────────────────────
  async getSkus() {
    const { data } = await sb().from('skus').select('*').order('name');
    return data || [];
  },
  async createSku(name, unit) {
    const { data, error } = await sb().from('skus').insert({ name, unit }).select().single();
    return { data, error };
  },
  async deleteSku(id) {
    const { error } = await sb().from('skus').delete().eq('id', id);
    return { error };
  },

  // ── Stock Counts ────────────────────────────────────────
  // Returns { locationId: { skuId: quantity } }
  async getCountMap(eventId, type) {
    const { data } = await sb()
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

  async saveCount(eventId, locationId, skuId, quantity, type) {
    const s = sb();
    const { data: existing } = await s.from('stock_counts')
      .select('id')
      .eq('event_id', eventId)
      .eq('location_id', locationId)
      .eq('sku_id', skuId)
      .eq('type', type)
      .maybeSingle();

    if (existing) {
      const { error } = await s.from('stock_counts')
        .update({ quantity, counted_at: new Date().toISOString() })
        .eq('id', existing.id);
      return { error };
    } else {
      const { error } = await s.from('stock_counts')
        .insert({ event_id: eventId, location_id: locationId, sku_id: skuId, quantity, type });
      return { error };
    }
  },

  // ── Movements ───────────────────────────────────────────
  async getMovements(eventId, limit = 50) {
    const { data } = await sb()
      .from('movements')
      .select(`*, sku:skus(name,unit), from_loc:locations!movements_from_location_id_fkey(name), to_loc:locations!movements_to_location_id_fkey(name)`)
      .eq('event_id', eventId)
      .order('moved_at', { ascending: false })
      .limit(limit);
    return data || [];
  },

  async createMovement({ eventId, fromLocationId, toLocationId, skuId, quantity, type, notes }) {
    const { data, error } = await sb().from('movements').insert({
      event_id:         eventId,
      from_location_id: fromLocationId || null,
      to_location_id:   toLocationId || null,
      sku_id:           skuId,
      quantity:         Number(quantity),
      type,
      notes:            notes || null,
    }).select().single();
    return { data, error };
  },

  // ── Computed Current Stock ──────────────────────────────
  // Returns { locationId: { skuId: quantity } }
  async computeCurrentStock(eventId) {
    const [opening, movements] = await Promise.all([
      DB.getCountMap(eventId, 'opening'),
      (async () => {
        const { data } = await sb()
          .from('movements')
          .select('*')
          .eq('event_id', eventId)
          .limit(5000);
        return data || [];
      })(),
    ]);

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
        if (m.to_location_id)   add(m.to_location_id,   m.sku_id,  qty);
      }
      if (m.type === 'sale' && m.from_location_id) {
        add(m.from_location_id, m.sku_id, -qty);
      }
    }
    return stock;
  },

  // ── Stock Breakdown (for charts + burn rate) ───────────
  // Returns { locationId: { skuId: { totalSupply, used, current, burnPerHour, hoursLeft } } }
  async getStockBreakdown(eventId) {
    const [openingMap, rawMovements] = await Promise.all([
      DB.getCountMap(eventId, 'opening'),
      (async () => {
        const { data } = await sb().from('movements').select('*').eq('event_id', eventId).order('moved_at').limit(5000);
        return data || [];
      })(),
    ]);

    // Find the earliest sale/movement timestamp for burn rate window
    const firstSaleTime = {};  // { locId_skuId: Date }
    const result = {};

    // Pass 1: build totals
    const locSkuData = {}; // locId -> skuId -> { opening, delivIn, transIn, transOut, salesOut }
    const ensure = (locId, skuId) => {
      if (!locSkuData[locId]) locSkuData[locId] = {};
      if (!locSkuData[locId][skuId]) locSkuData[locId][skuId] = { opening: 0, delivIn: 0, transIn: 0, transOut: 0, salesOut: 0 };
    };

    // Openings
    for (const [locId, skuMap] of Object.entries(openingMap)) {
      for (const [skuId, qty] of Object.entries(skuMap)) {
        ensure(locId, skuId);
        locSkuData[locId][skuId].opening = qty;
      }
    }

    // Movements
    for (const m of rawMovements) {
      const qty = Number(m.quantity);
      if (m.type === 'delivery' && m.to_location_id) {
        ensure(m.to_location_id, m.sku_id);
        locSkuData[m.to_location_id][m.sku_id].delivIn += qty;
      }
      if (m.type === 'transfer') {
        if (m.from_location_id) {
          ensure(m.from_location_id, m.sku_id);
          locSkuData[m.from_location_id][m.sku_id].transOut += qty;
        }
        if (m.to_location_id) {
          ensure(m.to_location_id, m.sku_id);
          locSkuData[m.to_location_id][m.sku_id].transIn += qty;
        }
      }
      if (m.type === 'sale' && m.from_location_id) {
        ensure(m.from_location_id, m.sku_id);
        locSkuData[m.from_location_id][m.sku_id].salesOut += qty;
        const key = m.from_location_id + '_' + m.sku_id;
        if (!firstSaleTime[key]) firstSaleTime[key] = new Date(m.moved_at);
      }
    }

    const now = new Date();
    for (const [locId, skuMap] of Object.entries(locSkuData)) {
      result[locId] = {};
      for (const [skuId, d] of Object.entries(skuMap)) {
        const totalSupply = d.opening + d.delivIn + d.transIn;
        const used = d.salesOut + d.transOut;
        const current = totalSupply - used;

        // Burn rate: sales per hour since first sale
        let burnPerHour = 0;
        const key = locId + '_' + skuId;
        if (d.salesOut > 0 && firstSaleTime[key]) {
          const hoursElapsed = (now - firstSaleTime[key]) / 3600000;
          if (hoursElapsed > 0.05) burnPerHour = d.salesOut / hoursElapsed; // at least 3 min
        }

        const hoursLeft = (burnPerHour > 0 && current > 0) ? current / burnPerHour : null;

        result[locId][skuId] = {
          opening: d.opening, delivIn: d.delivIn, transIn: d.transIn, transOut: d.transOut, salesOut: d.salesOut,
          totalSupply, used, current, burnPerHour, hoursLeft,
        };
      }
    }

    return result;
  },

  // ── Variance Data ──────────────────────────────────────
  // Returns array of { locationId, locationName, skuId, skuName, unit, opening, deliveriesIn, transfersOut, transfersIn, expected, actual, variance }
  async getVarianceData(eventId) {
    const [locations, skus, openingMap, closingMap, rawMovements] = await Promise.all([
      DB.getLocations(eventId),
      DB.getSkus(),
      DB.getCountMap(eventId, 'opening'),
      DB.getCountMap(eventId, 'closing'),
      (async () => {
        const { data } = await sb().from('movements').select('*').eq('event_id', eventId).limit(5000);
        return data || [];
      })(),
    ]);

    const rows = [];
    for (const loc of locations) {
      for (const sku of skus) {
        const open = openingMap[loc.id]?.[sku.id] || 0;
        let delivIn = 0, transOut = 0, transIn = 0, salesOut = 0;
        for (const m of rawMovements) {
          if (m.sku_id !== sku.id) continue;
          if (m.type === 'delivery' && m.to_location_id === loc.id) delivIn += Number(m.quantity);
          if (m.type === 'transfer' && m.from_location_id === loc.id) transOut += Number(m.quantity);
          if (m.type === 'transfer' && m.to_location_id === loc.id) transIn += Number(m.quantity);
          if (m.type === 'sale' && m.from_location_id === loc.id) salesOut += Number(m.quantity);
        }
        const expected = open + delivIn + transIn - transOut - salesOut;
        const actual = closingMap[loc.id]?.[sku.id] ?? null;
        const variance = actual !== null ? actual - expected : null;

        // Only include rows that have any data
        if (open || delivIn || transOut || transIn || salesOut || actual !== null) {
          rows.push({
            locationId: loc.id, locationName: loc.name,
            skuId: sku.id, skuName: sku.name, unit: sku.unit,
            opening: open, deliveriesIn: delivIn, transfersOut: transOut, transfersIn: transIn, salesOut,
            expected, actual, variance,
          });
        }
      }
    }
    return rows;
  },
};
