/* ==================================================================
   PCFL Recruitment Center — front-end module
   Loaded lazily by app.js for the #/recruiting route. Talks to the
   standalone Recruitment Center service (js/recruiting.config.js →
   apiBase). Nothing here is imported by the rest of the site.
   ================================================================== */
const CFG = window.PCFL_RECRUITING || { apiBase: 'http://localhost:8787/api/recruiting/v1' };
const ATTRS = ['SP', 'AC', 'AG', 'ST', 'HA', 'EN', 'IN', 'DI'];
const ATTR_NAMES = { SP: 'Speed', AC: 'Acceleration', AG: 'Agility', ST: 'Strength', HA: 'Hands', EN: 'Endurance', IN: 'Intelligence', DI: 'Discipline' };
const POS_ORDER = ['QB', 'HB', 'FB', 'WR', 'TE', 'C', 'G', 'T', 'DE', 'DT', 'LB', 'CB', 'S', 'FS', 'SS', 'K', 'P'];
const TOKEN_KEY = 'pcfl-rc-token';

let H = null;          // helpers from app.js: { App, T, logo, esc, haptic }
const S = {            // module state (survives route re-renders while on #/recruiting)
  token: localStorage.getItem(TOKEN_KEY) || null, me: null, state: null, recruits: new Map(), feed: [],
  es: null, view: 'board', filters: null, sort: { key: 'rank', dir: 'asc' }, viewMode: localStorage.getItem('pcfl-rc-view') || 'cards',
  selected: new Set(), watch: new Set(), ledger: null, notifs: [], clock: null, savedFilters: [], adminData: null, filtersCollapsed: true,
};
const defaultFilters = () => ({ pos: 'ALL', stars: new Set(), status: 'available', search: '', attrMin: {}, attrMode: 'pot', round: 'current' });
S.filters = defaultFilters();

/* ------------------------------------------------------------- utils */
const esc = s => (H ? H.esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const T = slug => H.T(slug);
const logo = (slug, dark) => H.logo(slug, dark);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const rcls = v => v >= 90 ? 'r4' : v >= 80 ? 'r3' : v >= 70 ? 'r2' : 'r1';
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmtTs = iso => { const d = new Date(iso); const t = d.getTime(); const tenth = Math.floor((t % 1000) / 100); return `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/(\d)(?= [AP]M)/, `$1.${tenth}`)}`; };
const fmtDate = iso => new Date(iso).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pad = n => String(n).padStart(2, '0');
function countdown(iso) {
  const ms = Date.parse(iso) - Date.now() - (S.skew || 0);
  if (ms <= 0) return { text: '0:00:00.0', ms: 0 };
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3), s = Math.floor(ms % 60e3 / 1000), t = Math.floor(ms % 1000 / 100);
  return { text: `${h}:${pad(m)}:${pad(s)}.${t}`, ms };
}
const initials = r => `${(r.firstName || '')[0] || ''}${(r.lastName || '')[0] || ''}`.toUpperCase();
const myTeam = () => S.me?.team || null;
const isCommish = () => S.me?.role === 'commissioner';
const currentRound = () => S.state?.currentRound || null;
const nav = (sub) => { location.hash = '#/recruiting' + (sub ? '/' + sub : ''); };

