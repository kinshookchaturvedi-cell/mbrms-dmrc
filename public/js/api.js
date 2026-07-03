// api.js — shared helpers used across all pages

const API_BASE = '/api';

async function apiGet(endpoint) {
  const res = await fetch(API_BASE + endpoint);
  if (!res.ok) throw await res.json().catch(() => ({ error: 'Request failed' }));
  return res.json();
}

async function apiPost(endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: 'Request failed' }));
  return res.json();
}

async function apiPut(endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: 'Request failed' }));
  return res.json();
}

async function apiUpload(formData) {
  const res = await fetch(API_BASE + '/upload', { method: 'POST', body: formData });
  if (!res.ok) throw await res.json().catch(() => ({ error: 'Upload failed' }));
  return res.json();
}

// ---- Session (sessionStorage so each browser tab is a fresh login) ----
function setSession(role, user) {
  sessionStorage.setItem('dmrc_role', role);
  sessionStorage.setItem('dmrc_user', JSON.stringify(user));
}
function getSession() {
  const role = sessionStorage.getItem('dmrc_role');
  const user = sessionStorage.getItem('dmrc_user');
  return role && user ? { role, user: JSON.parse(user) } : null;
}
function clearSession() {
  sessionStorage.removeItem('dmrc_role');
  sessionStorage.removeItem('dmrc_user');
}
function requireRole(role) {
  const session = getSession();
  if (!session || session.role !== role) {
    window.location.href = role === 'hr' ? 'hr-login.html' : 'employee-login.html';
    return null;
  }
  return session;
}

// ---- Toast ----
function showToast(message, type = '') {
  let el = document.getElementById('global-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function fmtCurrency(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '--';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusClass(status) {
  return 'status-' + String(status).replace(/\s+/g, '-');
}
