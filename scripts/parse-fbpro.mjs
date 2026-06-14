#!/usr/bin/env node
/**
 * PCFL FBPro98 Export Parser
 * Converts raw FBPro98 HTML exports (gamestats/standings/schedule/season/rosters)
 * dropped in /drops/<season>/week<N>/ into structured JSON consumed by the site.
 *
 * Usage:  node scripts/parse-fbpro.mjs [--season 2028]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DROPS = join(ROOT, 'drops');
const DATA = join(ROOT, 'data');

/* ------------------------------------------------------------------ */
/* Team metadata                                                       */
/* ------------------------------------------------------------------ */
const TEAMS = [
  t('washington','Washington','Huskies','UW','#4B2E83','#B7A57A','Western','Pacific',['WASH','WAS']),
  t('usc','USC','Trojans','USC','#990000','#FFCC00','Western','Pacific',[]),
  t('ucla','UCLA','Bruins','UCLA','#2D68C4','#F2A900','Western','Pacific',['UCL']),
  t('oregon','Oregon','Ducks','UO','#154733','#FEE123','Western','Pacific',['ORE','OR']),
  t('ohio-state','Ohio State','Buckeyes','OSU','#BB0000','#A7B1B7','Western','Central',[]),
  t('notre-dame','Notre Dame','Fighting Irish','ND','#0C2340','#C99700','Western','Central',[]),
  t('colorado','Colorado','Buffaloes','COL','#CFB87C','#000000','Western','Central',['COLO']),
  t('oklahoma','Oklahoma','Sooners','OU','#841617','#FDF9D8','Western','Central',['OKL']),
  t('michigan','Michigan','Wolverines','MICH','#00274C','#FFCB05','Western','Central',['MIC']),
  t('texas','Texas','Longhorns','TEX','#BF5700','#FFFFFF','Eastern','Atlantic',[]),
  t('penn-state','Penn State','Nittany Lions','PSU','#041E42','#FFFFFF','Eastern','Atlantic',['PENNST','PENN ST']),
  t('boston-college','Boston College','Eagles','BC','#98002E','#BC9B6A','Eastern','Atlantic',['BOSTON COLLEG']),
  t('clemson','Clemson','Tigers','CLEM','#F56600','#522D80','Eastern','Atlantic',['CLE']),
  t('lsu','LSU','Tigers','LSU','#461D7C','#FDD023','Eastern','Southern',[]),
  t('tennessee','Tennessee','Volunteers','TENN','#FF8200','#58595B','Eastern','Southern',['TEN']),
  t('arkansas','Arkansas','Razorbacks','ARK','#9D2235','#FFFFFF','Eastern','Southern',[]),
  t('georgia','Georgia','Bulldogs','UGA','#BA0C2F','#000000','Eastern','Southern',[]),
  t('miami','Miami','Hurricanes','MIA','#F47321','#005030','Eastern','Southern',[]),
];
function t(slug,name,nickname,abbr,primary,secondary,conference,division,aliases){
  return { slug,name,nickname,abbr,colors:{primary,secondary},conference,division,
    aliases:[name.toUpperCase(),abbr,...aliases] };
}

// Fight song YouTube videos — official band recordings where available.
// `start`/`end` define a snippet (seconds) so the site doesn't play the full
// song on every team page visit. Defaults: 0 → 20s.
const FIGHT_SONGS = {
  washington:       { youtubeId:'xN2HTCmpeV4', name:'Bow Down to Washington',           start:0,  end:22 },
  usc:              { youtubeId:'cj7IYSv_BVE', name:'Conquest',                          start:0,  end:22 },
  ucla:             { youtubeId:'Mi1rc1zGEQM', name:'Sons of Westwood / Mighty Bruins',  start:0,  end:22 },
  oregon:           { youtubeId:'sf6wT7nn8i8', name:'Mighty Oregon',                     start:0,  end:22 },
  'ohio-state':     { youtubeId:'uDI1qWHqJt4', name:'Buckeye Battle Cry',                start:0,  end:22 },
  'notre-dame':     { youtubeId:'clNTdf8xAtk', name:'Notre Dame Victory March',          start:0,  end:22 },
  colorado:         { youtubeId:'jcTOBFq-2T0', name:'CU Fight Song',                     start:0,  end:22 },
  oklahoma:         { youtubeId:'5ErtzJSUiQY', name:'Boomer Sooner',                     start:0,  end:22 },
  michigan:         { youtubeId:'Oww_gtVVqkQ', name:'The Victors',                       start:0,  end:22 },
  texas:            { youtubeId:'W41tB1nkQtI', name:'The Eyes of Texas',                 start:0,  end:22 },
  'penn-state':     { youtubeId:'wLIuF9E6gcQ', name:'Fight On, State',                   start:0,  end:22 },
  'boston-college': { youtubeId:'qBwkc-x8dYs', name:'For Boston',                        start:0,  end:22 },
  clemson:          { youtubeId:'tGl_XIGlhfw', name:'Tiger Rag',                         start:0,  end:22 },
  lsu:              { youtubeId:'YZ4e35_hdjE', name:'Hey Fightin’ Tigers',          start:0,  end:22 },
  tennessee:        { youtubeId:'ylc2FxBLvz4', name:'Rocky Top',                         start:0,  end:22 },
  arkansas:         { youtubeId:'0hJMyTBFJnI', name:'Arkansas Fight',                    start:0,  end:22 },
  georgia:          { youtubeId:'pe6njUwC59c', name:'Glory, Glory',                      start:0,  end:22 },
  miami:            { youtubeId:'HMfQ-GKhvQo', name:'Miami U How-Dee-Doo',               start:0,  end:22 },
};
const ALIAS = new Map();
for (const tm of TEAMS) for (const a of tm.aliases) ALIAS.set(a, tm.slug);

function teamFrom(text){
  if (!text) return null;
  const up = text.trim().toUpperCase().replace(/\s+/g,' ');
  if (ALIAS.has(up)) return ALIAS.get(up);
  // prefix match handles truncated names like "Boston Colleg"
  for (const [a, slug] of ALIAS) {
    if (a.length >= 3 && (a.startsWith(up) || up.startsWith(a))) return slug;
  }
  return null;
}
const teamName = s => TEAMS.find(x=>x.slug===s)?.name ?? s;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const strip = s => s.replace(/<[^>]*>/g,'');
const read = p => readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const num = s => { const n = parseFloat(String(s).replace(/[^\d.\-]/g,'')); return isNaN(n)?0:n; };

