/**
 * Grounded context for AI writing (recaps, previews, weekly wraps).
 *
 * 1. gameNarrative(logText) — turns an FBPro98 play-by-play .log into the facts a
 *    broadcaster would use: scoring timeline (quarter, clock, play, score after),
 *    quarter-by-quarter score, lead changes, largest lead, turnovers, explosive
 *    plays, fourth-down stops, missed kicks, overtime and the final possession.
 * 2. Season-context helpers that compare a game with the season-to-date numbers
 *    (records, power-poll movement, streaks, scoring averages, player season
 *    totals and league ranks) before and after the game.
 * 3. numbersNotIn(text, allowed) — the anti-invention guard: every multi-digit
 *    number an AI writes must appear in (or be derivable from) the data it was given.
 *
 * Pure functions, no I/O, so they are unit-testable (scripts/ai-context.test.mjs).
 */

const QWORDS = { first: 1, second: 2, third: 3, fourth: 4, overtime: 5 };
const QLABEL = q => (q >= 5 ? 'OT' : `Q${q}`);

const clean = s => s
  .replace(/\s+/g, ' ')
  .replace(/\s*That was .*$/s, '')               // strip FBPro play-call codes
  .replace(/\b([A-Z]{1,2})\d{0,2} #\d+ /g, '$1 ') // "QB1 #4 TJ Giles" -> "QB TJ Giles"
  .replace(/\bK \b/g, 'K ')
  .trim();

const STATE = /^(.+?)'s ball on (.+?)\. (First|Second|Third|Fourth) and (goal|\d+)(?: to go)?\. (\d*:\d\d) left in (?:the )?(first|second|third|fourth|overtime)(?: quarter)?\. The score is (.+?) (\d+), (.+?) (\d+)\.\s*$/;

/**
 * @param {string} text raw .log contents
 * @param {(name:string)=>string} rename maps a team name in the log to its current name
 * @returns {object|null} narrative facts, or null if the log could not be read
 */
export function gameNarrative(text, rename = n => n) {
  if (!text || text.length < 200) return null;
  // FBPro logs put control bytes (e.g. \u0005) after sentences; drop them first
  const paras = text.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [];
  for (const p of paras) {
    const m = p.match(STATE);
    if (m) items.push({ kind: 'state', team: rename(m[1]), spot: m[2], down: m[3], dist: m[4], clock: m[5], q: QWORDS[m[6]], a: rename(m[7]), as: +m[8], b: rename(m[9]), bs: +m[10] });
    else if (!/^(Weather|Stadium):/.test(p)) items.push({ kind: 'play', raw: p, text: clean(p) });
  }
  const states = items.filter(i => i.kind === 'state');
  if (states.length < 10) return null;
  const A = states[0].a, B = states[0].b;
  const out = { teams: [A, B], scoring: [], quarters: [], leadChanges: 0, largestLead: null, turnovers: [], explosive: [], fourthDownStops: [], missedKicks: [], overtime: false, final: null, finalPossession: null };

  let prev = null, playsSince = [], leader = 0;
  const quarterEnd = {};
  const pushScore = (st, plays) => {
    const da = st.as - prev.as, db = st.bs - prev.bs;
    const team = da > 0 ? A : B, pts = da > 0 ? da : db;
    const key = plays.find(p => /Touchdown|field goal|Safety|2-Point|extra point/i.test(p.raw)) || plays[plays.length - 1];
    const kind = /Safety/.test(key?.raw) ? 'safety' : /field goal/.test(key?.raw) ? 'field goal' : /2-Point/.test(key?.raw) ? '2-pt conversion' : /extra point/i.test(key?.raw) ? 'extra point' : 'touchdown';
    out.scoring.push({ q: prev.q, clock: prev.clock, team, pts, kind, play: key ? key.text : '', score: `${A} ${st.as}, ${B} ${st.bs}` });
  };
  for (const it of items) {
    if (it.kind === 'play') { playsSince.push(it); continue; }
    const st = it;
    if (prev) {
      if (st.as !== prev.as || st.bs !== prev.bs) pushScore(st, playsSince);
      // turnovers: interception, or a fumble after which the other team has the ball
      for (const p of playsSince) {
        if (/intercepted by/.test(p.raw)) out.turnovers.push({ q: prev.q, clock: prev.clock, by: prev.team === A ? B : A, lost: prev.team, kind: 'interception', play: p.text });
        else if (/fumbles/.test(p.raw) && st.team !== prev.team && !/kicks off|punts/.test(p.raw)) out.turnovers.push({ q: prev.q, clock: prev.clock, by: st.team, lost: prev.team, kind: 'fumble', play: p.text });
        else if (/fumbles/.test(p.raw) && /punts|kicks off/.test(p.raw) && st.team === prev.team) out.turnovers.push({ q: prev.q, clock: prev.clock, by: st.team, lost: prev.team === A ? B : A, kind: 'muffed/fumbled return', play: p.text });
        const g = p.raw.match(/for a gain of (?:almost |just over |about )?(\d+) yards?/);
        if (g && +g[1] >= 25) out.explosive.push({ q: prev.q, clock: prev.clock, team: prev.team, yards: +g[1], td: /Touchdown/.test(p.raw), play: p.text });
        const r = p.raw.match(/returns the kick for (\d+) yards/);
        if (r && +r[1] >= 40) out.explosive.push({ q: prev.q, clock: prev.clock, team: st.team, yards: +r[1], td: /Touchdown/.test(p.raw), play: p.text });
        if (/field goal\. The kick is (wide|short|no good|blocked)/.test(p.raw)) out.missedKicks.push({ q: prev.q, clock: prev.clock, team: prev.team, play: p.text });
      }
      // fourth-down stop: went for it on 4th and the other side took over without a punt/kick/score
      if (prev.down === 'Fourth' && st.team !== prev.team && st.as === prev.as && st.bs === prev.bs && !playsSince.some(p => /punts|field goal|kicks off|intercepted|fumbles/.test(p.raw)))
        out.fourthDownStops.push({ q: prev.q, clock: prev.clock, offense: prev.team, spot: prev.spot, dist: prev.dist, play: playsSince.map(p => p.text).join(' ') });
      if (st.q !== prev.q) quarterEnd[prev.q] = `${A} ${st.as}, ${B} ${st.bs}`;
    }
    const lead = Math.sign(st.as - st.bs);
    if (lead !== 0 && leader !== 0 && lead !== leader) out.leadChanges++;
    if (lead !== 0) leader = lead;
    const margin = Math.abs(st.as - st.bs);
    if (margin > 0 && (!out.largestLead || margin > out.largestLead.margin)) out.largestLead = { team: st.as > st.bs ? A : B, margin, q: st.q, clock: st.clock };
    if (st.q === 5) out.overtime = true;
    prev = st; playsSince = [];
  }
  // plays after the last state line (final snaps, possible last score)
  const last = states[states.length - 1];
  out.finalPossession = { team: last.team, q: last.q, clock: last.clock, spot: last.spot, down: last.down, dist: last.dist, plays: playsSince.map(p => p.text) };
  for (const p of playsSince) if (/Touchdown|field goal\. The kick is good|Safety/.test(p.raw)) out.lateScoreNote = p.text;
  out.final = `${A} ${last.as}, ${B} ${last.bs}`;
  quarterEnd[last.q] = out.final;
  out.quarters = Object.entries(quarterEnd).sort((x, y) => x[0] - y[0]).map(([q, s]) => ({ q: QLABEL(+q), score: s }));
  out.explosive.sort((x, y) => y.yards - x.yards).splice(6);
  return out;
}

/** Narrative -> compact plain-text block for a prompt. */
export function narrativeText(n) {
  if (!n) return '';
  const L = [];
  L.push('OFFICIAL PLAY-BY-PLAY FACTS (from the game log):');
  L.push('Score at the end of each period: ' + n.quarters.map(x => `${x.q}: ${x.score}`).join(' | '));
  L.push(`Lead changes: ${n.leadChanges}.` + (n.largestLead ? ` Largest lead: ${n.largestLead.team} by ${n.largestLead.margin} (${QLABEL(n.largestLead.q)} ${n.largestLead.clock}).` : '') + (n.overtime ? ' The game went to OVERTIME.' : ''));
  L.push('Scoring plays (period, clock remaining, team, play -> score after):');
  const merged = [];
  for (const s of n.scoring) { const last = merged[merged.length - 1]; if (last && last.team === s.team && /extra point|2-pt/.test(s.kind) && last.kind === 'touchdown') { last.score = s.score; last.pat = s.kind; } else merged.push({ ...s }); }
  for (const s of merged) L.push(`  ${QLABEL(s.q)} ${s.clock} ${s.team} ${s.kind.toUpperCase()}${s.pat === '2-pt conversion' ? ' (+2-pt try good)' : ''}: ${s.play} -> ${s.score}`);
  if (n.turnovers.length) { L.push('Turnovers:'); for (const t of n.turnovers) L.push(`  ${QLABEL(t.q)} ${t.clock} ${t.kind}, ${t.lost} lost it to ${t.by}: ${t.play}`); }
  else L.push('Turnovers: none.');
  if (n.explosive.length) { L.push('Explosive plays (25+ yards):'); for (const e of n.explosive) L.push(`  ${QLABEL(e.q)} ${e.clock} ${e.team} ${e.yards} yds${e.td ? ' (TD)' : ''}: ${e.play}`); }
  if (n.fourthDownStops.length) { L.push('Fourth-down stops:'); for (const f of n.fourthDownStops) L.push(`  ${QLABEL(f.q)} ${f.clock} ${f.offense} failed on 4th and ${f.dist} at ${f.spot}: ${f.play}`); }
  if (n.missedKicks.length) { L.push('Missed field goals:'); for (const k of n.missedKicks) L.push(`  ${QLABEL(k.q)} ${k.clock} ${k.team}: ${k.play}`); }
  if (n.finalPossession) L.push(`Final possession: ${n.finalPossession.team}, ${QLABEL(n.finalPossession.q)} ${n.finalPossession.clock}, ${n.finalPossession.down} and ${n.finalPossession.dist} at ${n.finalPossession.spot}.`);
  L.push(`Final: ${n.final}.`);
  return L.join('\n');
}

/** Ordinal helper for ranks. */
export const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** Rank of a player within a season leader table by a numeric field (1 = best). */
export function leaderRank(table, name, team, field) {
  if (!Array.isArray(table)) return null;
  const rows = table.filter(r => r && r[field] != null).map(r => ({ ...r, _v: +String(r[field]).replace(/,/g, '') })).sort((x, y) => y._v - x._v);
  const i = rows.findIndex(r => r.name === name && (!team || r.team === team));
  return i < 0 ? null : { rank: i + 1, of: rows.length, value: rows[i]._v };
}

/**
 * Numbers a model wrote that are not in the source data (or simple derivations of it).
 * Only checks integers >= 10 (small counts like "two" or "3rd" are left alone).
 */
export function numbersNotIn(output, sourceText) {
  const nums = s => [...String(s).replace(/(\d),(\d{3})/g, '$1$2').matchAll(/(?<![\w.])(\d{2,4})(?!\w|\.\d)/g)].map(m => +m[1]);
  const allowed = new Set(nums(sourceText));
  const base = [...allowed];
  // allow simple differences/sums of source numbers (margins, combined points)
  for (let i = 0; i < base.length && i < 400; i++) for (let j = 0; j < base.length && j < 400; j++) { allowed.add(Math.abs(base[i] - base[j])); if (base[i] + base[j] < 2000) allowed.add(base[i] + base[j]); }
  for (let y = 2020; y <= 2040; y++) allowed.add(y);
  return [...new Set(nums(typeof output === 'string' ? output : JSON.stringify(output)).filter(n => !allowed.has(n)))];
}

/* --------------------------- season context --------------------------- */
const N = v => +String(v ?? '').replace(/,/g, '') || 0;
const per = (v, g) => (g ? Math.round((v / g) * 10) / 10 : null);
const gamesOf = rec => { const m = String(rec || '').match(/(\d+)-(\d+)(?:-(\d+))?/); return m ? +m[1] + +m[2] + (+m[3] || 0) : 0; };
function teamRow(table, slug) { return Array.isArray(table) ? table.find(r => r.team === slug) : null; }
function rankBy(table, slug, field, asc = false) {
  if (!Array.isArray(table) || !table.length) return null;
  const rows = [...table].sort((x, y) => asc ? N(x[field]) - N(y[field]) : N(y[field]) - N(x[field]));
  const i = rows.findIndex(r => r.team === slug); return i < 0 ? null : i + 1;
}
function standingOf(standings, slug) {
  for (const c of standings || []) for (const d of c.divisions || []) {
    const sorted = [...d.teams].sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.pf - a.pf);
    const i = sorted.findIndex(t => t.team === slug);
    if (i >= 0) return { conference: c.conference, division: d.name, place: i + 1, of: sorted.length, row: sorted[i], leader: sorted[0].team };
  }
  return null;
}
function findLeader(table, lastName, team) {
  if (!Array.isArray(table) || !lastName) return null;
  const ln = String(lastName).toLowerCase().replace(/[^a-z]/g, '');
  return table.find(r => r.team === team && String(r.name).toLowerCase().replace(/[^a-z ]/g, '').split(' ').pop() === ln) || null;
}

