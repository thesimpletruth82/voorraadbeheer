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
  await Auth.loadActiveEvent();
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

  renderDashboard();
  renderCharts();
}

function renderDashboard() {
  const container = document.getElementById('bars-container');
  if (!dState.bars.length) {
    container.innerHTML = '<p class="text-gray-400">Geen bars geconfigureerd.</p>';
    return;
  }
  container.innerHTML = dState.bars.map(bar => renderBar(bar)).join('');
}

function renderBar(bar) {
  const barSkuIds = dState.barSkus[bar.id] || [];
  const barSkus = dState.skus.filter(s => barSkuIds.includes(s.id));

  if (!barSkus.length) {
    return `<div class="bar-card bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="bg-gray-800 text-white px-5 py-3 font-semibold text-lg">${bar.name}</div>
      <p class="p-4 text-gray-400 text-sm">Geen producten toegewezen.</p>
    </div>`;
  }

  const rows = barSkus.map(sku => renderSkuRow(bar.id, sku)).join('');

  return `<div class="bar-card bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
    <div class="bg-gray-800 text-white px-5 py-3 font-semibold text-lg">${bar.name}</div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <th class="text-left px-4 py-2">Product</th>
            <th class="text-right px-3 py-2">Start</th>
            <th class="text-right px-3 py-2">Verkocht</th>
            <th class="text-right px-3 py-2">In container</th>
            <th class="text-right px-3 py-2">Per uur</th>
            <th class="text-right px-4 py-2">Leeg om</th>
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
    const latestLevel = levelReadings[0];
    const liters = latestLevel ? Number(latestLevel.beer_tank_liters) : null;
    const pct = liters != null ? Math.round((liters / sku.tank_size_liters) * 100) : null;
    const beerBurnRate = calculateBeerBurnRate(levelReadings);

    currentDisplay = liters != null
      ? `<div>${liters.toLocaleString('nl-NL')} L</div>
         <div class="flex items-center gap-1 mt-1">
           <div class="w-16 bg-gray-200 rounded-full h-2">
             <div class="h-2 rounded-full ${pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-400' : 'bg-red-500'}"
                  style="width:${pct}%"></div>
           </div>
           <span class="text-xs text-gray-500">${pct}%</span>
         </div>`
      : '<span class="text-gray-300">—</span>';

    burnDisplay = beerBurnRate != null
      ? `${Math.round(beerBurnRate)} L/u`
      : (burnRate > 0 ? `${Math.round(burnRate)} L/u` : '<span class="text-gray-300">—</span>');

    const beerTimeToEmpty = liters != null && beerBurnRate > 0 ? liters / beerBurnRate : timeToEmpty;
    return buildRow(sku.name, statusColor,
      `${initial} ${sku.unit}`, tapOut || '—', currentDisplay, burnDisplay,
      formatTimeToEmpty(beerTimeToEmpty), sku.is_beer_tank);
  }

  burnDisplay = burnRate > 0 ? `${burnRate.toFixed(1)}/u` : '<span class="text-gray-300">—</span>';
  currentDisplay = `${current} ${sku.unit}`;

  return buildRow(sku.name, statusColor,
    `${initial} ${sku.unit}`, tapOut || '—', currentDisplay, burnDisplay,
    formatTimeToEmpty(timeToEmpty), false);
}

function buildRow(name, colorClass, start, sold, current, burn, empty, isBeer) {
  return `<tr class="${colorClass} border-b border-gray-100 last:border-0">
    <td class="px-4 py-2.5 font-medium text-gray-800">${isBeer ? '🍺 ' : ''}${name}</td>
    <td class="px-3 py-2.5 text-right text-gray-500">${start}</td>
    <td class="px-3 py-2.5 text-right text-gray-600">${sold}</td>
    <td class="px-3 py-2.5 text-right font-semibold">${current}</td>
    <td class="px-3 py-2.5 text-right text-gray-600">${burn}</td>
    <td class="px-4 py-2.5 text-right font-medium">${empty}</td>
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
    if (timeToEmpty < 1) return 'bg-red-50';
    if (timeToEmpty < 3) return 'bg-yellow-50';
    return 'bg-green-50';
  }
  if (initial > 0) {
    const pct = current / initial;
    if (pct < 0.2) return 'bg-red-50';
    if (pct < 0.5) return 'bg-yellow-50';
    return 'bg-green-50';
  }
  return '';
}

function formatTimeToEmpty(hours) {
  if (hours === null || hours === undefined) return '<span class="text-gray-300">—</span>';
  if (hours < 0) return '<span class="text-red-600 font-bold">LEEG</span>';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const timeStr = h > 0 ? `${h}u ${m.toString().padStart(2,'0')}m` : `${m}m`;
  if (hours < 1) return `<span class="text-red-600 font-bold">${timeStr}</span>`;
  if (hours < 3) return `<span class="text-yellow-600 font-bold">${timeStr}</span>`;
  return `<span class="text-green-700">${timeStr}</span>`;
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

    const regularCanvas = regularSkus.length
      ? `<canvas id="chart-reg-${bar.id}"></canvas>` : '';
    const beerCanvas = beerSkus.length
      ? `<div class="mt-5 pt-5 border-t border-gray-100"><p class="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">🍺 Biertank (liters)</p><canvas id="chart-beer-${bar.id}"></canvas></div>` : '';

    return `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
      <h3 class="font-semibold text-gray-800 mb-4">${bar.name}</h3>
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
          const levels = e
            .filter(x => x.entry_type === 'beer_tank_level' && x.beer_tank_liters != null)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          const available = levels.length ? Number(levels[0].beer_tank_liters) : 0;
          const used = levels.length >= 2
            ? Math.max(0, Number(levels[0].beer_tank_liters) - Number(levels[levels.length - 1].beer_tank_liters))
            : e.filter(x => x.entry_type === 'tap_out').reduce((a, x) => a + Number(x.quantity), 0);
          return { available, used };
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

  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Totaal beschikbaar',
          data: available,
          backgroundColor: 'rgba(59, 130, 246, 0.75)',
          borderColor: 'rgba(37, 99, 235, 1)',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Gebruikt',
          data: used,
          backgroundColor: 'rgba(249, 115, 22, 0.75)',
          borderColor: 'rgba(234, 88, 12, 1)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const sku = skus[ctx.dataIndex];
              return `${ctx.dataset.label}: ${ctx.raw.toLocaleString('nl-NL')} ${sku.unit}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
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
