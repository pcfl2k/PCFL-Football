/* ================================================================
   PCFL NETWORK — application core
   Hash-routed SPA over static per-week JSON generated from FBPro98.
   ================================================================ */
'use strict';

const App = {
  manifest: null, teams: [], teamMap: {}, videos: [],
  season: null, week: null,
  cache: {}, schedule: null, rosters: null,
};

/* ----------------------------- utils ----------------------------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const T = slug => App.teamMap[slug] || { slug, name: slug, nickname:'', abbr:(slug||'?').slice(0,3).toUpperCase(), colors:{primary:'#444',secondary:'#999'} };
const logo = (slug, dark) => `assets/logos/${slug}${dark ? '-dark' : ''}.png`;
const num = s => { const n = parseFloat(String(s).replace(/[^\d.\-]/g,'')); return isNaN(n) ? 0 : n; };
const fmtDate = d => d || '';

async function getJSON(path){
  if (App.cache[path]) return App.cache[path];
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (App.cache[path] = await r.json());
}
const weekData = (s = App.season, w = App.week) => getJSON(`data/${s}/week${w}.json`);

function ranksOf(wk){
  const m = {};
  for (const r of wk.powerRankings) m[r.team] = r.rank;
  return m;
}
const rankChip = (ranks, slug) => {
  const r = ranks?.[slug];
  return r && r <= 10 ? `<span style="color:var(--muted-2);font-size:.78em;font-weight:700">#${r} </span>` : '';
};

/* ----------------------- animations helpers ---------------------- */
let observer;
function revealInit(root){
  observer ??= new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting){ e.target.classList.add('in'); observer.unobserve(e.target); }
  }), { threshold: .08 });
  root.querySelectorAll('.reveal').forEach(n => observer.observe(n));
}
function animateWidths(root){
  requestAnimationFrame(() => requestAnimationFrame(() =>
    root.querySelectorAll('[data-w]').forEach(n => { n.style.width = n.dataset.w + '%'; })));
}
function countUp(elm, target, ms = 900){
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    elm.textContent = Math.round(target * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ----------------------------- header ---------------------------- */
function renderChrome(){
  const seasonOpts = App.manifest.seasons.map(s =>
    `<option value="${s.year}" ${s.year===App.season?'selected':''}>${s.year}</option>`).join('');
  const season = App.manifest.seasons.find(s => s.year === App.season);
  const weekOpts = season.weeks.map(w =>
    `<option value="${w}" ${w===App.week?'selected':''}>Week ${w}</option>`).join('');
  document.querySelectorAll('select.season-sel').forEach(s => s.innerHTML = seasonOpts);
  document.querySelectorAll('select.week-sel').forEach(s => s.innerHTML = weekOpts);
}

/* ------------------- mobile drawer + haptics ---------------------- */
const haptic = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
document.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) haptic(10);
}, { passive: true });

