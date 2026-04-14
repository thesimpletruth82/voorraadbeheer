// ── Admin sidebar renderer ──────────────────────────────────
// Call renderAdminNav(activePage, profile) from each admin page
// activePage: 'events'|'locations'|'skus'|'opening'|'overview'|'closing'|'variance'|'users'

function renderAdminNav(activePage, profile) {
  const eventId   = Auth.getEventId();
  const eventName = Auth.getEventName() || '—';
  const eventSt   = Auth.getEventStatus() || '';

  const links = [
    { section: 'Opzet', items: [
      { id: 'events',    label: 'Evenementen',   href: '/admin',            icon: 'calendar' },
      { id: 'locations', label: 'Locaties',       href: '/admin/locations',  icon: 'map-pin',  needsEvent: true },
      { id: 'skus',      label: 'Producten',      href: '/admin/skus',       icon: 'package' },
    ]},
    { section: 'Dag', items: [
      { id: 'opening',  label: 'Begintelling',   href: '/admin/opening',   icon: 'clipboard-list', needsEvent: true },
      { id: 'overview', label: 'Live Overzicht',  href: '/admin/overview',  icon: 'activity',       needsEvent: true },
      { id: 'closing',  label: 'Eindtelling',    href: '/admin/closing',   icon: 'flag',           needsEvent: true },
      { id: 'variance', label: 'Variantierapport',href: '/admin/variance',  icon: 'bar-chart-2',   needsEvent: true },
    ]},
    { section: 'Beheer', items: [
      { id: 'users', label: 'Gebruikers', href: '/admin/users', icon: 'users' },
    ]},
  ];

  const badgeHtml = eventSt
    ? `<span class="sidebar-event-status status-${eventSt}">${eventSt}</span>`
    : '';

  let sectionsHtml = '';
  for (const sec of links) {
    const items = sec.items.map(item => {
      const disabled = item.needsEvent && !eventId;
      const cls = [
        'nav-link',
        item.id === activePage ? 'active' : '',
        disabled ? 'disabled' : '',
      ].filter(Boolean).join(' ');
      const href = disabled ? '#' : item.href;
      return `<a href="${href}" class="${cls}" ${disabled ? 'onclick="return false" title="Selecteer eerst een evenement"' : ''}>
        <i data-lucide="${item.icon}"></i> ${item.label}
      </a>`;
    }).join('');
    sectionsHtml += `<div class="nav-section">
      <div class="nav-section-label">${sec.section}</div>
      ${items}
    </div>`;
  }

  const sidebar = document.getElementById('admin-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">
        <i data-lucide="beer" style="color:white;width:18px;height:18px"></i>
      </div>
      <span class="sidebar-logo-name">StockFest</span>
    </div>

    ${eventId ? `
    <div class="sidebar-event">
      <div class="sidebar-event-label">Evenement</div>
      <div class="sidebar-event-name" title="${eventName}">${eventName}</div>
      ${badgeHtml}
    </div>` : `
    <div class="sidebar-event">
      <div class="sidebar-event-label">Evenement</div>
      <div style="font-size:12px;color:var(--text4);margin-top:2px">Geen geselecteerd</div>
      <a href="/admin" style="font-size:11px;color:var(--accent)">→ Selecteer</a>
    </div>`}

    <nav class="sidebar-nav">${sectionsHtml}</nav>

    <div class="sidebar-footer">
      <div class="sidebar-user">${profile?.name || profile?.email || '—'}</div>
      <button class="btn-logout" onclick="Auth.signOut()">
        <i data-lucide="log-out"></i> Uitloggen
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}
