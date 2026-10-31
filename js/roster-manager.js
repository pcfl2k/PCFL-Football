/* PCFL Network: live roster management on a coach's own team page, and the commissioner's league
   page. Loaded only for signed-in coaches; anyone else keeps the read-only roster. If this module
   or its service is unavailable, the read-only roster stays on the page.
   The browser checks every change for instant feedback, with the same rules the service runs
   again before it saves anything (js/roster-rules.js). */
import { GROUPS, SECTIONS, SECTION_ORDER, TOTAL_SLOTS, assignedGroup, sectionOf, slotLabel, slotAccepts, slotsOfGroup, firstFree, placementFor, availableNumbers, pickNumber, validateRoster, nameProblem, groupOf } from './roster-rules.js?v=__BUILD__';

const HOSTED_API = 'https://pcfl-rosters.153.75.235.217.sslip.io/api/rosters/v1';
const TOKEN_KEY = 'pcfl-rc-token';   // the Recruitment Center's sign-in: one login for everything
const api = () => window.PCFL_ROSTERS?.apiBase || HOSTED_API;
const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ATTRS = ['SP', 'AC', 'AG', 'ST', 'HA', 'EN', 'IN', 'DI'];
const when = iso => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet');
const avg = a => (a?.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const SIGNED_OUT = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'ACCOUNT_LOCKED', 'TOKEN_INVALID']);

async function request(path, { method = 'GET', body, blob = false } = {}) {
  const res = await fetch(`${api()}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token()}` }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const fresh = res.headers.get('x-pcfl-token');
  if (fresh) { try { localStorage.setItem(TOKEN_KEY, fresh); } catch {} }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(j.error?.message || `Request failed (${res.status})`); e.code = j.error?.code; e.status = res.status; e.errors = j.error?.errors; e.differences = j.error?.differences; e.count = j.error?.count; throw e;
  }
  if (blob) return { blob: await res.blob(), name: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'download' };
  return res.json();
}
async function download(path) {
  const { blob, name } = await request(path, { blob: true });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
}
function toast(title, msg = '', kind = 'ok') {
  let h = document.querySelector('.fm-toasts'); if (!h) { h = document.createElement('div'); h.className = 'fm-toasts'; document.body.appendChild(h); }
  const el = document.createElement('div'); el.className = `fm-toast ${kind}`; el.innerHTML = `<b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}`; h.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 4000);
}
/** In-page dialog. buttons: [{ label, value, cls }]; resolves with the chosen value. */
function dialog(title, message, buttons) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'rc-overlay';
    ov.innerHTML = `<div class="rc-modal sm" role="alertdialog" aria-modal="true"><div class="rc-mhead"><div><h3>${esc(title)}</h3></div></div><div class="rc-mbody"><p>${esc(message)}</p><div class="rc-mactions">${buttons.map((b, i) => `<button class="rc-btn ${b.cls || 'ghost'}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
    const done = v => { ov.remove(); resolve(v); };
    ov.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-i]'); if (b) done(buttons[+b.dataset.i].value); else if (e.target === ov) done(buttons[0].value); });
    document.body.appendChild(ov); ov.querySelector('[data-i]:last-child').focus();
  });
}

/* -------------------------------------------------------------- editor state */
const S = { slug: null, hash: '', view: null, layout: [], released: new Map(), selected: null, saving: false, serverErrors: [], root: null, me: null };
const clonePlayer = p => (p ? { ...p } : null);
const before = () => new Map(S.view.slots.filter(Boolean).map(p => [p.id, p]));
const check = () => validateRoster(S.layout, { strict: S.view.rules.strict, before: before() });
const canEdit = () => S.view?.editable && !(S.view.settings.locked && !S.me?.admin);

function changes() {
  const was = before(), out = { moved: 0, names: 0, numbers: 0, positions: 0, arrivals: 0, releases: S.released.size };
  S.layout.forEach((p, k) => {
    if (!p) return;
    if (p.incoming) { out.arrivals++; return; }
    const o = was.get(p.id); if (!o) return;
    if (S.view.slots[k]?.id !== p.id) out.moved++;
    if (o.first !== p.first || o.last !== p.last) out.names++;
    if (o.jersey !== p.jersey) out.numbers++;
    if (o.pos !== p.pos) out.positions++;
  });
  out.total = out.moved + out.names + out.numbers + out.positions + out.arrivals + out.releases;
  return out;
}
const isDirty = () => !!S.view && changes().total > 0;
function load(view) {
  S.view = view; S.layout = view.slots.map(clonePlayer); S.released = new Map(); S.serverErrors = [];
  if (S.selected != null && !S.layout[S.selected]) S.selected = null;
}

