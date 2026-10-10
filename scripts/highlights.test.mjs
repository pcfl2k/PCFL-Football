// Highlights alignment test on the real 2028 championship broadcast clock track.
//   node scripts/highlights.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildTrack, locate, playWindow, pickHighlights, buildHighlights, playTitle } from './highlights.mjs';
import { gameNarrative } from './ai-context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { videoId, samples } = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/2028-w15-tenn-tex-clock-track.json'), 'utf8'));
const logText = readFileSync(join(ROOT, 'data/2028/logs/week15/28W15TENN@TEX.log'), 'utf8');
let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

const track = buildTrack(samples);
t('four periods recovered from clock resets', () => {
  assert.deepEqual([...new Set(track.map(r => r.q))], [1, 2, 3, 4]);
});
t('plays are located at the right video second (verified by eye on the broadcast)', () => {
  assert.equal(locate(track, 4, '1:00'), 2308);        // Stone 50-yard FG
  const w = playWindow(samples, locate(track, 4, '12:56'));
  assert.ok(w.snap >= 1790 && w.snap <= 1792 && w.over >= 1798 && w.over <= 1800, JSON.stringify(w));  // fumble play
});
t('ranking puts the game-winner, the 4th-quarter takeaway and the longest gain in', () => {
  const kinds = pickHighlights(gameNarrative(logText), 4).map(c => c.kind);
  assert.ok(kinds.includes('game-winner')); assert.ok(kinds.includes('turnover')); assert.ok(kinds.includes('explosive'));
});
t('end to end: 4 clips in game order with the verified windows and broadcast titles', () => {
  const out = buildHighlights({ samples, logText, videoId, count: 4 });
  assert.deepEqual(out.highlights.map(h => [h.start, h.end]), [[47, 62], [1787, 1800], [2308, 2320], [2381, 2395]]);
  assert.deepEqual(out.highlights.map(h => h.title), ['MacIntyre to Davis, 30 yards', 'MacIntyre fumble, January recovers', 'Game-winner: Stone 50-yard field goal', 'Fourth-down stop: MacIntyre to Thomas, 5 yards short of the sticks']);
  assert.ok(out.highlights.every(h => h.end - h.start >= 8 && h.end - h.start <= 22), 'clip lengths sane');
});
t('titles for other play types', () => {
  assert.equal(playTitle({ play: "Colorado's QB Roger Anderson gives to HB Benjamin Sweeney. Sweeney runs for a gain of almost 16 yards. Touchdown, Colorado!" }), 'Sweeney 16-yard run — touchdown');
  assert.equal(playTitle({ play: "The pass from Georgia's QB TJ Giles is intercepted by Colorado's S Shilo Sanders and returned for a gain of just over 17 yards." }), 'Sanders intercepts Giles');
});
t('a track with no readable clock yields no clips (never a wrong clip)', () => {
  const out = buildHighlights({ samples: samples.map(([s]) => [s, '    ']), logText, videoId });
  assert.equal(out.highlights.length, 0);
});
console.log(`\nhighlights.test: ${passed} passed`);
