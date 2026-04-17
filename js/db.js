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
  // Returns the assortment for a specific event, ordered by per-event sort_order.
  async getSkus(eventId) {
    const { data } = await sb()
      .from('event_skus')
      .select('sort_order, sku:skus(id, name, unit)')
      .eq('event_id', eventId)
      .order('sort_order');
    return (data || []).map(r => ({ ...r.sku, sort_order: r.sort_order }));
  },
  // Full catalog of every SKU ever created — used for quick-add suggestions.
  async getAllSkuCatalog() {
    const { data } = await sb().from('skus').select('*').order('name');
    return data || [];
  },
  // Create a brand-new SKU and add it to the event's assortment.
  // If a SKU with the same name already exists in the catalog, reuse it.
  async createSku(eventId, name, unit) {
    let { data: existing } = await sb().from('skus').select('id').ilike('name', name).maybeSingle();
    let skuId;
    if (!existing) {
      const { data: newSku, error } = await sb().from('skus').insert({ name, unit }).select().single();
      if (error) return { error };
      skuId = newSku.id;
    } else {
      skuId = existing.id;
    }
    return DB.addSkuToEvent(eventId, skuId);
  },
  // Add an existing catalog SKU to an event's assortment.
  async addSkuToEvent(eventId, skuId) {
    const { data: maxRow } = await sb()
      .from('event_skus').select('sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: false }).limit(1);
    const nextOrder = maxRow?.length ? (maxRow[0].sort_order + 1) : 0;
    const { error } = await sb().from('event_skus')
      .insert({ event_id: eventId, sku_id: skuId, sort_order: nextOrder });
    return { error };
  },
  // Remove a SKU from an event's assortment (does NOT delete it from the catalog).
  async removeSkuFromEvent(eventId, skuId) {
    const { error } = await sb().from('event_skus')
      .delete().eq('event_id', eventId).eq('sku_id', skuId);
    return { error };
  },
  // Update per-event sort order after a drag-to-reorder.
  async reorderSkus(eventId, orderedIds) {
    const promises = orderedIds.map((skuId, i) =>
      sb().from('event_skus').update({ sort_order: i }).eq('event_id', eventId).eq('sku_id', skuId)
    );
    await Promise.all(promises);
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

    const firstSaleTime = {};  // { locId_skuId: Date }
    const salesLast3h = {};    // { locId_skuId: number }
    const result = {};
    const now = new Date();
    const threeHoursAgo = new Date(now - 3 * 3600000);

    const locSkuData = {};
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
        // Track last 3h sales
        if (new Date(m.moved_at) >= threeHoursAgo) {
          salesLast3h[key] = (salesLast3h[key] || 0) + qty;
        }
      }
    }

    for (const [locId, skuMap] of Object.entries(locSkuData)) {
      result[locId] = {};
      for (const [skuId, d] of Object.entries(skuMap)) {
        const totalSupply = d.opening + d.delivIn + d.transIn;
        const used = d.salesOut + d.transOut;
        const current = totalSupply - used;
        const key = locId + '_' + skuId;

        // Burn rate since start: total sales / hours since first sale
        let burnTotal = 0;
        if (d.salesOut > 0 && firstSaleTime[key]) {
          const hoursElapsed = (now - firstSaleTime[key]) / 3600000;
          if (hoursElapsed > 0.05) burnTotal = d.salesOut / hoursElapsed;
        }

        // Burn rate last 3h: sales in last 3h / min(3, hours since first sale)
        let burnRecent = 0;
        const recent = salesLast3h[key] || 0;
        if (recent > 0 && firstSaleTime[key]) {
          const hoursSinceFirst = (now - firstSaleTime[key]) / 3600000;
          const window = Math.min(3, hoursSinceFirst);
          if (window > 0.05) burnRecent = recent / window;
        }

        // ETA based on recent burn rate (more useful), fall back to total
        const activeBurn = burnRecent || burnTotal;
        const hoursLeft = (activeBurn > 0 && current > 0) ? current / activeBurn : null;

        result[locId][skuId] = {
          opening: d.opening, delivIn: d.delivIn, transIn: d.transIn, transOut: d.transOut, salesOut: d.salesOut,
          totalSupply, used, current, burnTotal, burnRecent, hoursLeft,
        };
      }
    }

    return result;
  },

  // ── Users, Invites, Assignments (superuser-only) ────────
  async getAllProfiles() {
    const { data } = await sb().from('profiles').select('*').order('created_at');
    return data || [];
  },
  async updatePlatformRole(userId, role) {
    const { error } = await sb().from('profiles').update({ platform_role: role }).eq('id', userId);
    return { error };
  },
  async deleteProfile(userId) {
    // This only deletes from profiles — the auth.users row stays unless
    // the superuser removes it in the Supabase dashboard.
    const { error } = await sb().from('profiles').delete().eq('id', userId);
    return { error };
  },

  async getInvites() {
    const { data } = await sb()
      .from('invites')
      .select('*, event:events(id,name)')
      .order('created_at', { ascending: false });
    return data || [];
  },
  async createInvite({ email, platformRole, eventId }) {
    const row = { email: email.toLowerCase().trim(), platform_role: platformRole };
    if (eventId) row.event_id = eventId;
    const { data, error } = await sb().from('invites').insert(row).select().single();
    return { data, error };
  },
  async deleteInvite(id) {
    const { error } = await sb().from('invites').delete().eq('id', id);
    return { error };
  },

  // Returns [{ event_id, user_id, assigned_at, email, platform_role }]
  async getEventAssignments(eventId) {
    const { data: rows } = await sb()
      .from('event_assignments')
      .select('*')
      .eq('event_id', eventId);
    if (!rows || !rows.length) return [];

    const userIds = rows.map(r => r.user_id);
    const { data: profs } = await sb()
      .from('profiles')
      .select('id, email, platform_role')
      .in('id', userIds);
    const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
    return rows.map(r => ({
      ...r,
      email: byId[r.user_id]?.email || '(unknown)',
      platform_role: byId[r.user_id]?.platform_role || null,
    }));
  },
  async getAssignmentsForUser(userId) {
    const { data } = await sb()
      .from('event_assignments')
      .select('event_id')
      .eq('user_id', userId);
    return (data || []).map(r => r.event_id);
  },
  async assignUserToEvent(eventId, userId) {
    const { error } = await sb()
      .from('event_assignments')
      .insert({ event_id: eventId, user_id: userId });
    return { error };
  },
  async unassignUserFromEvent(eventId, userId) {
    const { error } = await sb()
      .from('event_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);
    return { error };
  },

  // ── Variance Data ──────────────────────────────────────
  // Returns array of { locationId, locationName, skuId, skuName, unit, opening, deliveriesIn, transfersOut, transfersIn, expected, actual, variance }
  async getVarianceData(eventId) {
    const [locations, skus, openingMap, closingMap, rawMovements] = await Promise.all([
      DB.getLocations(eventId),
      DB.getSkus(eventId),
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
