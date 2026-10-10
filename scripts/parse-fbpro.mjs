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
import { gameNarrative, narrativeText, seasonContextText, previewContextText, numbersNotIn } from './ai-context.mjs';

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
  t('arizona-state','Arizona State','Sun Devils','ASU','#8C1D40','#FFC627','Western','Pacific',['ARIZONA ST','ARIZ ST','AZ STATE','OREGON','UO','ORE','OR']), // formerly Oregon (2029 rebrand)
  t('ohio-state','Ohio State','Buckeyes','OSU','#BB0000','#A7B1B7','Western','Central',[]),
  t('notre-dame','Notre Dame','Fighting Irish','ND','#0C2340','#C99700','Western','Central',[]),
  t('colorado','Colorado','Buffaloes','COL','#CFB87C','#000000','Western','Central',['COLO']),
  t('michigan-state','Michigan State','Spartans','MSU','#18453B','#FFFFFF','Western','Central',['MICHIGAN ST','MICH ST','OKLAHOMA','OU','OKL']), // formerly Oklahoma
  t('michigan','Michigan','Wolverines','MICH','#00274C','#FFCB05','Western','Central',['MIC']),
  t('texas','Texas','Longhorns','TEX','#BF5700','#FFFFFF','Eastern','Atlantic',[]),
  t('penn-state','Penn State','Nittany Lions','PSU','#041E42','#FFFFFF','Eastern','Atlantic',['PENNST','PENN ST']),
  t('boston-college','Boston College','Eagles','BC','#98002E','#BC9B6A','Eastern','Atlantic',['BOSTON COLLEG']),
  t('alabama','Alabama','Crimson Tide','ALA','#9E1B32','#828A8F','Eastern','Atlantic',['BAMA','CLEMSON','CLEM','CLE']), // formerly Clemson
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
  'arizona-state':  { youtubeId:'kbLIvnst_jk', name:'Maroon and Gold',                   start:0,  end:22 },
  'ohio-state':     { youtubeId:'uDI1qWHqJt4', name:'Buckeye Battle Cry',                start:0,  end:22 },
  'notre-dame':     { youtubeId:'clNTdf8xAtk', name:'Notre Dame Victory March',          start:0,  end:22 },
  colorado:         { youtubeId:'jcTOBFq-2T0', name:'CU Fight Song',                     start:0,  end:22 },
  'michigan-state': { youtubeId:'hbK6KiqkOKQ', name:'Victory for MSU',                   start:0,  end:22 },
  michigan:         { youtubeId:'Oww_gtVVqkQ', name:'The Victors',                       start:0,  end:22 },
  texas:            { youtubeId:'W41tB1nkQtI', name:'The Eyes of Texas',                 start:0,  end:22 },
  'penn-state':     { youtubeId:'wLIuF9E6gcQ', name:'Fight On, State',                   start:0,  end:22 },
  'boston-college': { youtubeId:'qBwkc-x8dYs', name:'For Boston',                        start:0,  end:22 },
  alabama:          { youtubeId:'hVxc6O2asxM', name:'Yea Alabama',                       start:0,  end:22 },
  lsu:              { youtubeId:'YZ4e35_hdjE', name:'Hey Fightin’ Tigers',          start:0,  end:22 },
  tennessee:        { youtubeId:'ylc2FxBLvz4', name:'Rocky Top',                         start:0,  end:22 },
  arkansas:         { youtubeId:'0hJMyTBFJnI', name:'Arkansas Fight',                    start:0,  end:22 },
  georgia:          { youtubeId:'pe6njUwC59c', name:'Glory, Glory',                      start:0,  end:22 },
  miami:            { youtubeId:'HMfQ-GKhvQo', name:'Miami U How-Dee-Doo',               start:0,  end:22 },
};
const ALIAS = new Map();
for (const tm of TEAMS) for (const a of tm.aliases) ALIAS.set(a, tm.slug);
// longest alias first, so a truncated "MICHIGAN ST" never prefix-matches "MICHIGAN"
const ALIAS_BY_LEN = [...ALIAS].sort((x, y) => y[0].length - x[0].length);