async function api(path, { method = 'GET', body, silent, _retry = 0 } = {}) {
  let res;
  try {
    res = await fetch(CFG.apiBase + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (netErr) {
    // transient network failure: retry idempotent reads with backoff; never retry writes (they could double-apply)
    if (method === 'GET' && _retry < 2) { await new Promise(r => setTimeout(r, 400 * (_retry + 1))); return api(path, { method, body, silent, _retry: _retry + 1 }); }
    const e = new Error('Cannot reach the Recruitment Center service.'); e.code = 'NETWORK'; if (!silent) throw e; return null;
  }
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && S.token && !path.startsWith('/auth/login')) { S.token = null; localStorage.removeItem(TOKEN_KEY); S.me = null; }
    const e = new Error(json.error?.message || `Request failed (${res.status})`); e.code = json.error?.code || 'HTTP_' + res.status; e.extra = json.error || {}; if (!silent) throw e; return null;
  }
  return json;
}
/** Report a browser-side failure to the service log (best effort) and show a recoverable error card. */
function reportClientError(e, where) {
  try { console.error('[recruiting]', where, e); } catch {}
  try { fetch(CFG.apiBase + '/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) }, body: JSON.stringify({ message: `${where}: ${e?.message || e}`, stack: String(e?.stack || '').slice(0, 1500), url: location.href }) }).catch(() => {}); } catch {}
}
const intIn = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/* ------------------------------------------------------------ toasts */
function toast(title, msg, kind = 'info', ms = 4200) {
  let host = $('.rc-toasts'); if (!host) { host = document.createElement('div'); host.className = 'rc-toasts'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = `rc-toast ${kind}`; el.innerHTML = `<b>${esc(title)}</b>${esc(msg)}`; host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, ms);
}
function modal(html, cls = '') {
  closeModal();
  const ov = document.createElement('div'); ov.className = 'rc-overlay'; ov.innerHTML = `<div class="rc-modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  const esc_ = e => { if (e.key === 'Escape') closeModal(); }; document.addEventListener('keydown', esc_); ov._esc = esc_;
  return ov;
}
function closeModal() { const ov = $('.rc-overlay'); if (ov) { document.removeEventListener('keydown', ov._esc); ov.remove(); document.body.style.overflow = ''; } }

/* ------------------------------------------------------------ entry */
export function render(ctx) {
  H = ctx; S.sub = ctx.sub || 'board';
  if (['board', 'ledger', 'signed', 'rankings', 'admin', 'settings'].includes(S.sub)) S.view = S.sub; else S.view = 'board';
  setTimeout(mount, 0);
  return `<div id="rc-root" class="rc"><div class="empty card" style="margin-top:30px"><b>Connecting to the Recruitment Center…</b></div></div>`;
}

async function mount() {
  if (!S.bound) {
    S.bound = true;
    window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/recruiting')) teardown(); });
    document.addEventListener('click', e => { const a = e.target.closest('[data-rc]'); if (a) { e.preventDefault(); const [act, arg] = a.dataset.rc.split(':'); ACTIONS[act]?.(arg, a, e); } });
    document.addEventListener('change', e => { const a = e.target.closest('[data-rcc]'); if (a) { const [act, arg] = a.dataset.rcc.split(':'); ACTIONS[act]?.(arg, a, e); } });
    document.addEventListener('input', e => { const a = e.target.closest('[data-rci]'); if (a) { const [act, arg] = a.dataset.rci.split(':'); ACTIONS[act]?.(arg, a, e); } });
  }
  try { await loadState(); }
  catch (e) { renderOffline(e); return; }
  connectSSE(); startClock();
  await draw();
  maybeCeremony();
}
/** Show the round-start ceremony if a round opened in the last 3 minutes and hasn't been shown yet. */
function maybeCeremony() {
  const cr = currentRound(); if (!cr || !cr.startedAt || cr.status !== 'ACTIVE') return;
  const key = `pcfl-rc-ceremony-${cr.id}`;
  if (Date.now() - Date.parse(cr.startedAt) < 3 * 60e3 && !localStorage.getItem(key)) { localStorage.setItem(key, '1'); roundCeremony(cr); }
}
function teardown() { if (S.es) { S.es.close(); S.es = null; } if (S.clock) { clearInterval(S.clock); S.clock = null; } closeModal(); }

async function loadState() {
  const st = await api('/state');
  S.skew = Date.now() - Date.parse(st.serverTime);
  S.state = st; S.me = st.me;
  if (S.me?.mustChangePw) S.forcePw = true;
  const rec = await api('/recruits');
  S.recruits = new Map(rec.recruits.map(r => [r.id, r]));
  const fd = await api('/feed?limit=40'); S.feed = fd.feed;
  if (myTeam()) { const w = await api('/teams/me/watchlist', { silent: true }); S.watch = new Set(w?.recruitIds || []); const f = await api('/teams/me/filters', { silent: true }); S.savedFilters = f?.filters || []; }
}
function renderOffline(e) {
  const root = $('#rc-root'); if (!root) return;
  root.innerHTML = `<div class="card rc-offline reveal in"><div style="font-size:40px">🏈</div><h3>Recruitment Center offline</h3>
    <p>The recruiting service isn't reachable right now, so bidding is unavailable. Everything else on PCFL Network works normally.</p>
    <p class="rc-note">Service: <code>${esc(CFG.apiBase)}</code><br>${esc(e.message)}</p>
    <div style="margin-top:14px"><button class="rc-btn dark" data-rc="retry">Retry</button></div></div>`;
}

/* ------------------------------------------------------------ SSE */
function connectSSE() {
  if (S.es) S.es.close();
  const url = CFG.apiBase + '/events' + (S.token ? `?token=${encodeURIComponent(S.token)}` : '');
  const es = new EventSource(url); S.es = es;
  const on = (type, fn) => es.addEventListener(type, ev => { try { fn(JSON.parse(ev.data)); } catch (err) { console.error(err); } });
  let wasDown = false;
  es.onopen = async () => { setLive(true); if (wasDown) { wasDown = false; try { await loadState(); draw(); toast('Reconnected', 'Live updates restored and state resynced.', 'ok'); } catch (e) { reportClientError(e, 'resync'); } } };
  es.onerror = () => { setLive(false); wasDown = true; };
  on('BID_PLACED', d => { upsert(d.recruit); pushFeed({ ...d.bid, type: 'BID_PLACED', name: d.recruit.name, position: d.recruit.position }); if (d.bid.team === myTeam()) return; if (S.view === 'board') refreshRecruit(d.recruit.id); });
  on('BID_OUTBID', d => { upsert(d.recruit); if (d.team === myTeam()) { S.me.points = d.points; toast('You have been outbid', `${T(d.by).name} bid ${d.amount} on ${d.recruit.position} ${d.recruit.name}.`, 'err', 6000); S.me.unread = (S.me.unread || 0) + 1; drawHero(); refreshRecruit(d.recruit.id); } });
  on('BALANCE_CHANGED', d => { if (d.team === myTeam() && S.me) { S.me.points = d.points; drawHero(); if (S.view === 'ledger') draw(); } });
  on('BID_WITHDRAWN', d => { upsert(d.recruit); refreshRecruit(d.recruit.id); });
  on('PLAYER_SIGNED', d => { upsert(d.recruit); pushFeed({ type: 'BID_WON', team: d.team, amount: d.amount, at: d.at, recruitId: d.recruit.id, name: d.recruit.name, position: d.recruit.position }); celebrate(d); refreshRecruit(d.recruit.id); if (S.view !== 'board') draw(); });
  on('PLAYER_UNSIGNED', d => { upsert(d.recruit); refreshRecruit(d.recruit.id); });
  on('ROUND_STARTED', async d => { await loadState(); draw(); localStorage.setItem(`pcfl-rc-ceremony-${d.round.id}`, '1'); roundCeremony(d.round, d.recruits); });
  on('ROUND_COMPLETE', async d => { toast('Round complete', `${d.round.name} has finished.`, 'info', 6000); await loadState(); draw(); });
  on('RECRUITMENT_PAUSED', async () => { await loadState(); draw(); toast('Recruiting paused', 'The commissioner paused recruiting. Clocks are frozen.', 'err', 6000); });
  on('RECRUITMENT_RESUMED', async () => { await loadState(); draw(); toast('Recruiting resumed', 'Clocks are running again.', 'ok'); });
  on('BIDDING_SUSPENDED', async () => { await loadState(); draw(); });
  on('BIDDING_UNSUSPENDED', async () => { await loadState(); draw(); });
  on('RECRUIT_ADDED', d => { upsert(d.recruit); if (S.view === 'board') draw(); });
  on('RECRUIT_UPDATED', d => { upsert(d.recruit); refreshRecruit(d.recruit.id); });
  on('RECRUIT_REMOVED', d => { S.recruits.delete(d.recruitId); if (S.view === 'board') draw(); });
  on('RECRUITS_IMPORTED', async () => { await loadState(); draw(); });
  on('SYSTEM_NOTICE', d => toast('League notice', d.message, d.level === 'critical' ? 'err' : 'info'));
}
function setLive(on) { const d = $('.rc-livehd .dot'); if (d) d.classList.toggle('off', !on); }
function upsert(r) { if (!r) return; S.recruits.set(r.id, r); }
function pushFeed(item) { S.feed.unshift(item); S.feed = S.feed.slice(0, 60); const el = $('#rc-feed'); if (el) { el.innerHTML = feedHTML(); } }

/* ------------------------------------------------------------ clock */
function startClock() {
  if (S.clock) clearInterval(S.clock);
  S.clock = setInterval(() => {
    $$('[data-closes]').forEach(el => {
      const c = countdown(el.dataset.closes); el.textContent = c.text;
      el.classList.toggle('warn', c.ms < 3600e3 && c.ms > 0); el.classList.toggle('crit', c.ms < 300e3 && c.ms > 0);
      if (c.ms === 0 && !el.dataset.done) { el.dataset.done = '1'; setTimeout(() => refreshRecruit(+el.dataset.rid), 1500); }
    });
  }, 100);
}
async function refreshRecruit(id) {
  if (!id) return;
  const r = S.recruits.get(id);
  const card = $(`[data-card="${id}"]`);
  if (card && r) { card.outerHTML = S.viewMode === 'cards' ? cardHTML(r) : rowHTML(r); }
  const fresh = await api(`/recruits/${id}`, { silent: true }); if (fresh?.recruit) { upsert(fresh.recruit); const c2 = $(`[data-card="${id}"]`); if (c2) c2.outerHTML = S.viewMode === 'cards' ? cardHTML(fresh.recruit) : rowHTML(fresh.recruit); }
  drawHero();
}

/* ------------------------------------------------------------ draw */
async function draw() {
  const root = $('#rc-root'); if (!root) return;
  try {
    if (S.forcePw && S.me) { root.innerHTML = heroHTML() + changePwHTML(true); return; }
    let body = '';
    if (S.view === 'ledger') body = await ledgerHTML();
    else if (S.view === 'signed') body = await signedHTML();
    else if (S.view === 'rankings') body = await rankingsHTML();
    else if (S.view === 'admin') body = isCommish() ? await adminHTML() : loginHTML('Commissioner sign-in required');
    else if (S.view === 'settings') body = S.me ? changePwHTML(false) : loginHTML();
    else body = boardHTML();
    root.innerHTML = heroHTML() + subnavHTML() + body + massHTML();
    if (S.view === 'board') bindBoard();
    if (S.view === 'ledger') mountRosterCharts();
  } catch (e) {
    // error boundary: never leave a blank page; the rest of the site is unaffected
    reportClientError(e, `draw:${S.view}`);
    root.innerHTML = (safe(() => heroHTML()) || '') + `<div class="card rc-errcard reveal in"><b style="font-family:var(--font-head);font-size:18px;display:block">This view hit a problem</b><div class="rc-note" style="margin:8px 0 14px">${esc(e.message || 'Unexpected error')}. Your data is safe — nothing is changed by viewing.</div><button class="rc-btn dark" data-rc="retry">Reload Recruitment Center</button> <a class="rc-btn ghost" href="#/recruiting">Back to board</a></div>`;
  }
}
const safe = fn => { try { return fn(); } catch { return null; } };
function roundCeremony(round, count) {
  const stars = round.type === 'PORTAL' ? '' : (round.name.match(/(\d)-Star/) || [])[1];
  const label = round.type === 'PORTAL' ? 'PORTAL PLAYERS' : (stars ? `${stars}-STAR RECRUITS` : round.name.toUpperCase());
  const n = count ?? [...S.recruits.values()].filter(r => r.roundId === round.id).length;
  const ov = document.createElement('div'); ov.className = 'rc-rstart';
  ov.innerHTML = `<div class="lines"></div><div class="box"><div class="k">PCFL Recruiting · ${esc(S.state.season?.year || '')}</div>${stars ? `<div class="stars">${'★'.repeat(+stars)}</div>` : ''}<div class="big">ROUND ${round.number}</div><div class="sub">${esc(label)} · NOW OPEN</div><div class="bar"></div><div class="meta">${n} players on the board · started ${fmtDate(round.startedAt)} · ${round.closeMode === 'after-hours' ? `closes after ${round.closeAfterHours}h` : 'a winning bid must stand ' + (round.windowHours || S.state.season?.windowHours) + 'h'}</div></div>`;
  ov.addEventListener('click', () => ov.remove()); document.body.appendChild(ov); H.haptic(30);
  setTimeout(() => { ov.style.transition = 'opacity .6s'; ov.style.opacity = '0'; setTimeout(() => ov.remove(), 600); }, 5200);
}
function drawHero() { const h = $('#rc-hero'); if (h) h.outerHTML = heroHTML(); const sn = $('#rc-subnav'); if (sn) sn.outerHTML = subnavHTML(); }

function heroHTML() {
  const st = S.state, cr = currentRound(), season = st.season;
  const openRecruits = [...S.recruits.values()].filter(r => r.status === 'OPEN' && (!cr || r.roundId === cr.id));
  const closes = openRecruits.map(r => r.closesAt).sort();
  const nextClose = closes[0] || null, lastClose = closes[closes.length - 1] || null;
  const poolCount = [...S.recruits.values()].filter(r => r.status === 'POOL').length;
  const team = myTeam() ? T(myTeam()) : null;
  const p = S.me?.points;
  // Round-end semantics: a round closes when its last player's winning bid has stood
  // for the full window (or at its hard time limit) — so the headline clock is the
  // LATEST clock in the round, with the next individual closure underneath.
  const hardEnd = cr?.status === 'ACTIVE' && cr.closeMode === 'after-hours' && cr.startedAt ? new Date(Date.parse(cr.startedAt) + cr.closeAfterHours * 3600e3 + (cr.pauseTotalMs || 0)).toISOString() : null;
  const roundEnd = hardEnd && (!lastClose || hardEnd < lastClose) ? hardEnd : lastClose;
  const clock = cr?.status === 'PAUSED' ? `<div class="lbl">Recruiting</div><div class="time warn">PAUSED</div>`
    : roundEnd ? `<div class="lbl">${hardEnd && roundEnd === hardEnd ? 'Round ends in' : 'Round closes no sooner than'}</div><div class="time" data-closes="${roundEnd}" data-rid="0">${countdown(roundEnd).text}</div>${nextClose && nextClose !== roundEnd ? `<div class="sub2">Next player signs in <b data-closes="${nextClose}" data-rid="0">${countdown(nextClose).text}</b></div>` : ''}`
    : cr ? `<div class="lbl">${esc(cr.name.split('—')[0].trim())}</div><div class="time" style="font-size:34px">${cr.status === 'COMPLETE' ? 'COMPLETE' : 'NOT STARTED'}</div>`
    : `<div class="lbl">Recruiting</div><div class="time" style="font-size:34px">OFFSEASON</div>`;
  const chip = cr ? `<div class="rc-roundchip"><span class="live ${cr.status === 'ACTIVE' ? '' : cr.status === 'COMPLETE' ? 'done' : 'idle'}"></span><b>Round ${cr.number}</b><span class="sep">·</span>${esc(cr.type === 'PORTAL' ? 'Portal' : (cr.name.split('—')[1] || cr.name).trim())}<span class="sep">·</span>${cr.startedAt ? `Started ${fmtDate(cr.startedAt)}` : cr.startMode === 'auto' ? (cr.startAfterHours != null ? `Auto-starts ${cr.startAfterHours}h after previous` : 'Auto-starts when previous completes') : 'Manual start'}${cr.status === 'ACTIVE' ? `<span class="sep">·</span>${cr.closeMode === 'after-hours' ? `${cr.closeAfterHours}h limit` : `bids stand ${cr.windowHours || st.season?.windowHours}h`}` : ''}</div>` : '';
  return `<div id="rc-hero" class="rc-hero reveal in" style="--hero-a:${team ? team.colors.primary : '#6a0011'};--hero-b:${team ? team.colors.secondary : '#2a2f3a'}">
    <div class="bg"></div><div class="grid-lines"></div>
    <div class="chyron"><span class="dot"></span> PCFL Recruitment Center${season ? ` · ${season.year} Recruiting` : ''}</div>
    <div class="rc-hero-inner">
      <div><div class="title">Recruitment<br>Center</div><div class="sub">${season ? esc(season.name) : 'No active recruiting season'}${st.season?.suspended ? ' · <span style="color:#ff5a6e">BIDDING SUSPENDED</span>' : ''}</div>${chip}</div>
      <div class="rc-clock">${clock}${cr ? `<div class="round">${openRecruits.length} recruits open${poolCount ? ` · ${poolCount} in Portal Pool` : ''}</div>` : ''}</div>
      <div>${team ? `<div class="rc-team"><div style="text-align:right"><div class="role">${isCommish() ? 'Commissioner · acting as' : 'Franchise'}</div><div class="nm">${esc(team.name)} ${esc(team.nickname)}</div></div><img src="${logo(myTeam(), true)}" onerror="this.src='${logo(myTeam())}'" alt=""></div>
        ${p ? `<div class="rc-points"><div><b>${p.allocated + p.adjustments}</b><span>Allocated</span></div><div><b>${p.spent}</b><span>Spent</span></div><div><b>${p.reserved}</b><span>Reserved</span></div><div class="avail"><b>${p.available}</b><span>Available</span></div></div>` : ''}`
      : isCommish() ? `<div class="rc-team"><div style="text-align:right"><div class="role">Signed in as</div><div class="nm">Commissioner</div><div class="role" style="margin-top:4px">Use ACT AS TEAM in Admin to bid for an open franchise</div></div></div>`
      : `<div class="rc-team"><div style="text-align:right"><div class="role">Coaches</div><div class="nm">Sign in to bid</div><div style="margin-top:8px"><button class="rc-btn gold" data-rc="login">Enter Recruitment Center</button></div></div></div>`}</div>
    </div>
    ${isCommish() && myTeam() ? `<div class="banner commish">⚑ Commissioner mode — acting as ${esc(T(myTeam()).name)} <button class="rc-btn sm ghost" style="color:#fff;border-color:rgba(255,255,255,.3)" data-rc="actclear">Exit team</button></div>` : ''}
    ${cr?.status === 'PAUSED' ? `<div class="banner paused">⏸ Recruitment temporarily paused by the commissioner — remaining clocks are preserved.</div>` : ''}
    ${st.season?.suspended ? `<div class="banner suspended">⚠ All bidding suspended${st.season.suspendReason ? ` — ${esc(st.season.suspendReason)}` : ''}</div>` : ''}
  </div>`;
}
function subnavHTML() {
  const leading = myTeam() ? [...S.recruits.values()].filter(r => r.leader === myTeam() && r.status === 'OPEN').length : 0;
  const link = (v, label, extra = '') => `<a href="#/recruiting${v === 'board' ? '' : '/' + v}" class="${S.view === v ? 'on' : ''}">${label}${extra}</a>`;
  return `<nav id="rc-subnav" class="rc-subnav">
    ${link('board', 'Recruit Board')}
    ${link('ledger', 'My Ledger', leading ? `<span class="cnt">${leading} leading</span>` : '')}
    ${link('signed', 'Signed')}
    ${link('rankings', 'Rankings')}
    ${isCommish() ? link('admin', 'Admin') : ''}
    <span class="spacer"></span>
    ${S.me ? `<a href="#" class="rc-notif" data-rc="notifs">🔔${S.me.unread ? `<span class="cnt hot">${S.me.unread}</span>` : ''}</a>${link('settings', 'Settings')}<a href="#" data-rc="logout">Sign out</a>` : `<a href="#" data-rc="login">Sign in</a>`}
  </nav>`;
}

/* ------------------------------------------------------------ login */
function loginHTML(msg) {
  const teams = S.state.teams;
  return `<div class="card rc-login reveal in"><h3>PCFL Recruitment Center</h3><div class="hint">${esc(msg || 'Sign in with your franchise to view your recruiting points and place bids.')}</div>
    <label>Team</label><div class="rc-teamsel"><img id="rc-login-logo" src="${logo(teams[0].slug)}" alt=""><select id="rc-login-team" data-rcc="loginlogo">${teams.map(t => `<option value="${t.abbr}" data-slug="${t.slug}">${esc(t.name)} ${esc(t.nickname)}</option>`).join('')}<option value="COMMISSIONER" data-slug="">— Commissioner —</option></select></div>
    <label>Password</label><div class="rc-field"><input class="rc-input" id="rc-login-pw" type="password" autocomplete="current-password" placeholder="••••••••••••" data-rc-enter="dologin"></div>
    <div class="rc-err" id="rc-login-err"></div>
    <div class="actions"><button class="rc-btn primary" data-rc="dologin">Enter Recruitment Center</button><a class="rc-btn ghost" href="#/">Return to PCFL</a></div>
    <p class="rc-note" style="margin-top:18px">Initial passwords are issued by the commissioner (PCFL + season + 4 digits). You'll be asked to change it on first sign-in. Five failed attempts lock the franchise login.</p></div>`;
}
function changePwHTML(forced) {
  return `<div class="card rc-login reveal in"><h3>${forced ? 'Set your recruiting password' : 'Change recruiting password'}</h3><div class="hint">${forced ? 'Your franchise is using a temporary password. Choose a new one to continue.' : 'Choose a new password for your franchise login.'}</div>
    <label>Current password</label><div class="rc-field"><input class="rc-input" id="rc-pw-cur" type="password" autocomplete="current-password"></div>
    <label>New password (8+ characters)</label><div class="rc-field"><input class="rc-input" id="rc-pw-new" type="password" autocomplete="new-password"></div>
    <label>Confirm new password</label><div class="rc-field"><input class="rc-input" id="rc-pw-new2" type="password" autocomplete="new-password"></div>
    <div class="rc-err" id="rc-pw-err"></div>
    <div class="actions"><button class="rc-btn primary" data-rc="dopw">Save password</button>${forced ? '<button class="rc-btn ghost" data-rc="logout">Sign out</button>' : '<a class="rc-btn ghost" href="#/recruiting">Back</a>'}</div></div>`;
}

/* ------------------------------------------------------------ board */
function visibleRecruits() {
  const f = S.filters, cr = currentRound(), me = myTeam();
  let list = [...S.recruits.values()];
  if (f.round === 'current') { if (cr) list = list.filter(r => r.roundId === cr.id); }
  else if (f.round !== 'all') list = list.filter(r => r.roundId === +f.round);
  if (f.pos !== 'ALL') list = list.filter(r => r.position === f.pos);
  if (f.stars.size) list = list.filter(r => f.stars.has(r.stars));
  if (f.search) { const s = f.search.toLowerCase(); list = list.filter(r => r.name.toLowerCase().includes(s) || r.position.toLowerCase() === s); }
  switch (f.status) {
    case 'available': list = list.filter(r => ['OPEN', 'PAUSED', 'UPCOMING', 'POOL'].includes(r.status)); break;
    case 'pool': list = list.filter(r => r.status === 'POOL'); break;
    case 'mine': list = list.filter(r => me && (r.leader === me || S.myBids?.has(r.id))); break;
    case 'leading': list = list.filter(r => me && r.leader === me && r.status === 'OPEN'); break;
    case 'outbid': list = list.filter(r => me && S.myBids?.has(r.id) && r.leader !== me && r.status === 'OPEN'); break;
    case 'nobids': list = list.filter(r => r.status === 'OPEN' && !r.bidCount); break;
    case 'signed': list = list.filter(r => r.status === 'SIGNED'); break;
    case 'watch': list = list.filter(r => S.watch.has(r.id)); break;
  }
  for (const [k, v] of Object.entries(f.attrMin)) { if (!v) continue; const i = ATTRS.indexOf(k); list = list.filter(r => (f.attrMode === 'act' ? r.act[i] : r.pot[i]) >= v); }
  const { key, dir, mode } = S.sort; const m = dir === 'asc' ? 1 : -1;
  const val = r => {
    if (ATTRS.includes(key)) { const i = ATTRS.indexOf(key); return (mode === 'act' ? r.act[i] : r.pot[i]); }
    switch (key) { case 'rank': return r.rank; case 'score': return r.score; case 'bid': return r.currentBid; case 'time': return r.closesAt ? Date.parse(r.closesAt) : 9e15; case 'stars': return r.stars; case 'name': return r.lastName; case 'pos': return POS_ORDER.indexOf(r.position); case 'ovr': return r.overallActual; case 'pot': return r.overallPotential; case 'bidders': return r.bidders; default: return r.rank; }
  };
  return list.sort((a, b) => { const x = val(a), y = val(b); if (x === y) return a.rank - b.rank; return (x > y ? 1 : -1) * m; });
}
function boardHTML() {
  const list = visibleRecruits();
  const f = S.filters, cr = currentRound();
  const posCounts = {}; for (const r of S.recruits.values()) if (f.round !== 'current' || !cr || r.roundId === cr.id) posCounts[r.position] = (posCounts[r.position] || 0) + 1;
  const sortOpts = [['rank', 'Overall rank'], ['score', 'Recruit score'], ['pot', 'Potential OVR'], ['ovr', 'Actual OVR'], ['bid', 'Current bid'], ['time', 'Time remaining'], ['bidders', 'Most contested'], ['stars', 'Stars'], ['name', 'Name'], ['pos', 'Position']];
  return `<div class="rc-board">
    <aside class="rc-side ${S.filtersCollapsed ? 'collapsed' : ''}">
      <div class="card rc-panel"><div class="rc-inline" style="justify-content:space-between"><h4 style="margin:0">Search</h4><button class="rc-btn sm ghost rc-filters-toggle" style="display:none" data-rc="togglefilters">Filters</button></div><div class="rc-field" style="margin-top:8px"><input class="rc-input rc-search" placeholder="Player or position…" value="${esc(f.search)}" data-rci="search"></div></div>
      <div class="card rc-panel"><h4>Position</h4><div class="rc-pos"><button class="${f.pos === 'ALL' ? 'on' : ''}" data-rc="pos:ALL">ALL</button>${POS_ORDER.filter(p => posCounts[p]).map(p => `<button class="${f.pos === p ? 'on' : ''}" data-rc="pos:${p}">${p} <small>${posCounts[p]}</small></button>`).join('')}</div></div>
      <div class="card rc-panel"><h4>Star rating</h4><div class="rc-pos rc-stars">${[5, 4, 3, 2, 1].map(n => `<button class="${f.stars.has(n) ? 'on' : ''}" data-rc="star:${n}">${n}★</button>`).join('')}</div></div>
      <div class="card rc-panel"><h4>Show</h4><div class="rc-pos">${[['available', 'Available'], ['all', 'All'], ['nobids', 'No bids'], ['pool', 'Portal Pool'], ['signed', 'Signed'], ...(myTeam() ? [['leading', 'I lead'], ['outbid', 'Outbid'], ['mine', 'My bids'], ['watch', '★ Targets']] : [])].map(([k, l]) => `<button class="${f.status === k ? 'on' : ''}" data-rc="status:${k}">${l}</button>`).join('')}</div>
        ${S.state.season?.visibility === 'current' && !isCommish() ? `<div class="rc-note" style="margin-top:8px">Players are revealed round by round; upcoming rounds appear when they open.</div>` : ''}
        ${S.state.rounds.length > 1 ? `<h4 style="margin-top:12px">Round</h4><select class="rc-input" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:12px;width:100%" data-rcc="round"><option value="current" ${f.round === 'current' ? 'selected' : ''}>Current round</option><option value="all" ${f.round === 'all' ? 'selected' : ''}>All rounds</option>${S.state.rounds.map(r => `<option value="${r.id}" ${String(f.round) === String(r.id) ? 'selected' : ''}>${esc(r.name)} (${r.status})</option>`).join('')}</select>` : ''}</div>
      <div class="card rc-panel"><h4>Minimum ratings</h4><div class="rc-attrf"><div class="mode"><button class="rc-chip ${f.attrMode === 'pot' ? 'on' : ''}" data-rc="attrmode:pot">Potential</button><button class="rc-chip ${f.attrMode === 'act' ? 'on' : ''}" data-rc="attrmode:act">Actual</button></div>
        ${ATTRS.map(a => `<label title="${ATTR_NAMES[a]}">${a} ≥ <input type="number" min="0" max="100" value="${f.attrMin[a] || ''}" data-rci="attrmin:${a}"></label>`).join('')}</div>
        <div class="rc-inline" style="margin-top:10px"><button class="rc-btn sm" data-rc="clearfilters">Clear</button>${myTeam() ? `<button class="rc-btn sm dark" data-rc="savefilter">Save filter</button>` : ''}</div>
        ${S.savedFilters.length ? `<h4 style="margin-top:12px">Saved filters</h4><div class="rc-pos">${S.savedFilters.map(sf => `<button data-rc="loadfilter:${sf.id}" title="Click to apply · shift-click to delete">${esc(sf.name)}</button>`).join('')}</div>` : ''}</div>
    </aside>
    <section>
      <div class="rc-toolbar"><span class="rc-count"><b>${list.length}</b> recruits</span><span class="grow"></span>
        <div class="rc-sort">Sort <select data-rcc="sort">${sortOpts.map(([k, l]) => `<option value="${k}" ${S.sort.key === k && !ATTRS.includes(S.sort.key) ? 'selected' : ''}>${l}</option>`).join('')}${ATTRS.map(a => `<option value="${a}" ${S.sort.key === a ? 'selected' : ''}>${a} ${S.sort.mode === 'act' ? 'actual' : 'potential'}</option>`).join('')}</select><button class="rc-btn sm ghost" data-rc="sortdir" title="Toggle direction">${S.sort.dir === 'asc' ? '↑' : '↓'}</button></div>
        <div class="rc-view"><button class="${S.viewMode === 'cards' ? 'on' : ''}" data-rc="viewmode:cards">▦ Cards</button><button class="${S.viewMode === 'table' ? 'on' : ''}" data-rc="viewmode:table">☰ Table</button></div>
        ${myTeam() ? `<label class="rc-count" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-rcc="selectall" ${list.length && list.every(r => S.selected.has(r.id)) ? 'checked' : ''}> Select all</label>` : ''}</div>
      ${list.length ? (S.viewMode === 'cards' ? `<div class="rc-grid" id="rc-grid">${list.map(cardHTML).join('')}</div>` : `<div class="card rc-tablewrap"><table class="rc-table"><thead><tr>${myTeam() ? '<th></th>' : ''}<th data-rc="sortby:rank" class="${S.sort.key === 'rank' ? 'on' : ''}">Rk</th><th class="l" data-rc="sortby:name">Player</th><th data-rc="sortby:pos">Pos</th><th data-rc="sortby:stars">★</th>${ATTRS.map(a => `<th data-rc="sortby:${a}" class="${S.sort.key === a ? 'on' : ''}" title="${ATTR_NAMES[a]} — click to cycle actual/potential ↓↑">${a}${S.sort.key === a ? (S.sort.mode === 'act' ? ' A' : ' P') + (S.sort.dir === 'asc' ? '↑' : '↓') : ''}</th>`).join('')}<th data-rc="sortby:ovr">OVR</th><th data-rc="sortby:pot">POT</th><th class="l">Leader</th><th data-rc="sortby:bid">Bid</th><th data-rc="sortby:time">Time</th></tr></thead><tbody>${list.map(rowHTML).join('')}</tbody></table></div>`)
      : `<div class="card rc-empty" style="padding:50px"><b style="font-family:var(--font-head);font-size:18px;display:block;color:var(--text)">No recruits match</b>${S.recruits.size ? 'Try clearing a filter.' : 'The commissioner has not imported a recruiting class yet.'}</div>`}
    </section>
    <aside class="rc-side rc-feedcol"><div class="card"><div class="rc-livehd"><span class="dot ${S.es && S.es.readyState === 1 ? '' : 'off'}"></span> Live recruiting</div><div class="rc-feed" id="rc-feed">${feedHTML()}</div></div></aside>
  </div>`;
}
function statusTag(r) {
  const me = myTeam();
  if (r.status === 'SIGNED') return `<span class="rc-tag signed">Signed</span>`;
  if (r.status === 'UNSIGNED') return `<span class="rc-tag">Unsigned</span>`;
  if (r.status === 'POOL') return `<span class="rc-tag pool">Portal Pool</span>${S.state.rounds.some(x => x.type === 'PORTAL' && x.status === 'ACTIVE') ? ' <span class="rc-tag">Bid opens a ' + (S.state.season?.poolBidHours || 24) + 'h clock</span>' : ' <span class="rc-tag">Available when Portal opens</span>'}`;
  if (r.status === 'UPCOMING') return `<span class="rc-tag">Upcoming</span>`;
  if (r.status === 'PAUSED') return `<span class="rc-tag hot">Paused</span>`;
  const t = [];
  if (me && r.leader === me) t.push('<span class="rc-tag lead">You lead</span>');
  else if (me && S.myBids?.has(r.id)) t.push('<span class="rc-tag outbid">Outbid</span>');
  if (!r.bidCount) t.push('<span class="rc-tag nobid">No bids</span>'); else if (r.bidders >= 5) t.push('<span class="rc-tag hot">Hot · 5+ teams</span>'); else if (r.bidders >= 3) t.push('<span class="rc-tag hot">Hot</span>'); else t.push(`<span class="rc-tag">${r.bidCount} bid${r.bidCount > 1 ? 's' : ''}</span>`);
  if (r.closesAt && Date.parse(r.closesAt) - Date.now() < 3600e3) t.push('<span class="rc-tag soon">Ending soon</span>');
  return t.join(' ');
}
function attrsHTML(r, big) {
  const cls = big ? 'rc-bigattrs' : 'rc-attrs';
  return `<div class="${cls}"><span class="rl"></span>${ATTRS.map(a => `<span class="h" title="${ATTR_NAMES[a]}">${a}</span>`).join('')}
    <span class="rl">ACT</span>${r.act.map(v => `<span class="v ${rcls(v)}">${v}</span>`).join('')}
    <span class="rl">POT</span>${r.pot.map(v => `<span class="p">${v}</span>`).join('')}</div>`;
}
function cardHTML(r) {
  const me = myTeam(); const portalOpen = S.state.rounds.some(x => x.type === 'PORTAL' && x.status === 'ACTIVE');
  const biddable = r.status === 'OPEN' || (r.status === 'POOL' && portalOpen);
  const cls = r.status === 'SIGNED' ? 'signed' : r.status === 'POOL' ? 'pool' : (me && r.leader === me) ? 'lead' : (me && S.myBids?.has(r.id) && r.leader !== me && r.status === 'OPEN') ? 'outbid' : '';
  const canSelect = me && biddable;
  return `<article class="card rc-card ${cls} ${S.selected.has(r.id) ? 'sel' : ''}" data-card="${r.id}">
    ${canSelect ? `<input type="checkbox" class="rc-sel" ${S.selected.has(r.id) ? 'checked' : ''} data-rcc="select:${r.id}" aria-label="Select ${esc(r.name)}">` : ''}
    <div class="top"><span class="rc-stars-row s${r.stars}" title="${r.stars}-star recruit">${stars(r.stars)}</span><span class="rc-posbadge">${r.position}</span></div>
    <div class="who" data-rc="open:${r.id}" style="cursor:pointer"><div class="rc-avatar">${r.headshotUrl ? `<img src="${esc(r.headshotUrl)}" alt="">` : initials(r)}<span>#${r.posRank}</span></div>
      <div><div class="name">${esc(r.name)}</div><div class="meta"><span>Rank <b>#${r.rank}</b></span><span>${r.position} <b>#${r.posRank}</b></span><span>OVR <b>${Math.round(r.overallActual)}</b> / <b>${Math.round(r.overallPotential)}</b></span>${S.watch.has(r.id) ? '<span style="color:var(--gold)">★ target</span>' : ''}</div></div></div>
    ${attrsHTML(r)}
    ${r.status === 'SIGNED' ? `<div class="rc-signed-strip"><img src="${logo(r.signedTeam)}" alt=""><span>Signed · <b>${esc(T(r.signedTeam).name)}</b></span><span class="pts">${r.signedAmount} pts</span></div>`
    : `<div class="bidrow"><div class="cur">${r.currentBid ? `<img src="${logo(r.leader)}" alt=""><div><b>${r.currentBid}</b><small>${esc(T(r.leader).abbr)} leads</small></div>` : `<div><b class="nobid">—</b><small>No bids · min 1</small></div>`}</div>
        ${me && biddable ? `<button class="rc-btn ${r.leader === me ? 'dark' : 'primary'} sm" data-rc="bid:${r.id}">${r.leader === me ? 'Raise' : r.status === 'POOL' ? 'Sign from pool' : 'Place bid'}</button>` : `<button class="rc-btn sm" data-rc="open:${r.id}">Details</button>`}
        <div class="tl"><span>${statusTag(r)}</span>${r.status === 'OPEN' ? `<span class="t" data-closes="${r.closesAt}" data-rid="${r.id}">${countdown(r.closesAt).text}</span>` : ''}</div></div>`}
  </article>`;
}
function rowHTML(r) {
  const me = myTeam(); const cls = (me && r.leader === me) ? 'mine' : (me && S.myBids?.has(r.id) && r.leader !== me && r.status === 'OPEN') ? 'lost' : '';
  return `<tr class="${cls}" data-card="${r.id}">${me ? `<td>${r.status === 'OPEN' ? `<input type="checkbox" ${S.selected.has(r.id) ? 'checked' : ''} data-rcc="select:${r.id}">` : ''}</td>` : ''}<td>${r.rank}</td><td class="l nm" data-rc="open:${r.id}">${esc(r.name)}</td><td>${r.position}</td><td class="rc-stars-row s${r.stars}" style="letter-spacing:0">${r.stars}★</td>
    ${r.act.map((v, i) => `<td class="attr"><b class="${rcls(v)}">${v}</b><span>${r.pot[i]}</span></td>`).join('')}<td>${Math.round(r.overallActual)}</td><td>${Math.round(r.overallPotential)}</td>
    <td class="lead">${r.status === 'SIGNED' ? `<img src="${logo(r.signedTeam)}" alt=""><span class="rc-tag signed">Signed ${esc(T(r.signedTeam).abbr)}</span>` : r.leader ? `<img src="${logo(r.leader)}" alt="">${esc(T(r.leader).abbr)}` : '<span style="color:var(--muted-2)">—</span>'}</td>
    <td><b>${r.status === 'SIGNED' ? r.signedAmount : (r.currentBid || '—')}</b></td><td>${r.status === 'OPEN' ? `<span data-closes="${r.closesAt}" data-rid="${r.id}">${countdown(r.closesAt).text}</span>` : r.status}</td></tr>`;
}
function feedHTML() {
  if (!S.feed.length) return `<div class="rc-empty">No bids yet. The board is quiet…</div>`;
  return S.feed.map(e => `<div class="it ${e.type === 'BID_WON' ? 'won' : ''}"><img src="${logo(e.team)}" alt=""><div><div class="who">${esc(T(e.team).name)}</div><div class="what">${e.type === 'BID_WON' ? 'signed' : e.type === 'BID_WITHDRAWN' ? 'withdrew on' : 'bid on'} ${e.position} <a href="#" data-rc="open:${e.recruitId}" style="font-weight:600">${esc(e.name)}</a></div></div><div class="amt">${e.amount ?? ''}</div><div class="ts">${fmtTs(e.at)}</div></div>`).join('');
}
function bindBoard() {
  const tgl = $('.rc-filters-toggle'); if (tgl && window.innerWidth <= 860) tgl.style.display = 'inline-flex';
  $$('[data-rc-enter]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ACTIONS[i.dataset.rcEnter](); }));
}
function massHTML() {
  if (!myTeam() || !S.selected.size || S.view !== 'board') return '';
  const per = S.massPer || 1; const n = S.selected.size;
  return `<div class="rc-mass"><div class="n">${n}<small>players selected</small></div>
    <div class="rc-inline"><span style="font-size:12px;color:rgba(255,255,255,.7)">Bid per player</span><div class="rc-stepper"><button data-rc="massstep:-1">−</button><input type="number" min="1" value="${per}" data-rci="massper"><button data-rc="massstep:1">+</button></div>
    <div class="presets">${[1, 2, 5, 10].map(v => `<button data-rc="masspreset:${v}">${v} PT</button>`).join('')}</div></div>
    <div class="exposure">Max exposure <b>${n * per}</b> · Available <b>${S.me.points?.available ?? '—'}</b></div><span class="grow"></span>
    <button class="rc-btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.25)" data-rc="clearsel">Clear</button><button class="rc-btn gold" data-rc="massbid">Bid selected players</button></div>`;
}
function redrawMass() { const m = $('.rc-mass'); const html = massHTML(); if (m) { if (html) m.outerHTML = html; else m.remove(); } else if (html) $('#rc-root')?.insertAdjacentHTML('beforeend', html); }

/* ------------------------------------------------------------ player detail + bidding */
async function openPlayer(id) {
  const d = await api(`/recruits/${id}`); upsert(d.recruit); const r = d.recruit; const me = myTeam();
  const portalOpen = S.state.rounds.some(x => x.type === 'PORTAL' && x.status === 'ACTIVE');
  const canBid = me && (r.status === 'OPEN' || (r.status === 'POOL' && portalOpen)) && !S.state.season?.suspended;
  const hist = d.events.filter(e => ['BID_PLACED', 'BID_WON', 'BID_WITHDRAWN', 'BID_RAISED'].includes(e.type) || e.type === 'BID_PLACED');
  const html = `<div class="rc-mhead"><div class="rc-avatar">${r.headshotUrl ? `<img src="${esc(r.headshotUrl)}" alt="">` : initials(r)}</div><div><h3>${esc(r.name)}</h3><div class="m"><span class="rc-stars-row s${r.stars}">${stars(r.stars)}</span><span>${r.position}</span><span>Overall #${r.rank}</span><span>${r.position} #${r.posRank}</span><span>${esc(S.state.rounds.find(x => x.id === r.roundId)?.name || '')}</span></div></div>
      ${me ? `<button class="rc-btn sm ${S.watch.has(r.id) ? 'gold' : 'ghost'}" style="margin-left:auto;${S.watch.has(r.id) ? '' : 'color:#fff;border-color:rgba(255,255,255,.3)'}" data-rc="watch:${r.id}">${S.watch.has(r.id) ? '★ Target' : '☆ Target'}</button>` : ''}<button class="x" data-rc="close" aria-label="Close">×</button></div>
    <div class="rc-mbody"><div class="rc-mgrid"><div><h4>Ratings</h4>${attrsHTML(r, true)}<div class="rc-note" style="margin-top:8px">Overall ${r.overallActual} actual · ${r.overallPotential} potential · Recruit score ${r.score}</div>
        <h4>Bid history</h4>${hist.length ? `<table class="rc-hist">${d.events.filter(e => e.type !== 'BID_RAISED').map(e => `<tr class="${e.type === 'BID_OUTBID' ? 'out' : e.type === 'BID_WON' ? 'won' : ''}"><td>${fmtTs(e.at)}</td><td><img src="${logo(e.team)}" alt="">${esc(T(e.team).abbr)}</td><td>${e.type === 'BID_OUTBID' ? 'outbid' : e.type === 'BID_WON' ? 'SIGNED' : e.type === 'BID_WITHDRAWN' ? 'withdrawn' : 'bid'}</td><td>${e.amount ?? ''}</td></tr>`).join('')}</table>` : '<div class="rc-empty">No bids yet.</div>'}</div>
      <div><h4>Current recruitment</h4><div class="rc-curbid">${r.status === 'SIGNED' ? `<img src="${logo(r.signedTeam)}" alt=""><div><b>${r.signedAmount}</b><small>Signed · ${esc(T(r.signedTeam).name)} · ${fmtDate(r.signedAt)}</small></div>` : r.currentBid ? `<img src="${logo(r.leader)}" alt=""><div><b>${r.currentBid}</b><small>${esc(T(r.leader).name)} leads${r.leader === me ? ' (you)' : ''}</small></div>` : `<div><b>—</b><small>No bids · minimum 1</small></div>`}</div>
        ${r.status === 'OPEN' ? `<div class="rc-note" style="margin-top:8px">Signs in <b data-closes="${r.closesAt}" data-rid="${r.id}">${countdown(r.closesAt).text}</b> · ${fmtDate(r.closesAt)}${S.state.season?.rollingBids ? ' · every new lead restarts the clock' : ''}</div>` : r.status === 'POOL' ? `<div class="rc-note" style="margin-top:8px">Portal Pool — not bid on in its round. ${portalOpen ? `The first bid opens a ${S.state.season?.poolBidHours || 24}h signing clock.` : 'Becomes available when the Portal period opens.'}</div>` : `<div class="rc-note" style="margin-top:8px">Status: ${r.status}</div>`}
        ${canBid ? `<h4>Your bid</h4><div class="rc-bidform"><div><div class="rc-field"><input id="rc-bid-amt" type="number" min="${r.currentBid + 1}" value="${r.leader === me ? r.currentBid + 1 : r.currentBid + 1}" data-rc-enter="reviewbid"></div><div class="min">Minimum valid bid: <b>${r.currentBid + 1}</b> · Available: <b>${S.me.points?.available ?? 0}</b>${r.leader === me ? ` · You lead at ${r.currentBid}; only the increase is reserved` : ''}</div></div><button class="rc-btn primary" data-rc="reviewbid:${r.id}">Review bid</button></div>
          ${r.leader === me && S.state.season?.allowWithdrawal && d.myBid ? `<div style="margin-top:10px"><button class="rc-btn sm ghost" data-rc="withdraw:${d.myBid.id}">Withdraw bid</button></div>` : ''}` : (!me && r.status === 'OPEN' ? `<div style="margin-top:14px"><button class="rc-btn gold" data-rc="login">Sign in to bid</button></div>` : '')}
      </div></div></div>`;
  modal(html, 'lg');
  $$('[data-rc-enter]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ACTIONS.reviewbid(String(r.id)); }));
}
function reviewBid(id, amount) {
  const r = S.recruits.get(+id); const me = myTeam();
  const additional = r.leader === me ? amount - r.currentBid : amount;
  modal(`<div class="rc-mhead"><div><h3>Confirm bid</h3><div class="m"><span>${r.position} ${esc(r.name)}</span></div></div><button class="x" data-rc="close">×</button></div>
    <div class="rc-mbody"><div class="rc-confirm"><div class="big">${amount}</div><p>You are about to bid <b>${amount} recruiting points</b> on <b>${r.position} ${esc(r.name)}</b>.<br>If you become the leader, <b>${additional}</b> point${additional === 1 ? '' : 's'} will be reserved from your available balance (currently ${S.me.points?.available}).${isCommish() ? '<br><b style="color:var(--rc-amber)">Commissioner override — bidding as ' + esc(T(me).name) + '.</b>' : ''}</p></div>
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="open:${r.id}">Cancel</button><button class="rc-btn primary" id="rc-confirm" data-rc="confirmbid:${r.id}|${amount}|${r.currentBid}">Confirm ${amount} point bid</button></div></div>`, 'sm');
}
async function confirmBid(id, amount, expected) {
  const btn = $('#rc-confirm'); if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  const reqId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  try {
    const out = await api('/bids', { method: 'POST', body: { recruitId: id, amount, clientRequestId: reqId, expectedCurrentBid: expected } });
    S.me.points = out.points; upsert(out.recruit); S.myBids?.add(id);
    closeModal(); H.haptic(20); toast('✓ Bid accepted', `${T(myTeam()).abbr} now leads ${out.recruit.position} ${out.recruit.name} at ${amount} points.`, 'ok');
    refreshRecruit(id); drawHero();
  } catch (e) {
    if (e.code === 'CONCURRENT_BID_CHANGE' || e.code === 'BID_TOO_LOW') {
      const min = e.extra.minimumBid;
      modal(`<div class="rc-mhead"><div><h3>Bid changed</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p>${esc(e.message)}</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="reviewbid:${id}|${min}">Update bid to ${min}</button></div></div>`, 'sm');
    } else { closeModal(); toast('Bid rejected', e.message, 'err', 6000); }
    const fresh = await api(`/recruits/${id}`, { silent: true }); if (fresh) { upsert(fresh.recruit); refreshRecruit(id); }
  }
}
async function massBid() {
  const ids = [...S.selected]; const per = Math.max(1, Math.trunc(+S.massPer || 1));
  const items = ids.map(id => ({ recruitId: id, amount: per }));
  modal(`<div class="rc-mhead"><div><h3>Confirm mass bid</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-confirm"><div class="big">${ids.length} × ${per}</div><p>Submit <b>${per}-point</b> bids on <b>${ids.length} recruits</b>?<br>Maximum immediate exposure: <b>${ids.length * per}</b> points. Available: <b>${S.me.points?.available}</b>.<br>All-or-nothing: if any bid is invalid, none are placed.</p></div>
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" id="rc-confirm" data-rc="confirmmass">Confirm ${ids.length} bids</button></div></div>`, 'sm');
  S.pendingMass = items;
}
async function confirmMass(items) {
  const btn = $('#rc-confirm'); if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const out = await api('/bids/batch', { method: 'POST', body: { items, clientRequestId: crypto.randomUUID?.() } });
    S.me.points = out.points; out.recruits.forEach(r => { upsert(r); S.myBids?.add(r.id); }); S.selected.clear();
    closeModal(); H.haptic(25); toast('✓ Mass bid accepted', `${out.count} bids placed. ${out.points.reserved} points reserved.`, 'ok'); draw();
  } catch (e) {
    if (e.code === 'MASS_BID_REJECTED') {
      const f = e.extra.failures || []; const bad = new Set(f.map(x => x.recruitId)); const valid = items.filter(i => !bad.has(i.recruitId));
      modal(`<div class="rc-mhead"><div><h3>Mass bid not submitted</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p><b>${e.extra.valid} valid · ${e.extra.invalid} invalid</b> — nothing was placed.</p><ul class="rc-list card">${f.map(x => `<li><span class="nm">${esc(x.name)}</span><span style="color:var(--red)">${esc(x.message)}</span></li>`).join('')}</ul>
        <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button>${valid.length ? `<button class="rc-btn primary" id="rc-confirm" data-rc="confirmmassvalid">Submit ${valid.length} valid bids</button>` : ''}</div></div>`);
      S.pendingMass = valid;
    } else { closeModal(); toast('Mass bid rejected', e.message, 'err', 6000); }
  }
}
function celebrate(d) {
  const r = d.recruit, mine = d.team === myTeam();
  const ov = document.createElement('div'); ov.className = 'rc-sign';
  ov.innerHTML = `<div class="box"><div class="k">PCFL Recruitment</div><div class="stars">${stars(r.stars)}</div><div class="who">${esc(r.name)}</div><div class="pos">${r.position}</div><div class="with">has signed with</div><img src="${logo(d.team, true)}" onerror="this.src='${logo(d.team)}'" alt=""><div class="team">${esc(T(d.team).name)} ${esc(T(d.team).nickname)}</div><div class="pts">${d.amount} points</div>${mine ? `<div class="mine">Welcome to ${esc(T(d.team).name)}!</div><div style="margin-top:16px;display:flex;gap:8px;justify-content:center"><button class="rc-btn gold" data-rc="open:${r.id}">View player</button><a class="rc-btn ghost" style="color:#fff;border-color:rgba(255,255,255,.3)" href="#/recruiting/ledger">View ledger</a></div>` : ''}</div>`;
  ov.addEventListener('click', e => { if (!e.target.closest('button,a')) ov.remove(); });
  document.body.appendChild(ov); if (mine) H.haptic(40);
  setTimeout(() => ov.remove(), mine ? 9000 : 4500);
}

/* ------------------------------------------------------------ ledger / signed / rankings */
async function ledgerHTML() {
  if (!myTeam()) return loginHTML('Sign in to view your recruitment ledger.');
  const L = await api('/teams/me/ledger'); S.ledger = L; S.myBids = new Set(L.bids.map(b => b.recruitId)); const p = L.points; const team = T(L.team);
  const li = (b, cls) => `<li><img src="${logo(L.team)}" alt=""><span class="pos">${b.position}</span><span class="nm" data-rc="open:${b.recruitId}">${esc(b.name)}</span>${cls === 'out' ? `<span class="rc-tag outbid">Outbid · ${esc(T(b.leader).abbr)} at ${b.currentBid}</span>` : `<span class="rc-tag lead">Leading</span>`}<span class="amt">${cls === 'out' ? b.currentBid : b.amount}</span>${cls === 'out' && b.recruitStatus === 'OPEN' ? `<button class="rc-btn sm primary" data-rc="bid:${b.recruitId}">Re-bid</button>` : ''}</li>`;
  const roster = await loadRoster(L.team); S.rosterGroups = rosterGroups(roster, L.signed);
  return `<div class="rc-summary"><div class="card"><b>${p.allocated}</b><span>Starting</span></div><div class="card"><b>${p.adjustments >= 0 ? '+' : ''}${p.adjustments}</b><span>Adjustments</span></div><div class="card"><b>${p.spent}</b><span>Spent</span></div><div class="card"><b>${p.reserved}</b><span>Reserved</span></div><div class="card avail"><b>${p.available}</b><span>Available</span></div></div>
    <div class="rc-sections">${roster.players.length ? rosterDashboardHTML(S.rosterGroups, roster) : `<div class="card wide rc-empty">Roster data for ${esc(T(L.team).name)} isn't available on the site yet.</div>`}
      <div class="card"><div class="rc-livehd">Leading bids <span class="cnt" style="margin-left:auto;font-size:11px;color:var(--muted)">${L.leading.length}</span></div>${L.leading.length ? `<ul class="rc-list">${L.leading.map(b => li(b, 'lead')).join('')}</ul>` : '<div class="rc-empty">You are not leading any recruits.</div>'}</div>
      <div class="card"><div class="rc-livehd">Outbid</div>${L.outbid.length ? `<ul class="rc-list">${L.outbid.map(b => li(b, 'out')).join('')}</ul>` : '<div class="rc-empty">Nobody has outbid you.</div>'}</div>
      <div class="card"><div class="rc-livehd">Signed recruits · ${esc(team.name)}</div>${L.signed.length ? `<ul class="rc-list">${L.signed.map(r => `<li><span class="rc-stars-row s${r.stars}" style="font-size:11px">${stars(r.stars)}</span><span class="pos">${r.position}</span><span class="nm" data-rc="open:${r.id}">${esc(r.name)}</span><span class="rc-tag signed">PCFL recruit ${S.state.season?.year}</span><span class="amt">${r.price}</span></li>`).join('')}</ul>` : '<div class="rc-empty">No signings yet this season.</div>'}</div>
      <div class="card"><div class="rc-livehd">Roster · recruits by eligibility</div>${L.roster.length ? `<ul class="rc-list">${L.roster.map(r => `<li><span class="pos">${r.position}</span><span class="nm" data-rc="open:${r.recruitId}">${esc(r.name)}</span><span class="rc-tag">Season ${r.eligibilitySeason}</span><span class="rc-tag ${r.status === 'ACTIVE' ? 'lead' : ''}">${r.status}</span></li>`).join('')}</ul>` : '<div class="rc-empty">Signed recruits appear here at Season 0 and graduate after Season 5.</div>'}</div>
      <div class="card wide"><div class="rc-livehd">Bid history</div>${L.bids.length ? `<div class="rc-tablewrap"><table class="rc-ledger"><thead><tr><th>Time</th><th>Player</th><th>Pos</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>${L.bids.map(b => `<tr><td>${fmtTs(b.at)} <span style="color:var(--muted-2)">${fmtDate(b.at).split(',')[0]}</span></td><td class="nm" data-rc="open:${b.recruitId}" style="cursor:pointer;font-weight:600">${esc(b.name)}</td><td>${b.position}</td><td class="n"><b>${b.amount}</b></td><td><span class="rc-type ${b.status === 'ACTIVE' ? 'BID_RESERVED' : b.status === 'WON' ? 'PLAYER_SIGNED' : ''}">${b.status === 'ACTIVE' ? 'LEADING' : b.status}</span>${b.impersonated ? ' <span class="rc-tag hot">commissioner</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="rc-empty">No bids submitted yet.</div>'}</div>
      <div class="card wide"><div class="rc-livehd">Points ledger</div><div class="rc-tablewrap"><table class="rc-ledger"><thead><tr><th>Time</th><th>Transaction</th><th>Player</th><th class="n">Amount</th><th class="n">Available after</th><th>Note</th></tr></thead><tbody>${L.ledger.map(l => `<tr><td>${fmtTs(l.at)} <span style="color:var(--muted-2)">${fmtDate(l.at).split(',')[0]}</span></td><td><span class="rc-type ${l.type}">${l.type.replace(/_/g, ' ')}</span></td><td>${l.name ? `${l.position} ${esc(l.name)}` : ''}</td><td class="n ${l.type === 'PLAYER_SIGNED' ? 'neg' : (l.type.startsWith('BID_RESERV') ? 'neg' : 'pos')}">${l.type === 'PLAYER_SIGNED' || l.type.startsWith('BID_RESERV') ? '−' : (l.amount < 0 ? '+' : '+')}${Math.abs(l.amount)}</td><td class="n"><b>${l.balanceAfter}</b></td><td style="color:var(--muted)">${esc(l.reason || '')}</td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
}
async function signedHTML() {
  const all = [...S.recruits.values()].filter(r => r.status === 'SIGNED').sort((a, b) => Date.parse(b.signedAt) - Date.parse(a.signedAt));
  const byTeam = {}; for (const r of all) (byTeam[r.signedTeam] ||= []).push(r);
  const spend = Object.entries(byTeam).map(([t, rs]) => ({ t, n: rs.length, pts: rs.reduce((s, r) => s + r.signedAmount, 0), avgStar: rs.reduce((s, r) => s + r.stars, 0) / rs.length })).sort((a, b) => b.pts - a.pts);
  return `<div class="rc-sections"><div class="card wide"><div class="rc-livehd">Signings · ${esc(S.state.season?.name || '')}<span style="margin-left:auto;color:var(--muted);font-size:11px">${all.length} signed</span></div>${all.length ? `<div class="rc-tablewrap"><table class="rc-ledger"><thead><tr><th>Signed</th><th>Player</th><th>Pos</th><th>★</th><th>Team</th><th class="n">Price</th><th class="n">Rank</th></tr></thead><tbody>${all.map(r => `<tr><td>${fmtDate(r.signedAt)}</td><td class="nm" data-rc="open:${r.id}" style="cursor:pointer;font-weight:600">${esc(r.name)}</td><td>${r.position}</td><td class="rc-stars-row s${r.stars}" style="letter-spacing:0">${r.stars}★</td><td><img src="${logo(r.signedTeam)}" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:6px" alt="">${esc(T(r.signedTeam).name)}</td><td class="n"><b>${r.signedAmount}</b></td><td class="n">#${r.rank}</td></tr>`).join('')}</tbody></table></div>` : '<div class="rc-empty">No recruits have signed yet. Signings happen automatically when each player\'s 24-hour clock expires.</div>'}</div>
    <div class="card wide"><div class="rc-livehd">Recruiting classes · points spent</div>${spend.length ? `<div class="rc-tablewrap"><table class="rc-ledger"><thead><tr><th>Team</th><th class="n">Signed</th><th class="n">Points</th><th class="n">Avg ★</th></tr></thead><tbody>${spend.map(s => `<tr><td><img src="${logo(s.t)}" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:6px" alt="">${esc(T(s.t).name)}</td><td class="n">${s.n}</td><td class="n"><b>${s.pts}</b></td><td class="n">${s.avgStar.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="rc-empty">—</div>'}</div></div>`;
}
/* ---- team ranking formula (private, per coach) ---- */
const defaultFormula = () => ({ name: 'My formula', actualWeight: 0.4, potentialWeight: 0.6, weights: Object.fromEntries(ATTRS.map(a => [a, 1])), positionWeights: {}, starBonus: 0, minPotential: 0, positions: [] });
const FORMULA_PRESETS = {
  'Speed & burst': { weights: { SP: 3, AC: 3, AG: 2, ST: .5, HA: 1, EN: 1, IN: .5, DI: .5 }, actualWeight: .3, potentialWeight: .7 },
  'Trench power': { weights: { SP: .5, AC: 1, AG: 1, ST: 3, HA: .5, EN: 2, IN: 1, DI: 1.5 }, actualWeight: .5, potentialWeight: .5 },
  'Playmakers': { weights: { SP: 2, AC: 2, AG: 2, ST: 1, HA: 3, EN: 1, IN: 1, DI: 1 }, actualWeight: .35, potentialWeight: .65 },
  'Win now': { weights: Object.fromEntries(ATTRS.map(a => [a, 1])), actualWeight: .8, potentialWeight: .2 },
  'Ceiling': { weights: Object.fromEntries(ATTRS.map(a => [a, 1])), actualWeight: .1, potentialWeight: .9, starBonus: 2 },
};
function formulaScore(r, f) {
  const w = f.positionWeights?.[r.position] || f.weights; let a = 0, p = 0, ws = 0;
  ATTRS.forEach((k, i) => { const wt = Number(w[k] ?? f.weights[k] ?? 1); a += r.act[i] * wt; p += r.pot[i] * wt; ws += wt; });
  if (!ws) return 0;
  return +((f.actualWeight * a / ws) + (f.potentialWeight * p / ws) + (f.starBonus || 0) * (r.stars - 3)).toFixed(2);
}
function rankedByFormula(f) {
  let list = [...S.recruits.values()];
  if (f.positions?.length) list = list.filter(r => f.positions.includes(r.position));
  if (f.minPotential) list = list.filter(r => r.overallPotential >= f.minPotential);
  list = list.map(r => ({ r, s: formulaScore(r, f) })).sort((a, b) => b.s - a.s || a.r.rank - b.r.rank);
  const posN = {}; return list.map((x, i) => { posN[x.r.position] = (posN[x.r.position] || 0) + 1; return { ...x, rank: i + 1, posRank: posN[x.r.position] }; });
}
async function rankingsHTML() {
  const pos = S.rankPos || 'ALL'; const me = myTeam();
  if (me && S.formula === undefined) { const f = await api('/teams/me/ranking-formula', { silent: true }); S.formula = f?.formula || null; if (S.formula && S.useMyFormula == null) S.useMyFormula = true; }
  const mine = me && S.useMyFormula && S.formula;
  const rows = mine ? rankedByFormula(S.formula).filter(x => pos === 'ALL' || x.r.position === pos) : [...S.recruits.values()].filter(r => pos === 'ALL' || r.position === pos).sort((a, b) => a.rank - b.rank).map(r => ({ r, s: r.score, rank: r.rank, posRank: r.posRank }));
  const vis = S.state.season?.visibility === 'current' && !isCommish() ? `<span class="rc-note">Showing rounds that have opened; more players appear as rounds complete.</span>` : '';
  return `<div class="rc-toolbar"><div class="rc-pos"><button class="${pos === 'ALL' ? 'on' : ''}" data-rc="rankpos:ALL">ALL</button>${POS_ORDER.filter(p => [...S.recruits.values()].some(r => r.position === p)).map(p => `<button class="${pos === p ? 'on' : ''}" data-rc="rankpos:${p}">${p}</button>`).join('')}</div><span class="grow"></span>
    ${me ? `<div class="rc-ftoggle"><button class="${!mine ? 'on' : ''}" data-rc="useformula:league">League formula</button><button class="${mine ? 'on' : ''}" data-rc="useformula:mine" ${S.formula ? '' : 'title="Build a formula first"'}>${S.formula ? esc(S.formula.name) : 'My formula'}</button></div><button class="rc-btn sm dark" data-rc="formula">${S.formula ? 'Edit formula' : 'Build my formula'}</button>` : `<span class="rc-note">Sign in to build your own ranking formula.</span>`}</div>
    <div class="rc-note" style="margin:-6px 0 10px">${mine ? `<b>${esc(S.formula.name)}</b> · ${Math.round(S.formula.actualWeight * 100)}% actual / ${Math.round(S.formula.potentialWeight * 100)}% potential${S.formula.positions?.length ? ' · ' + S.formula.positions.join(', ') : ''}${S.formula.minPotential ? ` · potential ≥ ${S.formula.minPotential}` : ''} — private to your franchise.` : 'League formula: 40% actual + 60% potential, equal attribute weights (set by the commissioner).'} ${vis}</div>
    <div class="card rc-tablewrap"><table class="rc-rank"><thead><tr><th>#</th><th>Pos #</th><th class="l">Player</th><th>Pos</th><th>★</th>${ATTRS.map(a => `<th title="${ATTR_NAMES[a]}${mine ? ` · weight ${S.formula.weights[a]}` : ''}">${a}</th>`).join('')}<th>OVR</th><th>POT</th><th>Score</th><th class="l">Status</th></tr></thead><tbody>${rows.map(({ r, s, rank, posRank }) => `<tr><td class="rk">${rank}</td><td>${posRank}</td><td class="l nm" data-rc="open:${r.id}" style="cursor:pointer;font-weight:600">${esc(r.name)}</td><td>${r.position}</td><td class="rc-stars-row s${r.stars}" style="letter-spacing:0">${r.stars}★</td>${r.act.map((v, i) => `<td class="attr" style="text-align:center;line-height:1.15"><b class="${rcls(v)}" style="display:block">${v}</b><span style="display:block;font-size:10px;color:var(--muted-2)">${r.pot[i]}</span></td>`).join('')}<td>${Math.round(r.overallActual)}</td><td>${Math.round(r.overallPotential)}</td><td><b>${s}</b></td><td class="l">${r.status === 'SIGNED' ? `<span class="rc-tag signed">${esc(T(r.signedTeam).abbr)} · ${r.signedAmount}</span>` : r.currentBid ? `${esc(T(r.leader).abbr)} ${r.currentBid}` : `<span class="rc-status ${r.status}">${r.status}</span>`}</td></tr>`).join('') || `<tr><td colspan="17" class="rc-empty">No players match this formula's filters.</td></tr>`}</tbody></table></div>`;
}
function formulaBuilder() {
  const f = S.formulaDraft = S.formulaDraft || JSON.parse(JSON.stringify(S.formula || defaultFormula()));
  const preview = rankedByFormula(f).slice(0, 12);
  modal(`<div class="rc-mhead"><div><h3>My ranking formula</h3><div class="m"><span>Private to ${esc(T(myTeam()).name)} — weights, balance and filters are yours alone</span></div></div><button class="x" data-rc="close">×</button></div>
    <div class="rc-mbody"><div class="rc-formula"><div>
      <div class="presets">${Object.keys(FORMULA_PRESETS).map(k => `<button class="rc-chip" data-rc="fpreset:${esc(k)}">${esc(k)}</button>`).join('')}<button class="rc-chip" data-rc="fpreset:reset">Reset</button></div>
      <div class="rc-form" style="margin-bottom:10px"><div class="full"><label>Formula name</label><input id="rc-f-name" value="${esc(f.name)}" maxlength="40"></div></div>
      <div class="balance"><span>Actual <b id="rc-f-aw">${Math.round(f.actualWeight * 100)}%</b></span><input type="range" min="0" max="100" value="${Math.round(f.potentialWeight * 100)}" data-rci="fbalance"><span>Potential <b id="rc-f-pw">${Math.round(f.potentialWeight * 100)}%</b></span></div>
      <h4>Attribute weights</h4>${ATTRS.map(a => `<div class="wrow"><label title="${ATTR_NAMES[a]}">${a}</label><input type="range" min="0" max="5" step="0.5" value="${f.weights[a]}" data-rci="fweight:${a}"><output id="rc-fw-${a}">${f.weights[a]}</output></div>`).join('')}
      <h4>Filters</h4><div class="rc-form"><div><label>Star bonus (per ★ above 3)</label><input type="number" min="0" max="20" step="0.5" value="${f.starBonus || 0}" data-rci="fstar"></div><div><label>Minimum potential OVR</label><input type="number" min="0" max="100" value="${f.minPotential || 0}" data-rci="fminpot"></div><div class="full"><label>Positions (blank = all)</label><div class="rc-pos">${POS_ORDER.map(p => `<button class="rc-chip ${f.positions?.includes(p) ? 'on' : ''}" data-rc="fpos:${p}">${p}</button>`).join('')}</div></div></div>
    </div><div><h4>Live preview · top 12</h4><div class="preview card" id="rc-f-preview"><table>${preview.map(x => `<tr><td>${x.rank}</td><td>${x.r.position}</td><td>${esc(x.r.name)}</td><td>${x.r.stars}★</td><td>${x.s}</td></tr>`).join('')}</table></div>
      <p class="rc-note" style="margin-top:10px">Score = actual% × weighted actual mean + potential% × weighted potential mean + star bonus. Weights apply to all positions; use the presets as starting points.</p></div></div>
    <div class="rc-mactions">${S.formula ? '<button class="rc-btn ghost left" style="color:var(--red)" data-rc="fdelete">Delete formula</button>' : ''}<button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="fsave">Save &amp; use</button></div></div>`, 'lg');
}
function refreshFormulaPreview() { const f = S.formulaDraft; const el = $('#rc-f-preview'); if (!el) return; el.innerHTML = `<table>${rankedByFormula(f).slice(0, 12).map(x => `<tr><td>${x.rank}</td><td>${x.r.position}</td><td>${esc(x.r.name)}</td><td>${x.r.stars}★</td><td>${x.s}</td></tr>`).join('') || '<tr><td class="rc-empty">No players match.</td></tr>'}</table>`; }

/* ---- roster dashboard (ledger view) ---- */
const IDEAL_DEPTH = { QB: 3, HB: 4, FB: 2, WR: 6, TE: 3, C: 2, G: 4, T: 4, DE: 4, DT: 4, LB: 6, CB: 5, S: 4, FS: 2, SS: 2, K: 1, P: 1 };
async function loadRoster(team) {
  if (S.rosterCache?.team === team) return S.rosterCache.data;
  const seasons = H.App.manifest?.seasons || []; const yr = H.App.season || seasons[seasons.length - 1]?.year;
  try { const res = await fetch(`data/${yr}/rosters.json`, { cache: 'no-cache' }); const all = await res.json(); const list = Array.isArray(all[team]) ? all[team] : (all[team]?.players || []); S.rosterCache = { team, data: { year: yr, players: list } }; return S.rosterCache.data; }
  catch (e) { reportClientError(e, 'roster-load'); return { year: yr, players: [] }; }
}
function rosterGroups(roster, signedMine) {
  const groups = {}; const norm = p => (p === 'FS' || p === 'SS') ? 'S' : p;
  for (const p of roster.players) { const pos = norm(p.pos); const g = groups[pos] ||= { pos, players: [], seniors: 0, injured: 0, inactive: 0 }; g.players.push(p); if (String(p.yr) === '4') g.seniors++; if (p.status === 'IR' || p.status === 'I' || (p.inj && p.inj !== 'OK')) g.injured++; if (p.status === 'O') g.inactive++; }
  for (const r of signedMine) { const pos = norm(r.position); (groups[pos] ||= { pos, players: [], seniors: 0, injured: 0, inactive: 0 }).signed = ((groups[pos].signed) || 0) + 1; }
  const avail = [...S.recruits.values()].filter(r => ['OPEN', 'POOL', 'UPCOMING', 'PAUSED'].includes(r.status));
  return Object.values(groups).map(g => {
    const count = g.players.length, signed = g.signed || 0, ideal = IDEAL_DEPTH[g.pos] || 3;
    const avgOvr = count ? +(g.players.reduce((s, p) => s + (p.ovr || 0), 0) / count).toFixed(1) : 0;
    const avgPot = count ? +(g.players.reduce((s, p) => s + ((p.p || []).reduce((a, b) => a + b, 0) / 8 || 0), 0) / count).toFixed(1) : 0;
    const projected = count - g.seniors + signed;
    const top = avail.filter(r => norm(r.position) === g.pos).sort((a, b) => b.overallPotential - a.overallPotential).slice(0, 3).map(r => ({ name: r.name, stars: r.stars, pot: Math.round(r.overallPotential), bid: r.currentBid || 0 }));
    const need = Math.max(0, ideal - projected) * 3 + (count ? g.seniors / count : 1) * 4 + Math.max(0, 78 - avgPot) / 4 + (projected === 0 ? 6 : 0);
    return { pos: g.pos, count, seniors: g.seniors, injured: g.injured, inactive: g.inactive, signed, projected, ideal, avgOvr, avgPot, topRecruitsAvailable: top, need: +need.toFixed(1) };
  }).sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos));
}
function rosterDashboardHTML(groups, roster) {
  const totals = { count: groups.reduce((s, g) => s + g.count, 0), seniors: groups.reduce((s, g) => s + g.seniors, 0), injured: groups.reduce((s, g) => s + g.injured, 0), signed: groups.reduce((s, g) => s + g.signed, 0) };
  const needs = [...groups].sort((a, b) => b.need - a.need).slice(0, 3);
  const bar = g => { const pct = Math.min(100, Math.round(g.projected / g.ideal * 100)); return `<span class="rc-depthbar"><i class="${pct < 60 ? 'bad' : pct < 100 ? 'warn' : ''}" style="width:${pct}%"></i></span>`; };
  return `<div class="card wide rc-rosterdash"><div class="rc-livehd">Roster disposition · ${esc(T(myTeam()).name)} · ${roster.year} season<span style="margin-left:auto;font-size:11px;color:var(--muted)">${totals.count} players · ${totals.seniors} seniors graduating · ${totals.signed} recruits signed</span></div>
    <div class="rc-attrition"><div><b>${totals.count}</b><span>On roster</span></div><div><b style="color:var(--red)">−${totals.seniors}</b><span>Attrition (Sr)</span></div><div><b style="color:var(--rc-green)">+${totals.signed}</b><span>Signed ${S.state.season?.year || ''}</span></div><div><b>${totals.count - totals.seniors + totals.signed}</b><span>Projected</span></div><div><b>${totals.injured}</b><span>Injured</span></div><div><b style="color:var(--red)">${needs.map(n => n.pos).join(' · ') || '—'}</b><span>Biggest needs</span></div></div>
    <div class="rc-roster-grid" style="padding:0 14px 14px">
      <div class="card"><div class="rc-charttabs"><button class="rc-chip ${(S.chartMode || 'depth') === 'depth' ? 'on' : ''}" data-rc="chart:depth">Depth vs ideal</button><button class="rc-chip ${S.chartMode === 'attrition' ? 'on' : ''}" data-rc="chart:attrition">Now → projected</button><button class="rc-chip ${S.chartMode === 'quality' ? 'on' : ''}" data-rc="chart:quality">Rating quality</button><button class="rc-chip ${S.chartMode === 'radar' ? 'on' : ''}" data-rc="chart:radar">Unit radar</button><span class="spacer"></span><span class="rc-note">Hover bars for detail · click legend to toggle</span></div><div class="rc-chartwrap"><canvas id="rc-chart" aria-label="Roster chart" role="img"></canvas></div></div>
      <div class="card"><div class="rc-livehd">Recruiting insight<span style="margin-left:auto"><button class="rc-btn sm gold" data-rc="insight">${S.insight ? 'Refresh insight' : 'Generate insight'}</button></span></div>${S.insight ? `<div class="rc-insight"><span class="src">${S.insight.source === 'anthropic' ? 'AI analyst · PCFL Network' : 'Roster analysis'}${S.insight.cached ? ' · cached' : ''}</span>${esc(S.insight.text)}</div>` : `<div class="rc-empty">Summarizes which position groups to target this cycle, based on depth, attrition, ratings and who is still on the board.</div>`}</div>
    </div>
    <div class="rc-tablewrap" style="padding:0 14px 14px"><table class="rc-posgroups"><thead><tr><th class="l">Group</th><th>Roster</th><th>Sr</th><th>Inj</th><th>Signed</th><th>Projected</th><th class="l">Depth vs ideal</th><th>Avg OVR</th><th>Avg POT</th><th class="l">Best available</th></tr></thead><tbody>${groups.map(g => `<tr class="${needs.includes(g) ? 'need' : ''} ${g.projected < g.ideal * .6 ? 'thin' : ''}"><td class="l"><span class="pos">${g.pos}</span></td><td>${g.count}</td><td>${g.seniors ? `<b style="color:var(--red)">${g.seniors}</b>` : '0'}</td><td>${g.injured}</td><td>${g.signed ? `<b style="color:var(--rc-green)">+${g.signed}</b>` : '0'}</td><td class="proj"><b>${g.projected}</b> / ${g.ideal}</td><td class="l">${bar(g)}</td><td>${g.avgOvr}</td><td>${g.avgPot}</td><td class="l">${g.topRecruitsAvailable.map(r => `${esc(r.name)} <span class="rc-note">${r.stars}★ ${r.pot}${r.bid ? ` · bid ${r.bid}` : ''}</span>`).join('<br>') || '<span class="rc-note">none on board</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
let chartLib = null;
async function ensureChart() { if (window.Chart) return window.Chart; if (!chartLib) chartLib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; s.onload = () => res(window.Chart); s.onerror = () => rej(new Error('Chart library failed to load')); document.head.appendChild(s); }); return chartLib; }
async function mountRosterCharts() {
  const canvas = $('#rc-chart'); if (!canvas || !S.rosterGroups) return;
  try {
    const Chart = await ensureChart(); if (S.chart) { S.chart.destroy(); S.chart = null; }
    const g = S.rosterGroups, labels = g.map(x => x.pos), mode = S.chartMode || 'depth';
    const css = getComputedStyle(document.documentElement); const red = css.getPropertyValue('--red').trim() || '#d6001c', gold = css.getPropertyValue('--gold').trim() || '#f1be48', ink = '#15181d', green = '#0a8f3c', muted = '#99a0aa';
    const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 500 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: {} } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f0f2f4' } } } };
    let cfg;
    if (mode === 'depth') cfg = { type: 'bar', data: { labels, datasets: [{ label: 'Projected depth', data: g.map(x => x.projected), backgroundColor: g.map(x => x.projected < x.ideal * .6 ? red : x.projected < x.ideal ? gold : ink), borderRadius: 4 }, { label: 'Ideal', data: g.map(x => x.ideal), type: 'line', borderColor: muted, borderDash: [4, 4], pointRadius: 2, tension: 0 }] }, options: base };
    else if (mode === 'attrition') cfg = { type: 'bar', data: { labels, datasets: [{ label: 'Roster now', data: g.map(x => x.count), backgroundColor: ink, borderRadius: 4 }, { label: 'Seniors leaving', data: g.map(x => -x.seniors), backgroundColor: red, borderRadius: 4 }, { label: 'Recruits signed', data: g.map(x => x.signed), backgroundColor: green, borderRadius: 4 }, { label: 'Projected', data: g.map(x => x.projected), type: 'line', borderColor: gold, pointBackgroundColor: gold, tension: .3 }] }, options: { ...base, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: '#f0f2f4' } } } } };
    else if (mode === 'quality') cfg = { type: 'bar', data: { labels, datasets: [{ label: 'Avg actual OVR', data: g.map(x => x.avgOvr), backgroundColor: ink, borderRadius: 4 }, { label: 'Avg potential', data: g.map(x => x.avgPot), backgroundColor: gold, borderRadius: 4 }] }, options: { ...base, scales: { x: { grid: { display: false } }, y: { min: 50, max: 100, grid: { color: '#f0f2f4' } } } } };
    else cfg = { type: 'radar', data: { labels, datasets: [{ label: 'Depth (% of ideal)', data: g.map(x => Math.min(150, Math.round(x.projected / x.ideal * 100))), borderColor: red, backgroundColor: 'rgba(214,0,28,.15)', pointBackgroundColor: red }, { label: 'Avg potential', data: g.map(x => x.avgPot), borderColor: gold, backgroundColor: 'rgba(241,190,72,.15)', pointBackgroundColor: gold }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { r: { beginAtZero: true, suggestedMax: 120, ticks: { display: false } } } } };
    S.chart = new Chart(canvas.getContext('2d'), cfg);
  } catch (e) { reportClientError(e, 'chart'); const w = $('.rc-chartwrap'); if (w) w.innerHTML = `<div class="rc-empty">Chart unavailable (${esc(e.message)}). The table below has the same data.</div>`; }
}

/* ------------------------------------------------------------ admin */
async function adminHTML() {
  const A = await api('/admin/overview'); S.adminData = A; const s = A.season, k = A.kpis;
  if (!s) return `<div class="card rc-login reveal in"><h3>Create a recruiting season</h3><div class="hint">No recruiting season exists yet. Creating one seeds every franchise's point account and five rounds (5★ → 1★).</div><div class="rc-form"><div><label>Season year</label><input id="rc-s-year" type="number" value="${new Date().getFullYear() + 1}"></div><div><label>Points per team</label><input id="rc-s-alloc" type="number" value="500"></div><div><label>Recruit window (hours)</label><input id="rc-s-hours" type="number" value="24" step="0.5"></div></div><div class="actions"><button class="rc-btn primary" data-rc="createseason">Create season</button></div></div>`;
  const cr = A.kpis.currentRound; const next = A.rounds.find(r => ['DRAFT', 'SCHEDULED'].includes(r.status));
  const roundN = id => (k.byRound.find(b => b.round_id === id)?.n || 0);
  return `<div class="rc-kpis"><div class="card"><b>${cr ? 'R' + cr.number : '—'}</b><span>Current round${cr ? ' · ' + cr.status : ''}</span></div><div class="card"><b>${k.recruitsOpen}</b><span>Recruits open</span></div><div class="card"><b>${k.activeBids}</b><span>Leading bids</span></div><div class="card"><b>${k.teamsActive}</b><span>Teams active</span></div><div class="card"><b>${k.pointsCommitted}</b><span>Points committed</span></div><div class="card"><b ${k.nextClose ? `data-closes="${k.nextClose}" data-rid="0"` : ''}>${k.nextClose ? countdown(k.nextClose).text : '—'}</b><span>Next closure</span></div></div>
  <div class="rc-admin-actions">
    ${cr?.status === 'ACTIVE' ? `<button class="rc-btn dark" data-rc="pause">⏸ Pause recruitment</button>` : cr?.status === 'PAUSED' ? `<button class="rc-btn primary" data-rc="resume">▶ Resume recruitment</button>` : ''}
    ${next && !(cr && ['ACTIVE', 'PAUSED'].includes(cr.status)) ? `<button class="rc-btn primary" data-rc="startround:${next.id}">▶ Start ${esc(next.name.split('—')[0].trim())} (${roundN(next.id)} players)</button>` : ''}
    ${A.suspended ? `<button class="rc-btn gold" data-rc="unsuspend">Lift bidding suspension</button>` : `<button class="rc-btn" data-rc="suspend">⚠ Suspend all bidding</button>`}
    <button class="rc-btn" data-rc="import">⇪ Import recruits</button><button class="rc-btn" data-rc="addrecruit">+ Add recruit</button><button class="rc-btn" data-rc="provision">🔑 Team logins</button><button class="rc-btn" data-rc="audit">Audit log</button><button class="rc-btn" data-rc="health">System health</button>
    <button class="rc-btn ghost sm" data-rc="settings">Settings</button></div>
  <div class="rc-admin-grid">
    <div class="card"><div class="rc-livehd">Rounds · ${esc(s.name)}<span style="margin-left:auto;font-size:11px;color:var(--muted)">${k.total} recruits · ${k.signed} signed · ${k.unsigned} unsigned</span><button class="rc-btn sm ghost" style="margin-left:8px" data-rc="editround:new">+ Round</button></div><ul class="rc-list rc-rounds">${A.rounds.map(r => `<li><div><b>${esc(r.name)}</b> ${r.type === 'PORTAL' ? '<span class="rc-tag pool">Portal</span>' : ''}<div class="rc-note">${roundN(r.id)} players${r.startedAt ? ` · started ${fmtDate(r.startedAt)}` : ''}${r.pauseTotalMs ? ` · paused ${Math.round(r.pauseTotalMs / 60000)}m` : ''}<br><code>${r.startMode === 'auto' ? (r.startAfterHours != null ? `auto ${r.startAfterHours}h after prev` : 'auto on prev complete') : 'manual start'}</code> <code>${r.closeMode === 'after-hours' ? `closes after ${r.closeAfterHours}h` : 'closes when all resolved'}</code> <code>${(r.rolling ?? (s.rollingBids ? 1 : 0)) ? 'rolling' : 'fixed'} ${r.windowHours || s.windowHours}h</code>${r.unbidToPool ? ' <code>unbid → pool</code>' : ''}</div></div><span class="rc-status ${r.status}">${r.status}</span><span class="acts">${['DRAFT', 'SCHEDULED'].includes(r.status) ? `<button class="rc-btn sm primary" data-rc="startround:${r.id}">Start</button>` : ''}${['ACTIVE', 'PAUSED'].includes(r.status) ? `<button class="rc-btn sm" data-rc="closeround:${r.id}">Force close</button>` : ''}<button class="rc-btn sm ghost" data-rc="editround:${r.id}">Settings</button></span></li>`).join('')}</ul></div>
    <div class="card"><div class="rc-livehd">League pulse</div><ul class="rc-list">${(A.insights?.mostContested || []).slice(0, 5).map(r => `<li><span class="pos">${r.position}</span><span class="nm" data-rc="open:${r.id}">${esc(r.name)}</span><span class="rc-tag hot">${r.bidders} teams</span><span class="amt">${r.currentBid}</span></li>`).join('') || '<li class="rc-empty">No bidding activity yet.</li>'}</ul>
      <div class="rc-note" style="padding:10px 16px">${A.insights?.unbid ?? 0} open recruits without a bid · Quiet teams: ${(A.insights?.quietTeams || []).map(t => T(t).abbr).join(', ') || 'none'}</div></div>
    <div class="card wide"><div class="rc-livehd">Franchises · points &amp; logins<span style="margin-left:auto;display:flex;gap:6px"><button class="rc-btn sm gold" data-rc="allocall">Set all allocations (${s.defaultAllocation})</button><button class="rc-btn sm" data-rc="syncteams">Sync from site</button></span></div><div class="rc-tablewrap"><table class="rc-adm"><thead><tr><th>Team</th><th>Login</th><th>Temp password</th><th>Status</th><th>Last login</th><th class="n">Allocated</th><th class="n">Spent</th><th class="n">Reserved</th><th class="n">Available</th><th>Actions</th></tr></thead><tbody>${A.teams.map(t => `<tr><td><img src="${logo(t.slug)}" alt="">${esc(t.name)}${t.franchiseStatus === 'OPEN' ? ' <span class="rc-tag hot">OPEN</span>' : ''}</td><td><code>${esc(t.loginId)}</code></td><td>${t.tempPassword ? `<code>${esc(t.tempPassword)}</code>` : t.provisioned ? '<span class="rc-note">activated</span>' : '<span class="rc-note">not issued</span>'}</td><td>${t.locked ? '<span class="rc-status LOCKED">🔒 LOCKED</span>' : t.provisioned ? '<span class="rc-status ACTIVE">ACTIVE</span>' : '<span class="rc-status">PENDING</span>'}</td><td>${t.lastLogin ? fmtDate(t.lastLogin) : '—'}</td><td class="n">${t.points ? t.points.allocated + t.points.adjustments : '—'}</td><td class="n">${t.points?.spent ?? '—'}</td><td class="n">${t.points?.reserved ?? '—'}</td><td class="n"><b>${t.points?.available ?? '—'}</b></td><td><span class="acts"><button class="rc-btn sm" data-rc="adjust:${t.slug}">± Points</button><button class="rc-btn sm" data-rc="setalloc:${t.slug}">Set exact</button><button class="rc-btn sm ghost" data-rc="resetpw:${t.slug}">Reset</button>${t.locked ? `<button class="rc-btn sm gold" data-rc="unlock:${t.slug}">Unlock</button>` : `<button class="rc-btn sm ghost" data-rc="lock:${t.slug}">Lock</button>`}<button class="rc-btn sm ghost" data-rc="openteam:${t.slug}|${t.franchiseStatus}">${t.franchiseStatus === 'OPEN' ? 'Mark owned' : 'Mark open'}</button><button class="rc-btn sm dark" data-rc="actas:${t.slug}">Act as team</button></span></td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
}
function importWizard() {
  modal(`<div class="rc-mhead"><div><h3>Import recruits</h3><div class="m"><span>.xls · .xlsx · .csv — the PCFL recruit workbook is supported as-is</span></div></div><button class="x" data-rc="close">×</button></div>
    <div class="rc-mbody rc-import" id="rc-import"><div class="drop" id="rc-drop"><b>Drop the recruit workbook here</b>or click to choose a file<input type="file" id="rc-file" accept=".xls,.xlsx,.csv" style="display:none"></div><div class="rc-note" style="margin-top:10px">Only the first sheet is imported by default (other tabs, e.g. CPU allocations, are ignored unless you pick them). Rows are validated before anything is written; recruits are assigned to rounds by star rating (5★ → Round 1 … 1★ → Round 5) unless you choose a round.</div></div>`, 'lg');
  const drop = $('#rc-drop'), file = $('#rc-file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) importFile(file.files[0]); });
}
async function importFile(f, opts = {}) {
  const box = $('#rc-import'); box.innerHTML = `<div class="rc-empty">Parsing ${esc(f.name)}…</div>`;
  const dataBase64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result.split(',')[1]); rd.onerror = rej; rd.readAsDataURL(f); });
  try { const p = await api('/admin/import/preview', { method: 'POST', body: { filename: f.name, dataBase64, sheet: opts.sheet, mapping: opts.mapping, starDefault: opts.starDefault ?? 1 } }); S.importFile = f; S.importPrev = p; renderImportPreview(p); }
  catch (e) { box.innerHTML = `<div class="rc-err">${esc(e.message)}</div><div class="rc-mactions"><button class="rc-btn" data-rc="import">Try another file</button></div>`; }
}
function renderImportPreview(p) {
  const box = $('#rc-import'); if (!box) return;
  const cols = Array.from({ length: p.columns }, (_, i) => i);
  const sampleFor = c => (p.rawSample.map(r => r[c]).filter(v => v !== '' && v != null).slice(0, 2).join(' / ') || '—');
  const sel = (name, val) => `<select data-map="${name}"><option value="-1">—</option>${cols.map(c => `<option value="${c}" ${c === val ? 'selected' : ''}>col ${c + 1}: ${esc(String(sampleFor(c)).slice(0, 18))}</option>`).join('')}</select>`;
  const m = p.mapping.map; const s = p.summary;
  const rounds = S.adminData?.rounds || [];
  box.innerHTML = `<div class="rc-inline" style="justify-content:space-between"><div><b>${esc(p.filename)}</b> · sheet <select id="rc-imp-sheet">${p.sheets.map(sh => `<option ${sh.name === p.sheet ? 'selected' : ''}>${esc(sh.name)}</option>`).join('')}</select></div><div class="rc-note">${esc((p.mapping.notes || []).join(' '))}</div></div>
    <div class="sum"><span>${s.total} rows</span><span class="ok">${s.valid} valid</span><span class="warn">${s.warnings} warnings</span><span class="err">${s.errors} errors</span></div>
    <details ${p.mapping.source === 'header' ? '' : 'open'}><summary style="cursor:pointer;font-family:var(--font-head);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Column mapping</summary><div class="maprow"><div><label>First name</label>${sel('first', m.first)}</div><div><label>Last name</label>${sel('last', m.last)}</div><div><label>Position</label>${sel('position', m.position)}</div><div><label>Star rating</label>${sel('star', m.star)}</div>${ATTRS.map((a, i) => `<div><label>${a} actual</label>${sel('act' + i, m.act[i])}</div><div><label>${a} potential</label>${sel('pot' + i, m.pot[i])}</div>`).join('')}<div><label>First data row</label><input id="rc-imp-start" type="number" min="1" value="${(p.mapping.dataStart || 0) + 1}"></div></div><div class="rc-inline"><button class="rc-btn sm" data-rc="remap">Re-validate with this mapping</button><button class="rc-btn sm ghost" data-rc="swapnames">Swap first/last</button></div></details>
    <div class="rc-form" style="margin:14px 0"><div><label>Round assignment</label><select id="rc-imp-round"><option value="by-star">By star rating (5★→R1 … 1★→R5)</option>${rounds.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div><label>Missing star → default</label><select id="rc-imp-star"><option value="1">1★</option><option value="2">2★</option><option value="3">3★</option><option value="">Treat as error</option></select></div><div><label>Rows with warnings</label><select id="rc-imp-warn"><option value="1">Import (unticked rows skipped)</option><option value="0">Skip all</option></select></div></div>
    <h4>Issues (${s.warnings + s.errors})</h4><div class="issues card">${p.items.filter(i => i.status !== 'valid').map(i => `<div class="${i.status}"><label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">${i.status === 'warning' ? `<input type="checkbox" class="rc-imp-row" value="${i.row}" checked>` : '<span style="width:13px"></span>'}<span><b>Row ${i.row}</b> ${esc([i.first, i.last].filter(Boolean).join(' ') || '(no name)')} ${i.position}${i.star ? ' ' + i.star + '★' : ''} — ${i.issues.map(x => esc(x.msg)).join(' · ')}</span></label></div>`).join('') || '<div class="rc-empty">No issues — every row is valid.</div>'}</div>
    <h4>Preview (first 12)</h4><div class="rc-tablewrap card"><table class="rc-ledger"><thead><tr><th>Row</th><th>Player</th><th>Pos</th><th>★</th>${ATTRS.map(a => `<th class="n">${a}</th>`).join('')}<th>Status</th></tr></thead><tbody>${p.items.slice(0, 12).map(i => `<tr><td>${i.row}</td><td><b>${esc(i.first)} ${esc(i.last)}</b></td><td>${i.position}</td><td>${i.star ?? '—'}</td>${i.act.map((v, j) => `<td class="n">${v ?? '?'}<span style="color:var(--muted-2)">/${i.pot[j] ?? '?'}</span></td>`).join('')}<td><span class="rc-status ${i.status === 'valid' ? 'ACTIVE' : i.status === 'warning' ? 'PAUSED' : 'LOCKED'}">${i.status}</span></td></tr>`).join('')}</tbody></table></div>
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn" data-rc="downloadissues">Download error report</button><button class="rc-btn primary" data-rc="commitimport" ${s.valid + s.warnings === 0 ? 'disabled' : ''}>Import ${s.valid + s.warnings} players</button></div>`;
  $('#rc-imp-sheet').addEventListener('change', e => importFile(S.importFile, { sheet: e.target.value }));
}
function readMapping() {
  const g = n => +$(`[data-map="${n}"]`).value;
  return { headerRow: -1, dataStart: Math.max(0, (+$('#rc-imp-start').value || 1) - 1), map: { first: g('first'), last: g('last'), position: g('position'), star: g('star'), act: ATTRS.map((_, i) => g('act' + i)), pot: ATTRS.map((_, i) => g('pot' + i)) } };
}

