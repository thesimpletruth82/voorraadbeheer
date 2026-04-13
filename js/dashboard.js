let dState = {
  event: null,
  bars: [],
  skus: [],
  barSkus: {},
  entries: [],
  refreshInterval: null,
};

const _charts = {}; // key -> Chart instance
let _currentBarId = null;

// ── Boot ───────────────────────────────────────────────────
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

  window.addEventListener('hashchange', () => {
    renderCurrentView();
    window.scrollTo(0, 0);
  });

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

  renderCurrentView();
}

// ── Routing ────────────────────────────────────────────────
function renderCurrentView() {
  const hash = location.hash;
  const mainView   = document.getElementById('main-view');
  const detailView = document.getElementById('detail-view');

  if (hash.startsWith('#bar-')) {
    const barId = hash.slice(5);
    _currentBarId = barId;
    mainView.style.display  = 'none';
    detailView.style.display = '';
    renderSummaryCards(barId);
    renderDetailView(barId);
  } else {
    _currentBarId = null;
    mainView.style.display  = '';
    detailView.style.display = 'none';
    renderSummaryCards(null);
    renderMainCharts();
  }
}

// ── Stat cards ─────────────────────────────────────────────
function renderSummaryCards(barId) {
  const el = document.getElementById('stat-cards');
  if (!el) return;

  // Which bars to consider
  const bars   = barId ? dState.bars.filter(b => b.id === barId) : dState.bars;
  const barIds = bars.map(b => b.id);

  // Collect all SKU ids across those bars
  const skuIdSet = new Set();
  barIds.forEach(id => (dState.barSkus[id] || []).forEach(sid => skuIdSet.add(sid)));
  const skus = dState.skus.filter(s => skuIdSet.has(s.id));

  const entries = dState.entries.filter(e => barIds.includes(e.bar_id));
  const totalMutations = entries.length;

  // Most critical SKU
  let critical = null, criticalHours = Infinity;
  bars.forEach(bar => {
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

  const subtitle = barId
    ? (dState.bars.find(b => b.id === barId)?.name || '')
    : (dState.event?.name || '—');

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(59,130,246,.15)">🏪</div>
      <div class="stat-label">${barId ? 'Geselecteerde bar' : 'Actieve bars'}</div>
      <div class="stat-value">${barId ? 1 : bars.length}</div>
      <div class="stat-sub">${subtitle}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(139,92,246,.15)">📦</div>
      <div class="stat-label">Producten</div>
      <div class="stat-value">${skus.length}</div>
      <div class="stat-sub">SKUs getrackt</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(16,185,129,.15)">📋</div>
      <div class="stat-label">Mutaties</div>
      <div class="stat-value">${totalMutations}</div>
      <div class="stat-sub">${barId ? 'voor deze bar' : 'ingevoerd totaal'}</div>
    </div>
    <div class="stat-card" style="border-color:${critical ? criticalColor + '44' : 'rgba(255,255,255,.07)'}">
      <div class="stat-icon" style="background:rgba(239,68,68,.15)">⚠️</div>
      <div class="stat-label">Meest kritiek</div>
      <div class="stat-value" style="font-size:18px;color:${criticalColor}">
        ${critical ? critical.sku.name : '—'}
      </div>
      <div class="stat-sub">
        ${critical ? `${critical.bar.name} · ${formatTimeToEmpty(criticalHours)}`.replace(/<[^>]+>/g, '') : 'geen data'}
      </div>
    </div>
  `;
}

// ── Main view ──────────────────────────────────────────────
function renderMainCharts() {
  renderTotaalTerrein();
  renderBarCharts();
}

function renderTotaalTerrein() {
  const container = document.getElementById('totaal-chart-container');
  if (!container) return;

  if (!dState.skus.length) {
    container.innerHTML = '<p style="color:#475569;padding:12px 0">Geen producten geconfigureerd.</p>';
    return;
  }

  // Aggregate all bars for each SKU
  const regularSkus = dState.skus.filter(s => !s.is_beer_tank);
  const beerSkus    = dState.skus.filter(s => s.is_beer_tank);
  const allSkus     = [...regularSkus, ...beerSkus];

  const availableArr = allSkus.map(sku => {
    return dState.bars.reduce((total, bar) => {
      const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
      const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
      return total + sum('initial_count') + sum('delivery') + sum('transfer_in');
    }, 0);
  });

  const usedArr = allSkus.map(sku => {
    return dState.bars.reduce((total, bar) => {
      const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
      return total + e.filter(x => x.entry_type === 'tap_out').reduce((a, x) => a + Number(x.quantity), 0);
    }, 0);
  });

  container.innerHTML = `<div class="chart-card"><canvas id="chart-totaal"></canvas></div>`;

  const key = 'totaal';
  if (_charts[key]) _charts[key].destroy();
  _charts[key] = buildChart('chart-totaal', allSkus, availableArr, usedArr);
}

function renderBarCharts() {
  const container = document.getElementById('bar-charts-container');
  if (!container) return;

  if (!dState.bars.length) {
    container.innerHTML = '<p style="color:#475569;padding:12px 0">Geen bars geconfigureerd.</p>';
    return;
  }

  container.innerHTML = dState.bars.map(bar => {
    const barSkuIds = dState.barSkus[bar.id] || [];
    const barSkus   = dState.skus.filter(s => barSkuIds.includes(s.id));
    const regular   = barSkus.filter(s => !s.is_beer_tank);
    const beer      = barSkus.filter(s => s.is_beer_tank);
    const allSkus   = [...regular, ...beer];

    if (!allSkus.length) return '';

    return `<div class="chart-card clickable" onclick="location.hash='#bar-${bar.id}'">
      <div class="chart-card-title">
        ${bar.name}
        <span class="chart-card-hint">Klik voor detail →</span>
      </div>
      <canvas id="chart-bar-${bar.id}"></canvas>
    </div>`;
  }).join('');

  dState.bars.forEach(bar => {
    const barSkuIds = dState.barSkus[bar.id] || [];
    const barSkus   = dState.skus.filter(s => barSkuIds.includes(s.id));
    const regular   = barSkus.filter(s => !s.is_beer_tank);
    const beer      = barSkus.filter(s => s.is_beer_tank);
    const allSkus   = [...regular, ...beer];

    if (!allSkus.length) return;

    const availableArr = allSkus.map(sku => {
      const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
      const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
      return sum('initial_count') + sum('delivery') + sum('transfer_in');
    });
    const usedArr = allSkus.map(sku => {
      const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
      return e.filter(x => x.entry_type === 'tap_out').reduce((a, x) => a + Number(x.quantity), 0);
    });

    const key = `bar-${bar.id}`;
    if (_charts[key]) _charts[key].destroy();
    _charts[key] = buildChart(`chart-bar-${bar.id}`, allSkus, availableArr, usedArr);
  });
}

// ── Detail view ────────────────────────────────────────────
function renderDetailView(barId) {
  const bar = dState.bars.find(b => b.id === barId);
  if (!bar) return;

  document.getElementById('detail-bar-name').textContent = bar.name;

  renderDetailChart(bar);
  renderDetailTable(bar);
}

function renderDetailChart(bar) {
  const container = document.getElementById('detail-chart-container');
  if (!container) return;

  const barSkuIds = dState.barSkus[bar.id] || [];
  const barSkus   = dState.skus.filter(s => barSkuIds.includes(s.id));
  const regular   = barSkus.filter(s => !s.is_beer_tank);
  const beer      = barSkus.filter(s => s.is_beer_tank);
  const allSkus   = [...regular, ...beer];

  if (!allSkus.length) {
    container.innerHTML = '<p style="color:#475569;padding:12px 28px">Geen producten toegewezen.</p>';
    return;
  }

  container.innerHTML = `<div class="chart-card"><canvas id="chart-detail-${bar.id}"></canvas></div>`;

  const availableArr = allSkus.map(sku => {
    const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
    const sum = t => e.filter(x => x.entry_type === t).reduce((a, x) => a + Number(x.quantity), 0);
    return sum('initial_count') + sum('delivery') + sum('transfer_in');
  });
  const usedArr = allSkus.map(sku => {
    const e = dState.entries.filter(x => x.bar_id === bar.id && x.sku_id === sku.id);
    return e.filter(x => x.entry_type === 'tap_out').reduce((a, x) => a + Number(x.quantity), 0);
  });

  const key = `detail-${bar.id}`;
  if (_charts[key]) _charts[key].destroy();
  _charts[key] = buildChart(`chart-detail-${bar.id}`, allSkus, availableArr, usedArr);
}

function renderDetailTable(bar) {
  const container = document.getElementById('detail-table-container');
  if (!container) return;

  const barSkuIds = dState.barSkus[bar.id] || [];
  const barSkus   = dState.skus.filter(s => barSkuIds.includes(s.id));

  if (!barSkus.length) {
    container.innerHTML = '';
    return;
  }

  const rows = barSkus.map(sku => renderSkuRow(bar.id, sku)).join('');

  container.innerHTML = `
    <div class="bar-card" style="grid-column:1/-1">
      <div class="bar-card-header">
        <span class="bar-card-header-dot"></span>${bar.name} — Voorraadoverzicht
      </div>
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

// ── Stock row ──────────────────────────────────────────────
function renderSkuRow(barId, sku) {
  const e = dState.entries.filter(x => x.bar_id === barId && x.sku_id === sku.id);
  const sum = type => e.filter(x => x.entry_type === type).reduce((s, x) => s + Number(x.quantity), 0);

  const initial     = sum('initial_count');
  const tapOut      = sum('tap_out');
  const delivery    = sum('delivery');
  const transferIn  = sum('transfer_in');
  const transferOut = sum('transfer_out');
  const current     = initial + delivery + transferIn - transferOut - tapOut;

  const burnRate    = calculateBurnRate(e.filter(x => x.entry_type === 'tap_out'));
  const timeToEmpty = burnRate > 0 ? current / burnRate : null;
  const statusColor = getStatusColor(current, initial, timeToEmpty);

  let currentDisplay, burnDisplay;

  if (sku.is_beer_tank) {
    const levelReadings = e
      .filter(x => x.entry_type === 'beer_tank_level' && x.beer_tank_liters != null)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const beerBurnRate = calculateBeerBurnRate(levelReadings);

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
      formatTimeToEmpty(timeToEmpty), true);
  }

  burnDisplay    = burnRate > 0 ? `${burnRate.toFixed(1)}/u` : '<span style="color:#334155">—</span>';
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
  const last  = levelReadingsSorted[0];
  const litersConsumed = Number(first.beer_tank_liters) - Number(last.beer_tank_liters);
  const hoursElapsed   = (new Date(last.created_at) - new Date(first.created_at)) / 3600000;
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
  const timeStr = h > 0 ? `${h}u ${m.toString().padStart(2, '0')}m` : `${m}m`;
  if (hours < 1) return `<span style="color:#ef4444;font-weight:700">${timeStr}</span>`;
  if (hours < 3) return `<span style="color:#f59e0b;font-weight:700">${timeStr}</span>`;
  return `<span style="color:#10b981">${timeStr}</span>`;
}

// ── Chart builder ──────────────────────────────────────────
function buildChart(canvasId, skus, availableArr, usedArr) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const labels    = skus.map(s => s.name);
  const remaining = availableArr.map((a, i) => Math.max(0, a - usedArr[i]));

  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Gebruikt',
          data: usedArr,
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
              return `Totaal: ${availableArr[i].toLocaleString('nl-NL')} ${skus[i].unit}`;
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
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'stock_entries',
      filter: `event_id=eq.${Auth.getEventId()}`,
    }, () => loadDashboard())
    .subscribe();
}