/**
 * Season context for one game as prompt text.
 * @param {object} game  week game (away/home/box/teamStats)
 * @param {object} cur   { records, standings, powerRankings, leaders, teamStats, nextWeekGames } after this week
 * @param {object|null} prev same shape, after the previous week (null in week 1)
 * @param {(slug:string)=>string} name team display name
 */
export function seasonContextText(game, cur, prev, name) {
  const L = ['SEASON CONTEXT (season-to-date numbers; "entering" = before this game, "now" = after it):'];
  const sides = [['away', game.away], ['home', game.home]];
  const ts = Object.fromEntries((game.teamStats || []).map(r => [r.label, r]));
  for (const [side, t] of sides) {
    const slug = t.team, nm = name(slug), opp = side === 'away' ? game.home : game.away;
    const recNow = cur.records?.[slug], recPrev = prev?.records?.[slug];
    const prNow = cur.powerRankings?.find(p => p.team === slug), prPrev = prev?.powerRankings?.find(p => p.team === slug);
    const st = standingOf(cur.standings, slug);
    const g = gamesOf(recNow);
    const sc = teamRow(cur.teamStats?.scoring, slug), osc = teamRow(cur.teamStats?.oppScoring, slug);
    const ty = teamRow(cur.teamStats?.totalYards, slug), oty = teamRow(cur.teamStats?.oppTotalYards, slug);
    const gameYds = N(ts['TOTAL NET YARDS']?.[side]);
    const parts = [];
    parts.push(`${nm}: record entering ${recPrev || '0-0'}, now ${recNow || '?'}`);
    if (prNow) parts.push(`power poll #${prNow.rank} now${prPrev ? ` (was #${prPrev.rank})` : ''}`);
    if (st) parts.push(`${ord(st.place)} of ${st.of} in the ${st.conference} ${st.division} division (${st.row.w}-${st.row.l}${st.row.t ? '-' + st.row.t : ''}, streak ${st.row.streak}, division leader ${name(st.leader)})`);
    if (sc && g) parts.push(`season scoring ${per(N(sc.pts), g)} points per game (this game: ${t.score})`);
    if (osc && g) parts.push(`allows ${per(N(osc.pts), g)} points per game (this game allowed: ${opp.score})`);
    if (ty && g) parts.push(`${per(N(ty.totYds), g)} total yards per game (this game: ${gameYds || '?'}; league rank in total offense: ${rankBy(cur.teamStats?.totalYards, slug, 'totYds')} of ${cur.teamStats.totalYards.length})`);
    if (oty && g) parts.push(`defense allows ${per(N(oty.totYds), g)} yards per game (league rank: ${rankBy(cur.teamStats?.oppTotalYards, slug, 'totYds', true)} of ${cur.teamStats.oppTotalYards.length})`);
    L.push('- ' + parts.join('; ') + '.');
  }
  const box = side => game.box?.[side] || [];
  const top = (side, sect, sortIdx) => (box(side).find(s => s.section === sect)?.rows || []).filter(r => !r.total).sort((a, b) => N(b.vals[sortIdx]) - N(a.vals[sortIdx]))[0];
  const P = [];
  for (const [side, t] of sides) {
    for (const [sect, tbl, idx, field, label] of [['Passing', 'passing', 2, 'yds', 'passing'], ['Rushing', 'rushing', 1, 'yds', 'rushing'], ['Receiving', 'receiving', 1, 'yds', 'receiving']]) {
      const r = top(side, sect, idx); if (!r) continue;
      const now = findLeader(cur.leaders?.[tbl], r.name, t.team), was = findLeader(prev?.leaders?.[tbl], r.name, t.team);
      if (!now) continue;
      const rk = leaderRank(cur.leaders[tbl], now.name, t.team, field), rkWas = was ? leaderRank(prev.leaders[tbl], was.name, t.team, field) : null;
      P.push(`- ${now.name} (${name(t.team)} ${now.pos}): season ${label} ${N(now.yds)} yds, ${N(now.td)} TD${tbl === 'passing' ? `, ${N(now.int)} INT, rating ${now.rtg}` : ''}${tbl === 'receiving' ? `, ${N(now.rec)} catches` : ''}${tbl === 'rushing' ? `, ${now.avg} per carry` : ''}${rk ? `; #${rk.rank} in the PCFL in ${label} yards` : ''}${was ? ` (entering: ${N(was.yds)} yds${rkWas ? `, #${rkWas.rank}` : ''})` : ''}.`);
    }
  }
  if (P.length) { L.push('Standout players, season totals (after this game):'); L.push(...P); }
  const lead = (tbl, field, label) => { const r = [...(cur.leaders?.[tbl] || [])].sort((a, b) => N(b[field]) - N(a[field]))[0]; return r ? `${label}: ${r.name} (${name(r.team)}) ${N(r[field])}` : null; };
  const LL = [lead('passing', 'yds', 'passing yards'), lead('rushing', 'yds', 'rushing yards'), lead('receiving', 'yds', 'receiving yards')].filter(Boolean);
  if (LL.length) L.push('PCFL season leaders: ' + LL.join('; ') + '.');
  const nextFor = slug => (cur.nextWeekGames || []).find(x => x.away === slug || x.home === slug);
  const nx = sides.map(([, t]) => { const n = nextFor(t.team); if (!n) return null; const o = n.away === t.team ? n.home : n.away; return `${name(t.team)} ${n.away === t.team ? 'visit' : 'host'} ${name(o)} (${cur.records?.[o] || '?'})`; }).filter(Boolean);
  if (nx.length) L.push('Next week: ' + nx.join('; ') + '.');
  return L.join('\n').replace(/ {2,}/g, ' ');
}

/** Pre-game context for a preview: both teams' season profiles + key players. */
export function previewContextText(away, home, cur, name) {
  const L = ['SEASON PROFILES (through the last completed week):'];
  for (const slug of [away, home]) {
    const rec = cur.records?.[slug], g = gamesOf(rec);
    const pr = cur.powerRankings?.find(p => p.team === slug);
    const st = standingOf(cur.standings, slug);
    const sc = teamRow(cur.teamStats?.scoring, slug), osc = teamRow(cur.teamStats?.oppScoring, slug);
    const ty = teamRow(cur.teamStats?.totalYards, slug), oty = teamRow(cur.teamStats?.oppTotalYards, slug);
    const parts = [`${name(slug)}: ${rec || '0-0'}`];
    if (pr) parts.push(`power poll #${pr.rank}${pr.prev ? ` (last week #${pr.prev})` : ''}`);
    if (st) parts.push(`${st.conference} ${st.division}: ${ord(st.place)} of ${st.of}, streak ${st.row.streak}, home ${st.row.home}, away ${st.row.away}`);
    if (sc && g) parts.push(`${per(N(sc.pts), g)} PPG scored`);
    if (osc && g) parts.push(`${per(N(osc.pts), g)} PPG allowed`);
    if (ty && g) parts.push(`offense ${per(N(ty.totYds), g)} YPG (rank ${rankBy(cur.teamStats.totalYards, slug, 'totYds')}), ${per(N(ty.passYds), g)} pass / ${per(N(ty.rushYds), g)} rush`);
    if (oty && g) parts.push(`defense ${per(N(oty.totYds), g)} YPG allowed (rank ${rankBy(cur.teamStats.oppTotalYards, slug, 'totYds', true)})`);
    L.push('- ' + parts.join('; ') + '.');
    const best = (tbl, field) => [...(cur.leaders?.[tbl] || [])].filter(r => r.team === slug).sort((a, b) => N(b[field]) - N(a[field]))[0];
    const ks = [['passing', 'yds', 'QB'], ['rushing', 'yds', 'rusher'], ['receiving', 'yds', 'receiver'], ['sacks', 'sacks', 'pass rusher'], ['interceptions', 'int', 'ballhawk']]
      .map(([tbl, f, lbl]) => { const r = best(tbl, f); if (!r) return null; const rk = leaderRank(cur.leaders[tbl], r.name, slug, f); return `${lbl} ${r.name}: ${N(r[f])} ${f === 'yds' ? 'yds' : f}${r.td != null && f === 'yds' ? `, ${N(r.td)} TD` : ''}${rk ? ` (#${rk.rank} in PCFL)` : ''}`; }).filter(Boolean);
    if (ks.length) L.push(`  key players: ${ks.join('; ')}.`);
  }
  return L.join('\n').replace(/(\S) {2,}/g, '$1 ');
}