/* ------------------------------------------------------------------ */
/* Game stats parser                                                   */
/* ------------------------------------------------------------------ */
function parseGameStats(html){
  const lines = html.split('\n');
  const out = { playerOfWeek: null, games: [] };

  const powLine = lines.find(l => /Player of the week:/i.test(l));
  if (powLine) out.playerOfWeek = parsePlayerRef(strip(powLine).replace(/.*Player of the week:/i,''));

  // locate game anchors
  const starts = [];
  lines.forEach((l,i)=>{ const m = l.match(/<A NAME="A(\d+)">/i); if (m && +m[1] > 0 && /FONT SIZE=6/i.test(l)) starts.push(i); });
  for (let g=0; g<starts.length; g++){
    const seg = lines.slice(starts[g], g+1<starts.length ? starts[g+1] : lines.length);
    const game = parseGame(seg);
    if (game) out.games.push(game);
  }
  return out;
}

function parsePlayerRef(text){
  const m = strip(text).trim().match(/^(.+?),\s*([A-Z]{1,3}),\s*(.+?)\s*$/);
  if (!m) return null;
  return { name: m[1].trim(), pos: m[2], team: teamFrom(m[3]) };
}

function parseGame(seg){
  const matchLine = strip(seg[0]).trim();           // "Texas at Georgia"
  const mm = matchLine.match(/^(.+?)\s+at\s+(.+)$/i);
  if (!mm) return null;
  const away = teamFrom(mm[1]), home = teamFrom(mm[2]);
  const scoreLine = strip(seg[1]).trim().match(/(\d+)\s+(\d+)/);
  const awayScore = scoreLine ? +scoreLine[1] : 0, homeScore = scoreLine ? +scoreLine[2] : 0;

  const game = {
    id: `${away}-${home}`,
    away: { team: away, score: awayScore },
    home: { team: home, score: homeScore },
    playerOfGame: null, teamStats: [], box: { away: [], home: [] },
  };
  const pog = seg.find(l => /Player of the game:/i.test(l));
  if (pog) game.playerOfGame = parsePlayerRef(strip(pog).replace(/.*Player of the game:/i,''));

  // team statistics rows: "value ..... LABEL ..... value"
  let i = seg.findIndex(l => /Team Statistics/i.test(l));
  const indIdx = seg.findIndex(l => /Individual Statistics/i.test(l));
  if (i >= 0 && indIdx > i){
    for (let k=i+1; k<indIdx; k++){
      const row = strip(seg[k]);
      const m = row.match(/^\s*(.+?)\s*\.{3,}\s*(.+?)\s*\.{3,}\s*(.+?)\s*$/);
      if (m) game.teamStats.push({ label: m[2].replace(/\s+/g,' ').trim(), away: m[1].trim(), home: m[3].trim() });
    }
  }

  // individual two-column tables
  if (indIdx >= 0){
    const SECTIONS = ['Passing','Rushing','Receiving','Intercepts','Punt Returns','KO Returns','Fumbles','Defense','Safeties','Punts','Converts','2pt Converts','Field Goals'];
    let cur = null;
    for (let k=indIdx+1; k<seg.length; k++){
      const raw = seg[k];
      if (/Back to top/i.test(raw)) break;
      const txt = strip(raw);
      if (!txt.trim()) continue;
      const header = SECTIONS.find(s => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(txt.trim()) && /<strong>/i.test(raw));
      const left = txt.slice(0,40), right = txt.slice(40);
      if (header && !/^(TEX|UGA|LSU|MIA|BC|ARK|CLEM|TENN|MICH|OSU|ND|UCLA|OU|UW|COL|USC|UO|PSU)\s+Total/i.test(txt.trim())){
        cur = { name: header, cols: txt.trim().replace(new RegExp(`^${header}\\s*`),'').slice(0,36).trim().split(/\s+/), away: [], home: [] };
        game.box.away.push({ section: header, cols: cur.cols, rows: cur.away });
        game.box.home.push({ section: header, cols: cur.cols, rows: cur.home });
        continue;
      }
      if (!cur) continue;
      addBoxRow(cur.away, left); addBoxRow(cur.home, right);
    }
    // drop empty sections
    game.box.away = game.box.away.filter(s=>s.rows.length);
    game.box.home = game.box.home.filter(s=>s.rows.length);
  }
  return game;
}

function addBoxRow(rows, text){
  const s = text.trim();
  if (!s || /^None\.?$/i.test(s)) return;
  const m = s.match(/^([A-Za-z'.\-][A-Za-z'.\- ]*?)\s+(?=[\d\-])(.*)$/);
  if (!m) return;
  const name = m[1].trim();
  const vals = m[2].trim().split(/\s+/);
  const total = /\bTotal$/i.test(name);
  rows.push({ name: total ? 'Total' : name, vals, total });
}