function setupDrawer(){
  const d = $('#drawer'), o = $('#drawer-overlay'), h = $('#hamburger');
  const set = open => {
    d.classList.toggle('open', open); o.classList.toggle('open', open); h.classList.toggle('open', open);
    h.setAttribute('aria-expanded', String(open)); d.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  h.addEventListener('click', () => set(!d.classList.contains('open')));
  o.addEventListener('click', () => set(false));
  $('#drawer-close').addEventListener('click', () => set(false));
  d.addEventListener('click', e => { if (e.target.closest('.drawer-nav a, .drawer-yt')) set(false); });
  window.addEventListener('hashchange', () => set(false));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
}

async function renderTicker(){
  const wk = await weekData();
  const ranks = ranksOf(wk);
  const items = wk.games.map(g => {
    const win = g.away.score > g.home.score ? 'away' : 'home';
    const row = (side) => {
      const t = T(g[side].team);
      return `<div class="row ${side===win?'win':'lose'}">
        <img src="${logo(g[side].team)}" alt="${esc(t.name)}">
        <span class="ab">${rankChip(ranks, g[side].team)}${t.abbr}</span>
        <span class="rec">${wk.records[g[side].team]||''}</span>
        <span class="sc">${g[side].score}</span></div>`;
    };
    return `<a class="tick" href="#/game/${wk.season}/${wk.week}/${g.id}">
      <div><div class="tag"><b>FINAL</b> · WK ${wk.week}</div>${row('away')}${row('home')}</div></a>`;
  }).join('');
  $('#ticker-track').innerHTML = items + items; /* duplicate for seamless loop */
}

/* ----------------------- fight song player ----------------------- */
function isFightSongMuted(){ return localStorage.getItem('pcfl-fightsongs-muted') === '1'; }
function setFightSongMuted(v){
  if (v) localStorage.setItem('pcfl-fightsongs-muted','1');
  else   localStorage.removeItem('pcfl-fightsongs-muted');
}
function stopFightSong(){
  const holder = document.getElementById('fightsong-frame-holder');
  if (holder) holder.innerHTML = '';
}
function playFightSong(team){
  const t = team || App.teamMap[document.getElementById('fightsong-chip')?.dataset.team];
  if (!t?.fightSong) return;
  const holder = document.getElementById('fightsong-frame-holder');
  if (!holder) return;
  holder.innerHTML = '';
  const fs = t.fightSong;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${fs.youtubeId}`
    + `?autoplay=1&start=${fs.start||0}&end=${fs.end||22}`
    + '&controls=0&playsinline=1&modestbranding=1&rel=0';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.setAttribute('frameborder','0');
  iframe.style.cssText = 'width:300px;height:200px';
  holder.appendChild(iframe);
}
function setFightSongUI(state){
  // state: 'playing' | 'paused' | 'muted'
  const chip = document.getElementById('fightsong-chip');
  const lbl  = document.getElementById('fightsong-state');
  if (!chip || !lbl) return;
  chip.classList.toggle('playing', state === 'playing');
  chip.classList.toggle('muted',   state === 'muted');
  lbl.textContent = state === 'playing' ? 'now playing · tap to mute'
                  : state === 'muted'   ? 'muted · tap to play'
                                        : 'tap to play';
}
function setupFightSong(){
  const chip = document.getElementById('fightsong-chip');
  if (!chip) return;
  const team = App.teamMap[chip.dataset.team];
  if (!team?.fightSong) return;
  if (isFightSongMuted()){
    setFightSongUI('muted');
  } else {
    playFightSong(team);
    setFightSongUI('playing');
    // Auto-update to paused state when the snippet ends (~end seconds after start)
    const snippetMs = ((team.fightSong.end || 22) - (team.fightSong.start || 0) + 2) * 1000;
    setTimeout(() => {
      if (document.getElementById('fightsong-chip') === chip)
        setFightSongUI('paused');
    }, snippetMs);
  }
  chip.onclick = () => {
    if (chip.classList.contains('playing')){
      stopFightSong();
      setFightSongMuted(true);
      setFightSongUI('muted');
    } else {
      setFightSongMuted(false);
      playFightSong(team);
      setFightSongUI('playing');
    }
  };
}

/* ------------------------- shared partials ----------------------- */
function gameCard(g, wk, ranks){
  const win = g.away.score > g.home.score ? 'away' : 'home';
  const row = side => {
    const t = T(g[side].team);
    return `<a class="trow ${side===win?'win':'lose'}" href="#/teams/${g[side].team}" title="${esc(t.name)} team page">
      <img src="${logo(g[side].team)}" alt=""><span class="nm">${rankChip(ranks,g[side].team)}${esc(t.name)}</span>
      <span class="rec">(${wk.records[g[side].team]||'0-0'})</span><span class="sc">${g[side].score}</span></a>`;
  };
  return `<div class="card gcard reveal">
    <div class="top"><span>${fmtDate(wk.date)}</span><span class="final">Final</span></div>
    <div class="teams">${row('away')}${row('home')}</div>
    <div class="foot">
      ${g.videoId ? `<a href="#/game/${wk.season}/${wk.week}/${g.id}?t=video">▶ Replay</a>` : ''}
      <a href="#/game/${wk.season}/${wk.week}/${g.id}">Box Score</a>
      <a href="#/game/${wk.season}/${wk.week}/${g.id}?t=recap">Recap</a>
      ${g.logFile ? `<a class="log-dl" href="data/${wk.season}/logs/week${wk.week}/${esc(g.logFile)}" download title="Download play-by-play log">↓ Log</a>` : ''}
    </div></div>`;
}

function potwCard(wk){
  if (!wk.playerOfWeek) return '';
  const p = wk.playerOfWeek, t = T(p.team);
  return `<div class="potw-wrap"><div class="potw reveal">
    <span class="p-week">Week ${wk.week} · ${wk.season} Season</span>
    <img class="wm" src="${logo(p.team)}" alt="">
    <div class="badge">Player of the Week</div>
    <img class="p-logo" src="${logo(p.team,true)}" onerror="this.src='${logo(p.team)}'" alt="">
    <div class="p-name">${esc(p.name)}</div>
    <div class="p-sub">${esc(p.pos)} · ${esc(t.name)} ${esc(t.nickname)}</div>
    ${p.line ? `<div class="p-line">${esc(p.line)}</div>` : ''}
  </div></div>`;
}

const LEADER_DEFS = [
  { key:'passing',       title:'Passing Yards',   val:p=>p.yds,  sub:p=>`${p.td} TD · ${p.int} INT · ${p.rtg} RTG`, unit:'yds' },
  { key:'rushing',       title:'Rushing Yards',   val:p=>p.yds,  sub:p=>`${p.att} car · ${p.avg} avg · ${p.td} TD`, unit:'yds' },
  { key:'receiving',     title:'Receiving Yards', val:p=>p.yds,  sub:p=>`${p.rec} rec · ${p.td} TD`, unit:'yds' },
  { key:'sacks',         title:'Sacks',           val:p=>p.sacks, sub:()=>'', unit:'sacks' },
  { key:'interceptions', title:'Interceptions',   val:p=>p.int,  sub:p=>`${p.yds} ret yds`, unit:'int' },
  { key:'tackles',       title:'Tackles',         val:p=>p.tackles, sub:()=>'', unit:'tkl' },
  { key:'scoring',       title:'Scoring',         val:p=>p.pts,  sub:p=>`${p.totTD} TD`, unit:'pts' },
];

function leaderCard(def, rows){
  if (!rows?.length) return '';
  const sorted = [...rows].sort((a,b)=>def.val(b)-def.val(a)).slice(0,5);
  const f = sorted[0], ft = T(f.team);
  return `<div class="card lead-card reveal">
    <div class="hd"><h3>${def.title}</h3><span>Season Leaders</span></div>
    <div class="lead-first">
      <img class="big-logo" src="${logo(f.team)}" alt="">
      <div><div class="nm">${esc(f.name)}</div><div class="pos">${esc(f.pos)} · ${esc(ft.abbr)}${def.sub(f)?` · ${def.sub(f)}`:''}</div></div>
      <div class="val"><b>${def.val(f)}</b><span>${def.unit}</span></div>
    </div>
    ${sorted.slice(1).map((p,i)=>`<div class="lead-row">
      <span class="num">${i+2}</span><img src="${logo(p.team)}" alt="">
      <span class="nm">${esc(p.name)} <span style="color:var(--muted-2);font-size:11px">${esc(T(p.team).abbr)}</span></span>
      <span class="v">${def.val(p)}</span></div>`).join('')}
  </div>`;
}

function powerPollRows(wk, limit){
  const max = Math.max(...wk.powerRankings.map(r=>r.pts), 1);
  return wk.powerRankings.slice(0, limit ?? wk.powerRankings.length).map(r => {
    const t = T(r.team);
    const mov = r.prev == null ? '<span class="mov even">NEW</span>'
      : r.prev > r.rank ? `<span class="mov up">▲${r.prev-r.rank}</span>`
      : r.prev < r.rank ? `<span class="mov dn">▼${r.rank-r.prev}</span>`
      : '<span class="mov even">—</span>';
    return `<a class="pp-row" href="#/teams/${r.team}">
      <span class="rk">${r.rank}</span><img class="lg" src="${logo(r.team)}" alt="">
      <span class="nm">${esc(t.name)}<span class="nick">${esc(t.nickname)} · ${wk.records[r.team]||''}</span></span>
      ${mov}<div class="ptsbar"><i data-w="${Math.round(r.pts/max*100)}"></i></div>
      <span class="beat">${r.defeated.length ? r.defeated.map(d=>`<img src="${logo(d)}" title="def. ${esc(T(d).name)}" alt="">`).join('') : '<span class="none">—</span>'}</span>
    </a>`;
  }).join('');
}

/* ============================ VIEWS ============================== */
const VIEWS = {};

/* ------------------------------ home ----------------------------- */
VIEWS.home = async function(){
  const wk = await weekData();
  const ranks = ranksOf(wk);

  // hero: best matchup by combined power rank, then total points
  const hero = [...wk.games].sort((a,b)=>{
    const rs = g => (ranks[g.away.team]||19)+(ranks[g.home.team]||19);
    return rs(a)-rs(b) || (b.away.score+b.home.score)-(a.away.score+a.home.score);
  })[0];

  const heroHTML = hero ? (() => {
    const A = T(hero.away.team), H = T(hero.home.team);
    const win = hero.away.score > hero.home.score ? 'away':'home';
    return `<div class="hero reveal" style="--hero-a:${A.colors.primary};--hero-b:${H.colors.primary}">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="chyron"><span class="dot"></span> PCFL Network · Game of the Week · Week ${wk.week}</div>
      <div class="hero-inner">
        <a class="side" href="#/teams/${hero.away.team}">
          <img src="${logo(hero.away.team,true)}" onerror="this.src='${logo(hero.away.team)}'" alt="">
          <div><div class="tname">${esc(A.name)}</div><div class="tsub">${rankChip(ranks,hero.away.team)}${esc(A.nickname)} · ${wk.records[hero.away.team]||''}</div></div>
        </a>
        <div class="mid"><div class="status">Final</div>
          <div class="scores">
            <span class="score ${win==='away'?'':'dim'}" data-count="${hero.away.score}">0</span>
            <span class="dash">–</span>
            <span class="score" data-count="${hero.home.score}">0</span>
          </div></div>
        <a class="side right" href="#/teams/${hero.home.team}">
          <img src="${logo(hero.home.team,true)}" onerror="this.src='${logo(hero.home.team)}'" alt="">
          <div><div class="tname">${esc(H.name)}</div><div class="tsub">${rankChip(ranks,hero.home.team)}${esc(H.nickname)} · ${wk.records[hero.home.team]||''}</div></div>
        </a>
      </div>
      <div class="hero-actions">
        ${hero.videoId ? `<a class="btn primary" href="#/game/${wk.season}/${wk.week}/${hero.id}?t=video">▶ Watch Replay</a>` : ''}
        <a class="btn" href="#/game/${wk.season}/${wk.week}/${hero.id}?t=recap">Game Recap</a>
        <a class="btn" href="#/game/${wk.season}/${wk.week}/${hero.id}">Box Score</a>
      </div></div>`;
  })() : '';

  // stories
  const stories = wk.games.map(g => {
    const margin = Math.abs(g.away.score - g.home.score);
    const cat = margin >= 21 ? 'Statement Win' : margin <= 3 ? 'Instant Classic' : 'Game Recap';
    const A = T(g.away.team), H = T(g.home.team);
    const thumb = g.videoId
      ? `<img class="yt" src="https://i.ytimg.com/vi/${g.videoId}/hqdefault.jpg" alt="" loading="lazy">`
      : '';
    return `<a class="card story reveal" href="#/game/${wk.season}/${wk.week}/${g.id}?t=recap">
      <div class="thumb" style="background:linear-gradient(120deg,${A.colors.primary},${H.colors.primary})">${thumb}
        <div class="logos"><img src="${logo(g.away.team,true)}" onerror="this.src='${logo(g.away.team)}'" alt=""><span class="vs">@</span><img src="${logo(g.home.team,true)}" onerror="this.src='${logo(g.home.team)}'" alt=""></div></div>
      <div style="min-width:0"><div class="cat">${cat}</div>
        <h3>${esc(g.story.headline)}</h3><p>${esc(g.story.body[0]||'')}</p>
        <div class="meta"><span>Week ${wk.week}</span>${g.playerOfGame?`<span>★ ${esc(g.playerOfGame.name)}</span>`:''}${g.videoId?'<span style="color:var(--red)">▶ Replay available</span>':''}</div>
      </div></a>`;
  }).join('');

  // rail: power poll, players of game, division leaders, videos
  const pogs = wk.games.filter(g=>g.playerOfGame).map(g=>{
    const p = g.playerOfGame;
    return `<a class="minirow" href="#/game/${wk.season}/${wk.week}/${g.id}">
      <img src="${logo(p.team)}" alt=""><div style="min-width:0"><b>${esc(p.name)}</b>
      <div class="sub">${esc(p.pos)} · ${esc(T(p.team).abbr)}${g.playerOfGameLine?` — ${esc(g.playerOfGameLine)}`:''}</div></div></a>`;
  }).join('');

  const divLeaders = wk.standings.map(c => c.divisions.map(d => {
    const tm = d.teams[0]; if (!tm) return '';
    return `<a class="minirow" href="#/teams/${tm.team}"><img src="${logo(tm.team)}" alt="">
      <div><b>${esc(T(tm.team).name)}</b><div class="sub">${esc(c.conference)} ${esc(d.name)} · ${tm.w}-${tm.l}</div></div>
      <span style="margin-left:auto;font-family:var(--font-head);color:var(--muted)">${tm.pf} PF</span></a>`;
  }).join('')).join('');

  const vids = App.videos.filter(v=>v.season===wk.season && v.week===wk.week).slice(0,3).map(v =>
    videoCardHTML(v, true)).join('');

  const leaders = LEADER_DEFS.slice(0,6).map(d => leaderCard(d, wk.leaders[d.key])).join('');

  const wrapHTML = (() => {
    const ww = wk.weeklyWrap;
    if (!ww) return '';
    const SEGMENT_META = {
      upset:     { tag: 'Upset',     icon: '⚡', accent: '#d6001c' },
      statement: { tag: 'Statement', icon: '◆', accent: '#9e0015' },
      spotlight: { tag: 'Spotlight', icon: '★', accent: '#f1be48' },
      defense:   { tag: 'Defense',   icon: '⛨', accent: '#185fa5' },
      shootout:  { tag: 'Shootout',  icon: '◎', accent: '#d85a30' },
      race:      { tag: 'Race',      icon: '▲', accent: '#0a8f3c' },
      storyline: { tag: 'Storyline', icon: '◇', accent: '#534ab7' },
      milestone: { tag: 'Milestone', icon: '◉', accent: '#8a6a14' },
    };
    const head = `<div class="section-h"><span class="bar"></span><h2>${esc(ww.headline || ('Week ' + wk.week + ' Wrap'))}</h2><span class="sub">PCFL Network AI Analyst</span></div>`;

    // New structured shape — render segments with icons + team logos
    if (Array.isArray(ww.segments) && ww.segments.length){
      const segments = ww.segments.map(s => {
        const meta = SEGMENT_META[s.type] || SEGMENT_META.storyline;
        const teamLogos = (s.teams || []).filter(slug => App.teamMap[slug]).map(slug =>
          `<a href="#/teams/${slug}" class="ww-seg-team" title="${esc(T(slug).name)}"><img src="${logo(slug)}" alt=""><span>${esc(T(slug).abbr)}</span></a>`
        ).join('');
        return `<article class="ww-segment" style="--seg-accent:${meta.accent}">
          <div class="ww-seg-head">
            <span class="ww-seg-tag"><i class="ww-seg-icon">${meta.icon}</i>${meta.tag}</span>
            <div class="ww-seg-teams">${teamLogos}</div>
          </div>
          <h3 class="ww-seg-title">${esc(s.title || '')}</h3>
          <p class="ww-seg-body">${esc(s.body || '')}</p>
        </article>`;
      }).join('');
      return `${head}
        <div class="card reveal weekly-wrap weekly-wrap-v2">
          ${ww.subhead ? `<div class="ww-sub">${esc(ww.subhead)}</div>` : ''}
          ${ww.lead ? `<p class="ww-lead">${esc(ww.lead)}</p>` : ''}
          <div class="ww-segments">${segments}</div>
          ${ww.closer ? `<p class="ww-closer">${esc(ww.closer)}</p>` : ''}
        </div>`;
    }

    // Legacy shape — keep working until cached content refreshes
    return `${head}
      <div class="card reveal weekly-wrap">
        ${ww.subhead ? `<div class="ww-sub">${esc(ww.subhead)}</div>` : ''}
        ${(ww.body || []).map(p => `<p>${esc(p)}</p>`).join('')}
      </div>`;
  })();

  return `
    ${heroHTML}
    ${potwCard(wk)}
    ${wrapHTML}
    <div class="home-grid">
      <div>
        <div class="section-h"><span class="bar"></span><h2>Top Stories</h2><span class="sub">Week ${wk.week} · ${fmtDate(wk.date)}</span><a class="more" href="#/scores">All Scores →</a></div>
        <div class="stories">${stories}</div>
      </div>
      <aside class="rail" style="margin-top:64px">
        <div class="card reveal"><div class="hd"><h3>PCFL Power Poll</h3><a href="#/rankings">Full Poll</a></div>${powerPollRowsMini(wk, 10)}</div>
        <div class="card reveal"><div class="hd"><h3>Players of the Game</h3><a href="#/awards">Awards</a></div>${pogs}</div>
        <div class="card reveal"><div class="hd"><h3>Division Leaders</h3><a href="#/standings">Standings</a></div>${divLeaders}</div>
        ${vids ? `<div class="card reveal" style="background:transparent;border:0;box-shadow:none"><div class="hd" style="border-radius:10px 10px 0 0"><h3>PCFL Network Video</h3><a href="#/media">Media Center</a></div><div class="video-grid" style="grid-template-columns:1fr;border-radius:0 0 10px 10px;overflow:hidden">${vids}</div></div>` : ''}
      </aside>
    </div>
    <div class="section-h"><span class="bar"></span><h2>League Leaders</h2><span class="sub">Through Week ${wk.week}</span><a class="more" href="#/stats">Full Statistics →</a></div>
    <div class="lead-grid">${leaders}</div>`;
};

function powerPollRowsMini(wk, n){
  return wk.powerRankings.slice(0,n).map(r => {
    const mov = r.prev == null ? '<span class="mov even">·</span>'
      : r.prev > r.rank ? `<span class="mov up">▲${r.prev-r.rank}</span>`
      : r.prev < r.rank ? `<span class="mov dn">▼${r.rank-r.prev}</span>`
      : '<span class="mov even">—</span>';
    return `<a class="rank-row" href="#/teams/${r.team}"><span class="num">${r.rank}</span>
      <img src="${logo(r.team)}" alt=""><span class="nm">${esc(T(r.team).name)}</span>
      <span class="rec">${wk.records[r.team]||''}</span>${mov}</a>`;
  }).join('');
}

/* ----------------------------- scores ---------------------------- */
VIEWS.scores = async function(){
  const wk = await weekData();
  const ranks = ranksOf(wk);
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>Scoreboard</h2><span class="sub">Week ${wk.week} · ${fmtDate(wk.date)}</span></div>
    <div class="score-grid">${wk.games.map(g=>gameCard(g, wk, ranks)).join('')}</div>
    ${wk.nextWeek?.games?.length ? `
    <div class="section-h"><span class="bar"></span><h2>Next Week</h2><span class="sub">Week ${wk.nextWeek.week} matchups</span></div>
    <div class="card reveal">${wk.nextWeek.games.map(g=>schedRow({away:g.away,home:g.home,final:false})).join('')}</div>` : ''}`;
};

/* --------------------------- game center ------------------------- */
VIEWS.game = async function(season, week, id, q){
  const wk = await weekData(+season, +week);
  const g = wk.games.find(x => x.id === id);
  if (!g) return `<div class="empty card" style="margin-top:30px"><b>Game not found</b></div>`;
  const ranks = ranksOf(wk);
  const A = T(g.away.team), H = T(g.home.team);
  const win = g.away.score > g.home.score ? 'away' : 'home';
  const tab = q.get('t') || (g.videoId ? 'video' : 'recap');

  const KEY_STATS = ['FIRST DOWNS','TOTAL NET YARDS','NET RUSHING YARDS','NET PASSING YARDS','RETURN YARDS','PENALTIES-YARDS','TIME OF POSSESSION'];
  const bars = g.teamStats.filter(r=>KEY_STATS.includes(r.label)).map(r=>{
    const av = r.label==='TIME OF POSSESSION' ? num(r.away.split(':')[0]) : num(r.away);
    const hv = r.label==='TIME OF POSSESSION' ? num(r.home.split(':')[0]) : num(r.home);
    const tot = av+hv || 1;
    return `<div class="statbar"><div class="lbl"><b>${esc(r.away)}</b><span>${esc(r.label)}</span><b>${esc(r.home)}</b></div>
      <div class="track"><i data-w="${Math.round(av/tot*100)}" style="background:${A.colors.primary};margin-left:auto;border-radius:4px 0 0 4px"></i>
      <i data-w="${Math.round(hv/tot*100)}" style="background:${H.colors.primary};border-radius:0 4px 4px 0"></i></div></div>`;
  }).join('');

  const fullStats = `<table class="box-table"><caption>Team Statistics</caption>
    <tr><th style="text-align:left;padding-left:16px">Stat</th><th>${esc(A.abbr)}</th><th>${esc(H.abbr)}</th></tr>
    ${g.teamStats.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.away)}</td><td>${esc(r.home)}</td></tr>`).join('')}</table>`;

  const boxSide = side => g.box[side].map(sec => `
    <table class="box-table"><caption>${esc(sec.section)}</caption>
      <tr><th>Player</th>${sec.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>
      ${sec.rows.map(r=>`<tr class="${r.total?'total':''}"><td>${esc(r.name)}</td>${r.vals.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
    </table>`).join('');

  const tabs = [
    g.videoId ? ['video','▶ Broadcast'] : null,
    ['recap','Recap'], ['box','Box Score'], ['stats','Team Stats'],
  ].filter(Boolean);

  const tabContent = {
    video: g.videoId ? `<div class="video-shell reveal in"><iframe src="https://www.youtube.com/embed/${g.videoId}?rel=0" title="PCFL Network broadcast" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : '',
    recap: (() => {
      const s = g.aiStory || g.story;
      const isAI = !!g.aiStory;
      const extras = isAI ? `
        ${g.aiStory.turningPoint ? `<div class="recap-cut"><div class="lbl">Turning point</div><p>${esc(g.aiStory.turningPoint)}</p></div>` : ''}
        ${g.aiStory.unsungHero ? `<div class="recap-cut"><div class="lbl">Unsung hero</div><p><b>${esc(g.aiStory.unsungHero.name)}</b> <span style="color:var(--muted-2)">(${esc(T(g.aiStory.unsungHero.team).abbr)})</span> — ${esc(g.aiStory.unsungHero.why)}</p></div>` : ''}
      ` : '';
      return `<div class="card recap-card reveal in"><div class="cat" style="color:var(--red);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em">PCFL Network · Game Recap ${isAI ? '· <span style="color:var(--gold)">AI Analyst</span>' : ''}</div>
        <h2>${esc(s.headline)}</h2>${s.body.map(p=>`<p>${esc(p)}</p>`).join('')}${extras}</div>`;
    })(),
    box: `<div class="card reveal in"><div class="box-2col">
      <div><a href="#/teams/${g.away.team}" style="padding:14px 16px 0;display:flex;gap:10px;align-items:center"><img src="${logo(g.away.team)}" style="width:30px;height:30px" alt=""><b style="font-family:var(--font-head);font-size:16px">${esc(A.name)}</b></a>${boxSide('away')}</div>
      <div><a href="#/teams/${g.home.team}" style="padding:14px 16px 0;display:flex;gap:10px;align-items:center"><img src="${logo(g.home.team)}" style="width:30px;height:30px" alt=""><b style="font-family:var(--font-head);font-size:16px">${esc(H.name)}</b></a>${boxSide('home')}</div>
    </div></div>`,
    stats: `<div class="card reveal in">${fullStats}</div>`,
  };

  return `
    <div class="hero gc-hero reveal" style="--hero-a:${A.colors.primary};--hero-b:${H.colors.primary}">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="chyron"><span class="dot"></span> Final · Week ${wk.week} · ${fmtDate(wk.date)}</div>
      <div class="hero-inner">
        <a class="side" href="#/teams/${g.away.team}"><img src="${logo(g.away.team,true)}" onerror="this.src='${logo(g.away.team)}'" alt="">
          <div><div class="tname">${esc(A.name)}</div><div class="tsub">${rankChip(ranks,g.away.team)}${esc(A.nickname)} · ${wk.records[g.away.team]||''}</div></div></a>
        <div class="mid"><div class="status">Final</div><div class="scores">
          <span class="score" data-count="${g.away.score}">0</span><span class="dash">–</span><span class="score" data-count="${g.home.score}">0</span></div></div>
        <a class="side right" href="#/teams/${g.home.team}"><img src="${logo(g.home.team,true)}" onerror="this.src='${logo(g.home.team)}'" alt="">
          <div><div class="tname">${esc(H.name)}</div><div class="tsub">${rankChip(ranks,g.home.team)}${esc(H.nickname)} · ${wk.records[g.home.team]||''}</div></div></a>
      </div></div>
    ${g.playerOfGame ? `<div class="pog-strip reveal" style="margin-top:18px">
      <img src="${logo(g.playerOfGame.team)}" alt="">
      <div><div class="t">★ Player of the Game</div><b>${esc(g.playerOfGame.name)}</b> <span style="color:var(--muted);font-size:12px">${esc(g.playerOfGame.pos)} · ${esc(T(g.playerOfGame.team).name)}</span>
      ${g.playerOfGameLine?`<div class="line">${esc(g.playerOfGameLine)}</div>`:''}</div></div>` : ''}
    <div class="gc-tabs">${tabs.map(([k,l])=>`<button data-tab="${k}" class="${k===tab?'on':''}">${l}</button>`).join('')}</div>
    <div class="gc-body">
      <div id="gc-pane">${tabContent[tab]||tabContent.recap}</div>
      <aside><div class="card reveal"><div class="hd" style="background:var(--ink-2);color:#fff;padding:11px 16px"><h3 style="font-size:14px">Matchup Stats</h3></div>${bars}</div></aside>
    </div>
    <script type="application/json" id="gc-data">${JSON.stringify({})}</script>`;
};

/* tab behavior for game center (event delegation) */
document.addEventListener('click', async e => {
  const b = e.target.closest('.gc-tabs button');
  if (!b) return;
  const m = location.hash.match(/^#\/game\/(\d+)\/(\d+)\/([a-z\-]+)/);
  if (!m) return;
  const url = `#/game/${m[1]}/${m[2]}/${m[3]}?t=${b.dataset.tab}`;
  history.replaceState(null,'',url);
  route();
});

/* ---------------------------- standings -------------------------- */
VIEWS.standings = async function(){
  const wk = await weekData();
  const conf = c => `<div>
    <div class="section-h"><span class="bar"></span><h2>${esc(c.conference)} Conference</h2></div>
    ${c.divisions.map(d=>`<div class="card reveal" style="margin-bottom:16px">
      <div class="hd" style="background:var(--ink-2);color:#fff;padding:10px 16px"><h3 style="font-size:13px;letter-spacing:.1em">${esc(d.name)} Division</h3></div>
      <table class="div-table">
        <tr><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Strk</th><th>Home</th><th>Away</th><th>Conf</th></tr>
        ${d.teams.map(tm=>`<tr>
          <td><a class="tm" href="#/teams/${tm.team}"><img src="${logo(tm.team)}" alt="">${esc(T(tm.team).name)}</a></td>
          <td>${tm.w}</td><td>${tm.l}</td><td>${tm.pf}</td><td>${tm.pa}</td>
          <td><span class="chip ${tm.streak[0]==='W'?'w':'l'}">${esc(tm.streak)}</span></td>
          <td>${esc(tm.home)}</td><td>${esc(tm.away)}</td><td>${esc(tm.conf)}</td></tr>`).join('')}
      </table></div>`).join('')}
  </div>`;
  return `<div style="margin-top:6px"></div>
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>League Standings</h2><span class="sub">Through Week ${wk.week} · ${fmtDate(wk.date)}</span></div>
    <div class="stand-grid">${wk.standings.map(conf).join('')}</div>`;
};

/* ---------------------------- rankings --------------------------- */
VIEWS.rankings = async function(){
  const wk = await weekData();
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>PCFL Power Poll</h2><span class="sub">Week ${wk.week} · official STAND power rankings</span></div>
    <div class="card reveal" style="margin-bottom:14px">
      <div style="display:grid;grid-template-columns:44px 34px minmax(0,1fr) 70px 90px minmax(0,1.1fr);gap:12px;padding:10px 18px;background:var(--ink-2);color:#9aa1ab;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <span style="text-align:center">Rank</span><span></span><span>Team</span><span>Move</span><span>Power Pts</span><span>Wins Over</span></div>
      ${powerPollRows(wk)}
    </div>`;
};

/* ---------------------------- schedule --------------------------- */
function schedRow(g){
  const aw = T(g.away), hm = T(g.home);
  const awWin = g.final && g.awayScore > g.homeScore, hmWin = g.final && g.homeScore > g.awayScore;
  return `<div class="sched-row">
    <a class="t right ${awWin?'winner':''}" href="#/teams/${g.away}"><span>${esc(aw.name)}</span>${g.final?`<span class="sc">${g.awayScore}</span>`:''}<img src="${logo(g.away)}" alt=""></a>
    <div class="mid">${g.final?`<b>Final${g.notes?' '+esc(g.notes.toUpperCase()):''}</b>`:'<b>@</b>'}</div>
    <a class="t ${hmWin?'winner':''}" href="#/teams/${g.home}"><img src="${logo(g.home)}" alt="">${g.final?`<span class="sc">${g.homeScore}</span>`:''}<span>${esc(hm.name)}</span></a>
  </div>`;
}

VIEWS.schedule = async function(){
  const sched = await getJSON(`data/${App.season}/schedule.json`);
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>${App.season} Season Schedule</h2><span class="sub">15 weeks · 18 teams</span></div>
    ${sched.map(w=>`<div class="sched-week reveal">
      <div class="section-h" style="margin:18px 0 10px"><h2 style="font-size:16px;color:var(--muted)">Week ${w.week}${w.label?` — ${esc(w.label)}`:''}</h2><span class="sub">${fmtDate(w.date)}</span></div>
      <div class="card">${w.games.length ? w.games.map(schedRow).join('') : `<div class="empty">Matchups to be determined${w.label?` — ${esc(w.label)}`:''}.</div>`}</div>
    </div>`).join('')}`;
};

/* ------------------------------ stats ---------------------------- */
VIEWS.stats = async function(_, __, ___, q){
  const wk = await weekData();
  const cat = (q && q.get('cat')) || 'passing';
  const defs = {
    passing:   { title:'Passing', cols:['Player','Team','Att','Com','Pct','Yds','Avg','TD','INT','RTG'], row:p=>[p.att,p.com,p.pct,p.yds,p.avg,p.td,p.int,p.rtg] },
    rushing:   { title:'Rushing', cols:['Player','Team','Att','Yds','Avg','Lg','TD'], row:p=>[p.att,p.yds,p.avg,p.lg,p.td] },
    receiving: { title:'Receiving', cols:['Player','Team','Rec','Yds','Avg','Lg','TD'], row:p=>[p.rec,p.yds,p.avg,p.lg,p.td] },
    sacks:     { title:'Sacks', cols:['Player','Team','Sacks','Safeties'], row:p=>[p.sacks,p.safeties] },
    interceptions: { title:'Interceptions', cols:['Player','Team','INT','Ret Yds','Lg','TD'], row:p=>[p.int,p.yds,p.lg,p.td] },
    tackles:   { title:'Tackles', cols:['Player','Team','Tackles'], row:p=>[p.tackles] },
    scoring:   { title:'Scoring', cols:['Player','Team','Rush TD','Rec TD','Tot TD','XP','FG','Pts'], row:p=>[p.rushTD,p.recTD,p.totTD,p.xp,p.fg,p.pts] },
  };
  const d = defs[cat] || defs.passing;
  const rows = wk.leaders[cat] || [];
  const teamRows = (wk.teamSeasonStats.totalYards||[]).map((r,i)=>{
    const def = (wk.teamSeasonStats.oppTotalYards||[]).find(x=>x.team===r.team);
    return { team:r.team, off: r.ydsGame ?? r.yds, def: def ? (def.ydsGame ?? def.yds) : '—', i };
  });
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>Statistics Hub</h2><span class="sub">Season totals through Week ${wk.week}</span></div>
    <div class="pill-tabs">${Object.entries(defs).map(([k,v])=>`<button class="${k===cat?'on':''}" onclick="location.hash='#/stats?cat=${k}'">${v.title}</button>`).join('')}</div>
    <div class="card reveal">
      <table class="box-table">
        <tr>${d.cols.map((c,i)=>`<th ${i<2?'style="text-align:left;padding-left:16px"':''}>${c}</th>`).join('')}</tr>
        ${rows.slice(0,25).map((p,i)=>`<tr>
          <td style="font-weight:600">${i+1}. ${esc(p.name)} <span style="color:var(--muted-2);font-size:11px">${esc(p.pos)}</span></td>
          <td style="text-align:left"><span style="display:inline-flex;align-items:center;gap:6px"><img src="${logo(p.team)}" style="width:18px;height:18px" alt="">${esc(T(p.team).abbr)}</span></td>
          ${d.row(p).map(v=>`<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}
      </table></div>
    ${teamRows.length ? `
    <div class="section-h"><span class="bar"></span><h2>Team Offense vs Defense</h2><span class="sub">Yards per game</span></div>
    <div class="card reveal"><table class="box-table">
      <tr><th style="text-align:left;padding-left:16px">Team</th><th>Off Yds/G</th><th>Def Yds/G</th></tr>
      ${teamRows.map(r=>`<tr><td><span style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><img src="${logo(r.team)}" style="width:20px;height:20px" alt="">${esc(T(r.team).name)}</span></td><td>${r.off}</td><td>${r.def}</td></tr>`).join('')}
    </table></div>` : ''}`;
};

/* ------------------------------ teams ---------------------------- */
VIEWS.teams = async function(){
  const wk = await weekData();
  const ranks = ranksOf(wk);
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>Teams</h2><span class="sub">18 programs · 2 conferences</span></div>
    <div class="team-grid">${App.teams.map(t=>`
      <a class="card tcard reveal" href="#/teams/${t.slug}" style="background:linear-gradient(135deg,${t.colors.primary} 0%,#101317 130%)">
        <img class="lg" src="${logo(t.slug,true)}" onerror="this.src='${logo(t.slug)}'" alt="">
        <div class="nm">${esc(t.name)}</div><div class="nick">${esc(t.nickname)}</div>
        <div class="rec">${rankChip(ranks,t.slug)}${wk.records[t.slug]||'0-0'} · ${esc(t.conference)} ${esc(t.division)}</div>
      </a>`).join('')}
    </div>`;
};

VIEWS.team = async function(slug){
  const t = T(slug);
  const wk = await weekData();
  const ranks = ranksOf(wk);
  const sched = await getJSON(`data/${App.season}/schedule.json`).catch(()=>[]);
  const rosters = await getJSON(`data/${App.season}/rosters.json`).catch(()=>({}));
  const roster = rosters[slug] || [];
  const games = sched.flatMap(w => w.games.filter(g=>g.away===slug||g.home===slug).map(g=>({...g, week:w.week, date:w.date})));

  const OFF = ['QB','HB','FB','WR','TE','C','G','T'], DEF = ['DE','DT','LB','CB','S'];
  const ATTRS = [['SP','Speed'],['AC','Acceleration'],['AG','Agility'],['ST','Strength'],['HA','Hands'],['EN','Endurance'],['IN','Intelligence'],['DI','Discipline']];
  const rcls = v => v>=90?'r4':v>=80?'r3':v>=70?'r2':'r1';
  const STATUS = { A:['Active','st-a'], I:['Inactive','st-i'], O:['O','st-o'], IR:['IR','st-ir'] };
  const stChip = p => {
    const [label, cls] = STATUS[p.status] || [p.status, 'st-o'];
    let h = `<span class="st-chip ${cls}">${esc(label)}</span>`;
    if (p.inj && p.inj !== 'OK' && p.inj !== p.status) h += ` <span class="st-chip st-ir" title="Injury designation">${esc(p.inj)}</span>`;
    return h;
  };
  const unitOf = p => OFF.includes(p.pos) ? 'offense' : DEF.includes(p.pos) ? 'defense' : 'special';
  const rosterRows = unit => roster.filter(p=>unitOf(p)===unit)
    .sort((a,b)=> OFF.concat(DEF,['K','P']).indexOf(a.pos) - OFF.concat(DEF,['K','P']).indexOf(b.pos) || (a.depth||9)-(b.depth||9))
    .map(p=>`<tr><td>${p.num}</td>
      <td style="font-weight:600;white-space:nowrap">${esc(p.name)}</td>
      <td>${esc(p.pos)}${p.depth?`<span style="color:var(--muted-2)">${p.depth}</span>`:''}</td>
      <td>${esc(p.yr)==='R'?'FR':['','FR','SO','JR','SR'][+p.yr]||esc(p.yr)}</td><td>${esc(p.ht)}</td><td>${p.wt}</td>
      <td style="white-space:nowrap">${stChip(p)}</td>
      <td><span class="ovr ${p.ovr>=85?'elite':p.ovr>=78?'good':'avg'}">${p.ovr}</span></td>
      ${(p.a||[]).map((v,i)=>`<td class="attr"><b class="${rcls(v)}">${v}</b><span>${(p.p||[])[i] ?? ''}</span></td>`).join('')}
    </tr>`).join('');
  const rosterHead = `<tr><th>#</th><th>Player</th><th>Pos</th><th>Yr</th><th>Ht</th><th>Wt</th><th title="Roster designation from the FBPro98 roster file">Status</th><th title="Overall — average of the 8 actual ratings">OVR</th>
    ${ATTRS.map(([k,n])=>`<th class="attr-h" title="${n}">${k}</th>`).join('')}</tr>`;
  const legend = `<div class="attr-legend">${ATTRS.map(([k,n])=>`<span><b>${k}</b> ${n}</span>`).join('')}
    <span class="key"><b>Top</b> actual · <b>bottom</b> potential</span></div>`;

  const leaders = LEADER_DEFS.map(d => {
    const mine = (wk.leaders[d.key]||[]).filter(p=>p.team===slug);
    if (!mine.length) return '';
    const top = mine.sort((a,b)=>d.val(b)-d.val(a))[0];
    return `<div class="minirow"><div style="min-width:0;flex:1"><b>${esc(top.name)}</b><div class="sub">${esc(top.pos)} · ${d.title}</div></div>
      <span style="font-family:var(--font-display);font-size:24px;color:var(--red)">${d.val(top)}</span></div>`;
  }).join('');

  const standLine = (() => {
    for (const c of wk.standings) for (const d of c.divisions){
      const i = d.teams.findIndex(x=>x.team===slug);
      if (i>=0) return { pos: i+1, div: `${c.conference} ${d.name}`, ...d.teams[i] };
    }
    return null;
  })();

  return `
    <div class="team-hero reveal" style="background:linear-gradient(120deg,${t.colors.primary} 0%,#0d0f13 90%)">
      <img class="lg" src="${logo(slug,true)}" onerror="this.src='${logo(slug)}'" alt="">
      <div style="flex:1;min-width:0"><div class="nm">${esc(t.name)} ${esc(t.nickname)}</div>
        <div class="meta">
          <span>Record <b>${wk.records[slug]||'0-0'}</b></span>
          ${ranks[slug]?`<span>Power Poll <b>#${ranks[slug]}</b></span>`:''}
          ${standLine?`<span>${esc(standLine.div)} <b>${['1st','2nd','3rd','4th','5th'][standLine.pos-1]}</b></span><span>PF <b>${standLine.pf}</b></span><span>PA <b>${standLine.pa}</b></span><span>Streak <b>${esc(standLine.streak)}</b></span>`:''}
        </div></div>
      ${t.fightSong ? `
      <button class="fightsong-chip" id="fightsong-chip" data-team="${slug}" title="${esc(t.fightSong.name)}">
        <span class="fs-bars"><i></i><i></i><i></i><i></i></span>
        <span class="fs-lbl">
          <span class="fs-title">${esc(t.fightSong.name)}</span>
          <span class="fs-state" id="fightsong-state">loading…</span>
        </span>
      </button>
      <div id="fightsong-frame-holder" style="position:absolute;left:-9999px;top:0;width:300px;height:200px"></div>
      ` : ''}
    </div>
    <div class="team-cols">
      <div>
        <div class="section-h"><span class="bar"></span><h2>${App.season} Schedule</h2></div>
        <div class="card reveal">${games.map(g=>{
          const home = g.home===slug, opp = home?g.away:g.home;
          const my = home?g.homeScore:g.awayScore, their = home?g.awayScore:g.homeScore;
          const won = g.final && my>their;
          return `<a class="minirow" href="${g.final?`#/game/${App.season}/${g.week}/${g.away}-${g.home}`:`#/teams/${opp}`}">
            <span style="width:42px;color:var(--muted);font-size:11px;font-weight:700">WK ${g.week}</span>
            <img src="${logo(opp)}" alt=""><b>${home?'vs':'at'} ${esc(T(opp).name)}</b>
            <span style="margin-left:auto;font-family:var(--font-head)">${g.final?`<span class="chip ${won?'w':'l'}">${won?'W':'L'}</span> ${my}–${their}${g.notes?` <span style="color:var(--muted-2);font-size:10px">${esc(g.notes.toUpperCase())}</span>`:''}`:`<span style="color:var(--muted-2);font-size:11px">${esc(g.date||'')}</span>`}</span></a>`;
        }).join('')}</div>
      </div>
      <aside>
        <div class="section-h"><span class="bar"></span><h2>Team Leaders</h2></div>
        <div class="card reveal">${leaders || '<div class="empty">No qualified leaders yet.</div>'}</div>
      </aside>
    </div>
    <div class="section-h"><span class="bar"></span><h2>Roster</h2><span class="sub">${roster.length} players · FBPro98 actual &amp; potential ratings</span></div>
    <div class="pill-tabs" id="roster-tabs">
      <button class="on" data-u="offense">Offense</button><button data-u="defense">Defense</button><button data-u="special">Special Teams</button></div>
    ${legend}
    <div class="card reveal roster-card">
      <table class="roster-table"><thead>${rosterHead}</thead>
      <tbody id="roster-body" data-slug="${slug}">${rosterRows('offense')}</tbody></table></div>
    <template id="roster-off">${rosterRows('offense')}</template>
    <template id="roster-def">${rosterRows('defense')}</template>
    <template id="roster-st">${rosterRows('special')}</template>`;
};

document.addEventListener('click', e => {
  const b = e.target.closest('#roster-tabs button');
  if (!b) return;
  document.querySelectorAll('#roster-tabs button').forEach(x=>x.classList.toggle('on', x===b));
  const tpl = { offense:'#roster-off', defense:'#roster-def', special:'#roster-st' }[b.dataset.u];
  $('#roster-body').innerHTML = $(tpl).innerHTML;
});

/* ----------------------------- awards ---------------------------- */
VIEWS.awards = async function(){
  const wk = await weekData();

  // weekly honors computed from this week's box scores
  const perf = { pass:[], rush:[], recv:[], def:[] };
  for (const g of wk.games){
    for (const side of ['away','home']){
      const team = g[side].team;
      for (const sec of g.box[side]){
        for (const r of sec.rows){
          if (r.total) continue;
          if (sec.section==='Passing') perf.pass.push({ name:r.name, team, v:+r.vals[2], line:`${r.vals[1]}/${r.vals[0]}, ${r.vals[2]} yds, ${r.vals[5]} TD` });
          if (sec.section==='Rushing') perf.rush.push({ name:r.name, team, v:+r.vals[1], line:`${r.vals[0]} car, ${r.vals[1]} yds, ${r.vals[4]} TD` });
          if (sec.section==='Receiving') perf.recv.push({ name:r.name, team, v:+r.vals[1], line:`${r.vals[0]} rec, ${r.vals[1]} yds, ${r.vals[4]} TD` });
          if (sec.section==='Defense') perf.def.push({ name:r.name, team, v:+r.vals[0] + (+r.vals[1])*3, line:`${r.vals[0]} tkl, ${r.vals[1]} sacks` });
        }
      }
    }
  }
  const top = a => a.sort((x,y)=>y.v-x.v)[0];
  const honors = [
    ['Passing Performance', top(perf.pass)], ['Rushing Performance', top(perf.rush)],
    ['Receiving Performance', top(perf.recv)], ['Defensive Player of the Week', top(perf.def)],
  ].filter(([,p])=>p);

  // Heisman watch from season leaders
  const score = new Map();
  const add = (p, pts) => {
    const k = `${p.name}|${p.team}`;
    const cur = score.get(k) || { ...p, pts: 0 };
    cur.pts += pts; score.set(k, cur);
  };
  (wk.leaders.passing||[]).forEach(p=>add(p, p.yds*.05 + p.td*5 - p.int*4));
  (wk.leaders.rushing||[]).forEach(p=>add(p, p.yds*.12 + p.td*6));
  (wk.leaders.receiving||[]).forEach(p=>add(p, p.yds*.09 + p.td*6));
  const heisman = [...score.values()].sort((a,b)=>b.pts-a.pts).slice(0,8);
  const maxH = heisman[0]?.pts || 1;

  return `
    ${potwCard(wk)}
    <div class="section-h"><span class="bar"></span><h2>Weekly Honors</h2><span class="sub">Week ${wk.week} top performances</span></div>
    <div class="award-grid">${honors.map(([title,p])=>`
      <div class="card reveal" style="padding:18px;display:flex;gap:14px;align-items:center">
        <img src="${logo(p.team)}" style="width:46px;height:46px" alt="">
        <div><div style="font-size:10px;color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.12em">${title}</div>
        <b style="font-family:var(--font-head);font-size:17px">${esc(p.name)}</b>
        <div style="color:var(--muted);font-size:12px">${esc(T(p.team).name)} — ${esc(p.line)}</div></div></div>`).join('')}
    </div>
    <div class="section-h"><span class="bar"></span><h2>PCFL Heisman Watch</h2><span class="sub">Computed from season production through Week ${wk.week}</span></div>
    <div class="card reveal" style="max-width:760px">${heisman.map((p,i)=>`
      <div class="heisman-row"><span class="rk">${i+1}</span><img src="${logo(p.team)}" alt="">
        <div class="nm">${esc(p.name)}<span>${esc(p.pos)} · ${esc(T(p.team).name)}</span></div>
        <div style="flex:1;max-width:220px"><div class="ptsbar" style="height:6px;background:#eef0f3;border-radius:4px;overflow:hidden"><i data-w="${Math.round(p.pts/maxH*100)}" style="display:block;height:100%;background:linear-gradient(90deg,var(--gold),#d6a012)"></i></div></div>
        <span class="pts">${Math.round(p.pts)}</span></div>`).join('')}
    </div>`;
};

/* ------------------------------ media ----------------------------- */
function videoCardHTML(v, compact){
  const gameLink = v.away && v.home ? `#/game/${v.season}/${v.week}/${v.away}-${v.home}?t=video` : null;
  const title = v.away && v.home ? `${T(v.away).name} at ${T(v.home).name}` : v.title;
  const sub = v.week ? `Week ${v.week} · ${v.season} Season · PCFL Network` : 'PCFL Network';
  const href = gameLink || `https://www.youtube.com/watch?v=${v.id}`;
  const ext = gameLink ? '' : 'target="_blank" rel="noopener"';
  return `<a class="card vcard ${compact?'':'reveal'}" href="${href}" ${ext}>
    <div class="th"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy"><div class="play"><i></i></div></div>
    <div class="info"><b>${esc(title)}</b><div class="sub">${esc(sub)}</div></div></a>`;
}

VIEWS.media = async function(){
  const vids = App.videos;
  const bySeason = {};
  for (const v of vids) (bySeason[v.season ?? 'Other'] ??= []).push(v);
  const sections = Object.entries(bySeason).sort((a,b)=>String(b[0]).localeCompare(String(a[0])))
    .map(([season, list])=>`
      <div class="section-h"><span class="bar"></span><h2>${season==='Other'?'More from PCFL Network':season+' Season Broadcasts'}</h2><span class="sub">${list.length} videos</span></div>
      <div class="video-grid">${list.sort((a,b)=>(b.week||0)-(a.week||0) || b.published.localeCompare(a.published)).map(v=>videoCardHTML(v)).join('')}</div>`).join('');
  return `
    <div class="hero reveal" style="--hero-a:#d6001c;--hero-b:#1c2027;margin-top:22px">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="hero-inner" style="padding:36px 40px">
        <div><div class="chyron" style="margin:0 0 14px"><span class="dot"></span> PCFL Network · Media Center</div>
          <div class="tname" style="font-size:40px">Every snap. Every broadcast.</div>
          <div class="tsub" style="margin-top:10px">Full game replays, produced by PCFL Network.</div></div>
        <a class="btn primary" href="https://www.youtube.com/channel/UCCopjecFoHzlVp99e-3W2yA?sub_confirmation=1" target="_blank" rel="noopener">Subscribe on YouTube</a>
      </div></div>
    ${sections}
    <div class="section-h"><span class="bar"></span><h2>Live Channel Feed</h2></div>
    <div class="card reveal video-shell" style="padding-top:50%"><iframe src="https://www.youtube.com/embed/videoseries?list=UUCopjecFoHzlVp99e-3W2yA" title="PCFL Network uploads" allowfullscreen></iframe></div>`;
};

/* ------------------------------ logs ----------------------------- */
let _jszipLoading = null;
function ensureJSZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (_jszipLoading) return _jszipLoading;
  return _jszipLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.integrity = 'sha384-G2DI/LHi4kEAtQ91+SqM2bMP/+/EWMTM07nQXPwwBPdJiwUv9JpTRrtPUk+W/CKD';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

VIEWS.logs = async function(){
  const wk = await weekData();
  const logs = wk.logFiles || [];
  const gamesByKey = new Map();
  for (const g of wk.games){
    if (g.logFile) gamesByKey.set(g.logFile, g);
  }
  const totalKB = logs.length ? '— ' + logs.length + ' files' : '— none uploaded yet';
  const base = `data/${wk.season}/logs/week${wk.week}`;

  const rows = logs.length ? logs.map(f => {
    const g = gamesByKey.get(f);
    if (g){
      const A = T(g.away.team), H = T(g.home.team);
      const win = g.away.score > g.home.score ? 'away' : 'home';
      return `<a class="log-row" href="${base}/${esc(f)}" download>
        <div class="log-row-game">
          <img src="${logo(g.away.team)}" alt="">
          <span class="${win==='away'?'win':''}">${esc(A.name)} <b>${g.away.score}</b></span>
          <span class="vs">@</span>
          <img src="${logo(g.home.team)}" alt="">
          <span class="${win==='home'?'win':''}">${esc(H.name)} <b>${g.home.score}</b></span>
        </div>
        <div class="log-row-meta"><span class="log-fname">${esc(f)}</span><span class="log-dl-pill">↓ Download</span></div>
      </a>`;
    }
    return `<a class="log-row" href="${base}/${esc(f)}" download>
      <div class="log-row-game"><span style="color:var(--muted)">${esc(f)}</span></div>
      <div class="log-row-meta"><span class="log-dl-pill">↓ Download</span></div>
    </a>`;
  }).join('') : `<div class="empty"><b>No game logs for this week yet</b>
      The commissioner can publish them via the PCFL Updater.</div>`;

  return `
    <div class="hero reveal" style="--hero-a:#1c2027;--hero-b:#101317;margin-top:22px">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="hero-inner" style="padding:30px 36px;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap">
        <div>
          <div class="chyron" style="margin:0 0 14px"><span class="dot"></span> PCFL Network · Game Logs Archive</div>
          <div class="tname" style="font-size:38px">Play-by-play, every snap.</div>
          <div class="tsub" style="margin-top:8px">${wk.season} Season · Week ${wk.week} ${esc(totalKB)}</div>
        </div>
        ${logs.length ? `<button class="btn primary" id="dl-all-zip">↓ Download All (.zip)</button>` : ''}
      </div>
    </div>

    <div class="section-h"><span class="bar"></span><h2>Week ${wk.week} Game Logs</h2><span class="sub">FBPro98 play-by-play text logs</span></div>
    <div class="logs-list">${rows}</div>

    <div class="section-h"><span class="bar"></span><h2>About the logs</h2></div>
    <div class="card reveal" style="padding:20px 24px;max-width:760px">
      <p style="color:var(--muted);font-size:14px;line-height:1.7;margin:0">
        Each <code style="background:#f0f2f4;padding:2px 6px;border-radius:4px;font-family:Consolas,monospace">.log</code>
        file is the complete play-by-play simulation output from FBPro98 for that game — every snap, every formation,
        every result, just as the engine produced it. Click any row above to download.
        The <b>Download All</b> button bundles every log in this week into a single zip.
      </p>
    </div>`;
};

document.addEventListener('click', async e => {
  if (e.target.id !== 'dl-all-zip') return;
  const btn = e.target;
  const originalText = btn.textContent;
  btn.textContent = 'Loading…';
  btn.disabled = true;
  try {
    const wk = await weekData();
    const JSZip = await ensureJSZip();
    const zip = new JSZip();
    const base = `data/${wk.season}/logs/week${wk.week}`;
    let i = 0;
    for (const f of (wk.logFiles || [])){
      btn.textContent = `Fetching ${++i}/${wk.logFiles.length}…`;
      const r = await fetch(`${base}/${f}`);
      if (r.ok) zip.file(f, await r.blob());
    }
    btn.textContent = 'Zipping…';
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PCFL-${wk.season}-week${wk.week}-logs.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    btn.textContent = '✓ Downloaded';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2500);
  } catch (err){
    console.error(err);
    btn.textContent = 'Download failed';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2500);
  }
});

/* ----------------------------- history ---------------------------- */
VIEWS.history = async function(){
  const season = App.manifest.seasons.find(s=>s.year===App.season);
  const weekCards = await Promise.all(season.weeks.map(async w => {
    const wk = await weekData(App.season, w);
    const no1 = wk.powerRankings[0];
    return `<div class="card reveal" style="padding:18px">
      <div style="font-size:10px;color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.12em">Week ${w} · ${fmtDate(wk.date)}</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:10px">
        <img src="${logo(no1.team)}" style="width:40px;height:40px" alt="">
        <div><b style="font-family:var(--font-head);font-size:16px">#1 ${esc(T(no1.team).name)}</b>
        <div style="color:var(--muted);font-size:12px">Power Poll leader</div></div></div>
      ${wk.playerOfWeek?`<div style="margin-top:10px;color:var(--muted);font-size:12.5px">★ POW: <b>${esc(wk.playerOfWeek.name)}</b> (${esc(T(wk.playerOfWeek.team).abbr)})</div>`:''}
      <div style="display:flex;gap:12px;margin-top:14px">
        <a href="#/scores" onclick="setWeek(${w})" style="color:var(--red);font-weight:700;font-size:12px;text-transform:uppercase">Scores</a>
        <a href="#/rankings" onclick="setWeek(${w})" style="color:var(--red);font-weight:700;font-size:12px;text-transform:uppercase">Rankings</a>
      </div></div>`;
  }));
  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>League History</h2><span class="sub">${App.season} season archive</span></div>
    <div class="award-grid">${weekCards.join('')}</div>
    <div class="empty card" style="margin-top:26px"><b>Dynasty records, champions & Hall of Fame</b>Coming as seasons are archived. Every weekly drop is preserved forever in the PCFL data vault.</div>`;
};

/* ----------------------------- preview --------------------------- */
VIEWS.preview = async function(){
  const wk = await weekData();
  // Previews are written for week+1 of the latest completed drop. Try that
  // first, then the current week (so the operator can still navigate to a
  // specific future week from the selector). Bail with empty state if neither.
  let prev = null, prevWeek = null;
  for (const candidate of [App.week + 1, App.week]){
    try {
      const data = await getJSON(`data/${App.season}/previews/week${candidate}.json`);
      if (data?.games?.length){ prev = data; prevWeek = candidate; break; }
    } catch { /* keep trying */ }
  }
  if (!prev){
    return `<div class="empty card" style="margin-top:30px"><b>No preview written yet</b>
      Previews are generated by the PCFL Network AI analyst after each weekly drop, looking forward to the next week's matchups. They'll appear here automatically.</div>`;
  }
  const gotw = prev.gameOfWeek;
  const ranks = ranksOf(wk);

  const heroHTML = gotw ? (() => {
    const A = T(gotw.away), H = T(gotw.home);
    const pred = gotw.prediction;
    const predWinnerSlug = pred?.winner;
    return `<div class="hero reveal" style="--hero-a:${A.colors.primary};--hero-b:${H.colors.primary}">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="chyron"><span class="dot"></span> PCFL Network · Game of the Week · Week ${prevWeek} Preview</div>
      <div class="hero-inner">
        <a class="side" href="#/teams/${gotw.away}">
          <img src="${logo(gotw.away,true)}" onerror="this.src='${logo(gotw.away)}'" alt="">
          <div><div class="tname">${esc(A.name)}</div><div class="tsub">${rankChip(ranks,gotw.away)}${esc(A.nickname)} · ${wk.records[gotw.away]||''}</div></div>
        </a>
        <div class="mid">
          <div class="status" style="color:var(--gold)">${pred?.confidence != null ? `${Math.round(pred.confidence*100)}% confidence` : 'Preview'}</div>
          <div class="scores">
            ${pred?.score ? `<span class="score">${pred.score.split('-')[0]}</span><span class="dash">–</span><span class="score">${pred.score.split('-')[1]}</span>` : '<span class="score">?</span><span class="dash">–</span><span class="score">?</span>'}
          </div>
          ${pred?.winner ? `<div style="margin-top:8px;font-family:var(--font-head);color:#fff;font-size:11px;letter-spacing:.18em;text-transform:uppercase">Projected: ${esc(T(predWinnerSlug).name)}</div>` : ''}
        </div>
        <a class="side right" href="#/teams/${gotw.home}">
          <img src="${logo(gotw.home,true)}" onerror="this.src='${logo(gotw.home)}'" alt="">
          <div><div class="tname">${esc(H.name)}</div><div class="tsub">${rankChip(ranks,gotw.home)}${esc(H.nickname)} · ${wk.records[gotw.home]||''}</div></div>
        </a>
      </div>
      ${gotw.headline ? `<div style="background:rgba(0,0,0,.32);padding:18px 28px 22px;color:#fff">
        <div style="font-family:var(--font-head);font-size:18px;margin-bottom:6px">${esc(gotw.headline)}</div>
        <div style="font-size:13.5px;color:rgba(255,255,255,.78)">${esc(gotw.subhead||'')}</div>
      </div>` : ''}
    </div>`;
  })() : '';

  // Schedule games don't carry an `id` — identify GotW by team pair.
  const isGotW = g => gotw && g.away === gotw.away && g.home === gotw.home;
  const cards = prev.games.filter(g => !isGotW(g)).map(g => {
    if (!g.headline) return ''; // skip games without AI content
    const A = T(g.away), H = T(g.home), pred = g.prediction;
    return `<div class="card reveal preview-card">
      <div class="prev-top">
        <a href="#/teams/${g.away}" class="prev-team"><img src="${logo(g.away)}" alt=""><b>${esc(A.name)}</b><span>${wk.records[g.away]||''}</span></a>
        <span class="prev-at">at</span>
        <a href="#/teams/${g.home}" class="prev-team right"><img src="${logo(g.home)}" alt=""><b>${esc(H.name)}</b><span>${wk.records[g.home]||''}</span></a>
      </div>
      <h3 class="prev-head">${esc(g.headline)}</h3>
      ${g.subhead ? `<div class="prev-sub">${esc(g.subhead)}</div>` : ''}
      <div class="prev-body">${(g.body||[]).map(p=>`<p>${esc(p)}</p>`).join('')}</div>
      <div class="prev-meta">
        ${pred ? `<div class="prev-pred"><span class="lbl">Projected</span> <b>${esc(T(pred.winner).name)} ${esc(pred.score||'')}</b> <span class="conf">${pred.confidence!=null?`(${Math.round(pred.confidence*100)}%)`:''}</span></div>` : ''}
        ${g.xFactor ? `<div class="prev-x"><span class="lbl">X-factor</span> ${esc(T(g.xFactor.team).abbr)} ${esc(g.xFactor.role||'')} — ${esc(g.xFactor.why||'')}</div>` : ''}
        ${g.keyMatchup ? `<div class="prev-key"><span class="lbl">Key matchup</span> ${esc(g.keyMatchup)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `${heroHTML}
    <div class="section-h"><span class="bar"></span><h2>Week ${prevWeek} Previews</h2><span class="sub">AI Network analyst column</span></div>
    <div class="preview-grid">${cards || `<div class="empty">No additional previews ready.</div>`}</div>`;
};

/* ----------------------------- playoffs -------------------------- */
VIEWS.playoffs = async function(){
  let p = null;
  try { p = await getJSON(`data/${App.season}/playoffs.json`); } catch { p = null; }
  if (!p){
    return `<div class="empty card" style="margin-top:30px"><b>Playoff picture not available</b>Run a weekly drop to compute the bracket.</div>`;
  }
  const remaining = Math.max(0, p.regularWeeks - p.throughWeek);
  const seedRow = s => `
    <div class="seed-row ${s.divWinner?'div-winner':'wild-card'}">
      <span class="seed-num">${s.seed}</span>
      <a href="#/teams/${s.team}" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
        <img src="${logo(s.team)}" alt="" style="width:26px;height:26px">
        <span class="seed-nm">${esc(T(s.team).name)}</span>
      </a>
      <span class="seed-rec">${s.w}-${s.l}</span>
      <span class="seed-pf">${s.pf}/${s.pa}</span>
      <span class="seed-badge ${s.divWinner?'dw':'wc'}">${s.divWinner?'Div Winner':'Wild Card'}</span>
    </div>`;

  const matchupCard = m => m.higher && m.lower ? `
    <div class="bracket-match">
      <div class="bm-row"><span class="bm-seed">#${m.higher.seed}</span><img src="${logo(m.higher.team)}" alt=""><span>${esc(T(m.higher.team).abbr)}</span><span class="bm-rec">${m.higher.w}-${m.higher.l}</span></div>
      <div class="bm-row"><span class="bm-seed">#${m.lower.seed}</span><img src="${logo(m.lower.team)}" alt=""><span>${esc(T(m.lower.team).abbr)}</span><span class="bm-rec">${m.lower.w}-${m.lower.l}</span></div>
    </div>` : `<div class="bracket-match" style="opacity:.35"><div class="bm-row"><span>TBD</span></div></div>`;

  const confColumn = (conf, seeds) => `
    <div class="bracket-conf">
      <div class="bracket-conf-hd">${esc(conf)} Conference</div>
      <div class="bracket-stage">
        <div class="stage-lbl">Wild card</div>
        ${matchupCard(p.bracket[conf].wildCard[0])}
        ${matchupCard(p.bracket[conf].wildCard[1])}
      </div>
      <div class="bracket-stage">
        <div class="stage-lbl">Conf championship</div>
        ${matchupCard(p.bracket[conf].championship)}
      </div>
      <div class="bracket-seeds">
        ${seeds.map(seedRow).join('')}
      </div>
    </div>`;

  const bowlRow = b => `
    <div class="bowl-row">
      <div class="bowl-name">${esc(b.name)}</div>
      <div class="bowl-teams">
        ${b.teams.map(t => `<a href="#/teams/${t}" style="display:inline-flex;align-items:center;gap:6px"><img src="${logo(t)}" alt="" style="width:20px;height:20px"><b>${esc(T(t).abbr)}</b></a>`).join('<span class="bowl-vs">vs</span>')}
      </div>
    </div>`;

  const hunt = Object.entries(p.teamStatus).filter(([,t])=>t.status==='in-the-hunt')
    .sort((a,b)=>b[1].winPct - a[1].winPct).slice(0,8);
  const eliminated = Object.entries(p.teamStatus).filter(([,t])=>t.status==='eliminated');

  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>Playoff Picture</h2>
      <span class="sub">Through Week ${p.throughWeek} · ${remaining} regular-season game${remaining===1?'':'s'} remaining</span></div>

    <div class="bracket-grid">
      ${confColumn('Western', p.confSeeds.Western || [])}
      ${confColumn('Eastern', p.confSeeds.Eastern || [])}
    </div>

    ${p.bowlProjections?.length ? `
    <div class="section-h"><span class="bar"></span><h2>Bowl Projections</h2><span class="sub">For teams ≥6 wins not in the playoff field</span></div>
    <div class="card reveal">
      ${p.bowlProjections.map(bowlRow).join('')}
    </div>` : ''}

    ${hunt.length ? `
    <div class="section-h"><span class="bar"></span><h2>In the Hunt</h2><span class="sub">Mathematically alive</span></div>
    <div class="card reveal">
      ${hunt.map(([slug,t]) => `
        <div class="hunt-row">
          <a href="#/teams/${slug}" style="display:flex;align-items:center;gap:8px;flex:1"><img src="${logo(slug)}" alt="" style="width:22px;height:22px"><b>${esc(T(slug).name)}</b></a>
          <span style="font-family:var(--font-head);color:var(--muted)">${t.w}-${t.l}</span>
          <span style="font-size:11px;color:var(--muted-2)">max ${t.maxWins} wins</span>
        </div>`).join('')}
    </div>` : ''}

    ${eliminated.length ? `
    <div class="section-h"><span class="bar"></span><h2>Eliminated</h2></div>
    <div class="card reveal" style="opacity:.7">
      ${eliminated.map(([slug,t]) => `
        <div class="hunt-row">
          <a href="#/teams/${slug}" style="display:flex;align-items:center;gap:8px;flex:1"><img src="${logo(slug)}" alt="" style="width:22px;height:22px"><span>${esc(T(slug).name)}</span></a>
          <span style="font-family:var(--font-head);color:var(--muted-2)">${t.w}-${t.l}</span>
        </div>`).join('')}
    </div>` : ''}
  `;
};

/* ----------------------------- compare --------------------------- */

/* ------ Roster unit scoring helpers (used by VIEWS.compare) ------ */
// Default total roster slots considered per position (configurable per-user
// via URL params). "QB: 2" means we compare the top 2 QBs (1 starter + 1 depth).
const DEFAULT_DEPTHS = {
  QB: 2, HB: 4, FB: 2, WR: 5, TE: 2, C: 2, G: 3, T: 3, K: 1,
  DE: 4, DT: 2, LB: 5, CB: 5, S: 3, P: 1,
};
// Starter counts are fixed by football convention.
const STARTER_COUNTS = {
  QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, C: 1, G: 2, T: 2, K: 1,
  DE: 2, DT: 2, LB: 3, CB: 2, S: 2, P: 1,
};
const POS_LABELS = {
  QB:'Quarterback', HB:'Halfback', FB:'Fullback', WR:'Wide Receiver', TE:'Tight End',
  C:'Center', G:'Guard', T:'Tackle', K:'Kicker',
  DE:'Defensive End', DT:'Defensive Tackle', LB:'Linebacker',
  CB:'Cornerback', S:'Safety', P:'Punter',
};

const UNIT_GROUPS = {
  offense: [
    { name: 'Quarterback',     positions: ['QB'] },
    { name: 'Running Backs',   positions: ['HB', 'FB'] },
    { name: 'Receivers',       positions: ['WR', 'TE'] },
    { name: 'Offensive Line',  positions: ['C', 'G', 'T'] },
    { name: 'Kicker',          positions: ['K'] },
  ],
  defense: [
    { name: 'Defensive Line',  positions: ['DE', 'DT'] },
    { name: 'Linebackers',     positions: ['LB'] },
    { name: 'Defensive Backs', positions: ['CB', 'S'] },
    { name: 'Punter',          positions: ['P'] },
  ],
};

const ATTRS_KEYS = [['SP','Speed'],['AC','Acceleration'],['AG','Agility'],['ST','Strength'],['HA','Hands'],['EN','Endurance'],['IN','Intelligence'],['DI','Discipline']];
const ratingClass = v => v>=90?'r4':v>=80?'r3':v>=70?'r2':'r1';

function getCompareConfig(q){
  const cfg = { depths: { ...DEFAULT_DEPTHS }, penalty: true };
  for (const pos of Object.keys(DEFAULT_DEPTHS)){
    const v = q.get(pos.toLowerCase());
    if (v != null && +v >= 1) cfg.depths[pos] = Math.min(8, Math.max(1, +v));
  }
  if (q.get('pen') === '0') cfg.penalty = false;
  return cfg;
}

function scorePosition(roster, pos, totalDepth, cfg){
  const startersCount = STARTER_COUNTS[pos] || 1;
  const expectedDepth = Math.max(0, totalDepth - startersCount);
  // Active (A) and operational/depth (O) players only — skip I, IR
  const players = roster
    .filter(p => p.pos === pos && (p.status === 'A' || p.status === 'O'))
    .sort((x, y) => {
      if (x.status !== y.status) return x.status === 'A' ? -1 : 1;
      return (x.depth || 99) - (y.depth || 99);
    });
  const starters = players.slice(0, startersCount);
  const backups  = players.slice(startersCount, startersCount + expectedDepth);

  let penalty = 0;
  const reasons = [];
  if (cfg.penalty){
    if (starters.length === 0){
      penalty = -2;
      reasons.push(`No ${pos} on roster (−2)`);
    } else if (starters.length < startersCount){
      const missing = startersCount - starters.length;
      penalty = -2 * missing;
      reasons.push(`${missing} ${pos} starter slot${missing>1?'s':''} unfilled (${penalty})`);
    } else if (backups.length === 0 && expectedDepth > 0){
      penalty = -1;
      reasons.push(`No ${pos} depth (−1)`);
    }
  }

  const avg = arr => arr.length ? arr.reduce((s,p)=>s+p.ovr,0)/arr.length : 0;
  const starterAvg = avg(starters);
  const backupAvg  = avg(backups);
  const talentedDepth = backups.filter(p => p.ovr >= 80).length;
  const depthBonus = (backupAvg * 0.15) + (talentedDepth * 1.5);
  const score = starterAvg + depthBonus + penalty;

  if (talentedDepth > 0) reasons.push(`${talentedDepth} talented backup${talentedDepth>1?'s':''} (≥80 OVR) +${(talentedDepth*1.5).toFixed(1)}`);
  if (backupAvg > 0)      reasons.push(`depth avg ${backupAvg.toFixed(1)} → +${(backupAvg*0.15).toFixed(1)}`);

  return {
    pos, players: [...starters, ...backups], starters, backups,
    starterAvg: +starterAvg.toFixed(1),
    backupAvg:  +backupAvg.toFixed(1),
    depthBonus: +depthBonus.toFixed(1),
    penalty, talentedDepth,
    score: +score.toFixed(1),
    reasons,
  };
}

function scoreUnit(roster, unit, cfg){
  const subs = [];
  let total = 0;
  for (const pos of unit.positions){
    const s = scorePosition(roster, pos, cfg.depths[pos], cfg);
    subs.push(s);
    total += s.score;
  }
  return { name: unit.name, subs, total: +total.toFixed(1) };
}

function scoreSide(roster, side, cfg){
  if (!roster) return { units: [], total: 0 };
  const units = UNIT_GROUPS[side].map(u => scoreUnit(roster, u, cfg));
  const total = units.reduce((s, u) => s + u.total, 0);
  return { units, total: +total.toFixed(1) };
}

VIEWS.compare = async function(_, __, ___, q){
  const wk = await weekData();
  const sos = await getJSON(`data/${App.season}/sos.json`).catch(() => ({}));
  const rosters = await getJSON(`data/${App.season}/rosters.json`).catch(() => ({}));
  const aSlug = q.get('a') || 'texas';
  const bSlug = q.get('b') || 'notre-dame';
  const tab = q.get('tab') || 'season';
  const A = T(aSlug), B = T(bSlug);

  const standOf = slug => {
    for (const c of wk.standings) for (const d of c.divisions){
      const tm = d.teams.find(t => t.team === slug);
      if (tm) return tm;
    }
    return null;
  };
  const sA = standOf(aSlug), sB = standOf(bSlug);
  const tsLookup = (cat, slug) => (wk.teamSeasonStats?.[cat] || []).find(r => r.team === slug) || {};

  const compareRow = (label, va, vb, fmt = v => v, dir = 'higher') => {
    const va2 = +va || 0, vb2 = +vb || 0;
    const aBetter = dir === 'higher' ? va2 > vb2 : va2 < vb2;
    const bBetter = dir === 'higher' ? vb2 > va2 : vb2 < va2;
    return `<div class="cmp-row">
      <span class="cmp-val ${aBetter?'win':''}">${fmt(va)}</span>
      <span class="cmp-lbl">${esc(label)}</span>
      <span class="cmp-val right ${bBetter?'win':''}">${fmt(vb)}</span>
    </div>`;
  };

  // head-to-head: any game involving both teams (from the schedule)
  const sched = await getJSON(`data/${App.season}/schedule.json`).catch(() => []);
  const h2h = [];
  for (const w of sched) for (const g of w.games){
    if ((g.away === aSlug && g.home === bSlug) || (g.away === bSlug && g.home === aSlug)){
      h2h.push({ ...g, week: w.week, date: w.date });
    }
  }

  // User-configurable per-position depths + penalty toggle from URL
  const cfg = getCompareConfig(q);

  // Compute roster-unit scores once per side per tab
  const sideA = scoreSide(rosters[aSlug], 'offense', cfg);
  const sideB = scoreSide(rosters[bSlug], 'offense', cfg);
  const defA  = scoreSide(rosters[aSlug], 'defense', cfg);
  const defB  = scoreSide(rosters[bSlug], 'defense', cfg);
  const totalA = +(sideA.total + defA.total).toFixed(1);
  const totalB = +(sideB.total + defB.total).toFixed(1);
  const totalWinner = totalA === totalB ? null : (totalA > totalB ? aSlug : bSlug);

  /* Render full roster table for one team's players at a position group */
  const playerTable = (players, slug) => {
    const tm = T(slug);
    const head = `<tr><th>#</th><th>Player</th><th>Pos</th><th title="Overall — average of the 8 actual ratings">OVR</th>
      ${ATTRS_KEYS.map(([k,n])=>`<th class="attr-h" title="${n}">${k}</th>`).join('')}</tr>`;
    if (!players.length){
      return `<div class="cmp-team-block">
        <div class="cmp-team-head"><img src="${logo(slug)}" alt=""><b>${esc(tm.name)}</b></div>
        <div class="cmp-empty">No player at this position</div>
      </div>`;
    }
    const rows = players.map(p => `<tr>
      <td>${p.num}</td>
      <td style="font-weight:600;white-space:nowrap">${esc(p.name)}</td>
      <td>${esc(p.pos)}${p.depth?`<span style="color:var(--muted-2)">${p.depth}</span>`:''}</td>
      <td><span class="ovr ${p.ovr>=85?'elite':p.ovr>=78?'good':'avg'}">${p.ovr}</span></td>
      ${(p.a||[]).map((v,i)=>`<td class="attr"><b class="${ratingClass(v)}">${v}</b><span>${(p.p||[])[i] ?? ''}</span></td>`).join('')}
    </tr>`).join('');
    return `<div class="cmp-team-block">
      <div class="cmp-team-head"><img src="${logo(slug)}" alt=""><b>${esc(tm.name)}</b></div>
      <div class="cmp-team-table-wrap">
        <table class="roster-table cmp-roster"><thead>${head}</thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  };

  /* Render one position row inside a unit (e.g. "QB" or "HB") */
  const positionRow = (posA, posB) => {
    const aWin = posA.score > posB.score;
    const bWin = posB.score > posA.score;
    const winnerLabel = aWin ? `<span class="rcmp-pwin">${esc(A.abbr)} wins</span>`
                     : bWin ? `<span class="rcmp-pwin">${esc(B.abbr)} wins</span>`
                     : `<span class="rcmp-ptie">even</span>`;
    return `<div class="rcmp-prow">
      <div class="rcmp-phead-row">
        <div class="rcmp-pscoreA ${aWin?'win':''}">${posA.score}</div>
        <div class="rcmp-pname-row">
          <span class="rcmp-poslabel">${esc(POS_LABELS[posA.pos] || posA.pos)} <code>${posA.pos}</code></span>
          ${aWin ? `<span class="rcmp-check left">✓</span>` : bWin ? `<span class="rcmp-check right">✓</span>` : ''}
          <span class="rcmp-depth">(top ${cfg.depths[posA.pos]} compared)</span>
        </div>
        <div class="rcmp-pscoreB ${bWin?'win':''}">${posB.score}</div>
      </div>
      ${playerTable(posA.players, aSlug)}
      ${playerTable(posB.players, bSlug)}
      ${(posA.reasons.length || posB.reasons.length) ? `<div class="rcmp-reasons">
        <div class="rcmp-rcol"><div class="rcmp-rlbl">${esc(A.abbr)} bonus / penalty</div>${posA.reasons.length?posA.reasons.map(r=>`<div>· ${esc(r)}</div>`).join(''):'<div class="rcmp-empty-r">—</div>'}</div>
        <div class="rcmp-rcol"><div class="rcmp-rlbl">${esc(B.abbr)} bonus / penalty</div>${posB.reasons.length?posB.reasons.map(r=>`<div>· ${esc(r)}</div>`).join(''):'<div class="rcmp-empty-r">—</div>'}</div>
      </div>` : ''}
      <div class="rcmp-winner-strip">${winnerLabel}</div>
    </div>`;
  };

  /* Render a unit (one or more positions grouped) */
  const unitBlock = (uA, uB) => {
    const aWin = uA.total > uB.total;
    const bWin = uB.total > uA.total;
    const rows = uA.subs.map((sa, i) => positionRow(sa, uB.subs[i])).join('');
    return `<div class="rcmp-unit">
      <div class="rcmp-uhead">
        <span class="rcmp-uscore ${aWin?'win':''}">${uA.total}</span>
        <span class="rcmp-uname">${esc(uA.name)} ${aWin?'<span class="rcmp-check">✓</span>':bWin?'<span class="rcmp-check right">✓</span>':''}</span>
        <span class="rcmp-uscore right ${bWin?'win':''}">${uB.total}</span>
      </div>
      ${rows}
    </div>`;
  };

  const sideTab = (units, side) => {
    const aTotal = units.A.total, bTotal = units.B.total;
    const aWin = aTotal > bTotal;
    return `
      <div class="rcmp-toplabel">
        <span>${esc(A.name)}</span><span>${esc(side[0].toUpperCase()+side.slice(1))} Comparison</span><span>${esc(B.name)}</span>
      </div>
      ${units.A.units.map((u, i) => unitBlock(u, units.B.units[i])).join('')}
      <div class="rcmp-sidetotal">
        <span class="rcmp-stscore ${aWin?'win':''}">${aTotal}</span>
        <span class="rcmp-stname">${side[0].toUpperCase()+side.slice(1)} Total</span>
        <span class="rcmp-stscore right ${!aWin && bTotal>aTotal?'win':''}">${bTotal}</span>
      </div>`;
  };

  const tabsHTML = `<div class="pill-tabs" style="margin:18px 0 12px">
    <button class="${tab==='season'?'on':''}" onclick="location.hash='#/compare?a=${aSlug}&b=${bSlug}&tab=season'">Season Stats</button>
    <button class="${tab==='offense'?'on':''}" onclick="location.hash='#/compare?a=${aSlug}&b=${bSlug}&tab=offense'">Offense (Roster)</button>
    <button class="${tab==='defense'?'on':''}" onclick="location.hash='#/compare?a=${aSlug}&b=${bSlug}&tab=defense'">Defense (Roster)</button>
  </div>`;

  let body = '';
  if (tab === 'season'){
    const passingA = tsLookup('passing', aSlug), passingB = tsLookup('passing', bSlug);
    const rushingA = tsLookup('rushing', aSlug), rushingB = tsLookup('rushing', bSlug);
    const scoringA = tsLookup('scoring', aSlug), scoringB = tsLookup('scoring', bSlug);
    const totalYdsA = tsLookup('totalYards', aSlug), totalYdsB = tsLookup('totalYards', bSlug);
    body = `
      <div class="card reveal cmp-card">
        <div class="cmp-section">Season record</div>
        ${compareRow('Wins', sA?.w, sB?.w)}
        ${compareRow('Losses', sA?.l, sB?.l, v=>v, 'lower')}
        ${compareRow('Points for', sA?.pf, sB?.pf)}
        ${compareRow('Points against', sA?.pa, sB?.pa, v=>v, 'lower')}
        ${compareRow('Point diff', (sA?.pf-sA?.pa), (sB?.pf-sB?.pa), v => (v>0?'+':'') + v)}
        ${compareRow('Streak', sA?.streak, sB?.streak, esc)}
        ${compareRow('Strength of schedule', sos[aSlug], sos[bSlug], v => v ? (v*100).toFixed(1)+'%' : '—')}
      </div>
      <div class="card reveal cmp-card">
        <div class="cmp-section">Offense</div>
        ${compareRow('Pass yards', passingA.yds, passingB.yds)}
        ${compareRow('Pass TDs', passingA.td, passingB.td)}
        ${compareRow('Passer rating', passingA.rtg, passingB.rtg)}
        ${compareRow('Rush yards', rushingA.yds, rushingB.yds)}
        ${compareRow('Rush TDs', rushingA.td, rushingB.td)}
        ${compareRow('Total yards/G', totalYdsA.ydsGame, totalYdsB.ydsGame)}
        ${compareRow('Points/G', scoringA.ptsGame, scoringB.ptsGame)}
      </div>
      ${h2h.length ? `
      <div class="card reveal cmp-card">
        <div class="cmp-section">Head-to-head</div>
        ${h2h.map(g => {
          const aIsAway = g.away === aSlug;
          const sa = g.final ? (aIsAway ? g.awayScore : g.homeScore) : null;
          const sb = g.final ? (aIsAway ? g.homeScore : g.awayScore) : null;
          return `<div class="h2h-row">
            <span>Week ${g.week} · ${esc(g.date||'')}</span>
            <span>${g.final ? `<b>${sa}</b>–<b>${sb}</b> at ${esc(T(aIsAway?g.home:g.away).abbr)}` : 'Scheduled'}</span>
          </div>`;
        }).join('')}
      </div>` : ''}`;
  } else if (tab === 'offense'){
    if (!rosters[aSlug] || !rosters[bSlug]){
      body = `<div class="empty card"><b>Roster comparison unavailable</b>Rosters must be uploaded for both teams.</div>`;
    } else {
      body = `<div class="card reveal">${sideTab({ A: sideA, B: sideB }, 'offense')}</div>`;
    }
  } else if (tab === 'defense'){
    if (!rosters[aSlug] || !rosters[bSlug]){
      body = `<div class="empty card"><b>Roster comparison unavailable</b>Rosters must be uploaded for both teams.</div>`;
    } else {
      body = `<div class="card reveal">${sideTab({ A: defA, B: defB }, 'defense')}</div>`;
    }
  }

  // Always-visible overall summary at bottom (when rosters available)
  const overallHTML = (rosters[aSlug] && rosters[bSlug]) ? `
    <div class="card reveal rcmp-overall">
      <div class="rcmp-othead">Overall Roster Strength</div>
      <div class="rcmp-otgrid">
        <div class="rcmp-otside ${totalA>totalB?'win':''}">
          <div class="rcmp-otname">${esc(A.name)}</div>
          <div class="rcmp-ottot">${totalA}</div>
          <div class="rcmp-otsub">Offense ${sideA.total} · Defense ${defA.total}</div>
        </div>
        <div class="rcmp-otvs">${totalWinner ? `<span class="rcmp-check">✓ ${esc(T(totalWinner).abbr)}</span>` : '<span>EVEN</span>'}</div>
        <div class="rcmp-otside right ${totalB>totalA?'win':''}">
          <div class="rcmp-otname">${esc(B.name)}</div>
          <div class="rcmp-ottot">${totalB}</div>
          <div class="rcmp-otsub">Offense ${sideB.total} · Defense ${defB.total}</div>
        </div>
      </div>
      <div class="rcmp-otnote">Scoring: avg OVR of active starters + depth bonus (15% of backup avg, +1.5 per backup ≥80) − penalties for missing players (−2 per missing starter, −1 if no depth).</div>
    </div>` : '';

  return `
    <div class="section-h" style="margin-top:28px"><span class="bar"></span><h2>Team Comparison</h2><span class="sub">Head-to-head breakdown</span></div>

    <div class="cmp-pickers">
      <div>
        <label>Team A</label>
        <select onchange="location.hash='#/compare?a='+this.value+'&b=${bSlug}&tab=${tab}'">
          ${App.teams.map(t => `<option value="${t.slug}" ${t.slug===aSlug?'selected':''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Team B</label>
        <select onchange="location.hash='#/compare?a=${aSlug}&b='+this.value+'&tab=${tab}'">
          ${App.teams.map(t => `<option value="${t.slug}" ${t.slug===bSlug?'selected':''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="cmp-hero">
      <a href="#/teams/${aSlug}" class="cmp-side" style="background:linear-gradient(135deg, ${A.colors.primary}, #0d0f13 130%)">
        <img src="${logo(aSlug,true)}" onerror="this.src='${logo(aSlug)}'" alt="">
        <div><div class="cmp-name">${esc(A.name)}</div><div class="cmp-nick">${esc(A.nickname)}</div></div>
      </a>
      <div class="cmp-vs">VS</div>
      <a href="#/teams/${bSlug}" class="cmp-side right" style="background:linear-gradient(135deg, ${B.colors.primary}, #0d0f13 130%)">
        <img src="${logo(bSlug,true)}" onerror="this.src='${logo(bSlug)}'" alt="">
        <div style="text-align:right"><div class="cmp-name">${esc(B.name)}</div><div class="cmp-nick">${esc(B.nickname)}</div></div>
      </a>
    </div>

    ${tabsHTML}
    ${body}
    ${overallHTML}
    ${cfgPanelHTML(cfg)}
  `;
};

/* Configuration flyout panel — rendered once inside VIEWS.compare */
function cfgPanelHTML(cfg){
  const stepper = (pos) => `<div class="cfg-row">
    <span class="cfg-row-lbl">${POS_LABELS[pos]} <code>${pos}</code></span>
    <div class="cfg-stepper">
      <button type="button" onclick="window.stepCfg('${pos.toLowerCase()}',-1)">−</button>
      <span class="cfg-val">${cfg.depths[pos]}</span>
      <button type="button" onclick="window.stepCfg('${pos.toLowerCase()}',1)">+</button>
    </div>
  </div>`;
  const offPositions = ['QB','HB','FB','WR','TE','C','G','T','K'];
  const defPositions = ['DE','DT','LB','CB','S','P'];
  return `
    <button class="cfg-toggle" type="button" onclick="window.cfgOpen()">⚙ Configure</button>
    <div class="cfg-overlay" onclick="window.cfgClose()"></div>
    <aside class="cfg-panel" aria-hidden="true">
      <div class="cfg-head">
        <h3>Comparison Settings</h3>
        <button type="button" class="cfg-close" onclick="window.cfgClose()" aria-label="Close">✕</button>
      </div>
      <div class="cfg-body">
        <div class="cfg-section">
          <div class="cfg-section-head">Offense — depth per position</div>
          ${offPositions.map(stepper).join('')}
        </div>
        <div class="cfg-section">
          <div class="cfg-section-head">Defense — depth per position</div>
          ${defPositions.map(stepper).join('')}
        </div>
        <div class="cfg-section">
          <div class="cfg-section-head">Penalties</div>
          <label class="cfg-toggle-row">
            <input type="checkbox" ${cfg.penalty?'checked':''} onchange="window.updateCfg('pen', this.checked ? null : 0)">
            <span>Penalize missing players</span>
          </label>
          <div class="cfg-note">−2 per missing starter, −1 if no depth at the position</div>
        </div>
        <div class="cfg-actions">
          <button type="button" class="cfg-reset" onclick="window.resetCfg()">Reset to Defaults</button>
        </div>
      </div>
    </aside>`;
}

// URL-based config helpers (state lives in the hash query string)
window.cfgOpen = () => {
  document.querySelector('.cfg-panel')?.classList.add('open');
  document.querySelector('.cfg-overlay')?.classList.add('open');
};
window.cfgClose = () => {
  document.querySelector('.cfg-panel')?.classList.remove('open');
  document.querySelector('.cfg-overlay')?.classList.remove('open');
};
function _hashParams(){
  const [path, search] = (location.hash || '#/').slice(2).split('?');
  return { path, params: new URLSearchParams(search || '') };
}
function _writeParams(path, params){
  const qs = params.toString();
  // Preserve panel-open state across re-renders by re-opening after route
  const wasOpen = document.querySelector('.cfg-panel')?.classList.contains('open');
  location.hash = '#/' + path + (qs ? '?' + qs : '');
  if (wasOpen) setTimeout(() => window.cfgOpen(), 30);
}
window.stepCfg = (pos, delta) => {
  const { path, params } = _hashParams();
  const defKey = pos.toUpperCase();
  const def = DEFAULT_DEPTHS[defKey] || 1;
  const cur = +(params.get(pos) || def);
  const next = Math.max(1, Math.min(8, cur + delta));
  if (next === def) params.delete(pos); else params.set(pos, next);
  _writeParams(path, params);
};
window.updateCfg = (key, value) => {
  const { path, params } = _hashParams();
  if (value === null || value === '' || value === undefined) params.delete(key);
  else params.set(key, value);
  _writeParams(path, params);
};
window.resetCfg = () => {
  const { path, params } = _hashParams();
  const keep = ['a','b','tab'];
  for (const k of [...params.keys()]) if (!keep.includes(k)) params.delete(k);
  _writeParams(path, params);
};

/* ----------------------------- podcast --------------------------- */
VIEWS.podcast = async function(){
  // Phase 3 skeleton — when ENABLE_PODCAST_AUDIO is set and audio files exist,
  // this view lists weekly episodes. For now it's a placeholder.
  return `
    <div class="hero reveal" style="--hero-a:#d6001c;--hero-b:#1c2027;margin-top:22px">
      <div class="bg"></div><div class="grid-lines"></div><div class="sheen"></div>
      <div class="hero-inner" style="padding:36px 40px">
        <div>
          <div class="chyron" style="margin:0 0 14px"><span class="dot"></span> PCFL Network · Audio</div>
          <div class="tname" style="font-size:38px">PCFL Network Weekly Podcast</div>
          <div class="tsub" style="margin-top:10px">AI-narrated game wrap-ups, coming soon.</div>
        </div>
      </div>
    </div>
    <div class="section-h"><span class="bar"></span><h2>Status</h2></div>
    <div class="card reveal" style="padding:24px 28px;max-width:760px">
      <p style="color:var(--muted);font-size:14.5px;line-height:1.7;margin:0">
        The PCFL Network is preparing an audio version of the weekly wrap-up. Each episode
        will be AI-narrated, ~3-4 minutes long, and dropped after the Friday sim. An RSS feed
        will be available for podcast clients. Stay tuned.
      </p>
    </div>`;
};

window.setWeek = w => { App.week = w; renderChrome(); renderTicker(); };

/* ============================ router ============================= */
async function route(){
  const hash = location.hash || '#/';
  const [pathPart, queryPart] = hash.slice(2).split('?');
  const q = new URLSearchParams(queryPart || '');
  const parts = pathPart.split('/').filter(Boolean);
  const name = parts[0] || 'home';

  document.querySelectorAll('[data-route]').forEach(a =>
    a.classList.toggle('active', a.dataset.route === name));

  const main = $('#view');
  let html;
  try {
    if (name === 'game' && parts.length >= 4) html = await VIEWS.game(parts[1], parts[2], parts[3], q);
    else if (name === 'teams' && parts[1]) html = await VIEWS.team(parts[1]);
    else if (VIEWS[name]) html = await VIEWS[name](parts[1], parts[2], parts[3], q);
    else html = await VIEWS.home();
  } catch (err){
    console.error(err);
    html = `<div class="empty card" style="margin-top:30px"><b>Something went wrong</b>${esc(err.message)}</div>`;
  }
  // tear down anything from the previous view (e.g., the previous team's fight song)
  stopFightSong();
  main.innerHTML = `<div class="view wrap">${html}</div>`;
  document.title = `PCFL Network — ${name === 'home' ? `Week ${App.week}, ${App.season} Season` : name[0].toUpperCase()+name.slice(1)}`;
  revealInit(main); animateWidths(main);
  main.querySelectorAll('[data-count]').forEach(n => countUp(n, +n.dataset.count));
  setupFightSong();
  window.scrollTo({ top: 0 });
}

/* ============================= boot ============================== */
async function boot(){
  // staging environment indicator
  if (/\/staging(\/|$)/.test(location.pathname)){
    document.body.insertAdjacentHTML('beforeend',
      `<div class="staging-ribbon">Staging</div>
       <a class="staging-note" href="https://pcfl2k.github.io/PCFL-Football/" title="Go to production site">⚠ Staging preview — not production</a>`);
    document.title = '[STAGING] ' + document.title;
  }
  const [manifest, teams, videos] = await Promise.all([
    getJSON('data/manifest.json'), getJSON('data/teams.json'), getJSON('data/videos.json'),
  ]);
  App.manifest = manifest; App.teams = teams; App.videos = videos;
  for (const t of teams) App.teamMap[t.slug] = t;

  const latest = manifest.seasons[manifest.seasons.length-1];
  App.season = +(localStorage.getItem('pcfl-season')) || latest.year;
  if (!manifest.seasons.some(s=>s.year===App.season)) App.season = latest.year;
  const seasonInfo = manifest.seasons.find(s=>s.year===App.season);
  // Always show the latest week on a fresh visit. Users navigate to other
  // weeks via the selector, but selection is intentionally not persisted —
  // returning visitors should see the newest content.
  App.week = seasonInfo.latest;

  renderChrome();
  setupDrawer();
  document.addEventListener('change', e => {
    if (e.target.matches('select.season-sel')){
      App.season = +e.target.value; localStorage.setItem('pcfl-season', App.season);
      const si = App.manifest.seasons.find(s=>s.year===App.season);
      App.week = si.latest;
      renderChrome(); renderTicker(); route();
    } else if (e.target.matches('select.week-sel')){
      App.week = +e.target.value;
      renderChrome(); renderTicker(); route();
    }
  });

  window.addEventListener('hashchange', route);
  await Promise.all([renderTicker(), route()]);
}
boot();
