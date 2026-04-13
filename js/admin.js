// ── State ──────────────────────────────────────────────────
let state = {
  events: [],
  activeEvent: null,
  bars: [],
  skus: [],
  barSkus: {},   // barId → [skuId, ...]
};

const DEFAULT_SKUS = [
  { name: 'Coca Cola Regular', unit: 'stuks', is_beer_tank: false },
  { name: 'Coca Cola Light', unit: 'stuks', is_beer_tank: false },
  { name: 'Coca Cola Zero', unit: 'stuks', is_beer_tank: false },
  { name: 'Fanta', unit: 'stuks', is_beer_tank: false },
  { name: 'Sprite', unit: 'stuks', is_beer_tank: false },
  { name: 'Chaudfontaine 0.33L', unit: 'stuks', is_beer_tank: false },
  { name: 'Chaudfontaine 1.5L', unit: 'stuks', is_beer_tank: false },
  { name: 'Red Bull', unit: 'stuks', is_beer_tank: false },
  { name: 'Red Bull Zero', unit: 'stuks', is_beer_tank: false },
  { name: 'Witte Wijn', unit: 'stuks', is_beer_tank: false },
  { name: 'Rosé', unit: 'stuks', is_beer_tank: false },
  { name: 'Bacardi Cola', unit: 'stuks', is_beer_tank: false },
  { name: 'Bacardi Razz & Up', unit: 'stuks', is_beer_tank: false },
  { name: 'Hoegaarden Rosé', unit: 'stuks', is_beer_tank: false },
  { name: 'Jupiler Blik', unit: 'stuks', is_beer_tank: false },
  { name: 'Jupiler Biertank', unit: 'liter', is_beer_tank: true, tank_size_liters: 1000 },
  { name: 'Bierbekers', unit: 'stuks', is_beer_tank: false },
  { name: 'Colabekers', unit: 'stuks', is_beer_tank: false },
  { name: 'Wijnbekers', unit: 'stuks', is_beer_tank: false },
  { name: 'Draagtrays', unit: 'stuks', is_beer_tank: false },
];

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showSection('main-section');
  loadData();

  document.getElementById('event-form').addEventListener('submit', handleCreateEvent);
  document.getElementById('bar-form').addEventListener('submit', handleCreateBar);
  document.getElementById('sku-form').addEventListener('submit', handleCreateSku);
});