/* ------------------------------------------------------------------ */
/* Standings + power rankings parser                                   */
/* ------------------------------------------------------------------ */
function parseStandings(html){
  const lines = html.split('\n');
  const out = { date: null, standings: [], powerRankings: [] };
  for (const l of lines){
    const d = strip(l).trim().match(/^([A-Z][a-z]+ \d+, \d{4})$/);
    if (d){ out.date = d[1]; break; }
  }
  let conf = null, division = null;
  for (let i=0;i<lines.length;i++){
    const raw = lines[i];
    if (/<H1>/i.test(raw) && /Game Schedule|Power Rankings/i.test(strip(lines[i])+strip(lines[i+1]||''))) {}
    const h2 = raw.match(/<H2>([^<]+)<\/H2>/i);
    if (h2 && /Conference/i.test(h2[1])){
      conf = { conference: h2[1].replace(/Conference/i,'').trim(), divisions: [] };
      out.standings.push(conf); continue;
    }
    const h3 = raw.match(/<H3>([^<]+)<\/H3>/i);
    if (h3 && conf){
      division = { name: h3[1].replace(/Division/i,'').trim(), teams: [] };
      conf.divisions.push(division); continue;
    }
    if (division){
      const txt = strip(raw);
      const m = txt.match(/^([A-Za-z .]+?)\s{2,}(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([WL]\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (m){
        const slug = teamFrom(m[1]);
        if (slug) division.teams.push({ team: slug, w:+m[2], l:+m[3], t:+m[4], pf:+m[5], pa:+m[6],
          streak: m[7], home: m[8], away: m[9], div: m[10], conf: m[11] });
      }
    }
  }
  // power rankings
  const prIdx = lines.findIndex(l => /Power Rankings/i.test(strip(l)));
  if (prIdx >= 0){
    let rank = 0;
    for (let i=prIdx; i<lines.length; i++){
      const txt = strip(lines[i]);
      const m = txt.match(/^\s*(\d+)?\s*([A-Za-z .]+?)\s{2,}(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/);
      if (!m) continue;
      const slug = teamFrom(m[2]);
      if (!slug) continue;
      if (m[1]) rank = +m[1];
      const defeated = (m[6]||'').trim().split(/\s+/).filter(Boolean).map(teamFrom).filter(Boolean);
      out.powerRankings.push({ rank, team: slug, w:+m[3], oppW:+m[4], pts:+m[5], defeated });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Schedule parser (full season, two-column weeks)                     */
/* ------------------------------------------------------------------ */
function parseSchedule(html){
  const lines = html.split('\n');
  const weeks = {}; // num -> {week, date, label, games[]}
  let leftWeek = null, rightWeek = null;
  for (let i=0;i<lines.length;i++){
    const raw = lines[i];
    if (/League Schedule by team/i.test(raw)) break;
    const txt = strip(raw);
    if (/<A NAME="W\d+">/i.test(raw) && /Week \d+/.test(txt)){
      leftWeek = weekHeader(weeks, txt.slice(0,40).trim());
      rightWeek = weekHeader(weeks, txt.slice(40).trim());
      continue;
    }
    if (!leftWeek && !rightWeek) continue;
    if (/Back to top/i.test(txt)){ leftWeek = rightWeek = null; continue; }
    const L = txt.slice(0,40).trim(), R = txt.slice(40).trim();
    const dl = L.match(/^([A-Z][a-z]+ \d+, \d{4})$/); if (dl && leftWeek && !leftWeek.date){ leftWeek.date = dl[1]; }
    const dr = R.match(/^([A-Z][a-z]+ \d+, \d{4})$/); if (dr && rightWeek && !rightWeek.date){ rightWeek.date = dr[1]; }
    const gl = parseSchedGame(L); if (gl && leftWeek) leftWeek.games.push(gl);
    const gr = parseSchedGame(R); if (gr && rightWeek) rightWeek.games.push(gr);
  }
  return Object.values(weeks).sort((a,b)=>a.week-b.week);
}
function ensureWeek(weeks,n){ return weeks[n] ??= { week:n, date:null, games:[] }; }
function weekHeader(weeks, s){
  const m = s.match(/^Week (\d+)(?::\s*(.+))?$/);
  if (!m) return null;
  const w = ensureWeek(weeks, +m[1]);
  if (m[2]) w.label = m[2].trim();
  return w;
}
function parseSchedGame(s){
  if (!s) return null;
  let m = s.match(/^(.+?)\s+(\d+)\s+at\s+(.+?)\s+(\d+)\s*$/);
  if (m){
    const a=teamFrom(m[1]), h=teamFrom(m[3]);
    if (!a||!h) return null;
    return { away:a, home:h, awayScore:+m[2], homeScore:+m[4], final:true };
  }
  m = s.match(/^(.+?)\s+at\s+(.+?)\s*$/);
  if (m){
    const a=teamFrom(m[1]), h=teamFrom(m[2]);
    if (!a||!h) return null;
    return { away:a, home:h, final:false };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Season cumulative stats parser (leaderboards)                       */
/* ------------------------------------------------------------------ */
function parseSeason(html){
  const lines = html.split('\n');
  const sec = name => {
    const i = lines.findIndex(l => l.includes(`name='${name}'`));
    if (i<0) return [];
    const out = [];
    for (let k=i+1;k<lines.length;k++){
      if (/<h2>/i.test(lines[k]) || /Non Qualifiers/i.test(lines[k])) break;
      out.push(lines[k]);
    }
    return out;
  };
  const leaders = {
    passing: sec('I1').map(parsePassingRow).filter(Boolean),
    rushing: sec('I2').map(l=>parseWideRow(l,['att','yds','avg','lg','td'])).filter(Boolean),
    receiving: sec('I3').map(l=>parseWideRow(l,['rec','yds','avg','lg','td'])).filter(Boolean),
    interceptions: sec('I4').map(l=>parseWideRow(l,['int','yds','avg','lg','td'])).filter(Boolean),
    sacks: sec('I9').map(l=>parseWideRow(l,['sacks','safeties'])).filter(Boolean),
    tackles: sec('I10').map(l=>parseWideRow(l,['tackles'])).filter(Boolean),
    scoring: sec('I15').map(parseScoringRow).filter(Boolean),
  };
  // team tables
  const teamTable = (name, cols) => sec(name).map(l=>{
    const txt = strip(l);
    const m = txt.match(/^\s*(\d+)\s+([A-Za-z .]+?)\s{2,}(.+)$/);
    if (!m) return null;
    const slug = teamFrom(m[2]); if (!slug) return null;
    const vals = m[3].trim().split(/\s+/);
    const o = { team: slug };
    cols.forEach((c,i)=>o[c]=vals[i]);
    return o;
  }).filter(Boolean);
  const teamStats = {
    passing: teamTable('T1',['att','com','pct','yds','avg','lg','td','int','rtg','sksYds']),
    rushing: teamTable('T2',['att','yds','avg','lg','td']),
    totalYards: teamTable('T19',['plays','yds','avg','ydsGame']),
    oppTotalYards: teamTable('O19',['plays','yds','avg','ydsGame']),
    scoring: teamTable('T15',['pts','ptsGame']),
    oppScoring: teamTable('O15',['pts','ptsGame']),
  };
  return { leaders, teamStats };
}
function parsePassingRow(l){
  const txt = strip(l);
  const m = txt.match(/^\s*(\d+)\s(.{15})(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)/);
  if (!m) return null;
  const team = teamFrom(m[3]); if (!team) return null;
  return { name: fixName(m[2].trim()), team, yr: m[4], pos:'QB',
    att:+m[5], com:+m[6], pct:+m[7], yds:+m[8], avg:+m[9], lg:+m[10], td:+m[11], int:+m[12], rtg:+m[13], sksYds:m[14] };
}
function parseWideRow(l, cols){
  const txt = strip(l);
  const m = txt.match(/^\s*(\d+)\s(.{25})(\S+)\s+(\S+)\s+([A-Z]{1,3})\s+(.+)$/);
  if (!m) return null;
  const team = teamFrom(m[3]); if (!team) return null;
  const vals = m[6].trim().split(/\s+/);
  const o = { name: fixName(m[2].trim()), team, yr: m[4], pos: m[5] };
  cols.forEach((c,i)=>o[c]=num(vals[i]));
  return o;
}
function parseScoringRow(l){
  const txt = strip(l);
  const m = txt.match(/^\s*(\d+)\s(.{25})(\S+)\s+(\S+)\s+([A-Z]{1,3})\s+(.+)$/);
  if (!m) return null;
  const team = teamFrom(m[3]); if (!team) return null;
  const v = m[6].trim().split(/\s+/).map(num);
  return { name: fixName(m[2].trim()), team, yr: m[4], pos: m[5],
    rushTD:v[0], recTD:v[1], miscTD:v[2], totTD:v[3], twoPt:v[4], xp:v[5], fg:v[6], pts:v[8]??v[7] };
}
function fixName(n){
  // "Lastname, First" -> "First Lastname"
  const m = n.match(/^(.+?),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : n;
}

/* ------------------------------------------------------------------ */
/* Rosters parser                                                      */
/* ------------------------------------------------------------------ */
function parseRosters(html){
  // Each player spans two lines: line 1 = bio + 8 ACTUAL ratings (SP AC AG ST HA EN IN DI),
  // line 2 = the same 8 attributes as POTENTIAL ratings (indented, numbers only).
  const lines = html.split('\n');
  const rosters = {};
  let cur = null, last = null;
  for (const raw of lines){
    const tm = raw.match(/Team Roster:\s*([^<]+)/i);
    if (tm){
      const slug = teamFrom(tm[1].trim());
      cur = slug ? (rosters[slug] = []) : null;
      last = null;
      continue;
    }
    if (/Free Agent Draft Pool/i.test(raw)){ cur = null; last = null; }
    if (!cur) continue;
    const txt = strip(raw);
    const pot = txt.match(/^\s{30,}((?:\d+\s+){7}\d+)\s*$/);
    if (pot && last){
      last.p = pot[1].trim().split(/\s+/).map(Number);
      last = null;
      continue;
    }
    const m = txt.match(/^([A-Z]{1,2})\s+([A-Z]{1,2}\d*)\s+(\d+)\s+(.{1,22}?)\s{2,}(\S+)\s+([R0-9])\s+(\d+-\d+)\s+(\d+)\s+((?:\d+\s+){7}\d+)\s*$/);
    if (m){
      const a = m[9].trim().split(/\s+/).map(Number);
      last = {
        status: m[1], pos: m[2].replace(/\d+$/,''), depth: +(m[2].match(/\d+$/)?.[0] ?? 0) || null,
        num: +m[3], name: m[4].trim(), inj: m[5], yr: m[6], ht: m[7], wt: +m[8],
        a, p: [...a],
        ovr: Math.round(a.reduce((x,y)=>x+y,0)/a.length),
      };
      cur.push(last);
    }
  }
  return rosters;
}

/* ------------------------------------------------------------------ */
/* Story engine — deterministic broadcast-style recaps                 */
/* ------------------------------------------------------------------ */
function seededPick(arr, seed){
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return arr[Math.abs(h) % arr.length];
}
function statVal(game, side, section, col, name){
  const sec = game.box[side].find(s=>s.section===section);
  if (!sec) return null;
  const row = name ? sec.rows.find(r=>!r.total && lastName(r.name)===lastName(name)) : null;
  return { sec, row };
}
const lastName = n => n.trim().split(/\s+/).pop().toLowerCase();

function findPlayerLine(game, player){
  if (!player?.team) return '';
  const side = game.away.team === player.team ? 'away' : 'home';
  const get = sect => game.box[side].find(s=>s.section===sect)?.rows.find(r=>!r.total && lastName(r.name)===lastName(player.name));
  const parts = [];
  const p = get('Passing');
  if (p) parts.push(`${p.vals[1]} of ${p.vals[0]} for ${p.vals[2]} yards${+p.vals[5]?` and ${p.vals[5]} TD${+p.vals[5]>1?'s':''}`:''}`);
  const r = get('Rushing');
  if (r && +r.vals[1] >= 40) parts.push(`${r.vals[1]} rushing yards${+r.vals[4]?` and ${r.vals[4]} rushing TD${+r.vals[4]>1?'s':''}`:''}`);
  const c = get('Receiving');
  if (c && +c.vals[1] >= 40) parts.push(`${c.vals[0]} catches for ${c.vals[1]} yards${+c.vals[4]?` and ${c.vals[4]} TD${+c.vals[4]>1?'s':''}`:''}`);
  const d = get('Defense');
  if (d && !p && !r && !c) parts.push(`${d.vals[0]} tackles${+d.vals[1]?` and ${d.vals[1]} sack${+d.vals[1]>1?'s':''}`:''}`);
  return parts.join(', ');
}

function buildStory(game, week, nextOpp){
  const aw = game.away, hm = game.home;
  const winner = aw.score > hm.score ? aw : hm;
  const loser  = aw.score > hm.score ? hm : aw;
  const W = teamName(winner.team), L = teamName(loser.team);
  const margin = winner.score - loser.score;
  const ts = Object.fromEntries(game.teamStats.map(r=>[r.label, r]));
  const wSide = winner===aw ? 'away':'home', lSide = winner===aw?'home':'away';
  const totalYds = ts['TOTAL NET YARDS'];
  const wYds = totalYds ? num(totalYds[wSide]) : 0, lYds = totalYds ? num(totalYds[lSide]) : 0;
  const pog = game.playerOfGame;
  const pogLine = pog ? findPlayerLine(game, pog) : '';

  const head = margin >= 21
    ? seededPick([`${W} steamrolls ${L}, ${winner.score}-${loser.score}`,`${W} makes a statement in ${winner.score}-${loser.score} rout of ${L}`,`No contest: ${W} buries ${L} ${winner.score}-${loser.score}`], game.id+week)
    : margin >= 10
    ? seededPick([`${W} pulls away from ${L}, ${winner.score}-${loser.score}`,`${W} takes control late, tops ${L} ${winner.score}-${loser.score}`], game.id+week)
    : margin >= 4
    ? seededPick([`${W} holds off ${L}, ${winner.score}-${loser.score}`,`${W} outlasts ${L} in ${winner.score}-${loser.score} battle`], game.id+week)
    : seededPick([`Instant classic: ${W} edges ${L}, ${winner.score}-${loser.score}`,`${W} survives ${L} by ${margin} in thriller`], game.id+week);

  const paras = [];
  paras.push(`${W} ${margin>=21?'dominated from start to finish':margin>=10?'asserted control when it mattered':'found just enough'} in a ${winner.score}-${loser.score} ${margin>=21?'rout':margin<=3?'thriller':'win'} over ${L} in Week ${week} PCFL action${pog?`, with ${pog.name} earning Player of the Game honors${pogLine?` after going for ${pogLine}`:''}`:''}.`);
  if (totalYds) paras.push(`The ${TEAMS.find(x=>x.slug===winner.team).nickname} ${wYds>lYds?'outgained':'were outgained by'} ${L} ${Math.max(wYds,lYds)}–${Math.min(wYds,lYds)} in total offense${ts['NET RUSHING YARDS']?`, including ${ts['NET RUSHING YARDS'][wSide]} yards on the ground`:''}. ${L} ${lYds<200?'never got the offense going':'kept fighting'}, managing ${lYds} total yards on the night.`);
  if (nextOpp) paras.push(`Up next, ${W} ${nextOpp.home===winner.team?'hosts':'travels to face'} ${teamName(nextOpp.home===winner.team?nextOpp.away:nextOpp.home)} in Week ${week+1}.`);
  return { headline: head, body: paras };
}

/* ------------------------------------------------------------------ */
/* Videos (YouTube RSS cache)                                          */
/* ------------------------------------------------------------------ */
function parseVideos(xmlPath){
  if (!existsSync(xmlPath)) return [];
  const xml = readFileSync(xmlPath,'utf8');
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m=>m[1]);
  return entries.map(e=>{
    const id = e.match(/<yt:videoId>([^<]+)/)?.[1];
    const title = e.match(/<title>([^<]+)/)?.[1] ?? '';
    const published = e.match(/<published>([^<]+)/)?.[1] ?? '';
    // pattern: 28W01TEX@UGA  (+ optional trailing rev digit)
    const m = title.match(/^(\d{2})W(\d{2})([A-Z]+)@([A-Z]+?)(\d?)$/);
    const v = { id, title, published };
    if (m){
      v.season = 2000 + +m[1]; v.week = +m[2];
      v.away = teamFrom(m[3]); v.home = teamFrom(m[4]);
      v.rev = m[5] ? +m[5] : 1;
    }
    return v;
  }).filter(v=>v.id);
}

/* ================================================================== */
/* AI Content Layer (previews, recaps, weekly wrap-up)                  */
/* ================================================================== */
/*
 * Calls Anthropic's Messages API (Claude Haiku 4.5) to generate broadcast-
 * voice content from the deterministic JSON we've already produced.
 *
 * Behavior:
 *   - If ANTHROPIC_API_KEY is unset, every helper returns null and the
 *     site falls back to the existing deterministic content. The build
 *     stays green either way.
 *   - Calls are cached by SHA-256 of (model + prompt). The cache lives at
 *     data/<season>/ai-cache/<hash>.json and is checked into the repo, so
 *     CI never regenerates content for inputs it has already seen — costs
 *     stay at "first ever drop of week N" only.
 *   - All API calls run in parallel via Promise.all per week. A typical
 *     drop fires ~20 calls and finishes in ~10s.
 */
import { createHash } from 'node:crypto';

const AI = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: 'claude-haiku-4-5-20251001',
  enabled: false,
};
AI.enabled = !!AI.apiKey;
if (!AI.enabled) console.log('ℹ ANTHROPIC_API_KEY not set — AI content disabled (deterministic fallback in use).');

function aiCacheDir(season){ return join(DATA, String(season), 'ai-cache'); }

async function callClaude(prompt, opts = {}){
  if (!AI.enabled) return null;
  const cacheKey = createHash('sha256').update(AI.model + '\n' + JSON.stringify(opts) + '\n' + prompt).digest('hex').slice(0, 16);
  const cacheFile = join(aiCacheDir(opts.season || 'global'), cacheKey + '.json');
  if (existsSync(cacheFile)){
    try { return JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  }
  mkdirSync(aiCacheDir(opts.season || 'global'), { recursive: true });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': AI.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI.model,
        max_tokens: opts.maxTokens || 1500,
        system: opts.system || '',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok){
      console.warn(`AI call failed: ${r.status} ${await r.text()}`);
      return null;
    }
    const j = await r.json();
    const text = j.content?.[0]?.text || '';
    let result;
    if (opts.parseJSON){
      // Claude often wraps JSON in code fences; strip and parse.
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try { result = JSON.parse(cleaned); }
      catch (e){ console.warn(`AI JSON parse failed: ${e.message}`); return null; }
    } else {
      result = { text };
    }
    writeFileSync(cacheFile, JSON.stringify(result));
    return result;
  } catch (e){
    console.warn(`AI fetch error: ${e.message}`);
    return null;
  }
}

const SYS_BROADCAST =
  'You are a veteran college football broadcast analyst writing for the PCFL Network. ' +
  'Voice: confident, observant, occasional flair, never hyperbolic. ' +
  'Surface a concrete turning point or key matchup; do not write generic copy. ' +
  'Use plain prose, no markdown, no emoji, no headers. ' +
  'Never invent stats — only reason about what the input data shows.';

function teamCtx(slug, records, ranks){
  const t = TEAMS.find(x => x.slug === slug);
  if (!t) return null;
  return { name: t.name, nickname: t.nickname, record: records[slug] || '0-0', rank: ranks[slug] ?? null };
}

/* -------------------- AI preview (pre-sim) ----------------------- */
async function aiPreview(game, week, season, records, ranks, recent){
  const A = teamCtx(game.away, records, ranks);
  const H = teamCtx(game.home, records, ranks);
  if (!A || !H) return null;
  const prompt = `Write a 2-paragraph preview for an upcoming PCFL Week ${week} matchup.

Game: ${A.name} (${A.record}${A.rank?`, ranked #${A.rank}`:''}) at ${H.name} (${H.record}${H.rank?`, ranked #${H.rank}`:''}).

Recent ${A.name} results: ${(recent[game.away]||[]).map(r=>`${r.opp} ${r.result} ${r.score}`).join('; ') || 'season opener'}.
Recent ${H.name} results: ${(recent[game.home]||[]).map(r=>`${r.opp} ${r.result} ${r.score}`).join('; ') || 'season opener'}.

Return ONLY JSON in this exact shape:
{
  "headline": "8-12 word headline",
  "subhead": "one short sentence framing the matchup",
  "prediction": { "winner": "${game.away}" | "${game.home}", "score": "AA-BB", "confidence": 0.50-0.85 },
  "xFactor": { "team": "${game.away}" | "${game.home}", "role": "QB|RB|WR|defense|special", "why": "one sentence" },
  "keyMatchup": "one sentence on the chess-match angle",
  "body": ["paragraph 1 (2-3 sentences)", "paragraph 2 (2-3 sentences)"]
}`;
  const r = await callClaude(prompt, { system: SYS_BROADCAST, parseJSON: true, maxTokens: 900, season });
  return r;
}

/* -------------------- AI recap (post-sim) ------------------------ */
async function aiRecap(game, week, season){
  const aw = game.away, hm = game.home;
  const ts = Object.fromEntries(game.teamStats.map(r => [r.label, r]));
  const A = TEAMS.find(x => x.slug === aw.team), H = TEAMS.find(x => x.slug === hm.team);
  const winnerSide = aw.score > hm.score ? 'away' : 'home';
  const winner = winnerSide === 'away' ? A : H;
  const loser  = winnerSide === 'away' ? H : A;
  // top performers from box score
  const top = side => {
    const box = game.box[side] || [];
    const get = sect => box.find(s=>s.section===sect)?.rows.filter(r=>!r.total) || [];
    const passing = get('Passing')[0];
    const rushing = get('Rushing').sort((a,b)=>+(b.vals[1]||0)-+(a.vals[1]||0))[0];
    const recv = get('Receiving').sort((a,b)=>+(b.vals[1]||0)-+(a.vals[1]||0))[0];
    const def = get('Defense').sort((a,b)=>(+b.vals[0]+(+b.vals[1])*3)-(+a.vals[0]+(+a.vals[1])*3))[0];
    return { passing, rushing, recv, def };
  };
  const tA = top('away'), tH = top('home');
  const fmt = (p, kind) => p ? `${p.name}: ${kind==='pass'?`${p.vals[1]}/${p.vals[0]}, ${p.vals[2]} yds, ${p.vals[5]} TD`:kind==='rush'?`${p.vals[0]} car, ${p.vals[1]} yds, ${p.vals[4]} TD`:kind==='recv'?`${p.vals[0]} rec, ${p.vals[1]} yds, ${p.vals[4]} TD`:`${p.vals[0]} tkl, ${p.vals[1]} sk`}` : 'n/a';

  const prompt = `Write a richer broadcast recap of a PCFL Week ${week} game.

Final: ${A.name} ${aw.score}, ${H.name} ${hm.score}. Winner: ${winner.name}.
Total yards: ${A.name} ${ts['TOTAL NET YARDS']?.away ?? '?'}, ${H.name} ${ts['TOTAL NET YARDS']?.home ?? '?'}.
Rushing yards: ${A.name} ${ts['NET RUSHING YARDS']?.away ?? '?'}, ${H.name} ${ts['NET RUSHING YARDS']?.home ?? '?'}.
Passing yards: ${A.name} ${ts['NET PASSING YARDS']?.away ?? '?'}, ${H.name} ${ts['NET PASSING YARDS']?.home ?? '?'}.
Turnovers: ${A.name} ${ts['FUMBLES-LOST']?.away ?? '?'} fumbles, ${H.name} ${ts['FUMBLES-LOST']?.home ?? '?'} fumbles.
${game.playerOfGame ? `Player of the Game: ${game.playerOfGame.name} (${game.playerOfGame.pos}, ${TEAMS.find(t=>t.slug===game.playerOfGame.team)?.name}).` : ''}

${A.name} top performers:
  QB ${fmt(tA.passing,'pass')}
  RB ${fmt(tA.rushing,'rush')}
  WR ${fmt(tA.recv,'recv')}
  DEF ${fmt(tA.def,'def')}
${H.name} top performers:
  QB ${fmt(tH.passing,'pass')}
  RB ${fmt(tH.rushing,'rush')}
  WR ${fmt(tH.recv,'recv')}
  DEF ${fmt(tH.def,'def')}

Return ONLY JSON in this shape:
{
  "headline": "punchy 8-14 word headline",
  "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "turningPoint": "one sentence on the decisive moment or shift",
  "unsungHero": { "name": "player name from the stats above", "team": "${aw.team}" | "${hm.team}", "why": "why they don't get the credit POG gets" }
}`;
  return callClaude(prompt, { system: SYS_BROADCAST, parseJSON: true, maxTokens: 1200, season });
}

/* -------------------- Weekly wrap-up article --------------------- */
async function aiWeeklyWrap(games, week, season, powerRankings){
  if (!games.length) return null;
  const scores = games.map(g=>{
    const A = TEAMS.find(t=>t.slug===g.away.team), H = TEAMS.find(t=>t.slug===g.home.team);
    return `${A.name} ${g.away.score}, ${H.name} ${g.home.score}`;
  }).join('\n');
  const top5 = powerRankings.slice(0, 5).map(r => `${r.rank}. ${TEAMS.find(t=>t.slug===r.team).name}`).join('\n');
  const prompt = `Write a PCFL Week ${week} wrap-up column covering the whole week. ${games.length} games:
${scores}

Top 5 in power poll:
${top5}

Identify across-the-board storylines: any upsets vs the power poll, performances that move the needle, conference race tightening or loosening. 4-5 paragraphs. Pick one ANGLE (don't catalog every game), but reference at least 3 specific results.

Return ONLY JSON:
{ "headline": "8-12 words", "subhead": "one sentence", "body": ["p1","p2","p3","p4"] }`;
  return callClaude(prompt, { system: SYS_BROADCAST, parseJSON: true, maxTokens: 1500, season });
}

/* ================================================================== */
/* Predictive Engine: SoS, playoff projection                          */
/* ================================================================== */

function computeSoS(season, schedule, weekJsons){
  // Per-team SoS = average opponent win% across full season schedule.
  // Use cumulative records snapshot from the most-recent week available.
  const latest = weekJsons[weekJsons.length - 1];
  if (!latest) return null;
  const recOf = slug => {
    for (const c of latest.standings) for (const d of c.divisions){
      const tm = d.teams.find(t => t.team === slug);
      if (tm) return tm.w + tm.l ? tm.w / (tm.w + tm.l) : 0;
    }
    return 0.5;
  };
  const out = {};
  for (const t of TEAMS){
    // every game in the season schedule involving this team
    const opps = [];
    for (const w of schedule)
      for (const g of w.games){
        if (g.away === t.slug) opps.push(g.home);
        if (g.home === t.slug) opps.push(g.away);
      }
    const avg = opps.length ? opps.reduce((s,o)=>s+recOf(o), 0)/opps.length : 0;
    out[t.slug] = +(avg.toFixed(4));
  }
  return out;
}

function computePlayoffPicture(season, schedule, weekJsons){
  // PCFL structure observed from drops: Eastern + Western conferences, each with 2 divisions.
  // Playoff weeks 13 (Wild Card), 14 (Conference), 15 (League Championship / PCFL Bowl).
  // Seeding model: each division winner auto-in (4); two wild cards per conference take next-best records (4).
  // → 8-team bracket, 4 from each conference. Wild card round: #2 div winners host wild cards; #1 div winners get bye? Simpler model: top-2 records in conference vs bottom-2 of qualifiers.
  const latest = weekJsons[weekJsons.length - 1];
  if (!latest) return null;
  const wk = latest.week;
  const totalRegularWeeks = 12;
  const remaining = Math.max(0, totalRegularWeeks - wk);

  const all = []; // { team, conf, div, w, l, t, pf, pa, divPct, confPct }
  for (const c of latest.standings)
    for (const d of c.divisions)
      for (const tm of d.teams){
        const conf = c.conference;
        const totalG = tm.w + tm.l + tm.t;
        all.push({
          team: tm.team, conf, div: d.name,
          w: tm.w, l: tm.l, t: tm.t, pf: tm.pf, pa: tm.pa, streak: tm.streak,
          winPct: totalG ? (tm.w + 0.5 * tm.t) / totalG : 0,
          gamesLeft: remaining,
          maxWins: tm.w + remaining,
          minWins: tm.w,
        });
      }

  // Division winners (best record per division by winPct, ties broken by PF-PA diff)
  const divWinners = {};
  for (const t of all){
    const key = `${t.conf}|${t.div}`;
    if (!divWinners[key] || t.winPct > divWinners[key].winPct ||
        (t.winPct === divWinners[key].winPct && (t.pf - t.pa) > (divWinners[key].pf - divWinners[key].pa))){
      divWinners[key] = t;
    }
  }

  // Wild cards: top 2 remaining per conference
  const confSeeds = {};
  for (const conf of [...new Set(all.map(t => t.conf))]){
    const divWinnersInConf = Object.values(divWinners).filter(t => t.conf === conf);
    const remaining = all.filter(t => t.conf === conf && !divWinnersInConf.includes(t))
      .sort((a,b) => b.winPct - a.winPct || (b.pf - b.pa) - (a.pf - a.pa));
    const wildcards = remaining.slice(0, 2);
    const seeded = [...divWinnersInConf, ...wildcards]
      .sort((a,b) => b.winPct - a.winPct || (b.pf - b.pa) - (a.pf - a.pa))
      .map((t, i) => ({ ...t, seed: i + 1, divWinner: divWinnersInConf.includes(t), wildcard: wildcards.includes(t) }));
    confSeeds[conf] = seeded;
  }

  // Compute status for each team
  const teamStatus = {};
  for (const t of all){
    const conf = confSeeds[t.conf];
    const seeded = conf.find(s => s.team === t.team);
    let status, magic = null;
    if (seeded){
      status = seeded.divWinner ? 'div-winner' : 'wild-card';
      // Magic number: wins needed to clinch their spot (rough — assumes nearest challenger keeps winning)
      const challengers = all.filter(x => x.conf === t.conf && x.team !== t.team && !conf.find(s => s.team === x.team));
      const topChal = challengers.sort((a,b) => b.winPct - a.winPct)[0];
      magic = topChal ? Math.max(1, topChal.maxWins - t.w + 1) : null;
    } else if (t.maxWins >= confSeeds[t.conf][3].w){
      status = 'in-the-hunt';
    } else {
      status = 'eliminated';
    }
    teamStatus[t.team] = { status, magic, ...t };
    delete teamStatus[t.team].team;
  }

  // Build bracket projection
  const bracket = {};
  for (const conf of Object.keys(confSeeds)){
    const s = confSeeds[conf];
    bracket[conf] = {
      wildCard: [
        { higher: s[0], lower: s[3] }, // 1 vs 4
        { higher: s[1], lower: s[2] }, // 2 vs 3
      ],
      championship: { higher: s[0], lower: s[1] }, // projected after WC round
    };
  }

  // Bowl projections (top 8 not in playoffs, sorted by winPct)
  const playoffTeams = new Set([].concat(...Object.values(confSeeds)).map(t => t.team));
  const bowlEligible = all
    .filter(t => !playoffTeams.has(t.team) && t.w >= 6)
    .sort((a,b) => b.winPct - a.winPct || (b.pf - b.pa) - (a.pf - a.pa));
  const bowls = [
    { name: 'PCFL Holiday Bowl',   tier: 1 },
    { name: 'Sunshine Bowl',       tier: 2 },
    { name: 'Heartland Bowl',      tier: 3 },
    { name: 'Frontier Bowl',       tier: 4 },
  ];
  const bowlProjections = bowls.map((b, i) => ({
    ...b,
    teams: [bowlEligible[i*2], bowlEligible[i*2+1]].filter(Boolean).map(t => t.team),
  })).filter(b => b.teams.length === 2);

  return {
    season: +season, throughWeek: wk, regularWeeks: totalRegularWeeks,
    confSeeds, teamStatus, bracket, bowlProjections,
    bowlEligible: bowlEligible.map(t => t.team),
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main(){
  const seasons = readdirSync(DROPS).filter(d=>/^\d{4}$/.test(d));
  const videos = parseVideos(join(ROOT,'scripts','yt-feed.xml'));
  const manifest = { seasons: [] }; // no timestamp: keep CI output deterministic so the bot only commits real data changes

  // Attach fight-song metadata before writing teams.json
  for (const tm of TEAMS) if (FIGHT_SONGS[tm.slug]) tm.fightSong = FIGHT_SONGS[tm.slug];
  writeFileSync(join(DATA,'teams.json'), JSON.stringify(TEAMS,null,1));
  writeFileSync(join(DATA,'videos.json'), JSON.stringify(videos,null,1));

  for (const season of seasons){
    const weekJsonsForSeason = [];   // collected for SoS + playoff after the week loop
    const weekDirs = readdirSync(join(DROPS,season)).filter(d=>/^week\d+$/.test(d))
      .sort((a,b)=>num(a)-num(b));
    const weeks = [];
    let prevRanks = null;
    let latestSchedule = null, latestRosters = null;

    for (const wd of weekDirs){
      const week = num(wd);
      const dir = join(DROPS,season,wd);
      const file = n => { const p = join(dir,n); return existsSync(p) ? read(p) : null; };

      const gs = file('gamestats.html');
      const st = file('standings.html');
      const sc = file('schedule.html');
      const se = file('season.html');
      const ro = file('rosters.html');

      const gameData = gs ? parseGameStats(gs) : { playerOfWeek:null, games:[] };
      const standData = st ? parseStandings(st) : { date:null, standings:[], powerRankings:[] };
      const schedule = sc ? parseSchedule(sc) : [];
      const seasonStats = se ? parseSeason(se) : { leaders:{}, teamStats:{} };
      if (schedule.length) latestSchedule = schedule;
      if (ro) latestRosters = parseRosters(ro);

      // power ranking movement vs previous week
      for (const pr of standData.powerRankings){
        pr.prev = prevRanks ? (prevRanks.get(pr.team) ?? null) : null;
      }
      // record map for ticker (from standings)
      const records = {};
      for (const c of standData.standings) for (const d of c.divisions) for (const tm of d.teams)
        records[tm.team] = `${tm.w}-${tm.l}${tm.t?`-${tm.t}`:''}`;

      // discover play-by-play .log files for this week, if uploaded
      const logsDir = join(DATA, season, 'logs', `week${week}`);
      const logFiles = existsSync(logsDir)
        ? readdirSync(logsDir).filter(f => f.endsWith('.log'))
        : [];
      const logMap = new Map();   // "away|home" -> filename, prefer higher-rev (re-sim)
      for (const f of logFiles){
        const m = f.match(/^(\d{2})W(\d{2})([A-Z]+)@([A-Z]+?)(\d?)\.log$/);
        if (!m) continue;
        const away = teamFrom(m[3]), home = teamFrom(m[4]);
        if (!away || !home) continue;
        const rev = m[5] ? +m[5] : 1;
        const key = `${away}|${home}`;
        const prev = logMap.get(key);
        if (!prev || prev.rev < rev) logMap.set(key, { file: f, rev });
      }

      // attach stories + videos + next opponents + game logs
      const nextWeekGames = schedule.find(w=>w.week===week+1)?.games ?? [];
      for (const g of gameData.games){
        const nextOpp = nextWeekGames.find(x=>{
          const winner = g.away.score>g.home.score ? g.away.team : g.home.team;
          return x.away===winner || x.home===winner;
        });
        g.story = buildStory(g, week, nextOpp);
        const vids = videos.filter(v=>v.season===+season && v.week===week &&
          ((v.away===g.away.team && v.home===g.home.team)||(v.away===g.home.team && v.home===g.away.team)))
          .sort((a,b)=>(b.rev??1)-(a.rev??1) || b.published.localeCompare(a.published));
        g.videoId = vids[0]?.id ?? null;
        g.playerOfGameLine = g.playerOfGame ? findPlayerLine(g, g.playerOfGame) : '';
        // attach log file (orientation-agnostic: away@home OR home@away)
        const lf = logMap.get(`${g.away.team}|${g.home.team}`)
                ?? logMap.get(`${g.home.team}|${g.away.team}`);
        g.logFile = lf ? lf.file : null;
      }
      // player of week stat line
      let powLine = '';
      if (gameData.playerOfWeek){
        const pg = gameData.games.find(g=>g.away.team===gameData.playerOfWeek.team||g.home.team===gameData.playerOfWeek.team);
        if (pg) powLine = findPlayerLine(pg, gameData.playerOfWeek);
      }

      // -------------- AI generation (recaps + wrap-up) ----------
      if (AI.enabled && gameData.games.length){
        const recapResults = await Promise.all(gameData.games.map(g => aiRecap(g, week, season)));
        for (let i = 0; i < gameData.games.length; i++){
          const ai = recapResults[i];
          if (ai) gameData.games[i].aiStory = ai;
        }
        console.log(`  ai: ${recapResults.filter(Boolean).length}/${gameData.games.length} recaps generated`);
      }
      let weeklyWrap = null;
      if (AI.enabled && gameData.games.length){
        weeklyWrap = await aiWeeklyWrap(gameData.games, week, season, standData.powerRankings);
        if (weeklyWrap) console.log(`  ai: weekly wrap-up generated`);
      }

      const weekJson = {
        season: +season, week, date: standData.date,
        playerOfWeek: gameData.playerOfWeek ? { ...gameData.playerOfWeek, line: powLine } : null,
        games: gameData.games,
        standings: standData.standings,
        powerRankings: standData.powerRankings,
        records,
        leaders: seasonStats.leaders,
        teamSeasonStats: seasonStats.teamStats,
        nextWeek: { week: week+1, games: nextWeekGames },
        logFiles: logFiles.sort(),   // all .log filenames for this week (download index)
        weeklyWrap,                  // AI-written weekly column, null if AI disabled
        aiGenerated: AI.enabled,
      };
      const outDir = join(DATA, season);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `week${week}.json`), JSON.stringify(weekJson));
      weekJsonsForSeason.push(weekJson);
      weeks.push(week);
      prevRanks = new Map(standData.powerRankings.map(p=>[p.team,p.rank]));
      console.log(`✓ ${season} week ${week}: ${gameData.games.length} games, ${standData.powerRankings.length} ranked, ${Object.keys(seasonStats.leaders).filter(k=>seasonStats.leaders[k]?.length).length} leader boards`);

      // -------------- AI previews for NEXT week ------------------
      if (AI.enabled && nextWeekGames.length){
        // Build a recent-results snapshot per team (last 2 games)
        const recent = {};
        for (const g of gameData.games){
          const winner = g.away.score > g.home.score ? g.away : g.home;
          const loser  = g.away.score > g.home.score ? g.home : g.away;
          (recent[winner.team] ??= []).push({ opp: teamName(loser.team), result: 'W', score: `${winner.score}-${loser.score}` });
          (recent[loser.team]  ??= []).push({ opp: teamName(winner.team), result: 'L', score: `${loser.score}-${winner.score}` });
        }
        const previewResults = await Promise.all(nextWeekGames.map(g =>
          aiPreview(g, week + 1, season,
            records, Object.fromEntries(standData.powerRankings.map(r => [r.team, r.rank])),
            recent)));
        const previewsJson = {
          season: +season, week: week + 1, generated: standData.date,
          games: nextWeekGames.map((g, i) => previewResults[i] ? { ...g, ...previewResults[i] } : g).filter(Boolean),
        };
        // Game of the Week = highest predicted confidence among ranked games
        const ranked = previewsJson.games.filter(g => g.prediction);
        if (ranked.length){
          previewsJson.gameOfWeek = ranked.sort((a, b) =>
            (b.prediction.confidence ?? 0) - (a.prediction.confidence ?? 0))[0];
        }
        const prevDir = join(outDir, 'previews');
        mkdirSync(prevDir, { recursive: true });
        writeFileSync(join(prevDir, `week${week + 1}.json`), JSON.stringify(previewsJson));
        console.log(`  ai: ${previewResults.filter(Boolean).length}/${nextWeekGames.length} previews for week ${week + 1}`);
      }
    }

    if (latestSchedule) writeFileSync(join(DATA,season,'schedule.json'), JSON.stringify(latestSchedule));
    if (latestRosters) writeFileSync(join(DATA,season,'rosters.json'), JSON.stringify(latestRosters));

    // -------------- Predictive engine (per season) ---------------
    if (latestSchedule && weekJsonsForSeason.length){
      const sos = computeSoS(season, latestSchedule, weekJsonsForSeason);
      if (sos){ writeFileSync(join(DATA, season, 'sos.json'), JSON.stringify(sos)); console.log(`✓ ${season} SoS computed for ${Object.keys(sos).length} teams`); }
      const playoffs = computePlayoffPicture(season, latestSchedule, weekJsonsForSeason);
      if (playoffs){ writeFileSync(join(DATA, season, 'playoffs.json'), JSON.stringify(playoffs)); console.log(`✓ ${season} playoff picture computed (through week ${playoffs.throughWeek})`); }
    }

    manifest.seasons.push({ year:+season, weeks, latest: weeks[weeks.length-1] ?? null });
  }
  writeFileSync(join(DATA,'manifest.json'), JSON.stringify(manifest,null,1));
  console.log('✓ manifest written');
}
main().catch(e => { console.error(e); process.exit(1); });
