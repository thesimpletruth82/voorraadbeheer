// ── Supabase Client ─────────────────────────────────────
const SUPABASE_URL  = 'https://ljsaptrpsyvgcerpzagg.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxqc2FwdHJwc3l2Z2NlcnB6YWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjA0NzYsImV4cCI6MjA5MTYzNjQ3Nn0.fpiRAFbdkWd8frjtrPmPI3pzYQo8RGrCsHrJlIwpO-w';

let _sb = null;
function sb() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sb;
}

// ── Active Event Context ────────────────────────────────
const Ctx = {
  set(id, name, status) {
    localStorage.setItem('sf_eid', id);
    localStorage.setItem('sf_ename', name);
    localStorage.setItem('sf_estatus', status);
  },
  id()     { return localStorage.getItem('sf_eid'); },
  name()   { return localStorage.getItem('sf_ename'); },
  status() { return localStorage.getItem('sf_estatus'); },
  clear()  {
    localStorage.removeItem('sf_eid');
    localStorage.removeItem('sf_ename');
    localStorage.removeItem('sf_estatus');
  }
};

// ── Toast ────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = type === 'ok' ? 'toast-ok' : 'toast-err';
  el.style.display = 'block';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.style.display = 'none', 300);
  }, 2500);
}

// ── Escape HTML ──────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Sidebar + Bottombar renderer ─────────────────────────
function renderNav(activePage) {
  const pages = [
    { id: 'events',    label: 'Events',    icon: 'calendar',        href: '/' },
    { id: 'locations', label: 'Locations',  icon: 'map-pin',         href: '/pages/setup-locations.html', section: 'Setup' },
    { id: 'skus',      label: 'Products',   icon: 'package',         href: '/pages/setup-skus.html' },
    { id: 'opening',   label: 'Opening Count', icon: 'clipboard-list', href: '/pages/opening.html', section: 'Counts' },
    { id: 'closing',   label: 'Closing Count', icon: 'clipboard-check', href: '/pages/closing.html' },
    { id: 'overview',  label: 'Live Overview', icon: 'activity',     href: '/pages/overview.html', section: 'Operations' },
    { id: 'sales',     label: 'Sales',         icon: 'shopping-cart', href: '/pages/sales.html' },
    { id: 'movement',  label: 'Log Movement',  icon: 'truck',        href: '/pages/movement.html' },
    { id: 'variance',  label: 'Variance Report', icon: 'bar-chart-2', href: '/pages/variance.html', section: 'Reports' },
  ];

  // Sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    let html = `
      <div class="sidebar-brand">
        <div class="sidebar-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>
        <span class="sidebar-title">StockFest</span>
      </div>`;

    if (Ctx.id()) {
      html += `
      <div class="sidebar-event">
        <div class="sidebar-event-label">Active Event</div>
        <div class="sidebar-event-name">${esc(Ctx.name())}</div>
      </div>`;
    }

    html += '<div class="sidebar-nav">';
    let currentSection = '';
    for (const p of pages) {
      if (p.section && p.section !== currentSection) {
        currentSection = p.section;
        html += `<div class="nav-section"><div class="nav-section-label">${p.section}</div></div>`;
      }
      const active = activePage === p.id ? ' active' : '';
      html += `<a class="nav-link${active}" href="${p.href}"><i data-lucide="${p.icon}"></i>${p.label}</a>`;
    }
    html += '</div>';
    sidebar.innerHTML = html;
  }

  // Bottom bar (mobile) — show key pages
  const bottomPages = [
    { id: 'overview', label: 'Overview',  icon: 'activity',        href: '/pages/overview.html' },
    { id: 'sales',    label: 'Sales',     icon: 'shopping-cart',   href: '/pages/sales.html' },
    { id: 'movement', label: 'Movement',  icon: 'truck',           href: '/pages/movement.html' },
    { id: 'events',   label: 'Events',    icon: 'calendar',        href: '/' },
  ];

  const bottombar = document.getElementById('bottombar');
  if (bottombar) {
    bottombar.innerHTML = bottomPages.map(p => {
      const active = activePage === p.id ? ' active' : '';
      return `<a class="${active}" href="${p.href}"><i data-lucide="${p.icon}"></i>${p.label}</a>`;
    }).join('');
  }

  // Init Lucide icons
  if (window.lucide) lucide.createIcons();
}
