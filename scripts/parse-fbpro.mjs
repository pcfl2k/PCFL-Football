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

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
function main(){
  const seasons = readdirSync(DROPS).filter(d=>/^\d{4}$/.test(d));
  const videos = parseVideos(join(ROOT,'scripts','yt-feed.xml'));
  const manifest = { generated: new Date().toISOString(), seasons: [] };

  writeFileSync(join(DATA,'teams.json'), JSON.stringify(TEAMS,null,1));
  writeFileSync(join(DATA,'videos.json'), JSON.stringify(videos,null,1));

  for (const season of seasons){
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

      // attach stories + videos + next opponents
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
      }
      // player of week stat line
      let powLine = '';
      if (gameData.playerOfWeek){
        const pg = gameData.games.find(g=>g.away.team===gameData.playerOfWeek.team||g.home.team===gameData.playerOfWeek.team);
        if (pg) powLine = findPlayerLine(pg, gameData.playerOfWeek);
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
      };
      const outDir = join(DATA, season);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `week${week}.json`), JSON.stringify(weekJson));
      weeks.push(week);
      prevRanks = new Map(standData.powerRankings.map(p=>[p.team,p.rank]));
      console.log(`✓ ${season} week ${week}: ${gameData.games.length} games, ${standData.powerRankings.length} ranked, ${Object.keys(seasonStats.leaders).filter(k=>seasonStats.leaders[k]?.length).length} leader boards`);
    }

    if (latestSchedule) writeFileSync(join(DATA,season,'schedule.json'), JSON.stringify(latestSchedule));
    if (latestRosters) writeFileSync(join(DATA,season,'rosters.json'), JSON.stringify(latestRosters));
    manifest.seasons.push({ year:+season, weeks, latest: weeks[weeks.length-1] ?? null });
  }
  writeFileSync(join(DATA,'manifest.json'), JSON.stringify(manifest,null,1));
  console.log('✓ manifest written');
}
main();
