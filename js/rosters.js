/* ================================================================
   PCFL NETWORK — shared roster module
   One source of truth for FBPro98 roster data on the site:
     · PCFLRoster.load()            newest roster export for the viewed season
     · PCFLRoster.teamSectionHTML() full team-page roster (depth chart + sortable table)
     · PCFLRoster.freeAgentsHTML()  free-agent pool (Teams page)
   Used by app.js (team page, compare, teams) and js/recruiting.js (ledger dashboard).
   data/<season>/rosters.json: { <team-slug>: Player[], _meta, _freeAgents, _draftPool }
   Classic script loaded before app.js; it only touches app.js globals (App, getJSON,
   esc, T, logo) at call time, and exposes a single global: window.PCFLRoster.
   ================================================================ */
(() => {
  'use strict';

  const ATTRS = [['SP','Speed'],['AC','Acceleration'],['AG','Agility'],['ST','Strength'],['HA','Hands'],['EN','Endurance'],['IN','Intelligence'],['DI','Discipline']];
  const UNITS = {
    offense: ['QB','HB','FB','WR','TE','C','G','T'],
    defense: ['DE','DT','LB','CB','S'],
    special: ['K','P'],
  };
  const ORDER = [...UNITS.offense, ...UNITS.defense, ...UNITS.special];
  const GROUP = { QB:'Quarterbacks', HB:'Halfbacks', FB:'Fullbacks', WR:'Wide Receivers', TE:'Tight Ends', C:'Centers', G:'Guards', T:'Tackles',
    DE:'Defensive Ends', DT:'Defensive Tackles', LB:'Linebackers', CB:'Cornerbacks', S:'Safeties', K:'Kickers', P:'Punters' };
  const STATUS = { A:['Active','a','Active roster'], O:['O','o','FBPro98 roster status O'], I:['Inactive','i','Inactive'], IR:['IR','ir','Injured reserve'] };
  const INJ = { P:'Probable', Q:'Questionable', D:'Doubtful', O:'Out' };
  const YR = { R:['RK','Rookie'], 1:['FR','Year 1'], 2:['SO','Year 2'], 3:['JR','Year 3'], 4:['SR','Year 4 — final season'], 5:['5Y','Year 5'] };
  const YR_ORDER = { R:0, 1:1, 2:2, 3:3, 4:4, 5:5 };

  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const rcls = v => v >= 90 ? 'r4' : v >= 80 ? 'r3' : v >= 70 ? 'r2' : 'r1';
  const ovrCls = v => v >= 85 ? 'elite' : v >= 78 ? 'good' : 'avg';
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const unitOf = pos => UNITS.offense.includes(pos) ? 'offense' : UNITS.defense.includes(pos) ? 'defense' : 'special';
  const posIdx = pos => { const i = ORDER.indexOf(pos); return i < 0 ? 99 : i; };
  const potOf = p => p.pot ?? (p.p?.length ? Math.round(avg(p.p)) : p.ovr);
  const isInjured = p => !!p.injStatus || (p.inj && p.inj !== 'OK');

  /* ------------------------------------------------------------ data */
  /** Which season's roster to show: the viewed season, or the newest export during the offseason. */
  function yearFor(app = (typeof App !== 'undefined' ? App : null)){
    const list = app?.manifest?.rosters || [];
    const season = app?.season;
    if (!list.length) return season;
    if (app.week === 'recruiting') return list.reduce((m, r) => Math.max(m, r.year), 0) || season;
    if (list.some(r => r.year === season)) return season;
    const older = list.filter(r => r.year <= season).sort((a, b) => a.year - b.year);
    return older.length ? older[older.length - 1].year : season;
  }

  /** Normalise any rosters.json shape (current, or the legacy slug→array file) into one object. */
  function normalize(raw, year){
    const teams = {};
    for (const [k, v] of Object.entries(raw || {})){
      if (k.startsWith('_')) continue;
      const list = Array.isArray(v) ? v : (v?.players || []);
      teams[k] = list.map(p => (p.pot == null ? { ...p, pot: potOf(p) } : p));
    }
    const meta = raw?._meta || null;
    const app = typeof App !== 'undefined' ? App : null;
    const fallback = app?.manifest?.rosters?.find(r => r.year === +year) || null;
    return { year: +year, meta: meta || fallback, label: (meta || fallback)?.label || `${year} season rosters`,
      teams, freeAgents: raw?._freeAgents || [], draftPool: raw?._draftPool || [] };
  }

  async function load(year){
    year = year ?? yearFor();
    let raw = {};
    try { raw = await getJSON(`data/${year}/rosters.json`); } catch { raw = {}; }
    return normalize(raw, year);
  }

  function summary(players){
    const starters = players.filter(p => p.depth === 1 && (p.status === 'A' || p.status === 'O'));
    return {
      count: players.length,
      ovr: +avg(players.map(p => p.ovr)).toFixed(1),
      pot: +avg(players.map(potOf)).toFixed(1),
      starters: +avg(starters.map(p => p.ovr)).toFixed(1),
      seniors: players.filter(p => String(p.yr) === '4' || String(p.yr) === '5').length,
      ir: players.filter(p => p.status === 'IR').length,
      injured: players.filter(isInjured).length,
    };
  }

  /* ------------------------------------------------------ team page */
  const ui = { unit: 'all', sort: null, dir: -1, mode: 'act', q: '' };
  let current = null;   // { slug, players }

  const SORTS = {
    num:   p => p.num ?? 999,
    name:  p => p.name.split(' ').slice(-1)[0].toLowerCase() + ' ' + p.name.toLowerCase(),
    pos:   p => posIdx(p.pos) * 100 + (p.depth || 50),
    yr:    p => YR_ORDER[p.yr] ?? 9,
    ht:    p => p.htIn ?? 0,
    wt:    p => p.wt ?? 0,
    ovr:   p => ui.mode === 'pot' ? potOf(p) : p.ovr,
    grow:  p => potOf(p) - p.ovr,
  };
  ATTRS.forEach(([k], i) => { SORTS[k] = p => (ui.mode === 'pot' ? p.p?.[i] : p.a?.[i]) ?? 0; });
  const TEXT_SORTS = new Set(['name', 'pos', 'num']);   // ascending first

  function flagsHTML(p){
    let h = '';
    if (p.status && p.status !== 'A'){
      const [label, cls, title] = STATUS[p.status] || [p.status, 'o', `FBPro98 roster status ${p.status}`];
      h += `<span class="rs-chip ${cls}" title="${e(title)}">${e(label)}</span>`;
    }
    if (isInjured(p)){
      const s = p.injStatus ? `${INJ[p.injStatus] || p.injStatus}${p.injWeeks ? ` · ${p.injWeeks} wk` : ''}` : p.inj;
      h += `<span class="rs-chip inj" title="Injury: ${e(p.inj)}">✚ ${e(s)}</span>`;
    }
    return h;
  }
  const yrHTML = yr => { const [l, t] = YR[yr] || [yr, `Year ${yr}`]; return `<span title="${e(t)} (FBPro98 Yr ${e(yr)})">${e(l)}</span>`; };
  const growthBar = (a, p) => {
    const sc = v => Math.max(0, Math.min(100, (v - 50) * 2));   // 50–100 rating window
    const lo = sc(Math.min(a, p)), hi = sc(Math.max(a, p));
    return `<span class="rs-bar" aria-hidden="true"><i style="width:${lo}%"></i><u style="left:${lo}%;width:${Math.max(0, hi - lo)}%"></u></span>`;
  };

  function rowHTML(p){
    const pot = potOf(p), grow = pot - p.ovr;
    const big = ui.mode === 'pot' ? pot : p.ovr, small = ui.mode === 'pot' ? p.ovr : pot;
    return `<tr class="rs-row${p.status === 'IR' ? ' is-ir' : ''}${p.status === 'I' ? ' is-inactive' : ''}">
      <td class="rs-num">${p.num ?? ''}</td>
      <td class="rs-name"><b>${e(p.name)}</b>${flagsHTML(p)}<span class="rs-mob">${e(p.slot || p.pos)} · ${YR[p.yr]?.[0] || e(p.yr)} · ${e(p.ht)} ${p.wt}</span></td>
      <td class="rs-pos"><b>${e(p.pos)}</b>${p.depth ? `<i>${p.depth}</i>` : ''}</td>
      <td class="rs-c rs-hide-s">${yrHTML(p.yr)}</td>
      <td class="rs-c rs-hide-s">${e(p.ht)}</td>
      <td class="rs-c rs-hide-s">${p.wt ?? ''}</td>
      <td class="rs-ovr" title="Overall ${p.ovr} actual · ${pot} potential (average of the 8 FBPro98 ratings)">
        <span class="ovr ${ovrCls(big)}">${big}</span><span class="rs-arrow">${ui.mode === 'pot' ? '←' : '→'}</span><span class="rs-potv${grow > 0 && ui.mode !== 'pot' ? ' up' : ''}">${small}</span>${growthBar(p.ovr, pot)}</td>
      ${ATTRS.map(([k, n], i) => {
        const a = p.a?.[i] ?? 0, pp = p.p?.[i] ?? a;
        const b = ui.mode === 'pot' ? pp : a, s = ui.mode === 'pot' ? a : pp;
        return `<td class="rs-at" title="${n}: ${a} actual → ${pp} potential"><b class="${rcls(b)}">${b}</b><small class="${pp > a && ui.mode !== 'pot' ? 'up' : ''}">${s}</small></td>`;
      }).join('')}
    </tr>`;
  }

  const COLS = 7 + ATTRS.length;
  function bodyHTML(){
    if (!current) return '';
    const q = ui.q.trim().toLowerCase();
    let list = current.players.filter(p => ui.unit === 'all' || unitOf(p.pos) === ui.unit);
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || String(p.num) === q || (p.slot || '').toLowerCase() === q || p.pos.toLowerCase() === q);
    if (!list.length) return `<tr><td colspan="${COLS}" class="rs-empty">No players match.</td></tr>`;
    if (ui.sort){
      const f = SORTS[ui.sort] || SORTS.ovr;
      list = [...list].sort((x, y) => { const a = f(x), b = f(y); return (a < b ? -1 : a > b ? 1 : 0) * ui.dir || (y.ovr - x.ovr); });
      return list.map(rowHTML).join('');
    }
    // depth chart: grouped by position, depth slot order, then players without a slot (IR / inactive)
    const rank = p => (p.depth || 50) + (p.status === 'IR' ? 200 : p.status === 'I' ? 100 : 0);
    const groups = {};
    for (const p of list) (groups[p.pos] ||= []).push(p);
    return Object.keys(groups).sort((a, b) => posIdx(a) - posIdx(b)).map(pos => {
      const g = groups[pos].sort((x, y) => rank(x) - rank(y) || y.ovr - x.ovr);
      const s = summary(g);
      return `<tr class="rs-grp"><th colspan="${COLS}"><span><span class="rs-gname">${e(GROUP[pos] || pos)}</span><span class="rs-gmeta">${g.length} · avg ${s.ovr} → ${s.pot}</span></span></th></tr>${g.map(rowHTML).join('')}`;
    }).join('');
  }

  function headHTML(){
    const th = (k, label, cls = '', title = '') => {
      const on = ui.sort === k;
      return `<th class="${cls}${on ? ' on' : ''}" data-rs-sort="${k}" ${title ? `title="${e(title)}"` : ''} aria-sort="${on ? (ui.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${on ? `<span class="rs-dir">${ui.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    };
    return `<tr>${th('num', '#', 'rs-num')}${th('name', 'Player', 'rs-name')}${th('pos', 'Pos', 'rs-pos')}${th('yr', 'Yr', 'rs-c rs-hide-s')}${th('ht', 'Ht', 'rs-c rs-hide-s')}${th('wt', 'Wt', 'rs-c rs-hide-s')}
      ${th('ovr', ui.mode === 'pot' ? 'POT ← OVR' : 'OVR → POT', 'rs-ovr', 'Overall: average of the 8 ratings, actual and potential')}
      ${ATTRS.map(([k, n]) => th(k, k, 'rs-at', `${n} — ${ui.mode === 'pot' ? 'potential (actual below)' : 'actual (potential below)'}`)).join('')}</tr>`;
  }

  const keyHTML = () => `Big number = ${ui.mode === 'pot' ? 'potential' : 'actual'} · small = ${ui.mode === 'pot' ? 'actual' : 'potential'} (<em class="up">green</em> = room to grow) · click any column to sort`;

  function redraw(root){
    root = root || document.querySelector('.rs');
    if (!root) return;
    root.querySelector('thead').innerHTML = headHTML();
    root.querySelector('tbody').innerHTML = bodyHTML();
    root.querySelectorAll('[data-rs-unit]').forEach(b => b.classList.toggle('on', b.dataset.rsUnit === ui.unit));
    root.querySelectorAll('[data-rs-mode]').forEach(b => b.classList.toggle('on', b.dataset.rsMode === ui.mode));
    const key = root.querySelector('.rs-key'); if (key) key.innerHTML = keyHTML();
    const reset = root.querySelector('[data-rs-reset]'); if (reset) reset.hidden = !ui.sort;
  }

  function teamSectionHTML(slug, R){
    const players = R?.teams?.[slug] || [];
    current = { slug, players };
    ui.sort = null; ui.q = '';
    const label = R?.label || '';
    if (!players.length){
      return `<div class="section-h"><span class="bar"></span><h2>Roster</h2>${label ? `<span class="sub">${e(label)}</span>` : ''}</div>
        <div class="card empty"><b>Roster not available yet</b>Rosters appear once the commissioner uploads an FBPro98 roster export.</div>`;
    }
    const s = summary(players);
    const tile = (v, l, cls = '') => `<div class="rs-tile ${cls}"><b>${v}</b><span>${l}</span></div>`;
    const m = R.meta || {};
    return `<section class="rs" id="team-roster" data-slug="${e(slug)}">
      <div class="section-h"><span class="bar"></span><h2>Roster</h2><span class="sub">${s.count} players · <span class="rs-asof">${e(label)}</span></span></div>
      <div class="rs-tiles reveal">
        ${tile(s.count, 'Players')}${tile(s.ovr, 'Avg OVR')}${tile(s.pot, 'Avg potential', 'gold')}${tile(s.starters || '—', 'Starters OVR')}
        ${tile(s.seniors, 'Seniors (Yr 4+)')}${tile(s.ir, 'On IR', s.ir ? 'red' : '')}${tile(s.injured, 'Injured', s.injured ? 'red' : '')}
      </div>
      <div class="rs-toolbar">
        <div class="rs-seg" role="group" aria-label="Unit">
          ${[['all','All'],['offense','Offense'],['defense','Defense'],['special','Special']].map(([k, l]) => `<button data-rs-unit="${k}" class="${ui.unit === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <div class="rs-seg" role="group" aria-label="Ratings shown">
          <button data-rs-mode="act" class="${ui.mode === 'act' ? 'on' : ''}">Actual</button><button data-rs-mode="pot" class="${ui.mode === 'pot' ? 'on' : ''}">Potential</button>
        </div>
        <input class="rs-search" type="search" placeholder="Search name, #, or slot (QB1)" aria-label="Search roster">
        <button class="rs-reset" data-rs-reset hidden>↺ Depth chart order</button>
      </div>
      <div class="card rs-card reveal"><div class="rs-scroll">
        <table class="rs-table"><thead>${headHTML()}</thead><tbody>${bodyHTML()}</tbody></table>
      </div></div>
      <div class="rs-legend">
        ${ATTRS.map(([k, n]) => `<span><b>${k}</b> ${n}</span>`).join('')}
        <span class="rs-key">${keyHTML()}</span>
      </div>
      <div class="rs-source">Source: FBPro98 roster report${m.asOf ? ` dated ${e(m.asOf)}` : ''}${m.phase ? ` (${e(m.phase)})` : ''}${m.sourceKind === 'weekly-export' && m.week ? ` · Week ${m.week} export` : ''}</div>
    </section>`;
  }

  /* ------------------------------------------------- free agent pool */
  function freeAgentsHTML(R, { limit = 0 } = {}){
    const fa = (R?.freeAgents || []).slice().sort((a, b) => posIdx(a.pos) - posIdx(b.pos) || potOf(b) - potOf(a));
    const m = R?.meta?.freeAgents;
    if (!fa.length && !m?.total) return '';
    const shown = limit ? fa.slice(0, limit) : fa;
    return `<details class="rs-fa card reveal">
      <summary><span class="rs-gname">Free Agent Pool</span><span class="rs-gmeta">${fa.length} players${m?.filler ? ` · ${m.filler} placeholder players hidden` : ''} · ${e(R.label)}</span></summary>
      <div class="rs-scroll"><table class="rs-table rs-fa-table"><thead><tr><th>Player</th><th>Pos</th><th class="rs-c">Yr</th><th class="rs-c">Ht</th><th class="rs-c">Wt</th><th class="rs-ovr">OVR → POT</th>${ATTRS.map(([k, n]) => `<th class="rs-at" title="${n}">${k}</th>`).join('')}</tr></thead>
      <tbody>${shown.map(p => { const pot = potOf(p); return `<tr><td class="rs-name"><b>${e(p.name)}</b>${flagsHTML(p)}</td><td class="rs-pos"><b>${e(p.pos)}</b></td><td class="rs-c">${yrHTML(p.yr)}</td><td class="rs-c">${e(p.ht)}</td><td class="rs-c">${p.wt}</td>
        <td class="rs-ovr"><span class="ovr ${ovrCls(p.ovr)}">${p.ovr}</span><span class="rs-arrow">→</span><span class="rs-potv${pot > p.ovr ? ' up' : ''}">${pot}</span>${growthBar(p.ovr, pot)}</td>
        ${ATTRS.map((_, i) => `<td class="rs-at"><b class="${rcls(p.a[i])}">${p.a[i]}</b><small class="${p.p[i] > p.a[i] ? 'up' : ''}">${p.p[i]}</small></td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
    </details>`;
  }

  /* ------------------------------------------------------- events */
  document.addEventListener('click', ev => {
    const root = ev.target.closest('.rs');
    if (!root || !current) return;
    const s = ev.target.closest('[data-rs-sort]');
    if (s){
      const k = s.dataset.rsSort;
      if (ui.sort === k) ui.dir = -ui.dir; else { ui.sort = k; ui.dir = TEXT_SORTS.has(k) ? 1 : -1; }
      return redraw(root);
    }
    const u = ev.target.closest('[data-rs-unit]'); if (u){ ui.unit = u.dataset.rsUnit; return redraw(root); }
    const m = ev.target.closest('[data-rs-mode]'); if (m){ ui.mode = m.dataset.rsMode; return redraw(root); }
    if (ev.target.closest('[data-rs-reset]')){ ui.sort = null; return redraw(root); }
  });
  document.addEventListener('input', ev => {
    if (!ev.target.matches('.rs .rs-search')) return;
    ui.q = ev.target.value; redraw(ev.target.closest('.rs'));
  });

  window.PCFLRoster = { ATTRS, UNITS, ORDER, GROUP, load, normalize, yearFor, summary, potOf, unitOf, teamSectionHTML, freeAgentsHTML };
})();
