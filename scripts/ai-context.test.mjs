// Unit tests for the grounded AI context (play-by-play narrative, season context, number guard).
//   node scripts/ai-context.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { gameNarrative, narrativeText, seasonContextText, previewContextText, numbersNotIn, leaderRank } from './ai-context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const j = p => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const teams = j('teams.json'); const name = s => teams.find(x => x.slug === s)?.name || s;
let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

// ---- play-by-play narrative: Week 2 Georgia at Colorado (verified by hand against the raw log)
const log = readFileSync(join(DATA, '2028/logs/week2/28W02UGA@COL.log'), 'utf8');
const n = gameNarrative(log);
t('narrative: period scores match the log', () => {
  assert.deepEqual(n.quarters.map(q => q.score), ['Georgia 7, Colorado 7', 'Georgia 21, Colorado 14', 'Georgia 21, Colorado 21', 'Georgia 28, Colorado 42']);
  assert.equal(n.final, 'Georgia 28, Colorado 42');
});
t('narrative: scoring plays, lead changes, largest lead', () => {
  const tds = n.scoring.filter(s => s.kind === 'touchdown');
  assert.equal(tds.length, 10);
  assert.deepEqual([tds[0].q, tds[0].clock, tds[0].team], [1, '10:00', 'Georgia']);
  assert.match(tds[9].play, /Sweeney runs for a gain of almost 16 yards/);
  assert.equal(n.leadChanges, 3);
  assert.deepEqual([n.largestLead.team, n.largestLead.margin], ['Colorado', 14]);
  assert.equal(n.overtime, false);
});
t('narrative: turnover found (interception by Shilo Sanders) and play-call codes stripped', () => {
  assert.equal(n.turnovers.length, 1);
  assert.equal(n.turnovers[0].kind, 'interception');
  assert.match(n.turnovers[0].play, /intercepted by Colorado's S Shilo Sanders/);
  assert.ok(!/That was|#\d/.test(narrativeText(n)), 'no FBPro codes or jersey numbers leak into prompts');
});
t('narrative: explosive plays sorted, 51-yard Mecum catch first', () => {
  assert.equal(n.explosive[0].yards, 51); assert.match(n.explosive[0].play, /Mecum/);
  assert.ok(n.explosive.length <= 6);
});
t('narrative: old school names in logs map to the rebranded teams', () => {
  const f = readdirSync(join(DATA, '2028/logs/week2')).find(x => /OKL@USC/.test(x));
  const r = gameNarrative(readFileSync(join(DATA, '2028/logs/week2', f), 'utf8'), x => ({ Oklahoma: 'Michigan State' }[x] || x));
  assert.ok(r.teams.includes('Michigan State') && !narrativeText(r).includes("Oklahoma's ball"));
});
t('narrative: no pre-rebrand school name survives anywhere in any prompt text', () => {
  const R = x => ({ Oregon: 'Arizona State', Oklahoma: 'Michigan State', Clemson: 'Alabama' }[x] || x);
  let leaks = 0;
  for (const w of readdirSync(join(DATA, '2028/logs'))) for (const f of readdirSync(join(DATA, '2028/logs', w)))
    if (/(Oregon|Oklahoma|Clemson)/.test(narrativeText(gameNarrative(readFileSync(join(DATA, '2028/logs', w, f), 'utf8'), R)))) leaks++;
  assert.equal(leaks, 0);
});
t('narrative: every 2028 log parses; overtime games detected', () => {
  let ok = 0, total = 0, ot = 0;
  for (const w of readdirSync(join(DATA, '2028/logs'))) for (const f of readdirSync(join(DATA, '2028/logs', w))) { total++; const r = gameNarrative(readFileSync(join(DATA, '2028/logs', w, f), 'utf8')); if (r) { ok++; if (r.overtime) ot++; } }
  assert.equal(ok, total); assert.ok(total >= 100); assert.ok(ot >= 1);
});
t('narrative: closing sequence lists the real final snaps (Week 2 Tennessee at Penn State)', () => {
  const f = readdirSync(join(DATA, '2028/logs/week2')).find(x => /TENN@PENNST/.test(x));
  const r = gameNarrative(readFileSync(join(DATA, '2028/logs/week2', f), 'utf8'));
  const txt = narrativeText(r);
  assert.ok(r.closing.length >= 3, 'final-3:00 plays captured');
  assert.match(txt, /Closing sequence/);
  assert.match(txt, /Jake Merklinger is sacked/, 'backup QB on the final drive is in the facts');
  assert.ok(!/onside/i.test(txt.replace(/Do not describe[^.]*\./, '')), 'no onside kick in this game');
  assert.match(txt, /Do not describe kickoffs, onside kicks, kneel-downs/);
});
t('narrative: every possession line is parsed, incl. "less than N" / "just over N" / midfield', () => {
  const lines = log.split(/\r?\n\s*\r?\n/).filter(p => /^.+?'s ball on /.test(p.replace(/\s+/g, ' ').trim())).length;
  const varied = log.match(/and (less than|just over) \d+ to go/g) || [];
  assert.ok(varied.length > 20, 'sample log really uses the "less than / just over" phrasings');
  // every snap of the final drive counted (the old parser saw 3 of its 8 snaps)
  const last = n.scoring.filter(s => s.kind === 'touchdown').at(-1);
  assert.deepEqual(last.drive, { snaps: 8, yards: 53, time: '1:05', from: 'their 47 yard line' });
  assert.ok(lines > 150, 'sample log has the expected number of possession lines');
});
t('narrative: scoring drives carry snaps/yards/time; non-offensive scores flagged', () => {
  const tds = n.scoring.filter(s => s.kind === 'touchdown');
  assert.ok(tds.every(s => s.drive && s.drive.snaps > 0 && s.drive.yards > 0), 'all offensive TD drives measured');
  assert.match(narrativeText(n), /\[drive: 8 plays, 53 yards, 1:05, started at their 47 yard line\]/);
});
t('narrative: final score rebuilt from the play-by-play matches the official result (all 2028 games but the known ND-UCLA re-sim)', () => {
  const R = x => ({ Oregon: 'Arizona State', Oklahoma: 'Michigan State', Clemson: 'Alabama' }[x] || x);
  const nm = s => teams.find(x => x.slug === s)?.name;
  const mism = [];
  for (const w of readdirSync(join(DATA, '2028/logs'))) {
    const wk = j(`2028/${w}.json`);
    for (const g of wk.games) {
      if (!g.logFile) continue;
      const fin = gameNarrative(readFileSync(join(DATA, '2028/logs', w, g.logFile), 'utf8'), R).final;
      const a = `${nm(g.away.team)} ${g.away.score}, ${nm(g.home.team)} ${g.home.score}`, b = `${nm(g.home.team)} ${g.home.score}, ${nm(g.away.team)} ${g.away.score}`;
      if (fin !== a && fin !== b) mism.push(`${w}/${g.logFile}`);
    }
  }
  assert.deepEqual(mism, ['week1/28W01ND@UCLA2.log']);
});
t('narrative: walk-off points after the last possession line are counted (Michigan State at USC, week 2)', () => {
  const f = readdirSync(join(DATA, '2028/logs/week2')).find(x => /OKL@USC/.test(x));
  const r = gameNarrative(readFileSync(join(DATA, '2028/logs/week2', f), 'utf8'), x => ({ Oklahoma: 'Michigan State' }[x] || x));
  assert.equal(r.final, 'Michigan State 32, USC 35');
  assert.equal(r.scoring.at(-1).kind, 'field goal'); assert.equal(r.scoring.at(-1).team, 'USC'); assert.equal(r.scoring.at(-1).final, true);
});
t('narrative: garbage input returns null instead of throwing', () => {
  assert.equal(gameNarrative(''), null); assert.equal(gameNarrative('not a log '.repeat(50)), null);
});

// ---- season context
const ctx = w => ({ records: w.records, standings: w.standings, powerRankings: w.powerRankings, leaders: w.leaders, teamStats: w.teamSeasonStats, nextWeekGames: w.nextWeek?.games });
const w1 = j('2028/week1.json'), w2 = j('2028/week2.json');
const game = w2.games.find(g => g.home.team === 'colorado');
const sc = seasonContextText(game, ctx(w2), ctx(w1), name);
t('season context: records entering/now, power poll movement, division standing', () => {
  assert.match(sc, /Georgia: record entering 0-1, now 0-2; power poll #14 now \(was #10\)/);
  assert.match(sc, /Colorado: record entering 0-1, now 1-1/);
  assert.match(sc, /division leader LSU/);
});
t('season context: per-game averages vs this game, league ranks', () => {
  assert.match(sc, /season scoring 31\.5 points per game \(this game: 42\)/);
  assert.match(sc, /league rank in total offense: 18 of 18/);
});
t('season context: standout player season totals + PCFL rank, next week', () => {
  assert.match(sc, /Roger Anderson \(Colorado QB\): season passing 662 yds, 6 TD/);
  assert.match(sc, /#3 in the PCFL in passing yards/);
  assert.match(sc, /Next week: Georgia visit Notre Dame \(1-1\); Colorado host Boston College \(0-2\)/);
});
t('season context: week 1 (no previous week) still works', () => {
  const g1 = w1.games[0];
  assert.match(seasonContextText(g1, ctx(w1), null, name), /record entering 0-0/);
});
t('preview context: both profiles with ranks and key players', () => {
  const pc = previewContextText('texas', 'washington', ctx(j('2028/week6.json')), name);
  assert.match(pc, /Texas: 5-1; power poll #2/);
  assert.match(pc, /pass rusher Jacob Manu: 5 sacks \(#1 in PCFL\)/);
  assert.ok(!/\S {2,}/.test(pc), 'no double spaces inside text');
});
t('leaderRank ranks by the field, null when absent', () => {
  const r = leaderRank(w2.leaders.passing, 'Roger Anderson', 'colorado', 'yds');
  assert.equal(r.rank, 3);
  assert.equal(leaderRank(w2.leaders.passing, 'Nobody', 'colorado', 'yds'), null);
});

// ---- number guard
t('number guard: flags invented numbers, allows data numbers, margins and sums', () => {
  const data = 'Final: Georgia 28, Colorado 42. Anderson 350 yds. Season 662 yds.';
  assert.deepEqual(numbersNotIn('Colorado won 42-28 behind 350 yards; now 662 on the season', data), []);
  assert.deepEqual(numbersNotIn('a 14-point win, 70 combined points', data), [], 'margin 14 and sum 70 are derivable');
  assert.deepEqual(numbersNotIn('Anderson threw for 444 yards', data), [444]);
  assert.deepEqual(numbersNotIn({ body: ['1,672 yards'] }, 'total 1672'), [], 'thousands separators normalised');
  assert.deepEqual(numbersNotIn('5 sacks and 3 TD', data), [], 'single digits are not policed');
});

console.log(`\nai-context.test: ${passed} passed`);
