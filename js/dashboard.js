let dState = {
  event: null,
  bars: [],
  skus: [],
  barSkus: {},
  entries: [],
  refreshInterval: null,
};

const _charts = {}; // barId -> Chart instance

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await Auth.loadActiveEvent();
  if (!ok) {
    document.getElementById('dashboard-section').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
        <div><div style="font-size:48px;margin-bottom:12px">⚠️</div>
          <h1 style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:8px">Geen actief evenement</h1>
          <p style="color:#64748b;font-size:14px;margin-bottom:16px">Ga naar Beheer en activeer eerst een evenement.</p>
          <a href="/admin" style="color:#3b82f6;font-weight:600;font-size:14px">→ Naar Beheer</a>
        </div></div>`;
    return;
  }
  await loadDashboard();
  startAutoRefresh();
  subscribeRealtime();
});

async function loadDashboard() {
  const sb = getSupabase();
  const eventId = Auth.getEventId();

  const [{ data: event }, { data: bars }, { data: skus }] = await Promise.all([
    sb.from('events').select('*').eq('id', eventId).single(),
    sb.from('bars').select('*').eq('event_id', eventId).order('order_num'),
    sb.from('skus').select('*').eq('event_id', eventId).order('order_num'),
  ]);

  dState.event = event;
  dState.bars = bars || [];
  dState.skus = skus || [];

  if (dState.bars.length > 0) {
    const barIds = dState.bars.map(b => b.id);
    const [{ data: barSkusData }, { data: entries }] = await Promise.all([
      sb.from('bar_skus').select('*').in('bar_id', barIds),
      sb.from('stock_entries').select('*').eq('event_id', eventId).order('created_at'),
    ]);
    dState.barSkus = {};
    (barSkusData || []).forEach(bs => {
      if (!dState.barSkus[bs.bar_id]) dState.barSkus[bs.bar_id] = [];
      dState.barSkus[bs.bar_id].push(bs.sku_id);
    });
    dState.entries = entries || [];
  }

  document.getElementById('event-heading').textContent = dState.event?.name || '';
  document.getElementById('event-date').textContent = dState.event?.date
    ? new Date(dState.event.date + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString('nl-NL');

  renderSummaryCards();
  renderDashboard();
  renderCharts();
}

function renderSummaryCards() {
  const el = document.getElementById('stat-cards');
  if (!el) return;

  const totalSkus = dState.skus.length;
  const totalBars = dState.bars.length;

  // Find most critical SKU (lowest time to empty, > 0)
  let critical = null, criticalHours = Infinity;
  dState.bars.forEach(bar => {
    const barSkuIds = dState.barSkus[bar.id] || [];
    dState.skus.filter(s => barSkuIds.includes(s.id)).forEach(sku => {
      const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
      const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
      const current = sum('initial_count') + sum('delivery') + sum('transfer_in') - sum('transfer_out') - sum('tap_out');
      const rate = calculateBurnRate(e.filter(x => x.entry_type === 'tap_out'));
      if (rate > 0 && current > 0) {
        const h = current / rate;
        if (h < criticalHours) { criticalHours = h; critical = { sku, bar, hours: h }; }
      }
    });
  });

  const criticalColor = critical
    ? (criticalHours < 1 ? '#ef4444' : criticalHours < 3 ? '#f59e0b' : '#10b981')
    : '#64748b';

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(59,130,246,.15)">🏪</div>
      <div class="stat-label">Actieve bars</div>
      <div class="stat-value">${totalBars}</div>
      <div class="stat-sub">${dState.event?.name || '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(139,92,246,.15)">📦</div>
      <div class="stat-label">Producten</div>
      <div class="stat-value">${totalSkus}</div>
      <div class="stat-sub">SKUs getrackt</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(16,185,129,.15)">📋</div>
      <div class="stat-label">Mutaties</div>
      <div class="stat-value">${dState.entries.length}</div>
      <div class="stat-sub">ingevoerd vandaag</div>
    </div>
    <div class="stat-card" style="border-color:${critical ? criticalColor + '44' : 'rgba(255,255,255,.07)'}">
      <div class="stat-icon" style="background:rgba(239,68,68,.15)">⚠️</div>
      <div class="stat-label">Meest kritiek</div>
      <div class="stat-value" style="font-size:18px;color:${criticalColor}">
        ${critical ? critical.sku.name : '—'}
      </div>
      <div class="stat-sub">
        ${critical ? `${critical.bar.name} · ${formatTimeToEmpty(criticalHours)}`.replace(/<[^>]+>/g,'') : 'geen data'}
      </div>
    </div>
  `;
}

function renderDashboard() {
  const container = document.getElementById('bars-container');
  if (!dState.bars.length) {
    container.innerHTML = '<p style="color:#475569;padding:20px">Geen bars geconfigureerd.</p>';
    return;
  }
  container.innerHTML = dState.bars.map(bar => renderBar(bar)).join('');
}