function teamFrom(text){
  if (!text) return null;
  const up = text.trim().toUpperCase().replace(/\s+/g,' ');
  if (ALIAS.has(up)) return ALIAS.get(up);
  // prefix match handles truncated names like "Boston Colleg"
  for (const [a, slug] of ALIAS_BY_LEN) {
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
      if (header && !/^(TEX|UGA|LSU|MIA|BC|ARK|CLEM|TENN|MICH|OSU|ND|UCLA|OU|UW|COL|USC|UO|PSU|ASU|MSU|ALA)\s+Total/i.test(txt.trim())){
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
  // Played games: "Team A 35 at Team B 29" — with optional trailing annotation
  // FBPro98 appends "(ot)", "(2ot)" etc. for overtime games. Capture the
  // annotation as `notes` so it can be surfaced downstream.
  let m = s.match(/^(.+?)\s+(\d+)\s+at\s+(.+?)\s+(\d+)(?:\s*\(([^)]+)\))?\s*$/);
  if (m){
    const a=teamFrom(m[1]), h=teamFrom(m[3]);
    if (!a||!h) return null;
    const out = { away:a, home:h, awayScore:+m[2], homeScore:+m[4], final:true };
    if (m[5]) out.notes = m[5].trim();
    return out;
  }
  // Upcoming games: just "Team A at Team B"
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
  // team tables — strips bracketed rank markers ("349 [10]") that some FBPro98
  // team sections (T19/O19) interleave between numeric columns; cols must
  // match the section's actual non-rank values, in order.
  const teamTable = (name, cols) => sec(name).map(l=>{
    const txt = strip(l);
    const m = txt.match(/^\s*(\d+)\s+([A-Za-z .]+?)\s{2,}(.+)$/);
    if (!m) return null;
    const slug = teamFrom(m[2]); if (!slug) return null;
    const cleaned = m[3].replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const vals = cleaned.split(/\s+/);
    const o = { team: slug };
    cols.forEach((c,i)=>o[c]=vals[i]);
    return o;
  }).filter(Boolean);
  const teamStats = {
    passing:       teamTable('T1',  ['att','com','pct','yds','avg','lg','td','int','rtg','sksYds']),
    rushing:       teamTable('T2',  ['att','yds','avg','lg','td']),
    interceptions: teamTable('T4',  ['int','yds','avg','lg','td']),
    sacks:         teamTable('T9',  ['sacks','safeties']),
    tackles:       teamTable('T10', ['tackles']),
    scoring:       teamTable('T15', ['rushTD','recTD','miscTD','totTD','twoPt','xp','fg','sft','pts']),
    totalYards:    teamTable('T19', ['rushYds','passYds','totYds']),
    oppPassing:    teamTable('O1',  ['att','com','pct','yds','avg','lg','td','int','rtg','sksYds']),
    oppRushing:    teamTable('O2',  ['att','yds','avg','lg','td']),
    oppScoring:    teamTable('O15', ['rushTD','recTD','miscTD','totTD','twoPt','xp','fg','sft','pts']),
    oppTotalYards: teamTable('O19', ['rushYds','passYds','totYds']),
  };
  return { leaders, teamStats };
}
function parsePassingRow(l){
  const txt = strip(l);
  // Yards is allowed to contain thousand-separator commas ("1,432") once a QB
  // crosses 1,000 yards mid-season. Earlier weeks pass through too.
  const m = txt.match(/^\s*(\d+)\s(.{15})(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d,]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)/);
  if (!m) return null;
  const team = teamFrom(m[3]); if (!team) return null;
  return { name: fixName(m[2].trim()), team, yr: m[4], pos:'QB',
    att:+m[5], com:+m[6], pct:+m[7], yds:num(m[8]), avg:+m[9], lg:+m[10], td:+m[11], int:+m[12], rtg:+m[13], sksYds:m[14] };
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
/*
 * FBPro98 roster report ("PCFL Rosters"). Sources, newest wins per season:
 *   drops/<season>/rosters/*.html      roster-only drop (Updater "ROSTER ONLY" mode)
 *   drops/<season>/week<N>/rosters.html roster export inside a weekly drop
 * The newest export is chosen by the report's own date line, then folder order
 * (weeks ascending, then the rosters/ folder, files by name). See buildSeasonRosters().
 *
 * Each player spans two lines: line 1 = status, slot (pos+depth), jersey, name, injury,
 * year, height, weight + 8 ACTUAL ratings (SP AC AG ST HA EN IN DI); line 2 = the same 8
 * attributes as POTENTIAL ratings (indented, numbers only). Free-agent / draft-pool rows
 * have no status, depth or jersey. Placeholder "filler" players (every rating 1) are
 * dropped from the output but counted in _meta.
 */
const INJ_STATUS = { P:'Probable', Q:'Questionable', D:'Doubtful', O:'Out' };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseRosterHeader(html){
  const head = strip(html.split('\n').slice(0, 14).join('\n'));
  const out = { reportSeason: null, asOf: null, asOfISO: null, phase: null };
  const s = head.match(/(\d{4})\s+season/i); if (s) out.reportSeason = +s[1];
  const lines = head.split('\n').map(l => l.trim());
  const di = lines.findIndex(l => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(l));
  if (di >= 0){
    out.asOf = lines[di];
    const m = lines[di].match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
    const mi = MONTHS.indexOf(m[1]);
    if (mi >= 0) out.asOfISO = `${m[3]}-${String(mi+1).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`;
    const ph = lines[di+1];
    if (ph && !/^(Teams|PCFL)/i.test(ph)) out.phase = ph;
  }
  return out;
}

function rosterLabel(meta){
  const yr = meta.reportSeason ?? meta.season;
  let when = '';
  if (meta.asOfISO){
    const [y, m, d] = meta.asOfISO.split('-').map(Number);
    when = `${MONTHS[m-1].slice(0,3)} ${d}, ${y}`;
  }
  const ph = meta.phase || '';
  const phaseTxt = /^end of season$/i.test(ph) ? `End of ${yr} season`
    : /^week\s+\d+$/i.test(ph) ? `${yr} season, ${ph.replace(/^week/i,'Week')}`
    : /^pre-?season$/i.test(ph) ? `${yr} preseason`
    : ph ? `${yr} season · ${ph}` : `${yr} season`;
  return `Rosters as of ${when || 'latest export'} · ${phaseTxt}`;
}

function parseRosterLine(txt){
  // Fixed columns from the report header: status 0-2, slot 3-6, jersey 7-10, name 12-32, then
  // Inj Yr Ht Wt + 8 ratings. A looser regex covers any column drift in other exports.
  let m = txt.slice(0, 12).match(/^(\S{1,2})?\s+([A-Z]{1,2})(\d*)\s*(\d+)?\s*$/);
  let name = txt.slice(12, 33).trim();
  let rest = txt.slice(33).match(/^\s*(\S+)\s+([R0-9]+)\s+(\d+-\d+)\s+(\d+)\s+((?:\d+\s+){7}\d+)\s*$/);
  if (!m || !rest || !name){
    const L = txt.match(/^(\S{1,2})?\s+([A-Z]{1,2})(\d*)\s+(\d+)?\s*(\S.*?)\s{2,}(\S+)\s+([R0-9]+)\s+(\d+-\d+)\s+(\d+)\s+((?:\d+\s+){7}\d+)\s*$/);
    if (!L) return null;
    m = [null, L[1], L[2], L[3], L[4]]; name = L[5].trim(); rest = [null, L[6], L[7], L[8], L[9], L[10]];
  }
  const a = rest[5].trim().split(/\s+/).map(Number);
  const [ft, inch] = rest[3].split('-').map(Number);
  const p = {
    status: m[1] || null, pos: m[2], depth: m[3] ? +m[3] : null, num: m[4] != null ? +m[4] : null,
    name, inj: rest[1], yr: rest[2], ht: rest[3], wt: +rest[4],
    a, p: [...a],
    ovr: Math.round(a.reduce((x,y)=>x+y,0)/a.length),
    slot: m[2] + (m[3] || ''), htIn: ft * 12 + inch,
  };
  const im = String(p.inj).match(/^([A-Z])-(\d+)$/);
  if (im && p.inj !== 'OK'){ p.injStatus = im[1]; p.injWeeks = +im[2]; }
  return p;
}

function parseRosters(html){
  const lines = html.split('\n');
  const teams = {}, pools = { freeAgents: [], draftPool: [] };
  const filler = { team: 0, freeAgents: 0, draftPool: 0 };
  const isFiller = pl => pl.a.every(v => v <= 1) && pl.p.every(v => v <= 1);
  let cur = null, kind = null, last = null;
  const flush = () => {
    if (!last) return;
    const pl = last; last = null;
    pl.pot = Math.round(pl.p.reduce((x,y)=>x+y,0)/pl.p.length);
    if (isFiller(pl)){ filler[kind === 'team' ? 'team' : kind]++; return; }
    if (kind !== 'team'){ delete pl.status; delete pl.depth; delete pl.num; }
    cur.push(pl);
  };
  for (const raw of lines){
    const tm = raw.match(/Team Roster:\s*([^<]+)/i);
    if (tm){
      flush();
      const slug = teamFrom(tm[1].trim());
      if (!slug) console.warn(`  rosters: unknown team "${tm[1].trim()}" skipped`);
      cur = slug ? (teams[slug] = []) : null; kind = 'team';
      continue;
    }
    if (/<A NAME="A\d+">\s*Free Agent (Draft )?Pool/i.test(raw)){ flush(); cur = pools.freeAgents; kind = 'freeAgents'; continue; }
    if (/<A NAME="A\d+">\s*College Draft Pool/i.test(raw)){ flush(); cur = pools.draftPool; kind = 'draftPool'; continue; }
    if (!cur) continue;
    const txt = strip(raw);
    const pot = txt.match(/^\s{30,}((?:\d+\s+){7}\d+)\s*$/);
    if (pot && last){
      last.p = pot[1].trim().split(/\s+/).map(Number);
      flush();
      continue;
    }
    if (/^\s*Pos\s+Num\s+Name/.test(txt)) continue;
    const pl = parseRosterLine(txt);
    if (pl){ flush(); last = pl; }
  }
  flush();
  return { teams, freeAgents: pools.freeAgents, draftPool: pools.draftPool, filler };
}

/* Pick the newest roster export for a season and build rosters.json + its _meta. */
function buildSeasonRosters(season, weekDirs){
  const cands = [];
  for (const wd of weekDirs){
    const p = join(DROPS, season, wd, 'rosters.html');
    if (existsSync(p)) cands.push({ path: p, rel: `drops/${season}/${wd}/rosters.html`, kind: 'weekly-export', week: num(wd) });
  }
  const rdir = join(DROPS, season, 'rosters');
  if (existsSync(rdir)){
    for (const f of readdirSync(rdir).filter(f => /\.html?$/i.test(f)).sort())
      cands.push({ path: join(rdir, f), rel: `drops/${season}/rosters/${f}`, kind: 'roster-drop', week: null });
  }
  const valid = [];
  cands.forEach((c, order) => {
    const html = read(c.path);
    if (!/Team Roster:/i.test(html)){ console.warn(`  rosters: ${c.rel} is not an FBPro98 roster report — ignored`); return; }
    valid.push({ ...c, order, html, header: parseRosterHeader(html) });
  });
  if (!valid.length) return null;
  valid.sort((x, y) => (y.header.asOfISO || '').localeCompare(x.header.asOfISO || '') || y.order - x.order);
  const pick = valid[0];
  const parsed = parseRosters(pick.html);
  if (pick.header.reportSeason && pick.header.reportSeason !== +season)
    console.warn(`  rosters: ${pick.rel} says "${pick.header.reportSeason} season" but is filed under ${season}`);
  const players = Object.values(parsed.teams).reduce((s, a) => s + a.length, 0);
  const meta = {
    season: +season, ...pick.header,
    source: pick.rel, sourceKind: pick.kind, week: pick.week,
    teams: Object.keys(parsed.teams).length, players,
    freeAgents: { listed: parsed.freeAgents.length, filler: parsed.filler.freeAgents, total: parsed.freeAgents.length + parsed.filler.freeAgents },
    draftPool:  { listed: parsed.draftPool.length,  filler: parsed.filler.draftPool,  total: parsed.draftPool.length + parsed.filler.draftPool },
    fillerExcluded: parsed.filler.team + parsed.filler.freeAgents + parsed.filler.draftPool,
    considered: valid.length,
  };
  meta.label = rosterLabel(meta);
  // Backwards compatible: top-level team-slug keys still map to player arrays (existing
  // consumers read rosters[slug]); underscore keys can never collide with a slug.
  const data = { ...parsed.teams, _meta: meta, _freeAgents: parsed.freeAgents, _draftPool: parsed.draftPool };
  console.log(`✓ ${season} rosters: ${meta.label} — ${players} players / ${meta.teams} teams, ${meta.freeAgents.listed} free agents (+${meta.fillerExcluded} filler hidden) from ${pick.rel}${valid.length > 1 ? ` (newest of ${valid.length})` : ''}`);
  return { data, meta };
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
 * Calls HuggingFace's Inference Router (OpenAI-compatible) to generate
 * broadcast-voice content from the deterministic JSON we've already
 * produced. Defaults to Qwen 2.5 7B Instruct — open weights, no gating,
 * free tier reliable for our weekly volume.
 *
 * Behavior:
 *   - If HF_TOKEN (or HUGGINGFACE_TOKEN) is unset, every helper returns
 *     null and the site falls back to the existing deterministic content.
 *     The build stays green either way.
 *   - Calls are cached by SHA-256 of (model + prompt). The cache lives at
 *     data/<season>/ai-cache/<hash>.json and is checked into the repo, so
 *     CI never regenerates content for inputs it has already seen — free-
 *     tier credits go further and rate limits aren't a concern week-over-
 *     week.
 *   - Open models are less reliable at "Return ONLY JSON" than Claude was,
 *     so the JSON extractor is generous — it tries fenced blocks first,
 *     then any {...} substring it can find.
 *   - Rate-limit / cold-start failures degrade silently to deterministic
 *     content. The build never fails because the AI was busy.
 */
import { createHash } from 'node:crypto';

// Provider auto-selection: Anthropic Claude is preferred when both are set
// (better writing quality and the per-week cost is ~$0.12 — within "keep
// costs low" by any reasonable definition). HuggingFace router is the free
// alternative. Either provider is fine; the code just picks based on which
// secret is configured.
const AI = (() => {
  // Preferred: the league's free self-hosted Ollama on the VPS, reached through the
  // Recruitment Center's token-protected relay (Ollama itself is never public).
  const relayUrl = (process.env.PCFL_AI_URL || '').replace(/\/+$/, '');
  const relayTok = process.env.PCFL_AI_TOKEN || '';
  if (relayUrl && relayTok) return {
    provider: 'ollama',
    apiKey: relayTok,
    model: process.env.PCFL_AI_MODEL || 'nemotron-3-ultra:cloud',
    editorModel: process.env.PCFL_AI_EDITOR_MODEL || 'nemotron-3-super:cloud',
    endpoint: relayUrl + '/ai/chat',
    enabled: true,
  };
  const anthKey = process.env.ANTHROPIC_API_KEY || '';
  const hfKey   = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '';
  if (anthKey) return {
    provider: 'anthropic',
    apiKey: anthKey,
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    endpoint: 'https://api.anthropic.com/v1/messages',
    enabled: true,
  };
  if (hfKey) return {
    provider: 'huggingface',
    apiKey: hfKey,
    model: process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
    enabled: true,
  };
  return { provider: null, apiKey: '', model: '', endpoint: '', enabled: false };
})();
if (!AI.enabled) console.log('ℹ No AI API key set (ANTHROPIC_API_KEY or HF_TOKEN) — AI content disabled (deterministic fallback in use).');
else             console.log(`ℹ AI content enabled via ${AI.provider} (${AI.model}).`);

function aiCacheDir(season){ return join(DATA, String(season), 'ai-cache'); }

// Retry on 429 (rate-limit) with backoff. Anthropic returns `retry-after`
// in seconds; HF doesn't always, so fall back to exponential.
async function fetchWithRetry(url, opts, attempts = 4){
  for (let i = 0; i < attempts; i++){
    const r = await fetch(url, opts);
    if (r.status !== 429) return r;
    const retryAfter = r.headers.get('retry-after');
    const wait = retryAfter ? Math.min(70, +retryAfter) * 1000 : Math.min(60000, 6000 * Math.pow(2, i));
    console.warn(`AI rate-limited (${AI.provider}), waiting ${Math.round(wait/1000)}s before retry ${i+1}/${attempts-1}`);
    await new Promise(res => setTimeout(res, wait));
  }
  return fetch(url, opts);
}

// Limit how many AI calls fire in parallel — keeps us under per-minute rate
// limits without serializing the whole batch.
async function pAllLimit(items, fn, limit = 4){
  const results = new Array(items.length);
  let next = 0;
  async function worker(){
    while (next < items.length){
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Generous JSON extractor — open models often produce extra prose before
// or after the JSON. Try fenced code blocks first, then the first {...}
// substring that parses.
function extractJSON(text){
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence){
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  // Find a brace-balanced JSON object anywhere in the response
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++){
    const c = text[i];
    if (esc){ esc = false; continue; }
    if (c === '\\'){ esc = true; continue; }
    if (c === '"' && !esc) inStr = !inStr;
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}'){
      depth--;
      if (depth === 0){
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

// Circuit breaker: an account-level failure (no credit, bad/revoked key) will fail every
// call the same way, so stop after the first one, keep cached content, and say so loudly
// (GitHub Actions ::warning:: annotation + end-of-run summary) instead of silently
// shipping deterministic write-ups in place of AI recaps.
const AI_STATS = { cached: 0, generated: 0, failed: 0, skipped: 0, fatal: null };
// PCFL_AI_CACHE_ONLY=1: use cached AI content but never generate (staging builds and
// non-main pushes — the slow free model only runs for the production site).
const AI_CACHE_ONLY = process.env.PCFL_AI_CACHE_ONLY === '1';
if (AI.enabled && AI_CACHE_ONLY) console.log('ℹ AI cache-only mode: cached content is used, nothing new is generated in this build.');
function aiFatal(status, body){
  if (status === 401 || status === 403) return `the ${AI.provider} API key was rejected (${status})`;
  if (/credit balance|billing|insufficient_quota|quota/i.test(body)) return `the ${AI.provider} account is out of credit`;
  return null;
}
process.on('exit', () => {
  if (!AI.enabled) return;
  const line = `AI content: ${AI_STATS.cached} from cache, ${AI_STATS.generated} newly generated, ${AI_STATS.failed + AI_STATS.skipped} missing`;
  console.log('ℹ ' + line);
  if (AI_STATS.fatal) console.log(`::warning title=AI recaps not generated::${AI_STATS.fatal} — ${AI_STATS.failed + AI_STATS.skipped} AI recaps/previews/wraps fell back to deterministic text. Fix the account, then re-run this workflow; cached content is unaffected.`);
});

const LEGACY_AI = [['anthropic', 'claude-haiku-4-5-20251001'], ['huggingface', 'Qwen/Qwen2.5-7B-Instruct']];
let relayChain = Promise.resolve();   // the VPS model runs one generation at a time; don't stack up timeouts
async function callClaude(prompt, opts = {}){
  if (!AI.enabled) return null;
  const keyFor = (provider, model) => createHash('sha256').update(provider + '\n' + model + '\n' + JSON.stringify(opts) + '\n' + prompt).digest('hex').slice(0, 16);
  // v2 prompts (grounded in play-by-play + season stats) are cached by prompt only, so
  // switching AI providers/models never throws away or regenerates finished writing.
  const { validate, ...keyOpts } = opts;
  const v2Key = createHash('sha256').update('pcfl-ai-v2\n' + JSON.stringify(keyOpts) + '\n' + prompt).digest('hex').slice(0, 16);
  const cacheFile = join(aiCacheDir(opts.season || 'global'), (opts.v2 ? v2Key : keyFor(AI.provider, AI.model)) + '.json');
  if (opts.v2 && existsSync(cacheFile)){
    try { const hit = JSON.parse(readFileSync(cacheFile, 'utf8')); AI_STATS.cached++; return hit; } catch {}
  }
  // Reuse content already written for the same prompt by any provider (the existing
  // Claude Haiku recaps stay; only genuinely new prompts are generated).
  for (const [prov, model] of (opts.v2 ? [] : [[AI.provider, AI.model], ...LEGACY_AI.filter(([p, m]) => p !== AI.provider || m !== AI.model)])){
    const f = join(aiCacheDir(opts.season || 'global'), keyFor(prov, model) + '.json');
    if (existsSync(f)){
      try { const hit = JSON.parse(readFileSync(f, 'utf8')); AI_STATS.cached++; return hit; } catch {}
    }
  }
  if (AI_STATS.fatal || AI_CACHE_ONLY){ AI_STATS.skipped++; return null; }
  mkdirSync(aiCacheDir(opts.season || 'global'), { recursive: true });

  let feedback = '';
  for (let attempt = 0; attempt < (validate ? 2 : 1); attempt++){
    let result = await aiRequest(prompt + feedback, opts);
    if (!result) return null;
    const problems = validate ? validate(result) : [];
    if (problems.length && attempt === 0){
      console.warn(`AI draft rejected (${problems.join('; ').slice(0, 160)}) — asking for a corrected rewrite`);
      feedback = `\n\nYOUR PREVIOUS DRAFT WAS REJECTED: ${problems.join('; ')}. Rewrite it using ONLY facts and numbers that appear in the data above.`;
      continue;
    }
    if (problems.length) { console.warn(`AI draft still has issues after rewrite: ${problems.join('; ').slice(0, 160)} — discarded`); AI_STATS.failed++; return null; }
    let final = result;
    if (opts.edit && AI.provider === 'ollama'){
      // Copy-desk pass: a second model checks every claim in the draft against the same data
      // and fixes what is unsupported (wrong counts, wrong attribution, contradictions).
      const editPrompt = `${prompt}\n\n---\nDRAFT TO FACT-CHECK (JSON):\n${JSON.stringify(result)}\n\nYou are the copy desk. Check every sentence of the draft against the data above, especially every described EVENT against the OFFICIAL PLAY-BY-PLAY FACTS and its closing sequence. Fix anything not supported by the data: events that are not listed (onside kicks, kneel-downs, kickoffs, timeouts, a player taking a snap he did not take), wrong counts (e.g. touchdowns credited to the wrong player or totals the data does not give), wrong attributions (who threw, ran, caught or intercepted), wrong period/clock, contradictions (e.g. calling 50% "perfect"), or invented details. When unsure, delete the claim rather than guess. Keep the voice, structure and length; change only what is wrong. Return the corrected draft as JSON in exactly the same shape.`;
      const edited = await aiRequest(editPrompt, { ...opts, model: AI.editorModel, temperature: 0.2 });
      const editProblems = edited ? (validate ? validate(edited) : []) : ['no reply'];
      if (edited && !editProblems.length) final = edited;
      else console.warn(`  copy-desk pass skipped (${editProblems.join('; ').slice(0, 120)}); keeping the checked draft`);
    }
    result = final;
    writeFileSync(cacheFile, JSON.stringify(result));
    AI_STATS.generated++;
    return result;
  }
  return null;
}

/** One model call (no caching). Returns parsed JSON / {text}, or null. */
async function aiRequest(prompt, opts = {}){
  // For JSON-mode prompts, stress the constraint at the end — open models
  // need the reminder more than Claude does.
  const userContent = opts.parseJSON
    ? prompt + '\n\nIMPORTANT: Respond with ONLY the JSON object. No prose before or after.'
    : prompt;

  let fetchOpts;
  if (AI.provider === 'ollama'){
    fetchOpts = {
      method: 'POST',
      headers: { 'x-pcfl-ai-token': AI.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ system: opts.system || '', prompt: userContent, json: !!opts.parseJSON, maxTokens: opts.maxTokens || 1500, temperature: opts.temperature ?? 0.7, model: opts.model || AI.model }),
      signal: AbortSignal.timeout(600000),
    };
  } else if (AI.provider === 'anthropic'){
    fetchOpts = {
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
        messages: [{ role: 'user', content: userContent }],
      }),
    };
  } else {
    // HuggingFace router uses OpenAI-compatible chat completion schema
    const messages = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: userContent });
    fetchOpts = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI.model,
        messages,
        max_tokens: opts.maxTokens || 1500,
        temperature: 0.7,
      }),
    };
  }

  try {
    const r = AI.provider === 'ollama'
      ? await (relayChain = relayChain.catch(() => {}).then(() => fetchWithRetry(AI.endpoint, fetchOpts)))
      : await fetchWithRetry(AI.endpoint, fetchOpts);
    if (!r.ok){
      const err = await r.text();
      AI_STATS.failed++;
      const fatal = aiFatal(r.status, err);
      if (fatal){ AI_STATS.fatal = fatal; console.warn(`AI disabled for the rest of this run: ${fatal}.`); }
      console.warn(`AI call failed (${AI.provider}): ${r.status} ${err.slice(0, 200)}`);
      return null;
    }
    const j = await r.json();
    const text = AI.provider === 'ollama' ? (j.text || '')
      : AI.provider === 'anthropic' ? (j.content?.[0]?.text || '')
      : (j.choices?.[0]?.message?.content || '');
    if (!text) return null;
    let result;
    if (opts.parseJSON){
      result = extractJSON(text);
      if (!result){ console.warn(`AI JSON parse failed (first 160 chars): ${text.slice(0,160)}`); return null; }
    } else {
      result = { text };
    }
    return result;
  } catch (e){
    console.warn(`AI fetch error: ${e.message}`);
    return null;
  }
}