/** A waiting signing takes any spot that opens up. */
function seatWaiting() {
  const seated = new Set(S.layout.filter(p => p?.incoming).map(p => p.id));
  for (const p of S.view.pending) {
    if (seated.has(p.id)) continue;
    const k = placementFor(S.layout, p.pos);
    if (k < 0) break;
    S.layout[k] = { ...p, jersey: pickNumber(S.layout, p.pos) };
  }
}
function moveTo(from, to) {
  const p = S.layout[from], q = S.layout[to];
  if (!p || from === to) return;
  if (!slotAccepts(to, p.pos)) return toast('Not a legal move', `${p.pos} ${p.last} cannot play the ${slotLabel(to)} slot.`, 'err');
  const list = k => (assignedGroup(k) ? slotsOfGroup(assignedGroup(k)) : (s => Array.from({ length: s.count }, (_, i) => s.first + i))(SECTIONS[sectionOf(k)]));
  if (list(from).includes(to)) {
    // reorder inside a group: everyone between shifts one place, like moving a player on the depth chart
    const l = list(from), a = l.indexOf(from), b = l.indexOf(to), row = l.map(k => S.layout[k]);
    row.splice(b, 0, row.splice(a, 1)[0]);
    l.forEach((k, i) => { S.layout[k] = row[i]; });
  } else {
    if (q && !slotAccepts(from, q.pos)) return toast('Not a legal move', `${q.pos} ${q.last} cannot go to the ${slotLabel(from)} slot, so the two cannot swap. Move that player to Out first.`, 'err');
    S.layout[to] = p; S.layout[from] = q || null;
  }
  S.selected = S.layout.indexOf(p);
  render();
}
function setStatus(slot, section) {
  const p = S.layout[slot];
  if (!p || section === sectionOf(slot)) return;
  const k = firstFree(S.layout, section, p.pos);
  if (k < 0) {
    const s = SECTIONS[section], g = groupOf(p.pos);
    render();
    return toast(`${s.label} is full`, section === 'A' ? `All ${g.count} ${g.label} slots are taken. Drag this player onto the one to replace.` : `${s.label} is at its limit of ${s.count}. Move someone out first.`, 'err');
  }
  S.layout[k] = p; S.layout[slot] = null; S.selected = k;
  render();
}
async function release(slot) {
  const p = S.layout[slot];
  if (!p) return;
  if (p.incoming) { render(); return toast('Not on the roster yet', `${p.name || p.last} has to reach the roster on Update before being released.`, 'err'); }
  const yes = await dialog('Release this player?', `Release ${p.pos} ${p.first} ${p.last} (#${p.jersey}) from ${S.view.team.name}? When you press Update this player goes to the Transfer Portal, a post goes up in the forum, and other teams can sign this player. This cannot be undone.`, [{ label: 'Keep player', value: false }, { label: 'Release player', value: true, cls: 'primary' }]);
  if (!yes) return render();
  S.released.set(p.id, p); S.layout[slot] = null; S.selected = null;
  seatWaiting();
  render();
}
function undoRelease(id) {
  const p = S.released.get(id); if (!p) return;
  S.released.delete(id);
  let k = placementFor(S.layout, p.pos);
  if (k < 0) {
    for (let i = TOTAL_SLOTS - 1; i >= 0 && k < 0; i--) if (S.layout[i]?.incoming) { S.layout[i] = null; k = placementFor(S.layout, p.pos); }
  }
  if (k < 0) { S.released.set(id, p); return toast('No room to bring this player back', 'Move someone out first.', 'err'); }
  S.layout[k] = p; S.selected = k;
  render();
}
function payload() {
  const was = before(), b = { rev: S.view.rev, editRev: S.view.editRev, slots: S.layout.map(p => p?.id || 0), releases: [...S.released.keys()], names: {}, numbers: {}, positions: {} };
  for (const p of S.layout) {
    if (!p) continue;
    const o = was.get(p.id); if (!o) continue;
    if (o.first !== p.first || o.last !== p.last) b.names[p.id] = { first: p.first, last: p.last };
    if (o.jersey !== p.jersey) b.numbers[p.id] = p.jersey;
    if (o.pos !== p.pos) b.positions[p.id] = p.pos;
  }
  return b;
}
/** Update: true when the changes were saved. */
async function save() {
  if (S.saving) return false;
  const v = check();
  if (!v.legal) { render(); toast('This roster is not legal yet', v.errors[0].message, 'err'); return false; }
  S.saving = true; render();
  try {
    const r = await request(`/teams/${S.slug}/roster`, { method: 'POST', body: payload() });
    S.saving = false; load(r); render();
    const p = r.processed;
    if (p) toast('Roster updated', [p.moved && `${p.moved} moved`, p.names && `${p.names} renamed`, p.numbers && `${p.numbers} renumbered`, p.releases.length && `${p.releases.length} released`, p.arrivals.length && `${p.arrivals.length} joined`].filter(Boolean).join(', ') + '. League files are up to date.');
    return true;
  } catch (e) {
    S.saving = false;
    if (e.code === 'ROSTER_CHANGED') { toast('Your roster changed', e.message, 'err'); await refresh(); return false; }
    S.serverErrors = e.errors?.length ? e.errors : [{ message: e.message }];
    render(); toast('Not saved', e.message, 'err');
    return false;
  }
}
async function refresh() { load(await request(`/teams/${S.slug}/roster`)); render(); }

