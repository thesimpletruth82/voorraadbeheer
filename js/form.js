let fState = {
  event: null,
  bars: [],
  skus: [],
  barSkus: {},
  selectedBar: null,
  entryType: null,
};

const ENTRY_TYPES = [
  { id: 'initial_count', label: 'Begintelling', icon: '📦', color: 'bg-blue-100 text-blue-800', description: 'Openingstelling container' },
  { id: 'tap_out', label: 'Uitgifte', icon: '🍺', color: 'bg-orange-100 text-orange-800', description: 'Producten uit container gehaald' },
  { id: 'delivery', label: 'Levering', icon: '🚚', color: 'bg-green-100 text-green-800', description: 'Nieuwe levering ontvangen' },
  { id: 'transfer_out', label: 'Transfer', icon: '↔️', color: 'bg-purple-100 text-purple-800', description: 'Naar andere bar sturen' },
  { id: 'beer_tank_level', label: 'Biertank', icon: '🛢️', color: 'bg-amber-100 text-amber-800', description: 'Huidig niveau biertank' },
  { id: 'end_count', label: 'Eindtelling', icon: '🏁', color: 'bg-gray-100 text-gray-800', description: 'Slottelling container' },
];

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await Auth.loadActiveEvent();
  if (!ok) {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center">
      <div><div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <h1 style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:8px">Geen actief evenement</h1>
        <p style="color:#64748b;font-size:14px;margin-bottom:16px">Ga naar Beheer en activeer eerst een evenement.</p>
        <a href="/admin" style="color:#3b82f6;font-weight:600;font-size:14px">→ Naar Beheer</a>
      </div></div>`;
    return;
  }
  await loadEventData();
  showStep('step-bar');

  document.getElementById('submit-btn').addEventListener('click', handleSubmit);
});

function showStep(stepId) {
  ['step-bar','step-type','step-entries'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== stepId);
  });
}

async function loadEventData() {
  const sb = getSupabase();
  const eventId = Auth.getEventId();

  const [{ data: event }, { data: bars }, { data: skus }] = await Promise.all([
    sb.from('events').select('*').eq('id', eventId).single(),
    sb.from('bars').select('*').eq('event_id', eventId).order('order_num'),
    sb.from('skus').select('*').eq('event_id', eventId).order('order_num'),
  ]);

  fState.event = event;
  fState.bars = bars || [];
  fState.skus = skus || [];

  if (fState.bars.length > 0) {
    const barIds = fState.bars.map(b => b.id);
    const { data: barSkusData } = await sb.from('bar_skus').select('*').in('bar_id', barIds);
    fState.barSkus = {};
    (barSkusData || []).forEach(bs => {
      if (!fState.barSkus[bs.bar_id]) fState.barSkus[bs.bar_id] = [];
      fState.barSkus[bs.bar_id].push(bs.sku_id);
    });
  }

  document.getElementById('event-title').textContent = fState.event?.name || '';
  renderBarSelection();
}

function renderBarSelection() {
  const el = document.getElementById('bar-buttons');
  el.innerHTML = fState.bars.map(bar => `
    <button onclick="selectBar('${bar.id}','${bar.name}')"
      class="bar-btn w-full py-4 text-left px-4 rounded-xl border-2 font-medium text-lg
             ${Auth.getBarId() === bar.id ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-800'}
             active:scale-95 transition-transform">
      ${bar.name}
    </button>
  `).join('');
}

function selectBar(barId, barName) {
  Auth.setBar(barId, barName);
  fState.selectedBar = { id: barId, name: barName };
  document.getElementById('selected-bar-name').textContent = barName;
  renderBarSelection();
  renderEntryTypeButtons();
  showStep('step-type');
}

function renderEntryTypeButtons() {
  const el = document.getElementById('type-buttons');
  el.innerHTML = ENTRY_TYPES.map(t => `
    <button onclick="selectEntryType('${t.id}')"
      class="type-btn flex items-center gap-3 w-full py-3 px-4 rounded-xl border-2 border-gray-200
             font-medium ${t.color} active:scale-95 transition-transform">
      <span class="text-2xl">${t.icon}</span>
      <div class="text-left">
        <div class="font-semibold">${t.label}</div>
        <div class="text-xs opacity-75">${t.description}</div>
      </div>
    </button>
  `).join('');
}

function selectEntryType(typeId) {
  fState.entryType = typeId;
  const type = ENTRY_TYPES.find(t => t.id === typeId);
  document.getElementById('entry-type-label').textContent = `${type.icon} ${type.label}`;
  document.getElementById('entry-bar-label').textContent = fState.selectedBar.name;
  renderEntryForm();
  showStep('step-entries');
}

function renderEntryForm() {
  const barSkuIds = fState.barSkus[fState.selectedBar.id] || [];
  let relevantSkus = fState.skus.filter(s => barSkuIds.includes(s.id));

  if (fState.entryType === 'beer_tank_level') {
    relevantSkus = relevantSkus.filter(s => s.is_beer_tank);
  }

  const isTransfer = fState.entryType === 'transfer_out';
  let html = '';

  if (isTransfer) {
    const otherBars = fState.bars.filter(b => b.id !== fState.selectedBar.id);
    html += `<div class="mb-4">
      <label class="block text-sm font-semibold text-gray-700 mb-2">Naar welke bar?</label>
      <select id="transfer-target" class="w-full border-2 border-gray-200 rounded-xl p-3 text-base">
        <option value="">Selecteer bar...</option>
        ${otherBars.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
      </select>
    </div>`;
  }

  if (relevantSkus.length === 0) {
    html += '<p class="text-gray-500 text-sm">Geen producten beschikbaar voor dit type invoer.</p>';
  } else {
    html += relevantSkus.map(sku => {
      const isBeerLevel = fState.entryType === 'beer_tank_level' && sku.is_beer_tank;
      const label = isBeerLevel ? `${sku.name} (liters in tank)` : sku.name;
      const unit = isBeerLevel ? 'L' : sku.unit;
      const placeholder = isBeerLevel ? `0 – ${sku.tank_size_liters}` : '0';
      return `
        <div class="sku-row flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
          <div>
            <div class="font-medium text-gray-800">${label}</div>
            <div class="text-xs text-gray-400">${unit}</div>
          </div>
          <div class="flex items-center gap-2 ml-4">
            <button type="button" onclick="adjustQty('${sku.id}',-1)"
              class="w-10 h-10 rounded-xl bg-gray-100 text-xl font-bold text-gray-600 flex items-center justify-center active:bg-gray-200">−</button>
            <input id="qty-${sku.id}" type="number" min="0" value="0" placeholder="${placeholder}"
              class="w-16 text-center text-lg border-2 border-gray-200 rounded-xl py-1 focus:border-blue-400 focus:outline-none">
            <button type="button" onclick="adjustQty('${sku.id}',1)"
              class="w-10 h-10 rounded-xl bg-gray-100 text-xl font-bold text-gray-600 flex items-center justify-center active:bg-gray-200">+</button>
          </div>
        </div>
      `;
    }).join('');
  }

  html += `<div class="mt-4">
    <label class="block text-sm font-medium text-gray-600 mb-1">Notities (optioneel)</label>
    <input id="entry-notes" type="text" placeholder="Opmerking..."
      class="w-full border-2 border-gray-200 rounded-xl p-3 text-base focus:border-blue-400 focus:outline-none">
  </div>`;

  document.getElementById('entry-form-body').innerHTML = html;
}

function adjustQty(skuId, delta) {
  const input = document.getElementById(`qty-${skuId}`);
  const current = parseInt(input.value) || 0;
  input.value = Math.max(0, current + delta);
}

async function handleSubmit() {
  const sb = getSupabase();
  const barSkuIds = fState.barSkus[fState.selectedBar.id] || [];
  let relevantSkus = fState.skus.filter(s => barSkuIds.includes(s.id));
  if (fState.entryType === 'beer_tank_level') {
    relevantSkus = relevantSkus.filter(s => s.is_beer_tank);
  }

  const notes = document.getElementById('entry-notes')?.value || '';
  const transferTargetId = document.getElementById('transfer-target')?.value || null;

  if (fState.entryType === 'transfer_out' && !transferTargetId) {
    alert('Selecteer een doelbar voor de transfer.');
    return;
  }

  const entries = [];
  const transferInEntries = [];
  let hasAnyValue = false;

  relevantSkus.forEach(sku => {
    const rawVal = parseFloat(document.getElementById(`qty-${sku.id}`)?.value) || 0;
    if (rawVal === 0) return;
    hasAnyValue = true;

    const entry = {
      event_id: Auth.getEventId(),
      bar_id: fState.selectedBar.id,
      sku_id: sku.id,
      entry_type: fState.entryType,
      quantity: fState.entryType === 'beer_tank_level' ? 0 : rawVal,
      beer_tank_liters: fState.entryType === 'beer_tank_level' ? rawVal : null,
      transfer_to_bar_id: fState.entryType === 'transfer_out' ? transferTargetId : null,
      notes,
    };
    entries.push(entry);

    if (fState.entryType === 'transfer_out') {
      transferInEntries.push({
        event_id: Auth.getEventId(),
        bar_id: transferTargetId,
        sku_id: sku.id,
        entry_type: 'transfer_in',
        quantity: rawVal,
        notes: `Van ${fState.selectedBar.name}`,
      });
    }
  });

  if (!hasAnyValue) { alert('Voer minimaal één waarde in.'); return; }

  const btn = document.getElementById('submit-btn');
  btn.textContent = 'Opslaan...';
  btn.disabled = true;

  const allEntries = [...entries, ...transferInEntries];
  const { error } = await sb.from('stock_entries').insert(allEntries);

  btn.textContent = 'Opslaan';
  btn.disabled = false;

  if (error) { alert('Fout bij opslaan: ' + error.message); return; }

  showToast('✓ Opgeslagen!');
  setTimeout(() => {
    showStep('step-type');
    fState.entryType = null;
  }, 1200);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden', 'opacity-0');
  toast.classList.add('opacity-100');
  setTimeout(() => {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 1500);
}