const SYS_BROADCAST_V2 =
  'You are the lead play-by-play voice and analyst of the PCFL Network, writing the definitive recap the morning after. ' +
  'Write with live-broadcast energy in the big moments (vivid verbs, the clock, the down and distance, the score) and an analyst\'s ' +
  'perspective in between: what the numbers say, how this game fits the season, what it means next. Specific, never generic; ' +
  'confident, never hyperbolic. Plain prose, no markdown, no emoji, no headers inside paragraphs. ' +
  'ACCURACY IS NON-NEGOTIABLE: use only facts, names and numbers present in the data you are given. Never invent plays, quarters, ' +
  'scores, yardages, streaks, injuries, crowd details or quotes. When a fact is not in the data, leave it out. ' +
  'The PCFL is a self-contained simulation league: never name real-world coaches, conferences, bowls, networks or media personalities, ' +
  'and say "the staff" rather than naming any coach.';
const SYS_BROADCAST =
  'You are a veteran college football broadcast analyst writing for the PCFL Network. ' +
  'Voice: confident, observant, occasional flair, never hyperbolic. ' +
  'Surface a concrete turning point or key matchup; do not write generic copy. ' +
  'Use plain prose, no markdown, no emoji, no headers. ' +
  'Never invent stats — only reason about what the input data shows. ' +
  'CRITICAL: The PCFL is a self-contained simulation league. NEVER name or reference ' +
  'real-world coaches (no Deion Sanders, Nick Saban, Dabo Swinney, Kirby Smart, ' +
  'Lincoln Riley, Marcus Freeman, or any other real coach). NEVER reference real-world ' +
  'rivalries, conferences (SEC, Big Ten, etc.), bowl games, broadcast networks, or ' +
  'media personalities. Treat every team as its own program in the PCFL universe. If ' +
  'you need to refer to coaching, say "the staff" or "the coaching room" — never a ' +
  'specific name.';