/* ----------------------------------------------------------- leaving the page */
/** app.js asks this before any navigation. False means stay. */
async function leaveGuard() {
  if (!isDirty() || !document.getElementById('roster-manager')) return true;
  const target = location.hash;
  if (target !== S.hash) history.replaceState(null, '', S.hash || '#/');
  const c = changes(), legal = check().legal;
  const choice = await dialog('You have unsaved changes', `You have ${c.total} roster ${c.total === 1 ? 'change' : 'changes'} that will not take effect until you press Update. Press Update to save them, or cancel them to leave this page.`,
    [{ label: 'Keep editing', value: 'stay' }, { label: 'Cancel changes', value: 'discard' }, ...(legal ? [{ label: 'Update', value: 'update', cls: 'primary' }] : [])]);
  if (choice === 'stay') return false;
  if (choice === 'update' && !(await save())) return false;
  if (choice === 'discard') load(S.view);
  if (target !== S.hash) location.hash = target; else return true;
  return false;
}
window.PCFLRosterGuard = leaveGuard;
window.PCFLRosterDirty = isDirty;
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

/* --------------------------------------------------------------- rendering */
function rowHTML(k, p, editable) {
  const label = slotLabel(k), sel = S.selected === k && p;
  if (!p) return `<div class="rm-row empty" data-slot="${k}"><span class="rm-grip"></span><span class="rm-slot">${label}</span><span class="rm-empty">Empty</span></div>`;
  const moved = S.view.slots[k]?.id !== p.id;
  return `<div class="rm-row${sel ? ' on' : ''}${moved ? ' moved' : ''}${p.incoming ? ' new' : ''}" data-slot="${k}" tabindex="0">
    <span class="rm-grip" ${editable ? 'data-grip title="Drag to move"' : ''}>${editable ? '⠿' : ''}</span>
    <span class="rm-slot">${label}</span><span class="rm-num">${p.jersey || ''}</span>
    <span class="rm-name"><b>${esc(`${p.first} ${p.last}`)}</b>${p.incoming ? '<em>New signing</em>' : ''}</span>
    <span class="rm-pos">${esc(p.pos)}</span><span class="rm-yr">${esc(p.yr ?? '')}</span><span class="rm-ovr">${Math.round(p.ovr ?? avg(p.act))}</span>
    ${editable ? `<select class="rm-status" data-status="${k}" aria-label="Status for ${esc(p.last)}">${SECTION_ORDER.map(s => `<option value="${s}"${sectionOf(k) === s ? ' selected' : ''}>${SECTIONS[s].label}</option>`).join('')}<option value="release">Release / cut</option></select>` : `<span class="rm-sec">${SECTIONS[sectionOf(k)].label}</span>`}
  </div>`;
}
function boardHTML(editable) {
  const groups = GROUPS.map(g => `<div class="rm-group"><h4>${g.label}<span>${g.positions.join(' / ')}</span></h4>${slotsOfGroup(g).map(k => rowHTML(k, S.layout[k], editable)).join('')}</div>`).join('');
  const sec = key => { const s = SECTIONS[key], rows = []; for (let k = s.first; k <= s.last; k++) rows.push(rowHTML(k, S.layout[k], editable)); return rows.join(''); };
  const count = v => key => `<b>${v.counts[key]}</b> / ${SECTIONS[key].count}`;
  const c = count(check());
  return `<section class="rm-sect"><header><h3>Active</h3><span>${c('A')}</span></header>${groups}</section>
    <section class="rm-sect"><header><h3>Out</h3><span>${c('O')}</span></header><p class="rm-note">These are the game's Open slots. Any position, and they still dress on game day.</p>${sec('O')}</section>
    <section class="rm-sect"><header><h3>Inactive</h3><span>${c('I')}</span></header>${sec('I')}</section>
    <section class="rm-sect"><header><h3>IR / Practice Squad</h3><span>${c('IR')}</span></header>${sec('IR')}</section>`;
}
function cardHTML(editable) {
  const k = S.selected, p = k == null ? null : S.layout[k];
  if (!p) return `<div class="rm-card-empty"><b>Select a player</b><span>Pick a row to edit the name, number and status. Drag the handle to change the depth chart.</span></div>`;
  const nums = [...new Set([p.jersey, ...availableNumbers(S.layout, p.pos, p.id)])].filter(Boolean).sort((a, b) => a - b);
  const lock = !editable || p.incoming ? 'disabled' : '', nameLock = !editable || !S.view.settings.namesOpen || p.incoming ? 'disabled' : '';
  const g = groupOf(p.pos);
  const list = assignedGroup(k) ? slotsOfGroup(assignedGroup(k)) : null, at = list ? list.indexOf(k) : -1;
  return `<div class="rm-card-head"><span class="rm-card-num">#${p.jersey || '–'}</span><div><b>${esc(p.first)} ${esc(p.last)}</b><span>${esc(p.pos)} · ${slotLabel(k)}${p.ht ? ` · ${esc(p.ht)} ${p.weight}` : ''}</span></div></div>
    <div class="rm-fields">
      <label>First name<input data-field="first" maxlength="12" value="${esc(p.first)}" ${nameLock}></label>
      <label>Last name<input data-field="last" maxlength="12" value="${esc(p.last)}" ${nameLock}></label>
      ${editable && !S.view.settings.recruitingDone ? '<p class="rm-hint">Names can be changed once the whole recruiting period has finished.</p>' : ''}
      <label>Number<select data-field="jersey" ${lock}>${nums.map(n => `<option${n === p.jersey ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Status<select data-status="${k}" ${editable ? '' : 'disabled'}>${SECTION_ORDER.map(s => `<option value="${s}"${sectionOf(k) === s ? ' selected' : ''}>${SECTIONS[s].label}</option>`).join('')}<option value="release">Release / cut</option></select></label>
      ${S.view.settings.allowPositions && g?.positions.length > 1 && editable && !p.incoming ? `<label>Position<select data-field="pos">${g.positions.map(x => `<option${x === p.pos ? ' selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="rm-attrs" title="Attributes cannot be edited">${ATTRS.map((a, i) => `<span><i>${a}</i><b>${p.act?.[i] ?? '–'}</b><small>${p.pot?.[i] ?? ''}</small></span>`).join('')}</div>
    ${editable ? `<div class="rm-card-actions">
      ${list ? `<button class="rc-btn sm ghost" data-rm="up" ${at <= 0 ? 'disabled' : ''}>▲ Move up</button><button class="rc-btn sm ghost" data-rm="down" ${at >= list.length - 1 ? 'disabled' : ''}>▼ Move down</button>` : ''}
      <button class="rc-btn sm rm-cut" data-rm="release" ${p.incoming ? 'disabled' : ''}>Release player</button></div>` : ''}`;
}
function render() {
  const root = S.root; if (!root) return;
  const v = check(), c = changes(), editable = canEdit();
  const errors = [...v.errors, ...S.serverErrors.filter(e => !v.errors.some(x => x.message === e.message))];
  const waiting = S.view.pending.filter(p => !S.layout.some(x => x?.id === p.id));
  const released = [...S.released.values()];
  const chip = (key, label) => `<span class="rm-chip${v.counts[key] > SECTIONS[key].count ? ' bad' : ''}"><b>${v.counts[key]}/${SECTIONS[key].count}</b>${label}</span>`;
  const top = root.scrollTop, sect = root.querySelector('.rm-board')?.scrollTop;
  root.innerHTML = `
    <div class="rm-bar">
      <span class="rm-badge"><i></i>${editable ? 'Roster management enabled' : S.view.settings.locked ? 'Roster moves locked by the commissioner' : 'View only'}</span>
      <div class="rm-stamps"><span>Last roster update <b>${esc(when(S.view.rosterUpdatedAt))}</b></span><span>League files <b>${esc(when(S.view.league.updatedAt))}</b></span></div>
      <div class="rm-actions">
        <button class="rc-btn sm" data-rm="download">Download league files</button>
        ${S.view.rmu ? `<button class="rc-btn sm ghost" data-rm="rmu">RMUpdate file</button>` : ''}
        ${S.me?.admin ? `<a class="rc-btn sm ghost" href="#/league">Commissioner</a>` : ''}
        <button class="rc-btn sm ghost" data-rm="public">Public view</button>
      </div>
    </div>
    <div class="rm-counts">${chip('A', 'Active')}${chip('O', 'Out')}${chip('I', 'Inactive')}${chip('IR', 'IR / Practice Squad')}<span class="rm-chip total"><b>${v.counts.total}/${TOTAL_SLOTS}</b>Total</span><span class="rm-legal ${v.legal ? 'ok' : 'bad'}">${v.legal ? (v.gameReady ? 'Legal and game ready' : 'Legal so far') : 'Not legal yet'}</span></div>
    ${waiting.length ? `<div class="rm-msg warn"><b>${waiting.length} signed ${waiting.length === 1 ? 'player is' : 'players are'} waiting for a roster spot.</b> Your roster is full, so release a player to make room. Until then you cannot bid on anyone else. <span>${waiting.map(p => `${esc(p.pos)} ${esc(p.name)}`).join(', ')}</span></div>` : ''}
    ${errors.length ? `<div class="rm-msg bad"><b>Fix before you can press Update:</b><ul>${errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    ${v.warnings.length ? `<div class="rm-msg note"><ul>${v.warnings.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    ${released.length ? `<div class="rm-msg rel"><b>Released on Update:</b> ${released.map(p => `<span>${esc(p.pos)} ${esc(p.first)} ${esc(p.last)} <button class="fm-link" data-unrelease="${p.id}">Undo</button></span>`).join(' ')}</div>` : ''}
    <div class="rm-grid"><div class="rm-board">${boardHTML(editable)}</div><aside class="rm-card card">${cardHTML(editable)}</aside></div>
    ${editable ? `<div class="rm-foot${c.total ? ' dirty' : ''}"><span>${c.total ? `${c.total} unsaved ${c.total === 1 ? 'change' : 'changes'}. Nothing takes effect until you press Update.` : 'No unsaved changes'}</span>
      <button class="rc-btn ghost" data-rm="cancel" ${c.total ? '' : 'disabled'}>Cancel changes</button>
      <button class="rc-btn primary" data-rm="update" ${c.total && v.legal && !S.saving ? '' : 'disabled'}>${S.saving ? 'Updating…' : 'Update'}</button></div>` : ''}`;
  root.scrollTop = top; if (sect) root.querySelector('.rm-board').scrollTop = sect;
}

/* --------------------------------------------------------------- interaction */
function select(slot) { S.selected = slot; render(); }
function wire(root) {
  root.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-rm]');
    if (b) {
      const a = b.dataset.rm, k = S.selected, l = k != null && assignedGroup(k) ? slotsOfGroup(assignedGroup(k)) : null;
      try {
        if (a === 'update') await save();
        else if (a === 'cancel') { load(S.view); render(); }
        else if (a === 'download') await download('/league/download');
        else if (a === 'rmu') await download(`/teams/${S.slug}/rmupdate`);
        else if (a === 'release') await release(k);
        else if (a === 'up' && l) moveTo(k, l[l.indexOf(k) - 1]);
        else if (a === 'down' && l) moveTo(k, l[l.indexOf(k) + 1]);
        else if (a === 'public') { const on = document.body.classList.toggle('rm-public'); b.textContent = on ? 'Manage roster' : 'Public view'; }
      } catch (e) { toast('That did not work', e.message, 'err'); }
      return;
    }
    const u = ev.target.closest('[data-unrelease]');
    if (u) return undoRelease(+u.dataset.unrelease);
    if (ev.target.closest('select,input,button')) return;
    const row = ev.target.closest('.rm-row');
    if (row && !row.classList.contains('empty')) select(+row.dataset.slot);
  });
  root.addEventListener('change', ev => {
    const s = ev.target.closest('[data-status]');
    if (s) { const k = +s.dataset.status; if (s.value === 'release') release(k); else setStatus(k, s.value); return; }
    const f = ev.target.closest('[data-field]'), p = S.layout[S.selected];
    if (!f || !p) return;
    if (f.dataset.field === 'jersey') p.jersey = +f.value;
    else if (f.dataset.field === 'pos') p.pos = f.value;
    else p[f.dataset.field] = f.value.trim();
    render();
  });
  root.addEventListener('input', ev => {
    const f = ev.target.closest('input[data-field]'), p = S.layout[S.selected];
    if (!f || !p) return;
    p[f.dataset.field] = f.value;
    f.setCustomValidity(nameProblem(f.value, 'Name') || '');
  });
  root.addEventListener('keydown', ev => {
    const row = ev.target.closest?.('.rm-row'); if (!row || ev.target !== row) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(+row.dataset.slot); }
  });
  // drag and drop by pointer, so it works with a mouse, a pen or a finger
  let drag = null;
  root.addEventListener('pointerdown', ev => {
    const grip = ev.target.closest('[data-grip]'); if (!grip) return;
    const row = grip.closest('.rm-row'), from = +row.dataset.slot, p = S.layout[from];
    if (!p) return;
    ev.preventDefault();
    const ghost = document.createElement('div'); ghost.className = 'rm-ghost'; ghost.textContent = `${p.pos} ${p.first} ${p.last}`;
    document.body.appendChild(ghost);
    drag = { from, p, ghost, over: null };
    row.classList.add('dragging'); document.body.classList.add('rm-dragging');
    place(ev);
    grip.setPointerCapture?.(ev.pointerId);
  });
  const place = ev => { drag.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`; };
  root.addEventListener('pointermove', ev => {
    if (!drag) return;
    place(ev);
    if (ev.clientY < 70) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 90) window.scrollBy(0, 14);
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.rm-row');
    if (drag.over && drag.over !== el) drag.over.classList.remove('rm-over', 'rm-no');
    if (el) el.classList.add(slotAccepts(+el.dataset.slot, drag.p.pos) ? 'rm-over' : 'rm-no');
    drag.over = el || null;
  });
  const end = ev => {
    if (!drag) return;
    const { from, over, ghost } = drag; drag = null;
    ghost.remove(); document.body.classList.remove('rm-dragging');
    root.querySelector('.dragging')?.classList.remove('dragging');
    if (over && ev.type === 'pointerup') moveTo(from, +over.dataset.slot); else over?.classList.remove('rm-over', 'rm-no');
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ mounting */
function leagueStrip(meta) {
  const el = document.createElement('div'); el.className = 'rm-strip card';
  el.innerHTML = `<span>League files updated <b>${esc(when(meta.updatedAt))}</b></span><button class="rc-btn sm" data-rm="download">Download league files</button>`;
  el.addEventListener('click', e => { if (e.target.closest('[data-rm]')) download('/league/download').catch(x => toast('That did not work', x.message, 'err')); });
  return el;
}
/** Called by app.js after a team page renders. Anything that fails leaves the read-only roster. */
export async function mount({ slug, main }) {
  S.root = null; S.view = null; document.body.classList.remove('rm-public');
  if (!token()) return;
  const section = main.querySelector('.rs') || main.querySelector('.view');
  try {
    S.me = await request('/me');
    const view = await request(`/teams/${slug}/roster`);
    if (location.hash.split('?')[0].split('/')[2] !== slug) return;   // the coach has moved on
    if (!view.editable) { section.parentNode.insertBefore(leagueStrip(view.league), section); return; }
    S.slug = slug; S.hash = location.hash; S.selected = null; load(view);
    const root = document.createElement('section'); root.id = 'roster-manager'; root.className = 'rm';
    section.parentNode.insertBefore(root, section);
    document.body.classList.add('rm-active');
    S.root = root; wire(root); render();
    const jump = document.createElement('button'); jump.className = 'rm-jump'; jump.type = 'button'; jump.innerHTML = '<i></i>Manage your roster';
    jump.addEventListener('click', () => window.scrollTo({ top: root.getBoundingClientRect().top + scrollY - 84, behavior: 'smooth' }));
    main.querySelector('.view')?.prepend(jump);
  } catch (e) { if (!SIGNED_OUT.has(e.code)) console.warn('roster management unavailable', e.message); }
}
export const unmount = () => { document.body.classList.remove('rm-active', 'rm-public'); };

/* ------------------------------------------------------- commissioner's page */
const yes = v => (v ? 'On' : 'Off');
function teamRow(t) {
  const state = !t.legal ? ['bad', 'Needs fixing'] : t.gameReady ? ['ok', 'Game ready'] : ['warn', 'Short of players'];
  const notes = [...t.errors, ...t.warnings].map(x => x.message).slice(0, 3).join(' ');
  return `<tr><td><a href="#/teams/${t.slug}">${esc(t.name)}</a></td><td class="rm-c">${t.counts.A}/34</td><td class="rm-c">${t.counts.O}/12</td><td class="rm-c">${t.counts.I}/7</td><td class="rm-c">${t.counts.IR}/10</td><td class="rm-c"><b>${t.counts.total}</b></td><td class="rm-c">${t.waiting || ''}</td><td><span class="rm-pill ${state[0]}">${state[1]}</span></td><td class="rm-small" title="${esc(notes)}">${esc(t.rosterUpdatedAt ? when(t.rosterUpdatedAt) : '')}</td></tr>`;
}
function eventText(e) {
  if (e.type === 'update') {
    const bits = [e.moved && `${e.moved} moved`, e.names && `${e.names} renamed`, e.numbers && `${e.numbers} renumbered`, e.positions && `${e.positions} position changes`, e.releases?.length && `released ${e.releases.join(', ')}`, e.arrivals?.length && `added ${e.arrivals.join(', ')}`].filter(Boolean);
    return `<b>${esc(e.team)}</b> roster update: ${esc(bits.join(', '))} <button class="fm-link" data-view="${esc(e.file)}">View file</button>`;
  }
  if (e.type === 'signings') return `Signings reconciled: ${e.placed} placed${e.waiting ? `, ${e.waiting} waiting for a spot` : ''}`;
  if (e.type === 'league-upload') return `League files uploaded by ${esc(e.by)}`;
  if (e.type === 'undo') return `Update undone for <b>${esc(e.team)}</b>`;
  if (e.type === 'settings') return `Settings changed by ${esc(e.by)}`;
  return esc(e.type);
}
export async function mountAdmin(el) {
  if (!token()) { el.innerHTML = `<div class="card fm-empty"><b>Commissioner only</b><p>Sign in on the Recruiting page first.</p></div>`; return; }
  const draw = async () => {
    const o = await request('/admin/overview');
    const toggle = (key, label, hint) => `<label class="rm-toggle"><input type="checkbox" data-set="${key}" ${o.settings[key] ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`;
    el.innerHTML = `<section class="rm rm-admin">
      <div class="section-h"><span class="bar"></span><h2>League Files</h2><span class="sub">Rosters, RMUpdate and downloads</span></div>
      <div class="rm-bar"><div class="rm-stamps"><span>League files <b>${esc(when(o.league.updatedAt))}</b></span><span>${o.league.players} players on file</span><span>Last signing check <b>${esc(when(o.lastSync))}</b></span></div>
        <div class="rm-actions"><button class="rc-btn sm" data-a="download">Download league files</button><label class="rc-btn sm ghost">Upload newer league zip<input type="file" accept=".zip" data-a="upload" hidden></label><button class="rc-btn sm ghost" data-a="undo" ${o.undo ? '' : 'disabled'} title="${o.undo ? `Undo ${esc(o.undo.team)}'s update` : 'Only the last update can be undone, and not one with releases or new arrivals'}">Undo last update</button></div></div>
      ${o.syncProblems?.length ? `<div class="rm-msg bad"><ul>${o.syncProblems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      ${o.outbox.length ? `<div class="rm-msg note">${o.outbox.length} release ${o.outbox.length === 1 ? 'notice is' : 'notices are'} waiting to reach the portal or the forum. They retry on their own.</div>` : ''}
      <div class="rm-settings card">
        ${toggle('allowNames', 'Allow name changes', 'Only once all recruiting has finished')}
        ${toggle('allowPositions', 'Allow position changes', 'Inside a position group, such as DE to DT')}
        ${toggle('locked', 'Lock roster moves', 'While you run a week. You can still edit.')}
        ${toggle('bidGate', 'Block bids when a roster is full', 'Coaches must release a player first')}
        <label class="rm-toggle"><input type="checkbox" data-strict ${o.settings.strict === 'on' ? 'checked' : ''}><span><b>Require all 46 now</b><small>${o.recruitingDone ? 'Recruiting is finished, so this already applies.' : 'Otherwise this starts when recruiting finishes.'}</small></span></label>
      </div>
      <div class="card rs-card"><div class="rs-scroll"><table class="rm-table"><thead><tr><th>Team</th><th class="rm-c">Active</th><th class="rm-c">Out</th><th class="rm-c">Inactive</th><th class="rm-c">IR/PS</th><th class="rm-c">Total</th><th class="rm-c">Waiting</th><th>Status</th><th>Last update</th></tr></thead><tbody>${o.teams.map(teamRow).join('')}</tbody></table></div></div>
      <div class="section-h"><span class="bar"></span><h2>Activity</h2></div>
      <div class="card rm-log">${o.events.length ? o.events.map(e => `<div><time>${esc(when(e.at))}</time><span>${eventText(e)}</span></div>`).join('') : '<div class="rm-small">Nothing yet.</div>'}</div>
    </section>`;
  };
  try { await draw(); } catch (e) {
    el.innerHTML = `<div class="card fm-empty"><b>${e.status === 403 ? 'Commissioner only' : 'That did not load'}</b><p>${esc(e.message)}</p></div>`;
    return;
  }
  el.addEventListener('click', async ev => {
    const a = ev.target.closest('[data-a]')?.dataset.a, v = ev.target.closest('[data-view]')?.dataset.view;
    try {
      if (a === 'download') await download('/league/download');
      if (a === 'undo') {
        if (!(await dialog('Undo the last update?', 'This puts the league files back as they were before the last roster update.', [{ label: 'Keep it', value: false }, { label: 'Undo update', value: true, cls: 'primary' }]))) return;
        await request('/admin/undo', { method: 'POST', body: {} }); toast('Update undone'); await draw();
      }
      if (v) {
        const f = await request(`/admin/rmupdate/${encodeURIComponent(v)}`);
        const ov = document.createElement('div'); ov.className = 'rc-overlay';
        ov.innerHTML = `<div class="rc-modal"><div class="rc-mhead"><div><h3>RMUpdate file</h3><p>${esc(f.file)}</p></div></div><div class="rc-mbody"><table class="rm-table"><thead><tr><th>Id</th><th>Name</th><th>#</th><th>Pos</th><th>Slot</th></tr></thead><tbody>${f.slots.map(s => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${s.jersey}</td><td>${esc(s.pos)}</td><td>${slotLabel(s.slot)}</td></tr>`).join('')}</tbody></table></div></div>`;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
      }
    } catch (e) { toast('That did not work', e.message, 'err'); }
  });
  el.addEventListener('change', async ev => {
    const t = ev.target;
    try {
      if (t.dataset.set) { await request('/admin/settings', { method: 'PATCH', body: { [t.dataset.set]: t.checked } }); toast('Saved', `${t.dataset.set}: ${yes(t.checked)}`); }
      if ('strict' in t.dataset) { await request('/admin/settings', { method: 'PATCH', body: { strict: t.checked ? 'on' : 'auto' } }); toast('Saved'); }
      if (t.dataset.a === 'upload' && t.files[0]) {
        const f = t.files[0];
        if (!(await dialog('Replace the league files?', `Replace the league files with ${f.name}? Coaches will download these from now on.`, [{ label: 'Cancel', value: false }, { label: 'Replace', value: true, cls: 'primary' }]))) return;
        const b = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
        const send = confirm => request('/admin/league', { method: 'POST', body: { filename: f.name, dataBase64: b, confirm } });
        try { await send(false); toast('League files replaced'); }
        catch (e) {
          if (e.code !== 'UPLOAD_CHECK') throw e;
          const more = e.count > e.differences.length ? ` And ${e.count - e.differences.length} more.` : '';
          if (await dialog('These files look older than the site\'s', `${e.differences.join(' ')}${more} If you meant to upload these, replace anyway: any signing they lack goes back on its team. Otherwise download the current files and run those.`, [{ label: 'Cancel', value: false }, { label: 'Replace anyway', value: true, cls: 'primary' }])) { await send(true); toast('League files replaced'); }
        }
      }
      await draw();
    } catch (e) { toast('That did not work', e.message, 'err'); await draw().catch(() => {}); }
  });
}