function showTab(tab) {
  ['events','bars','skus'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-btn-${t}`).classList.toggle('tab-active', t === tab);
  });
}

// ── Data loaders ───────────────────────────────────────────
async function loadData() {
  await loadEvents();
}

async function loadEvents() {
  const sb = getSupabase();
  const { data } = await sb.from('events').select('*').order('created_at', { ascending: false });
  state.events = data || [];
  renderEventList();
  const active = state.events.find(e => e.is_active);
  if (active) await selectEvent(active.id);
}

async function selectEvent(eventId) {
  const sb = getSupabase();
  state.activeEvent = state.events.find(e => e.id === eventId);
  document.getElementById('active-event-name').textContent = state.activeEvent?.name || '—';

  const [{ data: bars }, { data: skus }] = await Promise.all([
    sb.from('bars').select('*').eq('event_id', eventId).order('order_num'),
    sb.from('skus').select('*').eq('event_id', eventId).order('order_num'),
  ]);
  state.bars = bars || [];
  state.skus = skus || [];

  if (state.bars.length > 0) {
    const barIds = state.bars.map(b => b.id);
    const { data: barSkusData } = await sb.from('bar_skus').select('*').in('bar_id', barIds);
    state.barSkus = {};
    (barSkusData || []).forEach(bs => {
      if (!state.barSkus[bs.bar_id]) state.barSkus[bs.bar_id] = [];
      state.barSkus[bs.bar_id].push(bs.sku_id);
    });
  }

  renderBars();
  renderSkus();
  renderEventList();
}

// ── Event CRUD ─────────────────────────────────────────────
async function handleCreateEvent(e) {
  e.preventDefault();
  const sb = getSupabase();
  const name = document.getElementById('event-name').value.trim();
  const date = document.getElementById('event-date').value;
  const useDefaults = document.getElementById('event-use-defaults').checked;

  const { data: event, error } = await sb
    .from('events')
    .insert({ name, date, staff_password: 'none' })
    .select().single();
  if (error) { alert('Fout: ' + error.message); return; }

  if (useDefaults) {
    const skuRows = DEFAULT_SKUS.map((s, i) => ({ ...s, event_id: event.id, order_num: i }));
    await sb.from('skus').insert(skuRows);
  }

  document.getElementById('event-form').reset();
  await loadEvents();
  await setActiveEvent(event.id);
  showTab('bars');
}

async function setActiveEvent(eventId) {
  const sb = getSupabase();
  await sb.from('events').update({ is_active: false }).neq('id', eventId);
  await sb.from('events').update({ is_active: true }).eq('id', eventId);
  await loadEvents();
}

async function deleteEvent(eventId) {
  if (!confirm('Dit evenement en alle data verwijderen?')) return;
  await getSupabase().from('events').delete().eq('id', eventId);
  await loadEvents();
}

// ── Bar CRUD ───────────────────────────────────────────────
async function handleCreateBar(e) {
  e.preventDefault();
  if (!state.activeEvent) { alert('Selecteer eerst een evenement.'); return; }
  const sb = getSupabase();
  const name = document.getElementById('bar-name').value.trim();
  const order_num = state.bars.length;
  await sb.from('bars').insert({ event_id: state.activeEvent.id, name, order_num });
  document.getElementById('bar-name').value = '';
  await selectEvent(state.activeEvent.id);
}

async function deleteBar(barId) {
  if (!confirm('Bar verwijderen?')) return;
  await getSupabase().from('bars').delete().eq('id', barId);
  await selectEvent(state.activeEvent.id);
}

// ── SKU CRUD ───────────────────────────────────────────────
async function handleCreateSku(e) {
  e.preventDefault();
  if (!state.activeEvent) { alert('Selecteer eerst een evenement.'); return; }
  const sb = getSupabase();
  const name = document.getElementById('sku-name').value.trim();
  const unit = document.getElementById('sku-unit').value.trim() || 'stuks';
  const is_beer_tank = document.getElementById('sku-is-beer').checked;
  const tank_size_liters = parseInt(document.getElementById('sku-tank-size').value) || 1000;
  const order_num = state.skus.length;
  await sb.from('skus').insert({ event_id: state.activeEvent.id, name, unit, is_beer_tank, tank_size_liters, order_num });
  document.getElementById('sku-form').reset();
  await selectEvent(state.activeEvent.id);
}

async function deleteSku(skuId) {
  if (!confirm('Product verwijderen?')) return;
  await getSupabase().from('skus').delete().eq('id', skuId);
  await selectEvent(state.activeEvent.id);
}

// ── Bar-SKU assignment ─────────────────────────────────────
async function toggleBarSku(barId, skuId, checked) {
  const sb = getSupabase();
  if (checked) {
    await sb.from('bar_skus').upsert({ bar_id: barId, sku_id: skuId });
  } else {
    await sb.from('bar_skus').delete().eq('bar_id', barId).eq('sku_id', skuId);
  }
  if (!state.barSkus[barId]) state.barSkus[barId] = [];
  if (checked) {
    if (!state.barSkus[barId].includes(skuId)) state.barSkus[barId].push(skuId);
  } else {
    state.barSkus[barId] = state.barSkus[barId].filter(id => id !== skuId);
  }
}

async function assignAllSkusToBar(barId) {
  const sb = getSupabase();
  const rows = state.skus.map(s => ({ bar_id: barId, sku_id: s.id }));
  await sb.from('bar_skus').upsert(rows);
  state.barSkus[barId] = state.skus.map(s => s.id);
  renderBars();
}

// ── Renders ────────────────────────────────────────────────
function renderEventList() {
  const el = document.getElementById('event-list');
  if (!state.events.length) {
    el.innerHTML = '<p class="text-gray-500 text-sm">Nog geen evenementen.</p>';
    return;
  }
  el.innerHTML = state.events.map(ev => `
    <div class="flex items-center justify-between p-3 rounded-lg border ${ev.is_active ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}">
      <div>
        <span class="font-medium">${ev.name}</span>
        <span class="text-sm text-gray-500 ml-2">${formatDate(ev.date)}</span>
        ${ev.is_active ? '<span class="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Actief</span>' : ''}
      </div>
      <div class="flex gap-2">
        ${!ev.is_active ? `<button onclick="setActiveEvent('${ev.id}')" class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">Activeer</button>` : ''}
        <button onclick="selectEvent('${ev.id}')" class="text-xs bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">Beheer</button>
        <button onclick="deleteEvent('${ev.id}')" class="text-xs bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200">✕</button>
      </div>
    </div>
  `).join('');
}

function renderBars() {
  const el = document.getElementById('bar-list');
  if (!state.activeEvent) {
    el.innerHTML = '<p class="text-gray-500 text-sm">Selecteer een evenement.</p>';
    return;
  }
  if (!state.bars.length) {
    el.innerHTML = '<p class="text-gray-500 text-sm">Nog geen bars. Voeg er één toe.</p>';
    return;
  }
  el.innerHTML = state.bars.map(bar => `
    <div class="border border-gray-200 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-gray-800">${bar.name}</h3>
        <div class="flex gap-2">
          <button onclick="assignAllSkusToBar('${bar.id}')" class="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300">Alles ✓</button>
          <button onclick="deleteBar('${bar.id}')" class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">✕</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-1">
        ${state.skus.map(sku => {
          const checked = (state.barSkus[bar.id] || []).includes(sku.id);
          return `<label class="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-gray-50">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleBarSku('${bar.id}','${sku.id}',this.checked)" class="rounded">
            <span class="${sku.is_beer_tank ? 'text-amber-700 font-medium' : ''}">${sku.name}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function renderSkus() {
  const el = document.getElementById('sku-list');
  if (!state.activeEvent) {
    el.innerHTML = '<p class="text-gray-500 text-sm">Selecteer een evenement.</p>';
    return;
  }
  if (!state.skus.length) {
    el.innerHTML = '<p class="text-gray-500 text-sm">Nog geen producten.</p>';
    return;
  }
  el.innerHTML = `<table class="w-full text-sm">
    <thead><tr class="text-left text-gray-500 border-b">
      <th class="pb-2">Product</th><th class="pb-2">Eenheid</th><th class="pb-2">Biertank</th><th></th>
    </tr></thead>
    <tbody>
      ${state.skus.map(sku => `
        <tr class="border-b border-gray-100">
          <td class="py-2">${sku.name}</td>
          <td class="py-2 text-gray-500">${sku.unit}</td>
          <td class="py-2">${sku.is_beer_tank ? `🍺 ${sku.tank_size_liters}L` : '—'}</td>
          <td class="py-2 text-right">
            <button onclick="deleteSku('${sku.id}')" class="text-xs text-red-500 hover:text-red-700">✕</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}