const FORMER_NAMES = { Oregon: 'Arizona State', Oklahoma: 'Michigan State', Clemson: 'Alabama' };
const logTeamName = n => FORMER_NAMES[n] || (TEAMS.find(t => t.slug === teamFrom(n))?.name) || n;
const teamName2 = slug => TEAMS.find(t => t.slug === slug)?.name || slug;
/** Facts the writing is checked against: rejects multi-digit numbers that are not in the data. */
const numberGuard = (data, fields) => out => {
  const text = fields.map(f => JSON.stringify(out?.[f] ?? '')).join(' ');
  const bad = numbersNotIn(text, data);
  return bad.length ? [`numbers not in the data: ${bad.slice(0, 8).join(', ')}`] : [];
};

function teamCtx(slug, records, ranks){
  const t = TEAMS.find(x => x.slug === slug);
  if (!t) return null;
  return { name: t.name, nickname: t.nickname, record: records[slug] || '0-0', rank: ranks[slug] ?? null };
}

/* -------------------- AI preview (pre-sim) ----------------------- */
async function aiPreview(game, week, season, records, ranks, recent, cur = null){
  const A = teamCtx(game.away, records, ranks);
  const H = teamCtx(game.home, records, ranks);
  if (!A || !H) return null;
  const prompt = `Write a 2-paragraph preview for an upcoming PCFL Week ${week} matchup.

Game: ${A.name} (${A.record}${A.rank?`, ranked #${A.rank}`:''}) at ${H.name} (${H.record}${H.rank?`, ranked #${H.rank}`:''}).

Recent ${A.name} results: ${(recent[game.away]||[]).map(r=>`${r.opp} ${r.result} ${r.score}`).join('; ') || 'season opener'}.
Recent ${H.name} results: ${(recent[game.home]||[]).map(r=>`${r.opp} ${r.result} ${r.score}`).join('; ') || 'season opener'}.
${cur ? '\n' + previewContextText(game.away, game.home, cur, teamName2) + '\n\nBuild the preview on these season numbers: the strength-on-strength matchups, each side\'s scoring and yardage per game, and the players who lead the PCFL. Use only numbers from the data.\n' : ''}
Return ONLY JSON in this exact shape:
{
  "headline": "8-12 word headline",
  "subhead": "one short sentence framing the matchup",
  "prediction": { "winner": "${game.away}" | "${game.home}", "score": "AA-BB", "confidence": 0.50-0.85 },
  "xFactor": { "team": "${game.away}" | "${game.home}", "role": "QB|RB|WR|defense|special", "why": "one sentence" },
  "keyMatchup": "one sentence on the chess-match angle",
  "body": ["paragraph 1 (2-3 sentences)", "paragraph 2 (2-3 sentences)"]
}`;
  const r = cur
    ? await callClaude(prompt, { system: SYS_BROADCAST_V2, parseJSON: true, maxTokens: 1100, season, v2: true, validate: numberGuard(prompt, ['headline', 'subhead', 'xFactor', 'keyMatchup', 'body']) })
    : await callClaude(prompt, { system: SYS_BROADCAST, parseJSON: true, maxTokens: 900, season });
  return r;
}

/* -------------------- AI recap (post-sim) ------------------------ */
async function aiRecap(game, week, season, ctx = null){
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

  if (ctx?.cur){
    const n = ctx.narrative;
    const facts = [
      `BOX SCORE`,
      `Final: ${A.name} ${aw.score}, ${H.name} ${hm.score}. Winner: ${winner.name}.`,
      `Total yards: ${A.name} ${ts['TOTAL NET YARDS']?.away ?? '?'}, ${H.name} ${ts['TOTAL NET YARDS']?.home ?? '?'}. Rushing: ${A.name} ${ts['NET RUSHING YARDS']?.away ?? '?'}, ${H.name} ${ts['NET RUSHING YARDS']?.home ?? '?'}. Passing: ${A.name} ${ts['NET PASSING YARDS']?.away ?? '?'}, ${H.name} ${ts['NET PASSING YARDS']?.home ?? '?'}.`,
      ts['FIRST DOWNS'] ? `First downs: ${A.name} ${ts['FIRST DOWNS'].away}, ${H.name} ${ts['FIRST DOWNS'].home}.` : '',
      ts['3rd down efficiency'] ? `Third downs: ${A.name} ${ts['3rd down efficiency'].away}, ${H.name} ${ts['3rd down efficiency'].home}.` : '',
      ts['4th down efficiency'] ? `Fourth downs: ${A.name} ${ts['4th down efficiency'].away}, ${H.name} ${ts['4th down efficiency'].home}.` : '',
      `Turnovers: ${A.name} threw ${ts['Had Intercepted']?.away ?? '?'} interceptions and lost fumbles ${ts['FUMBLES-LOST']?.away ?? '?'} (fumbles-lost); ${H.name} threw ${ts['Had Intercepted']?.home ?? '?'} interceptions and lost fumbles ${ts['FUMBLES-LOST']?.home ?? '?'} (fumbles-lost).`,
      ts['PENALTIES-YARDS'] ? `Penalties-yards: ${A.name} ${ts['PENALTIES-YARDS'].away}, ${H.name} ${ts['PENALTIES-YARDS'].home}.` : '',
      ts['TIME OF POSSESSION'] ? `Time of possession: ${A.name} ${ts['TIME OF POSSESSION'].away}, ${H.name} ${ts['TIME OF POSSESSION'].home}.` : '',
      game.playerOfGame ? `Player of the Game: ${game.playerOfGame.name} (${game.playerOfGame.pos}, ${teamName2(game.playerOfGame.team)})${game.playerOfGameLine ? ': ' + game.playerOfGameLine : ''}.` : '',
      `${A.name} top performers: QB ${fmt(tA.passing,'pass')}; RB ${fmt(tA.rushing,'rush')}; WR ${fmt(tA.recv,'recv')}; DEF ${fmt(tA.def,'def')}.`,
      `${H.name} top performers: QB ${fmt(tH.passing,'pass')}; RB ${fmt(tH.rushing,'rush')}; WR ${fmt(tH.recv,'recv')}; DEF ${fmt(tH.def,'def')}.`,
      '',
      n ? narrativeText(n) : 'No play-by-play log is available for this game; do not describe specific quarters, drives or plays.',
      '',
      seasonContextText(game, ctx.cur, ctx.prev, teamName2),
    ].filter(x => x !== null).join('\n');
    const prompt2 = `Write the PCFL Network recap of Week ${week}: ${A.name} at ${H.name}.

${facts}

WRITING BRIEF
- Paragraph 1: open on the defining moment (a scoring play, turnover, fourth-down stop or the closing stretch from the play-by-play), told live: the clock, the situation, the play, the score it produced. Then the result.
- Paragraph 2: the arc of the game using the period scores and scoring plays: who struck first, the swings, the answers, the lead changes, where it turned.
- Paragraph 3: the analyst's read: the matchup numbers that decided it (yards, rushing vs passing, third downs, turnovers) measured against each team's season norms from SEASON CONTEXT, and the standout players' lines placed in the season leaderboard.
- Paragraph 4: reflective: what the result does to each team's record, power-poll standing, division race and streak, and what waits next week.
- Weave season numbers into sentences naturally; do not list them. Vary sentence rhythm. Use player names exactly as given.
- Every number you write must appear in the data above (scores, yards, records, ranks, per-game averages). No invented details.

Return ONLY JSON in this shape:
{
  "headline": "vivid 8-14 word headline grounded in what actually happened",
  "dek": "one-sentence subhead with the season stakes",
  "body": ["paragraph 1", "paragraph 2", "paragraph 3", "paragraph 4"],
  "turningPoint": "one sentence naming the decisive play or stretch from the play-by-play (period and clock)",
  "byTheNumbers": ["3 or 4 short analytical notes, each built on one stat from the data and why it mattered"],
  "unsungHero": { "name": "player name from the data", "team": "${aw.team}" | "${hm.team}", "why": "why he mattered beyond the headline numbers" }
}`;
    return callClaude(prompt2, { system: SYS_BROADCAST_V2, parseJSON: true, maxTokens: 1800, season, v2: true, edit: true,
      validate: out => {
        const problems = [];
        if (!out || !Array.isArray(out.body) || out.body.length < 3) problems.push('body must be an array of at least 3 paragraphs');
        if (out && !out.headline) problems.push('missing headline');
        return problems.concat(numberGuard(prompt2, ['headline', 'dek', 'body', 'turningPoint', 'byTheNumbers', 'unsungHero'])(out));
      } });
  }

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
async function aiWeeklyWrap(games, week, season, powerRankings, ctx = null){
  if (!games.length) return null;
  const scores = games.map(g=>{
    const A = TEAMS.find(t=>t.slug===g.away.team), H = TEAMS.find(t=>t.slug===g.home.team);
    return `${A.name} (${g.away.team}) ${g.away.score}, ${H.name} (${g.home.team}) ${g.home.score}`;
  }).join('\n');
  const top5 = powerRankings.slice(0, 5).map(r => {
    const t = TEAMS.find(t=>t.slug===r.team);
    return `${r.rank}. ${t.name} (${r.team})`;
  }).join('\n');
  const validSlugs = TEAMS.map(t => t.slug).join(', ');

  const prompt = `Write a PCFL Week ${week} wrap-up. Don't catalog every game — pick the most compelling 3-5 angles and break them out as structured segments.

${games.length} games this week:
${scores}

Top 5 in power poll:
${top5}
${ctx ? `
How each game unfolded (from the play-by-play):
${games.map(g => { const f = g.gameFlow; if (!f) return `${teamName2(g.away.team)} at ${teamName2(g.home.team)}: no log.`; return `${teamName2(g.away.team)} at ${teamName2(g.home.team)}: periods ${f.quarters.map(q => q.q + ' ' + q.score).join(' | ')}; lead changes ${f.leadChanges}${f.largestLead ? `; largest lead ${f.largestLead.team} by ${f.largestLead.margin}` : ''}${f.overtime ? '; OVERTIME' : ''}${f.turnovers ? `; turnovers ${f.turnovers}` : ''}.`; }).join('\n')}

Power poll movement this week: ${powerRankings.filter(r => r.prev && r.prev !== r.rank).map(r => `${teamName2(r.team)} ${r.prev}→${r.rank}`).join(', ') || 'none'}.
Records now: ${Object.entries(ctx.cur.records || {}).map(([t, r]) => `${teamName2(t)} ${r}`).join(', ')}.
Use these to find the week's real stories: comebacks, overtime, poll shake-ups, division races. Only numbers from the data.
` : ''}
Valid team slugs (use these exactly when referencing teams in the JSON):
${validSlugs}

Segment "type" options (pick the right one for each segment — diversify, don't repeat the same type twice unless truly warranted):
- upset      → an underdog winning when the power poll said otherwise
- statement  → a dominant, message-sending performance
- spotlight  → a single player's standout game (often the POG)
- defense    → defensive dominance shaped the result
- shootout   → high-scoring offensive duel
- race       → conference / division standings implications
- storyline  → an emerging narrative arc (streak, return, slump)
- milestone  → record or streak watching

Return ONLY JSON in this exact shape:
{
  "headline": "8-12 word sharp headline for the whole column",
  "subhead": "one sentence framing the week",
  "lead": "opening paragraph (2-3 sentences) — defining theme of the week",
  "segments": [
    {
      "type": "upset" | "statement" | "spotlight" | "defense" | "shootout" | "race" | "storyline" | "milestone",
      "title": "5-8 word section header",
      "teams": ["team-slug", "team-slug"],
      "body": "2-3 sentence write-up of this angle"
    }
  ],
  "closer": "one sentence forward-looking comment about next week"
}

Produce 3 to 5 segments. Each segment's "teams" array must use 1 or 2 of the valid slugs above.`;
  return ctx
    ? callClaude(prompt, { system: SYS_BROADCAST_V2, parseJSON: true, maxTokens: 2200, season, v2: true, edit: true, validate: numberGuard(prompt, ['headline', 'subhead', 'lead', 'segments', 'closer']) })
    : callClaude(prompt, { system: SYS_BROADCAST, parseJSON: true, maxTokens: 2000, season });
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
  const manifest = { seasons: [], rosters: [] }; // no timestamp: keep CI output deterministic so the bot only commits real data changes

  // Attach fight-song metadata before writing teams.json
  for (const tm of TEAMS) if (FIGHT_SONGS[tm.slug]) tm.fightSong = FIGHT_SONGS[tm.slug];
  writeFileSync(join(DATA,'teams.json'), JSON.stringify(TEAMS,null,1));
  writeFileSync(join(DATA,'videos.json'), JSON.stringify(videos,null,1));

  for (const season of seasons){
    const weekJsonsForSeason = [];   // collected for SoS + playoff after the week loop
    const powHistory = {};           // 'Player Name|team' -> { name, team, pos, weeks: [n,...] }
    const weekDirs = readdirSync(join(DROPS,season)).filter(d=>/^week\d+$/.test(d))
      .sort((a,b)=>num(a)-num(b));
    const weeks = [];
    let prevRanks = null;
    let prevCtx = null;              // season-to-date context after the previous week (for "entering" numbers)
    let latestSchedule = null;

    for (const wd of weekDirs){
      const week = num(wd);
      const dir = join(DROPS,season,wd);
      const file = n => { const p = join(dir,n); return existsSync(p) ? read(p) : null; };

      const gs = file('gamestats.html');
      const st = file('standings.html');
      const sc = file('schedule.html');
      const se = file('season.html');

      const gameData = gs ? parseGameStats(gs) : { playerOfWeek:null, games:[] };
      const standData = st ? parseStandings(st) : { date:null, standings:[], powerRankings:[] };
      const schedule = sc ? parseSchedule(sc) : [];
      const seasonStats = se ? parseSeason(se) : { leaders:{}, teamStats:{} };
      if (schedule.length) latestSchedule = schedule;

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
        // structured game flow from the play-by-play (also shown on the site's recap tab)
        g.gameFlow = null;
        if (g.logFile){
          try {
            const n = gameNarrative(read(join(logsDir, g.logFile)), logTeamName);
            if (n){
              const merged = [];
              for (const sc of n.scoring){ const last = merged[merged.length - 1]; if (last && last.team === sc.team && /extra point|2-pt/.test(sc.kind) && last.kind === 'touchdown'){ last.score = sc.score; } else merged.push({ q: sc.q >= 5 ? 'OT' : 'Q' + sc.q, clock: sc.clock, team: sc.team, kind: sc.kind, play: sc.play, score: sc.score }); }
              g.gameFlow = { quarters: n.quarters, scoring: merged, leadChanges: n.leadChanges, largestLead: n.largestLead, overtime: n.overtime, turnovers: n.turnovers.length };
              g._narrative = n;
            }
          } catch (e){ console.warn(`  log parse failed for ${g.logFile}: ${e.message}`); }
        }
      }
      // player of week stat line
      let powLine = '';
      if (gameData.playerOfWeek){
        const pg = gameData.games.find(g=>g.away.team===gameData.playerOfWeek.team||g.home.team===gameData.playerOfWeek.team);
        if (pg) powLine = findPlayerLine(pg, gameData.playerOfWeek);
      }

      // -------------- AI generation (recaps + wrap-up) ----------
      const curCtx = { records, standings: standData.standings, powerRankings: standData.powerRankings, leaders: seasonStats.leaders, teamStats: seasonStats.teamStats, nextWeekGames };
      if (AI.enabled && gameData.games.length){
        const recapResults = await pAllLimit(gameData.games, g => aiRecap(g, week, season, { cur: curCtx, prev: prevCtx, narrative: g._narrative }), 4);
        for (let i = 0; i < gameData.games.length; i++){
          const ai = recapResults[i];
          if (ai) gameData.games[i].aiStory = ai;
        }
        console.log(`  ai: ${recapResults.filter(Boolean).length}/${gameData.games.length} recaps generated`);
      }
      let weeklyWrap = null;
      if (AI.enabled && gameData.games.length){
        weeklyWrap = await aiWeeklyWrap(gameData.games, week, season, standData.powerRankings, { cur: curCtx, prev: prevCtx });
        if (weeklyWrap) console.log(`  ai: weekly wrap-up generated`);
      }

      for (const g of gameData.games) delete g._narrative;
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
      // Track POW awards across the season for the Heisman watch
      if (gameData.playerOfWeek) {
        const p = gameData.playerOfWeek;
        const key = `${p.name}|${p.team}`;
        if (!powHistory[key]) powHistory[key] = { name: p.name, team: p.team, pos: p.pos, weeks: [] };
        powHistory[key].weeks.push(week);
      }
      prevRanks = new Map(standData.powerRankings.map(p=>[p.team,p.rank]));
      prevCtx = curCtx;
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
        const ranksMap = Object.fromEntries(standData.powerRankings.map(r => [r.team, r.rank]));
        const previewResults = await pAllLimit(nextWeekGames, g =>
          aiPreview(g, week + 1, season, records, ranksMap, recent, curCtx), 4);
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
    // Rosters: newest FBPro98 roster export for the season (roster-only drop or weekly export)
    mkdirSync(join(DATA, season), { recursive: true });
    const rosterBuild = buildSeasonRosters(season, weekDirs);
    if (rosterBuild) writeFileSync(join(DATA,season,'rosters.json'), JSON.stringify(rosterBuild.data));
    // Player-of-the-Week season history for the Heisman watch
    writeFileSync(join(DATA, season, 'pow-history.json'), JSON.stringify(Object.values(powHistory)));

    // -------------- Predictive engine (per season) ---------------
    if (latestSchedule && weekJsonsForSeason.length){
      const sos = computeSoS(season, latestSchedule, weekJsonsForSeason);
      if (sos){ writeFileSync(join(DATA, season, 'sos.json'), JSON.stringify(sos)); console.log(`✓ ${season} SoS computed for ${Object.keys(sos).length} teams`); }
      const playoffs = computePlayoffPicture(season, latestSchedule, weekJsonsForSeason);
      if (playoffs){ writeFileSync(join(DATA, season, 'playoffs.json'), JSON.stringify(playoffs)); console.log(`✓ ${season} playoff picture computed (through week ${playoffs.throughWeek})`); }
    }

    const rm = rosterBuild?.meta;
    const rosterRef = rm ? { asOf: rm.asOf, asOfISO: rm.asOfISO, phase: rm.phase, label: rm.label, source: rm.source, week: rm.week } : null;
    if (rm) manifest.rosters.push({ year: +season, ...rosterRef, reportSeason: rm.reportSeason, players: rm.players, freeAgents: rm.freeAgents.listed, hasWeeks: weeks.length > 0 });
    // A season with only a roster drop (e.g. next season's preseason rosters) has no week data
    // yet: it is listed under manifest.rosters only, so the season selector never offers empty weeks.
    if (weeks.length) manifest.seasons.push({ year:+season, weeks, latest: weeks[weeks.length-1] ?? null, ...(rosterRef ? { roster: rosterRef } : {}) });
  }
  writeFileSync(join(DATA,'manifest.json'), JSON.stringify(manifest,null,1));
  console.log('✓ manifest written');
}
main().catch(e => { console.error(e); process.exit(1); });