/* ------------------------------------------------------------ actions */
const ACTIONS = {
  retry: () => mount(),
  login: () => { closeModal(); const root = $('#rc-root'); root.innerHTML = heroHTML() + loginHTML(); bindLogin(); },
  loginlogo: (_, el) => { const slug = el.selectedOptions[0].dataset.slug; const img = $('#rc-login-logo'); if (img) { img.style.visibility = slug ? '' : 'hidden'; if (slug) img.src = logo(slug); } },
  dologin: async () => {
    const id = $('#rc-login-team')?.value, pw = $('#rc-login-pw')?.value, errEl = $('#rc-login-err');
    try { const out = await api('/auth/login', { method: 'POST', body: { loginId: id, password: pw } }); S.token = out.token; localStorage.setItem(TOKEN_KEY, out.token); H.haptic(15); await loadState(); connectSSE(); toast('Welcome', out.team ? `Signed in as ${T(out.team).name}.` : 'Signed in as commissioner.', 'ok'); S.view = out.role === 'commissioner' ? 'admin' : 'board'; nav(S.view === 'board' ? '' : S.view); draw(); }
    catch (e) { if (errEl) errEl.textContent = e.message; }
  },
  logout: async () => { await api('/auth/logout', { method: 'POST', body: {}, silent: true }); S.token = null; localStorage.removeItem(TOKEN_KEY); S.me = null; S.myBids = null; S.selected.clear(); S.forcePw = false; await loadState(); connectSSE(); nav(''); draw(); },
  dopw: async () => {
    const cur = $('#rc-pw-cur').value, n1 = $('#rc-pw-new').value, n2 = $('#rc-pw-new2').value, errEl = $('#rc-pw-err');
    if (n1 !== n2) { errEl.textContent = 'New passwords do not match.'; return; }
    try { await api('/auth/change-password', { method: 'POST', body: { current: cur, next: n1 } }); S.forcePw = false; if (S.me) S.me.mustChangePw = false; toast('✓ Password updated', 'Your recruiting password has been changed.', 'ok'); nav(''); draw(); } catch (e) { errEl.textContent = e.message; }
  },
  settings: () => nav('settings'),
  notifs: async (_, el) => {
    const n = await api('/teams/me/notifications'); await api('/teams/me/notifications/read', { method: 'POST', body: {} , silent: true }); if (S.me) S.me.unread = 0;
    const pop = document.createElement('div'); pop.className = 'pop'; pop.innerHTML = n.notifications.length ? n.notifications.map(x => `<div>${esc(x.message)}<small>${fmtDate(x.created_at)}</small></div>`).join('') : '<div class="rc-empty">No notifications yet.</div>';
    el.querySelector('.pop')?.remove(); el.appendChild(pop); el.querySelector('.cnt')?.remove();
    setTimeout(() => document.addEventListener('click', function h(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', h); } }), 0);
  },
  pos: v => { S.filters.pos = v; draw(); }, star: v => { const n = +v; S.filters.stars.has(n) ? S.filters.stars.delete(n) : S.filters.stars.add(n); draw(); },
  status: v => { S.filters.status = v; draw(); }, round: (_, el) => { S.filters.round = el.value; draw(); }, attrmode: v => { S.filters.attrMode = v; draw(); },
  attrmin: (a, el) => { S.filters.attrMin[a] = +el.value || 0; clearTimeout(S._t); S._t = setTimeout(() => { const foc = document.activeElement === el; const v = el.value; draw(); if (foc) { const n = $(`[data-rci="attrmin:${a}"]`); n?.focus(); } }, 350); },
  search: (_, el) => { S.filters.search = el.value; clearTimeout(S._s); S._s = setTimeout(() => { draw(); const n = $('.rc-search'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); },
  clearfilters: () => { S.filters = defaultFilters(); draw(); }, togglefilters: () => { S.filtersCollapsed = !S.filtersCollapsed; draw(); },
  savefilter: async () => { const name = prompt('Name this filter (e.g. "Speed CB"):'); if (!name) return; const f = { ...S.filters, stars: [...S.filters.stars] }; await api('/teams/me/filters', { method: 'POST', body: { name, filter: f } }); const r = await api('/teams/me/filters'); S.savedFilters = r.filters; toast('Filter saved', name, 'ok'); draw(); },
  loadfilter: async (id, _, e) => { const sf = S.savedFilters.find(x => x.id === +id); if (!sf) return; if (e.shiftKey) { await api(`/teams/me/filters/${id}`, { method: 'DELETE', body: {} }); S.savedFilters = S.savedFilters.filter(x => x.id !== +id); draw(); return; } S.filters = { ...defaultFilters(), ...sf.filter, stars: new Set(sf.filter.stars || []) }; draw(); },
  sort: (_, el) => { const v = el.value; if (ATTRS.includes(v)) { S.sort = { key: v, dir: 'desc', mode: S.sort.mode || 'pot' }; } else S.sort = { key: v, dir: ['rank', 'name', 'pos', 'time'].includes(v) ? 'asc' : 'desc' }; draw(); },
  sortdir: () => { S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; draw(); },
  sortby: k => { // table header cycle: attr → act↓, act↑, pot↓, pot↑
    if (ATTRS.includes(k)) { const s = S.sort; if (s.key !== k) S.sort = { key: k, mode: 'act', dir: 'desc' }; else if (s.mode === 'act' && s.dir === 'desc') S.sort = { key: k, mode: 'act', dir: 'asc' }; else if (s.mode === 'act') S.sort = { key: k, mode: 'pot', dir: 'desc' }; else if (s.dir === 'desc') S.sort = { key: k, mode: 'pot', dir: 'asc' }; else S.sort = { key: 'rank', dir: 'asc' }; }
    else S.sort = { key: k, dir: S.sort.key === k && S.sort.dir === 'desc' ? 'asc' : (S.sort.key === k ? 'desc' : (['rank', 'name', 'pos', 'time'].includes(k) ? 'asc' : 'desc')) };
    draw();
  },
  viewmode: v => { S.viewMode = v; localStorage.setItem('pcfl-rc-view', v); draw(); },
  select: (id, el) => { el.checked ? S.selected.add(+id) : S.selected.delete(+id); $(`[data-card="${id}"]`)?.classList.toggle('sel', el.checked); redrawMass(); },
  selectall: (_, el) => { const list = visibleRecruits().filter(r => r.status === 'OPEN'); if (el.checked) list.forEach(r => S.selected.add(r.id)); else S.selected.clear(); draw(); },
  clearsel: () => { S.selected.clear(); draw(); }, massstep: d => { S.massPer = Math.max(1, (+S.massPer || 1) + +d); redrawMass(); }, masspreset: v => { S.massPer = +v; redrawMass(); }, massper: (_, el) => { S.massPer = Math.max(1, +el.value || 1); const ex = $('.rc-mass .exposure b'); if (ex) ex.textContent = S.selected.size * S.massPer; },
  massbid: () => massBid(), confirmmass: () => confirmMass(S.pendingMass), confirmmassvalid: () => confirmMass(S.pendingMass),
  open: id => openPlayer(+id), close: () => closeModal(),
  bid: id => openPlayer(+id),
  reviewbid: arg => { const [id, preset] = String(arg).split('|'); const amt = preset ? +preset : Math.trunc(+$('#rc-bid-amt')?.value); const r = S.recruits.get(+id); if (!(amt > r.currentBid)) { toast('Bid too low', `Minimum bid is ${r.currentBid + 1}.`, 'err'); return; } if (!Number.isInteger(amt) || amt < 1) return; reviewBid(id, amt); },
  confirmbid: arg => { const [id, amt, exp] = arg.split('|'); confirmBid(+id, +amt, +exp); },
  withdraw: async id => { if (!confirm('Withdraw your leading bid? The reservation is released and the recruit returns to no-leader.')) return; try { const out = await api(`/bids/${id}/withdraw`, { method: 'POST', body: {} }); S.me.points = out.points; upsert(out.recruit); closeModal(); toast('Bid withdrawn', '', 'info'); refreshRecruit(out.recruit.id); } catch (e) { toast('Cannot withdraw', e.message, 'err'); } },
  watch: async id => { const out = await api(`/teams/me/watchlist/${id}`, { method: 'POST', body: {} }); out.watchlisted ? S.watch.add(+id) : S.watch.delete(+id); openPlayer(+id); refreshRecruit(+id); },
  rankpos: v => { S.rankPos = v; draw(); },
  useformula: v => { if (v === 'mine' && !S.formula) { formulaBuilder(); return; } S.useMyFormula = v === 'mine'; draw(); },
  formula: () => { S.formulaDraft = null; formulaBuilder(); },
  fpreset: k => { const f = S.formulaDraft; if (k === 'reset') Object.assign(f, defaultFormula(), { name: f.name }); else { const p = FORMULA_PRESETS[k]; Object.assign(f, { weights: { ...p.weights }, actualWeight: p.actualWeight, potentialWeight: p.potentialWeight, starBonus: p.starBonus || 0 }); if (f.name === 'My formula') f.name = k; } formulaBuilder(); },
  fbalance: (_, el) => { const f = S.formulaDraft; f.potentialWeight = intIn(el.value, 0, 100, 60) / 100; f.actualWeight = +(1 - f.potentialWeight).toFixed(2); $('#rc-f-aw').textContent = Math.round(f.actualWeight * 100) + '%'; $('#rc-f-pw').textContent = Math.round(f.potentialWeight * 100) + '%'; refreshFormulaPreview(); },
  fweight: (a, el) => { const f = S.formulaDraft; f.weights[a] = Math.min(5, Math.max(0, +el.value || 0)); $(`#rc-fw-${a}`).textContent = f.weights[a]; refreshFormulaPreview(); },
  fstar: (_, el) => { S.formulaDraft.starBonus = Math.min(20, Math.max(0, +el.value || 0)); refreshFormulaPreview(); },
  fminpot: (_, el) => { S.formulaDraft.minPotential = intIn(el.value, 0, 100, 0); refreshFormulaPreview(); },
  fpos: p => { const f = S.formulaDraft; f.positions = f.positions || []; f.positions = f.positions.includes(p) ? f.positions.filter(x => x !== p) : [...f.positions, p]; formulaBuilder(); },
  fsave: async () => { const f = S.formulaDraft; f.name = ($('#rc-f-name')?.value || 'My formula').slice(0, 40); try { const out = await api('/teams/me/ranking-formula', { method: 'PUT', body: { formula: f } }); S.formula = out.formula; S.useMyFormula = true; S.formulaDraft = null; closeModal(); toast('✓ Formula saved', `${S.formula.name} is now your ranking view.`, 'ok'); nav('rankings'); draw(); } catch (e) { toast('Not saved', e.message, 'err'); } },
  fdelete: async () => { if (!confirm('Delete your custom formula and return to the league ranking?')) return; await api('/teams/me/ranking-formula', { method: 'PUT', body: { formula: null } }); S.formula = null; S.useMyFormula = false; S.formulaDraft = null; closeModal(); draw(); },
  chart: m => { S.chartMode = m; $$('.rc-charttabs .rc-chip').forEach(b => b.classList.toggle('on', b.dataset.rc === `chart:${m}`)); mountRosterCharts(); },
  insight: async (_, el) => { el.disabled = true; el.textContent = 'Analyzing…'; try { S.insight = await api('/teams/me/insights', { method: 'POST', body: { groups: S.rosterGroups } }); draw(); } catch (e) { el.disabled = false; el.textContent = 'Generate insight'; toast('Insight unavailable', e.message, 'err'); } },
  actclear: async () => { const out = await api('/admin/act-as/clear', { method: 'POST', body: {} }); S.token = out.token; localStorage.setItem(TOKEN_KEY, out.token); await loadState(); connectSSE(); draw(); },
  // ---- admin
  createseason: async () => { try { await api('/admin/seasons', { method: 'POST', body: { year: +$('#rc-s-year').value, defaultAllocation: +$('#rc-s-alloc').value, windowHours: +$('#rc-s-hours').value } }); toast('✓ Season created', 'Point accounts and rounds are ready.', 'ok'); await loadState(); draw(); } catch (e) { toast('Error', e.message, 'err'); } },
  startround: async id => { const r = S.adminData.rounds.find(x => x.id === +id); const n = S.adminData.kpis.byRound.find(b => b.round_id === +id)?.n || 0; modal(`<div class="rc-mhead"><div><h3>Start ${esc(r.name)}?</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p>All <b>${n}</b> players in this round will become available and their <b>${S.state.season.windowHours}-hour</b> recruitment clocks will begin immediately. Every connected coach is notified in realtime.</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="dostartround:${id}">Start round</button></div></div>`, 'sm'); },
  dostartround: async id => { try { const out = await api(`/admin/rounds/${id}/start`, { method: 'POST', body: {} }); closeModal(); toast('✓ Round opened', `${out.recruits} recruits are live until ${fmtDate(out.closesAt)}.`, 'ok', 7000); await loadState(); draw(); } catch (e) { toast('Cannot start round', e.message, 'err', 6000); } },
  pause: () => modal(`<div class="rc-mhead"><div><h3>Pause all recruiting?</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p>No team will be able to submit bids while paused. Every player's remaining clock is preserved and extended by the pause duration on resume.</p><div class="rc-form"><div class="full"><label>Type PAUSE to confirm</label><input id="rc-confirm-word" autocomplete="off"></div><div class="full"><label>Reason (optional)</label><input id="rc-reason"></div></div><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="dopause">Pause recruitment</button></div></div>`, 'sm'),
  dopause: async () => { if ($('#rc-confirm-word').value.trim().toUpperCase() !== 'PAUSE') { toast('Type PAUSE to confirm', '', 'err'); return; } try { await api('/admin/rounds/pause', { method: 'POST', body: { reason: $('#rc-reason').value } }); closeModal(); } catch (e) { toast('Error', e.message, 'err'); } },
  resume: async () => { try { const out = await api('/admin/rounds/resume', { method: 'POST', body: {} }); toast('✓ Resumed', `Deadlines extended by ${Math.round(out.pausedMs / 60000)} min.`, 'ok'); } catch (e) { toast('Error', e.message, 'err'); } },
  suspend: () => modal(`<div class="rc-mhead"><div><h3>Suspend all bidding</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p>Emergency freeze: new bids are rejected immediately and settlement is held until lifted. Unlike Pause, clocks keep running — use Pause to preserve recruiting time.</p><div class="rc-form"><div class="full"><label>Reason</label><select id="rc-reason"><option>server issue</option><option>incorrect recruit data</option><option>scoring error</option><option>league decision</option><option>emergency maintenance</option></select></div></div><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="dosuspend">Suspend bidding</button></div></div>`, 'sm'),
  dosuspend: async () => { try { await api('/admin/suspend', { method: 'POST', body: { suspended: true, reason: $('#rc-reason').value } }); closeModal(); } catch (e) { toast('Error', e.message, 'err'); } },
  unsuspend: async () => { await api('/admin/suspend', { method: 'POST', body: { suspended: false } }); toast('✓ Bidding resumed', '', 'ok'); },
  closeround: async id => { if (!confirm('Force-close this round now? Every open recruit settles immediately to its current leader.')) return; try { await api(`/admin/rounds/${id}/close`, { method: 'POST', body: {} }); toast('Round closed', 'Settlement is running.', 'info'); setTimeout(async () => { await loadState(); draw(); }, 1500); } catch (e) { toast('Error', e.message, 'err'); } },
  editround: id => {
    const r = id === 'new' ? { name: '', number: (S.adminData.rounds.length || 0) + 1, type: 'STAR', startMode: 'auto', startAfterHours: null, closeMode: 'all-resolved', closeAfterHours: null, windowHours: null, rolling: null, unbidToPool: false, status: 'DRAFT' } : S.adminData.rounds.find(x => x.id === +id);
    const started = !['DRAFT', 'SCHEDULED'].includes(r.status);
    modal(`<div class="rc-mhead"><div><h3>${id === 'new' ? 'New round' : 'Round settings'}</h3><div class="m"><span>${esc(r.name || '')} ${started ? '· in progress — timing rules still apply live' : ''}</span></div></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-roundform">
      <div class="full"><label>Name</label><input id="rc-r-name" value="${esc(r.name)}" placeholder="Round 6 — Portal Players"></div>
      <div><label>Order #</label><input id="rc-r-number" type="number" min="1" max="99" value="${r.number}"></div>
      <div><label>Type</label><select id="rc-r-type"><option value="STAR" ${r.type === 'STAR' ? 'selected' : ''}>Star recruits</option><option value="PORTAL" ${r.type === 'PORTAL' ? 'selected' : ''}>Portal players</option></select></div>
      <div><label>Starts</label><select id="rc-r-startmode"><option value="manual" ${r.startMode === 'manual' ? 'selected' : ''}>Manually (commissioner)</option><option value="auto" ${r.startMode === 'auto' ? 'selected' : ''}>Automatically</option></select></div>
      <div><label>Auto-start trigger</label><select id="rc-r-starttrig"><option value="" ${r.startAfterHours == null ? 'selected' : ''}>When previous round completes</option><option value="hours" ${r.startAfterHours != null ? 'selected' : ''}>N hours after previous started</option></select></div>
      <div><label>Hours after previous start</label><input id="rc-r-startafter" type="number" min="0" step="0.5" value="${r.startAfterHours ?? 24}"></div>
      <div><label>Round closes</label><select id="rc-r-closemode"><option value="all-resolved" ${r.closeMode === 'all-resolved' ? 'selected' : ''}>When every player is resolved</option><option value="after-hours" ${r.closeMode === 'after-hours' ? 'selected' : ''}>After a time limit</option></select></div>
      <div><label>Time limit (hours)</label><input id="rc-r-closeafter" type="number" min="0" step="0.5" value="${r.closeAfterHours ?? 72}"></div>
      <div><label>Winning bid must stand (hours)</label><input id="rc-r-hours" type="number" step="0.5" min="0.25" value="${r.windowHours ?? ''}" placeholder="season default ${S.state.season.windowHours}"></div>
      <div><label>Clock resets on new lead</label><select id="rc-r-rolling"><option value="" ${r.rolling == null ? 'selected' : ''}>Season default (${S.state.season.rollingBids ? 'yes' : 'no'})</option><option value="1" ${r.rolling === 1 ? 'selected' : ''}>Yes (rolling)</option><option value="0" ${r.rolling === 0 ? 'selected' : ''}>No (fixed)</option></select></div>
      <div><label>Unbid players at close</label><select id="rc-r-pool"><option value="0" ${!r.unbidToPool ? 'selected' : ''}>Mark unsigned</option><option value="1" ${r.unbidToPool ? 'selected' : ''}>Send to Portal Pool</option></select></div>
    </div><p class="rc-note" style="margin-top:10px">A round is complete when its last player's winning bid has stood for the full window (or the time limit hits). Portal Pool players can be bid on any time a Portal round is open; the first bid opens a ${S.state.season.poolBidHours}h clock.</p>
    <div class="rc-mactions">${id !== 'new' && !started ? `<button class="rc-btn ghost left" style="color:var(--red)" data-rc="delround:${id}">Delete round</button>` : ''}<button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doeditround:${id}">Save</button></div></div>`, 'lg');
  },
  doeditround: async id => {
    const trig = $('#rc-r-starttrig').value;
    const body = { name: $('#rc-r-name').value, number: +$('#rc-r-number').value, type: $('#rc-r-type').value, startMode: $('#rc-r-startmode').value, startAfterHours: trig === 'hours' ? +$('#rc-r-startafter').value : null, closeMode: $('#rc-r-closemode').value, closeAfterHours: $('#rc-r-closemode').value === 'after-hours' ? +$('#rc-r-closeafter').value : null, windowHours: $('#rc-r-hours').value === '' ? null : +$('#rc-r-hours').value, rolling: $('#rc-r-rolling').value === '' ? null : $('#rc-r-rolling').value === '1', unbidToPool: $('#rc-r-pool').value === '1' };
    try { if (id === 'new') await api('/admin/rounds', { method: 'POST', body }); else await api(`/admin/rounds/${id}`, { method: 'PATCH', body }); closeModal(); toast('✓ Round saved', body.name, 'ok'); await loadState(); draw(); } catch (e) { toast('Not saved', e.message, 'err', 6000); }
  },
  delround: async id => { if (!confirm('Delete this round? Only empty, unstarted rounds can be deleted.')) return; try { await api(`/admin/rounds/${id}`, { method: 'DELETE', body: {} }); closeModal(); toast('Round deleted', '', 'info'); await loadState(); draw(); } catch (e) { toast('Cannot delete', e.message, 'err'); } },
  allocall: () => modal(`<div class="rc-mhead"><div><h3>Set every team's allocation</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-form"><div><label>Points per team</label><input id="rc-alloc-all" type="number" min="0" value="${S.state.season.defaultAllocation}"></div><div class="full"><label>Reason (audited)</label><input id="rc-alloc-reason" placeholder="Season allocation"></div></div><p class="rc-note">Sets the season default and applies it to all ${S.adminData.teams.length} franchises as ledger transactions (spent/reserved points are untouched). Use the ± Points / Set exact buttons on a team row to override one team.</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doallocall">Apply to all teams</button></div></div>`, 'sm'),
  doallocall: async () => { try { await api('/admin/allocations/all', { method: 'POST', body: { allocated: +$('#rc-alloc-all').value, reason: $('#rc-alloc-reason').value } }); closeModal(); toast('✓ Allocations applied', 'Every franchise updated.', 'ok'); await loadState(); draw(); } catch (e) { toast('Not saved', e.message, 'err'); } },
  setalloc: slug => modal(`<div class="rc-mhead"><div><h3>Set exact allocation · ${esc(T(slug).name)}</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-form"><div><label>Allocated points</label><input id="rc-alloc-one" type="number" min="0" value="${S.adminData.teams.find(t => t.slug === slug)?.points?.allocated ?? S.state.season.defaultAllocation}"></div><div class="full"><label>Reason (audited)</label><input id="rc-alloc-reason" placeholder="Expansion team bonus"></div></div><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="dosetalloc:${slug}">Save</button></div></div>`, 'sm'),
  dosetalloc: async slug => { try { const out = await api(`/admin/teams/${slug}/allocation`, { method: 'POST', body: { allocated: +$('#rc-alloc-one').value, reason: $('#rc-alloc-reason').value } }); closeModal(); toast('✓ Allocation set', `${T(slug).abbr} allocated ${out.points.allocated}`, 'ok'); draw(); } catch (e) { toast('Not saved', e.message, 'err'); } },
  heal: async () => { try { const out = await api('/admin/heal', { method: 'POST', body: {} }); toast(out.fixes.length ? `Self-heal repaired ${out.fixes.length} cached value(s)` : '✓ All caches consistent', out.reconcile.ok ? 'Ledger reconciliation clean.' : `${out.reconcile.issues.length} ledger issue(s) remain — see health.`, out.reconcile.ok ? 'ok' : 'err', 7000); } catch (e) { toast('Heal failed', e.message, 'err'); } },
  backup: async () => { try { const out = await api('/admin/backup', { method: 'POST', body: {} }); toast('✓ Backup written', out.file.split(/[\\/]/).pop(), 'ok'); } catch (e) { toast('Backup failed', e.message, 'err'); } },
  settingsadmin: () => {},
  import: () => importWizard(),
  remap: () => importFile(S.importFile, { sheet: $('#rc-imp-sheet').value, mapping: readMapping(), starDefault: $('#rc-imp-star')?.value || null }),
  swapnames: () => { const f = $('[data-map="first"]'), l = $('[data-map="last"]'); const t = f.value; f.value = l.value; l.value = t; ACTIONS.remap(); },
  downloadissues: () => { const p = S.importPrev; const rows = [['Row', 'First', 'Last', 'Pos', 'Star', 'Status', 'Issues'], ...p.items.filter(i => i.status !== 'valid').map(i => [i.row, i.first, i.last, i.position, i.star ?? '', i.status, i.issues.map(x => x.msg).join(' | ')])]; const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'recruit-import-issues.csv'; a.click(); },
  commitimport: async (_, el) => {
    el.disabled = true; el.textContent = 'Importing…';
    const excludeRows = $$('.rc-imp-row').filter(c => !c.checked).map(c => +c.value);
    try { const out = await api('/admin/import/commit', { method: 'POST', body: { jobId: S.importPrev.jobId, sheet: $('#rc-imp-sheet').value, mapping: readMapping(), roundMode: $('#rc-imp-round').value, starDefault: $('#rc-imp-star').value || null, includeWarnings: $('#rc-imp-warn').value === '1', excludeRows } }); closeModal(); toast('✓ Recruits imported', `${out.imported} imported, ${out.skipped} skipped.`, 'ok', 7000); await loadState(); draw(); }
    catch (e) { el.disabled = false; el.textContent = 'Import'; toast('Import failed', e.message + ' No changes were committed.', 'err', 7000); }
  },
  addrecruit: (id) => { const r = id ? S.recruits.get(+id) : null; modal(`<div class="rc-mhead"><div><h3>${r ? 'Edit recruit' : 'Add recruit'}</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-form"><div><label>First name</label><input id="rc-a-first" value="${esc(r?.firstName || '')}"></div><div><label>Last name</label><input id="rc-a-last" value="${esc(r?.lastName || '')}"></div><div><label>Position</label><select id="rc-a-pos">${POS_ORDER.map(p => `<option ${r?.position === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div><label>Star rating</label><select id="rc-a-star">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${r?.stars === n ? 'selected' : ''}>${n}★</option>`).join('')}</select></div><div><label>Round</label><select id="rc-a-round"><option value="">(unassigned)</option>${(S.adminData?.rounds || []).map(x => `<option value="${x.id}" ${r?.roundId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="full"><label>Headshot URL (optional)</label><input id="rc-a-img" value="${esc(r?.headshotUrl || '')}"></div></div>
    <h4>Ratings</h4><div class="rc-attrform"><span class="rl"></span>${ATTRS.map(a => `<span class="h">${a}</span>`).join('')}<span class="rl">ACT</span>${ATTRS.map((a, i) => `<input type="number" min="0" max="100" class="rc-a-act" value="${r ? r.act[i] : ''}">`).join('')}<span class="rl">POT</span>${ATTRS.map((a, i) => `<input type="number" min="0" max="100" class="rc-a-pot" value="${r ? r.pot[i] : ''}">`).join('')}</div>
    <div class="rc-mactions">${r ? `<button class="rc-btn ghost left" style="color:var(--red)" data-rc="removerecruit:${r.id}">Remove recruit</button>` : ''}<button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="saverecruit:${r?.id || ''}">Save recruit</button></div></div>`, 'lg'); },
  saverecruit: async id => { const body = { firstName: $('#rc-a-first').value, lastName: $('#rc-a-last').value, position: $('#rc-a-pos').value, starRating: +$('#rc-a-star').value, roundId: $('#rc-a-round').value ? +$('#rc-a-round').value : null, headshotUrl: $('#rc-a-img').value || null, act: $$('.rc-a-act').map(i => +i.value), pot: $$('.rc-a-pot').map(i => +i.value) }; try { if (id) await api(`/admin/recruits/${id}`, { method: 'PATCH', body }); else await api('/admin/recruits', { method: 'POST', body }); closeModal(); toast(id ? '✓ Recruit updated' : '✓ Recruit added', '', 'ok'); await loadState(); draw(); } catch (e) { toast('Not saved', e.message, 'err', 6000); } },
  removerecruit: async id => { const reason = prompt('Reason for removal (recorded in the audit log):'); if (!reason) return; try { await api(`/admin/recruits/${id}`, { method: 'DELETE', body: { reason } }); closeModal(); toast('Recruit removed', reason, 'info'); await loadState(); draw(); } catch (e) { toast('Error', e.message, 'err'); } },
  editrecruit: id => ACTIONS.addrecruit(id),
  provision: async () => { const A = S.adminData; const pending = A.teams.filter(t => !t.provisioned).length; modal(`<div class="rc-mhead"><div><h3>Team logins</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><p>${pending ? `<b>${pending}</b> franchise${pending > 1 ? 's have' : ' has'} no recruiting password yet.` : 'Every franchise has been issued a password.'} Issuing generates <code>PCFL${S.state.season?.year}XXXX</code> temporary passwords (shown in the franchise table until first sign-in, then only the hash is kept).</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Close</button>${pending ? '<button class="rc-btn primary" data-rc="doprovision:new">Issue missing passwords</button>' : ''}<button class="rc-btn" data-rc="doprovision:reset">Reset ALL passwords</button></div></div>`, 'sm'); },
  doprovision: async mode => { if (mode === 'reset' && !confirm('Reset every franchise password and sign everyone out?')) return; const out = await api('/admin/teams/provision', { method: 'POST', body: { reset: mode === 'reset' } }); closeModal(); toast('✓ Passwords issued', `${out.issued.length} franchise logins updated.`, 'ok'); draw(); },
  resetpw: async slug => { if (!confirm(`Reset the recruiting password for ${T(slug).name}?`)) return; const out = await api(`/admin/teams/${slug}/password/reset`, { method: 'POST', body: {} }); toast('✓ Password reset', `${out.loginId}: ${out.tempPassword}`, 'ok', 12000); draw(); },
  unlock: async slug => { await api(`/admin/teams/${slug}/unlock`, { method: 'POST', body: {} }); toast('✓ Unlocked', T(slug).name, 'ok'); draw(); },
  lock: async slug => { await api(`/admin/teams/${slug}/lock`, { method: 'POST', body: {} }); toast('Locked', T(slug).name, 'info'); draw(); },
  openteam: async arg => { const [slug, cur] = arg.split('|'); await api(`/admin/teams/${slug}`, { method: 'PATCH', body: { franchiseStatus: cur === 'OPEN' ? 'ACTIVE' : 'OPEN' } }); draw(); },
  actas: async slug => { const out = await api(`/admin/act-as/${slug}`, { method: 'POST', body: {} }); S.token = out.token; localStorage.setItem(TOKEN_KEY, out.token); await loadState(); connectSSE(); toast('Commissioner mode', `Acting as ${T(slug).name}. Every bid is recorded as a commissioner action.`, 'info', 6000); nav(''); draw(); },
  adjust: slug => modal(`<div class="rc-mhead"><div><h3>Adjust points · ${esc(T(slug).name)}</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-form"><div><label>Adjustment (+/−)</label><input id="rc-adj" type="number" placeholder="+25"></div><div class="full"><label>Reason (required, audited)</label><input id="rc-adj-reason" placeholder="League correction"></div></div><p class="rc-note">Creates a COMMISSIONER_ADJUSTMENT ledger transaction. Balances are never edited directly.</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doadjust:${slug}">Apply adjustment</button></div></div>`, 'sm'),
  doadjust: async slug => { try { const out = await api(`/admin/teams/${slug}/points`, { method: 'POST', body: { delta: +$('#rc-adj').value, reason: $('#rc-adj-reason').value } }); closeModal(); toast('✓ Team points updated', `${T(slug).abbr} available: ${out.points.available}`, 'ok'); draw(); } catch (e) { toast('Not saved', e.message, 'err'); } },
  syncteams: async () => { const out = await api('/admin/teams/sync', { method: 'POST', body: {} }); toast('Teams synced', `${out.added} added.`, 'ok'); draw(); },
  audit: async () => { const a = await api('/admin/audit?limit=300'); modal(`<div class="rc-mhead"><div><h3>Audit log</h3><div class="m"><span>${a.entries.length} most recent actions</span></div></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-inline" style="margin-bottom:10px"><input class="rc-input rc-field" id="rc-audit-q" placeholder="Filter…" style="flex:1" oninput="[...document.querySelectorAll('#rc-audit tr')].forEach(r=>r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')"><button class="rc-btn sm" data-rc="auditcsv">Export CSV</button></div><div class="rc-audit card"><table class="rc-adm" id="rc-audit"><thead><tr><th>Time</th><th>Actor</th><th>Team</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>${a.entries.map(e => `<tr><td>${fmtDate(e.created_at)} ${fmtTs(e.created_at)}</td><td>${esc(e.actor_type)} · ${esc(e.actor_id)}</td><td>${e.acting_team ? esc(T(e.acting_team).abbr) : '—'}</td><td><span class="rc-type">${esc(e.action)}</span></td><td>${esc(e.entity_type || '')} ${esc(e.entity_id || '')}</td><td style="color:var(--muted);max-width:340px;word-break:break-all">${esc(e.details || '')}</td></tr>`).join('')}</tbody></table></div>${a.security.length ? `<h4>Security events</h4><div class="rc-audit card"><table class="rc-adm"><tbody>${a.security.map(s => `<tr><td>${fmtDate(s.created_at)}</td><td>${esc(s.subject)}</td><td><span class="rc-type">${esc(s.type)}</span></td><td>${esc(s.ip || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`, 'lg'); S.auditData = a; },
  auditcsv: () => { const rows = [['time', 'actor_type', 'actor', 'team', 'action', 'entity_type', 'entity_id', 'details'], ...S.auditData.entries.map(e => [e.created_at, e.actor_type, e.actor_id, e.acting_team || '', e.action, e.entity_type || '', e.entity_id || '', e.details || ''])]; const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'recruiting-audit.csv'; a.click(); },
  health: async () => { const [h, b] = await Promise.all([api('/admin/health'), api('/admin/backups', { silent: true })]); const ok = v => v ? '<span class="rc-status ACTIVE">✓ OK</span>' : '<span class="rc-status LOCKED">✕ CHECK</span>'; modal(`<div class="rc-mhead"><div><h3>System health</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><table class="rc-adm"><tr><td>Database</td><td>${ok(h.database)}</td></tr><tr><td>Realtime connections</td><td>${h.realtime}</td></tr><tr><td>Settlement worker</td><td>${ok(h.settlementWorker)} <span class="rc-note">last run ${h.settlementWorker ? fmtTs(h.settlementWorker) : '—'}</span></td></tr><tr><td>Ledger reconciliation</td><td>${ok(h.ledger)} <span class="rc-note">${h.reconcile.issues.length} issue(s) · ${fmtDate(h.reconcile.at)}</span></td></tr><tr><td>Backups</td><td>${b ? `${b.files.length} snapshot(s)` : '—'} <span class="rc-note">${b?.files[0] ? 'latest ' + esc(b.files[0].file) : ''}</span></td></tr><tr><td>Browser error reports</td><td>${b?.clientErrors?.length ?? 0} <span class="rc-note">${b?.clientErrors?.[0] ? esc(b.clientErrors[0].message).slice(0, 80) : ''}</span></td></tr></table>${h.reconcile.issues.length ? `<h4>Issues</h4><pre style="font-size:11px;white-space:pre-wrap">${esc(JSON.stringify(h.reconcile.issues, null, 1))}</pre>` : ''}<p class="rc-note" style="margin-top:10px">Self-heal recomputes cached balances and leader fields from the immutable ledger and bid history; it never alters those histories. A snapshot is taken before every heal, round start and allocation change.</p><div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Close</button><button class="rc-btn" data-rc="backup">Snapshot now</button><button class="rc-btn dark" data-rc="heal">Run self-heal</button></div></div>`, 'sm'); },
  settingsadmin2: () => {},
};
ACTIONS.settings = () => { if (isCommish() && S.view === 'admin') { const s = S.state.season; modal(`<div class="rc-mhead"><div><h3>Recruiting settings</h3><div class="m"><span>Season-wide defaults; individual rounds can override timing</span></div></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody"><div class="rc-form"><div class="full"><label>Season name</label><input id="rc-set-name" value="${esc(s.name)}"></div>
  <div><label>Winning bid must stand (hours)</label><input id="rc-set-hours" type="number" step="0.5" min="0.25" value="${s.windowHours}"></div>
  <div><label>Clock resets on each new lead</label><select id="rc-set-rolling"><option value="1" ${s.rollingBids ? 'selected' : ''}>Yes — rolling 24h rule</option><option value="0" ${!s.rollingBids ? 'selected' : ''}>No — fixed deadline</option></select></div>
  <div><label>Portal Pool bid window (hours)</label><input id="rc-set-pool" type="number" step="0.5" min="0.25" value="${s.poolBidHours}"></div>
  <div><label>Player visibility</label><select id="rc-set-vis"><option value="current" ${s.visibility === 'current' ? 'selected' : ''}>Reveal round by round</option><option value="all" ${s.visibility === 'all' ? 'selected' : ''}>Show all rounds' players</option></select></div>
  <div><label>Default allocation (new teams)</label><input id="rc-set-alloc" type="number" min="0" value="${s.defaultAllocation}"></div>
  <div><label>Allow bid withdrawal</label><select id="rc-set-wd"><option value="0" ${!s.allowWithdrawal ? 'selected' : ''}>OFF (recommended)</option><option value="1" ${s.allowWithdrawal ? 'selected' : ''}>ON</option></select></div></div>
  <p class="rc-note" style="margin-top:10px">Visibility controls what coaches see on the board and in rankings: with "round by round", players from upcoming rounds stay hidden until their round opens and the pool grows as rounds complete. The commissioner always sees everything.</p>
  <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="dosettings">Save settings</button></div></div>`, 'lg'); } else nav('settings'); };
ACTIONS.dosettings = async () => { try { await api('/admin/seasons/current', { method: 'PATCH', body: { name: $('#rc-set-name').value, windowHours: +$('#rc-set-hours').value, rollingBids: $('#rc-set-rolling').value === '1', poolBidHours: +$('#rc-set-pool').value, visibility: $('#rc-set-vis').value, defaultAllocation: +$('#rc-set-alloc').value, allowWithdrawal: $('#rc-set-wd').value === '1' } }); closeModal(); toast('✓ Recruiting settings saved', '', 'ok'); await loadState(); draw(); } catch (e) { toast('Not saved', e.message, 'err'); } };
window.addEventListener('error', e => { if (location.hash.startsWith('#/recruiting') && String(e.filename || '').includes('recruiting')) reportClientError(e.error || e.message, 'window'); });
function bindLogin() { $$('[data-rc-enter]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ACTIONS[i.dataset.rcEnter](); })); $('#rc-login-pw')?.focus(); }