function renderBar(bar) {
  const barSkuIds = dState.barSkus[bar.id] || [];
  const barSkus = dState.skus.filter(s => barSkuIds.includes(s.id));

  if (!barSkus.length) {
    return `<div class="bar-card">
      <div class="bar-card-header"><span class="bar-card-header-dot"></span>${bar.name}</div>
      <p style="padding:16px;color:#475569;font-size:13px">Geen producten toegewezen.</p>
    </div>`;
  }

  const rows = barSkus.map(sku => renderSkuRow(bar.id, sku)).join('');

  return `<div class="bar-card">
    <div class="bar-card-header"><span class="bar-card-header-dot"></span>${bar.name}</div>
    <div style="overflow-x:auto">
      <table class="stock-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Start</th>
            <th>Gebruikt</th>
            <th>In container</th>
            <th>Per uur</th>
            <th>Leeg om</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderSkuRow(barId, sku) {
  const e = dState.entries.filter(x => x.bar_id === barId && x.sku_id === sku.id);

  const sum = type => e.filter(x => x.entry_type === type).reduce((s, x) => s + Number(x.quantity), 0);

  const initial = sum('initial_count');
  const tapOut = sum('tap_out');
  const delivery = sum('delivery');
  const transferIn = sum('transfer_in');
  const transferOut = sum('transfer_out');
  const current = initial + delivery + transferIn - transferOut - tapOut;

  const burnRate = calculateBurnRate(e.filter(x => x.entry_type === 'tap_out'));
  const timeToEmpty = burnRate > 0 ? current / burnRate : null;
  const statusColor = getStatusColor(current, initial, timeToEmpty);

  let currentDisplay, burnDisplay;

  if (sku.is_beer_tank) {
    const levelReadings = e.filter(x => x.entry_type === 'beer_tank_level' && x.beer_tank_liters != null)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const beerBurnRate = calculateBeerBurnRate(levelReadings);

    // Primary value: calculated from entries (initial − tap_out), same as all other SKUs
    const pct = initial > 0 ? Math.min(100, Math.round((current / initial) * 100)) : null;

    const barColor = pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444';
    currentDisplay = `<div>${current.toLocaleString('nl-NL')} L</div>
       ${pct != null ? `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
         <div style="width:64px;background:rgba(255,255,255,.1);border-radius:9999px;height:6px;overflow:hidden">
           <div style="height:100%;border-radius:9999px;background:${barColor};width:${pct}%"></div>
         </div>
         <span style="font-size:11px;color:#64748b">${pct}%</span>
       </div>` : ''}`;

    burnDisplay = beerBurnRate != null
      ? `${Math.round(beerBurnRate)} L/u`
      : (burnRate > 0 ? `${Math.round(burnRate)} L/u` : '<span style="color:#334155">—</span>');

    return buildRow(sku.name, statusColor,
      `${initial} ${sku.unit}`, tapOut, currentDisplay, burnDisplay,
      formatTimeToEmpty(timeToEmpty), sku.is_beer_tank);
  }

  burnDisplay = burnRate > 0 ? `${burnRate.toFixed(1)}/u` : '<span style="color:#334155">—</span>';
  currentDisplay = `${current} ${sku.unit}`;

  return buildRow(sku.name, statusColor,
    `${initial} ${sku.unit}`, tapOut, currentDisplay, burnDisplay,
    formatTimeToEmpty(timeToEmpty), false);
}

function buildRow(name, colorClass, start, sold, current, burn, empty, isBeer) {
  return `<tr class="${colorClass}">
    <td>${isBeer ? '🍺 ' : ''}<span style="color:#e2e8f0">${name}</span></td>
    <td style="color:#64748b">${start}</td>
    <td style="color:#94a3b8">${sold}</td>
    <td style="font-weight:600;color:#f1f5f9">${current}</td>
    <td style="color:#94a3b8">${burn}</td>
    <td style="font-weight:600">${empty}</td>
  </tr>`;
}

// ── Calculations ───────────────────────────────────────────
function calculateBurnRate(tapEntries) {
  if (!tapEntries.length) return 0;
  const buckets = {};
  tapEntries.forEach(entry => {
    const t = new Date(entry.created_at);
    const key = Math.floor((t.getHours() * 60 + t.getMinutes()) / 30);
    buckets[key] = (buckets[key] || 0) + Number(entry.quantity);
  });
  const vals = Object.values(buckets);
  if (!vals.length) return 0;
  const avgPer30 = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avgPer30 * 2;
}

function calculateBeerBurnRate(levelReadingsSorted) {
  if (levelReadingsSorted.length < 2) return null;
  const first = levelReadingsSorted[levelReadingsSorted.length - 1];
  const last = levelReadingsSorted[0];
  const litersConsumed = Number(first.beer_tank_liters) - Number(last.beer_tank_liters);
  const hoursElapsed = (new Date(last.created_at) - new Date(first.created_at)) / 3600000;
  if (hoursElapsed < 0.1 || litersConsumed <= 0) return null;
  return litersConsumed / hoursElapsed;
}

function getStatusColor(current, initial, timeToEmpty) {
  if (initial === 0 && current === 0) return '';
  if (timeToEmpty !== null) {
    if (timeToEmpty < 1) return 'row-red';
    if (timeToEmpty < 3) return 'row-yellow';
    return 'row-green';
  }
  if (initial > 0) {
    const pct = current / initial;
    if (pct < 0.2) return 'row-red';
    if (pct < 0.5) return 'row-yellow';
    return 'row-green';
  }
  return '';
}

function formatTimeToEmpty(hours) {
  if (hours === null || hours === undefined) return '<span style="color:#334155">—</span>';
  if (hours < 0) return '<span style="color:#ef4444;font-weight:700">LEEG</span>';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const timeStr = h > 0 ? `${h}u ${m.toString().padStart(2,'0')}m` : `${m}m`;
  if (hours < 1) return `<span style="color:#ef4444;font-weight:700">${timeStr}</span>`;
  if (hours < 3) return `<span style="color:#f59e0b;font-weight:700">${timeStr}</span>`;
  return `<span style="color:#10b981">${timeStr}</span>`;
}

// ── Charts ─────────────────────────────────────────────────
function renderCharts() {
  const container = document.getElementById('charts-container');
  if (!dState.bars.length) { container.innerHTML = ''; return; }

  container.innerHTML = dState.bars.map(bar => {
    const barSkuIds = dState.barSkus[bar.id] || [];
    const barSkus = dState.skus.filter(s => barSkuIds.includes(s.id));
    const regularSkus = barSkus.filter(s => !s.is_beer_tank);
    const beerSkus = barSkus.filter(s => s.is_beer_tank);

    const regularCanvas = regularSkus.length ? `<canvas id="chart-reg-${bar.id}"></canvas>` : '';
    const beerCanvas = beerSkus.length
      ? `<div class="beer-divider"><div class="beer-divider-label">🍺 Biertank (liters)</div><canvas id="chart-beer-${bar.id}"></canvas></div>`
      : '';

    return `<div class="chart-card">
      <div class="chart-card-title">${bar.name}</div>
      ${regularCanvas}${beerCanvas}
    </div>`;
  }).join('');

  dState.bars.forEach(bar => {
    const barSkuIds = dState.barSkus[bar.id] || [];
    const barSkus = dState.skus.filter(s => barSkuIds.includes(s.id));

    const regularSkus = barSkus.filter(s => !s.is_beer_tank);
    const beerSkus = barSkus.filter(s => s.is_beer_tank);

    if (regularSkus.length) {
      const key = `reg-${bar.id}`;
      if (_charts[key]) _charts[key].destroy();
      _charts[key] = buildChart(
        `chart-reg-${bar.id}`,
        regularSkus,
        bar.id,
        (sku, e) => {
          const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
          return { available: sum('initial_count') + sum('delivery') + sum('transfer_in'), used: sum('tap_out') };
        }
      );
    }

    if (beerSkus.length) {
      const key = `beer-${bar.id}`;
      if (_charts[key]) _charts[key].destroy();
      _charts[key] = buildChart(
        `chart-beer-${bar.id}`,
        beerSkus,
        bar.id,
        (sku, e) => {
          const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
          return { available: sum('initial_count') + sum('delivery') + sum('transfer_in'), used: sum('tap_out') };
        }
      );
    }
  });
}

function buildChart(canvasId, skus, barId, calcFn) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const labels = skus.map(s => s.name);
  const available = [], used = [];

  skus.forEach(sku => {
    const e = dState.entries.filter(x => x.bar_id === barId && x.sku_id === sku.id);
    const vals = calcFn(sku, e);
    available.push(vals.available);
    used.push(vals.used);
  });

  const remaining = available.map((a, i) => Math.max(0, a - used[i]));

  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Gebruikt',
          data: used,
          backgroundColor: 'rgba(239,68,68,.75)',
          borderColor: 'rgba(239,68,68,1)',
          borderWidth: 1,
          borderRadius: 0,
          stack: 'stock',
        },
        {
          label: 'Resterend',
          data: remaining,
          backgroundColor: 'rgba(16,185,129,.75)',
          borderColor: 'rgba(16,185,129,1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'stock',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', font: { size: 12 }, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,.95)',
          borderColor: 'rgba(255,255,255,.1)',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          callbacks: {
            label: (ctx) => {
              const sku = skus[ctx.dataIndex];
              return `  ${ctx.dataset.label}: ${ctx.raw.toLocaleString('nl-NL')} ${sku.unit}`;
            },
            footer: (items) => {
              const i = items[0].dataIndex;
              return `Totaal: ${available[i].toLocaleString('nl-NL')} ${skus[i].unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#64748b', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,.04)' },
          border: { color: 'rgba(255,255,255,.06)' },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { precision: 0, color: '#64748b', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,.06)' },
          border: { color: 'rgba(255,255,255,.06)' },
        },
      },
    },
  });
}

// ── Auto-refresh & realtime ────────────────────────────────
function startAutoRefresh() {
  if (dState.refreshInterval) clearInterval(dState.refreshInterval);
  dState.refreshInterval = setInterval(loadDashboard, 30000);
}

function subscribeRealtime() {
  const sb = getSupabase();
  sb.channel('stock-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_entries',
        filter: `event_id=eq.${Auth.getEventId()}` },
      () => loadDashboard())
    .subscribe();
}
