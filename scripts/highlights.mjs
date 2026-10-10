/**
 * Game highlights: align FBPro play-by-play events to the broadcast video.
 *
 * Input:  a clock track read from the YouTube broadcast (one reading per second:
 *         [videoSeconds, "MMSS" | "    " when the clock box is off-screen]) and the
 *         game's .log file. Output: the top N plays with video start/end seconds,
 *         rendered on the site as YouTube embeds (?start=&end=) — nothing is
 *         downloaded, re-encoded or hosted.
 *
 * How the alignment works
 *   - FBPro shows the game clock (yellow LED box, bottom-left of the field view)
 *     while a play is live and hides it between plays. The log's possession line
 *     before each snap carries the clock at the snap, e.g. "Q4 1:00".
 *   - Quarters are inferred from the clock track: a reset from low (<3:00) to
 *     high (>=13:00) starts the next period.
 *   - A play logged at clock C in quarter Q starts at the first video second in Q
 *     where the box shows C (or the nearest reading at/below C within 6 s, since
 *     sampling is once per second). The box is hidden while the ball is live, so
 *     the snap is the first second it disappears and the play ends when it returns;
 *     the clip runs from 4 s before the snap (formation) to 1 s after, capped at 22 s.
 *   - Instant replays repeat clock values; taking the FIRST match per quarter and
 *     requiring forward progress keeps replays out.
 */
import { gameNarrative } from './ai-context.mjs';

const toSecs = mmss => +mmss.slice(0, 2) * 60 + +mmss.slice(2, 4);
const clockSecs = c => { const [m, s] = String(c).split(':'); return (+m || 0) * 60 + (+s || 0); };

/** Turn raw samples into segments of continuous clock visibility with period numbers. */
export function buildTrack(samples) {
  const readings = [];
  for (const [t, s] of samples) {
    if (!/^\d{4}$/.test(s)) continue;
    const secs = toSecs(s);
    if (+s.slice(2) > 59 || secs > 900) continue;          // misread
    readings.push({ t, secs });
  }
  // reject isolated misreads: a reading must agree (within 3 s of clock per s of video) with a neighbour
  const ok = readings.filter((r, i) => {
    const near = [readings[i - 1], readings[i + 1]].filter(Boolean);
    return near.some(n => Math.abs(n.t - r.t) <= 3 && Math.abs((r.secs - n.secs) + (r.t - n.t)) <= 3 && r.secs >= n.secs - 3 - Math.abs(n.t - r.t));
  });
  let q = 1, last = null;
  for (const r of ok) {
    if (last && last.secs < 180 && r.secs >= 780) q++;      // clock reset => next period
    r.q = q; last = r;
  }
  return ok;
}

/** Video second where a play logged at (q, clock) starts, or null. */
export function locate(track, q, clock) {
  const c = clockSecs(clock);
  const inQ = track.filter(r => r.q === q);
  const hit = inQ.find(r => r.secs === c) || inQ.find(r => r.secs <= c && r.secs >= c - 6);
  if (!hit) return null;
  // walk back to the first second of this play (same play = consecutive seconds, clock within the play)
  let i = track.indexOf(hit);
  while (i > 0 && track[i - 1].q === q && hit.t - track[i - 1].t <= 2 && track[i - 1].secs >= c && track[i - 1].secs <= c + 1) i--;
  return track[i].t;
}

/**
 * Snap and end of the play that follows a clock reading at `at`.
 * FBPro shows the clock box between plays and hides it while the ball is live,
 * so the snap is the first second the box is gone and the play is over when the
 * box comes back (the next play's clock).
 */
const digits = s => (String(s).match(/\d/g) || []).length;
const boxShown = s => digits(s) >= 3;          // tolerate one misread digit
const ballLive = s => digits(s) <= 1;          // box hidden (allow a stray mark)
export function playWindow(samples, at) {
  const i0 = samples.findIndex(([t]) => t >= at);
  if (i0 < 0) return { snap: at, over: at + 15 };
  let i = i0;
  while (i < samples.length && !ballLive(samples[i][1])) i++;                  // clock still showing (pre-snap)
  const snap = i < samples.length ? samples[i][0] : at + 2;
  let k = i;
  while (k < samples.length && !boxShown(samples[k][1]) && samples[k][0] - snap < 30) k++;   // ball is live
  const over = k < samples.length ? samples[k][0] : snap + 15;
  return { snap, over };
}

/** Short broadcast-style title from the play text: "MacIntyre to Davis, 30 yards", "Stone 50-yard field goal". */
export function playTitle(c) {
  const last = n => String(n || '').trim().split(/\s+/).pop();
  const p = c.play || '';
  const yards = (p.match(/gain of (?:almost |just over |about )?(\d+)/) || [])[1];
  const pass = p.match(/The pass from .*?'s QB ([A-Z][\w.'-]* ?[\w.'-]*) is caught by [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)(?: for| \.)/);
  const run = p.match(/gives to [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)\. /) || p.match(/'s [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?) runs for/);
  const fg = p.match(/'s K ([A-Z][\w.'-]* ?[\w.'-]*?) attempts a (\d+) yard field goal/);
  const fum = p.match(/'s [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?) fumbles the ball\. The ball is recovered by (?:.*?'s )?[A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)\./);
  const int = p.match(/'s QB ([A-Z][\w.'-]* ?[\w.'-]*?) is intercepted by .*?'s [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)(?: and|\.)/);
  const ret = p.match(/'s [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)\. \S+ returns the kick for (\d+) yards/) || p.match(/to .*?'s [A-Z]{1,2} ([A-Z][\w.'-]* ?[\w.'-]*?)\. \S+ returns the kick for (\d+) yards/);
  const td = /Touchdown/.test(p) ? ' — touchdown' : '';
  let t;
  if (fg) t = `${last(fg[1])} ${fg[2]}-yard field goal`;
  else if (fum) t = `${last(fum[1])} fumble, ${last(fum[2])} recovers`;
  else if (int) t = `${last(int[2])} intercepts ${last(int[1])}`;
  else if (ret) t = `${last(ret[1])} ${ret[2]}-yard kick return${td}`;
  else if (pass) t = `${last(pass[1])} to ${last(pass[2])}${yards ? `, ${yards} yards` : ''}${td}`;
  else if (run) t = `${last(run[1])} ${yards ? `${yards}-yard ` : ''}run${td}`;
  else t = c.title;
  if (c.kind === 'game-winner') t = `Game-winner: ${t}`;
  if (c.kind === '4th-down stop') t = `Fourth-down stop: ${t.replace(/ — touchdown$/, '')} short of the sticks`;
  return t;
}

/**
 * Rank candidate plays from the narrative. Game-deciding scores first, then
 * turnovers, touchdowns and the longest gains; at most `n`, chronological output.
 */
export function pickHighlights(n, count = 4) {
  const cand = [];
  const finalLead = (() => { const m = n.final.match(/^(.*) (\d+), (.*) (\d+)$/); return m ? (+m[2] > +m[4] ? m[1] : m[3]) : null; })();
  // the last score that put the eventual winner ahead for good
  let decisive = null;
  for (const s of n.scoring) {
    const m = s.score.match(/^(.*) (\d+), (.*) (\d+)$/); if (!m) continue;
    const leader = +m[2] > +m[4] ? m[1] : +m[4] > +m[2] ? m[3] : null;
    if (leader === finalLead && (!decisive || decisive.leader !== finalLead)) decisive = { s, leader };
    if (leader !== finalLead) decisive = null;
  }
  for (const s of n.scoring) {
    if (!['touchdown', 'field goal', 'safety'].includes(s.kind)) continue;
    const isDecisive = decisive && decisive.s === s;
    const yards = (s.play.match(/(\d+) yard field goal/) || s.play.match(/gain of (?:almost |just over |about )?(\d+)/) || [])[1];
    cand.push({ q: s.q, clock: s.clock, team: s.team, kind: isDecisive ? 'game-winner' : s.kind, score: (isDecisive ? 150 : 0) + (s.kind === 'touchdown' ? 30 + (+yards || 0) * 0.8 : s.kind === 'field goal' ? 10 + (+yards || 0) * 0.3 : 35),
      title: `${isDecisive ? 'Game-winner: ' : ''}${s.team} ${s.kind === 'field goal' ? `${yards}-yard field goal` : s.kind === 'touchdown' ? `touchdown${yards ? ` (${yards} yds)` : ''}` : s.kind}`, play: s.play, after: s.score });
  }
  for (const t of n.turnovers) cand.push({ q: t.q, clock: t.clock, team: t.by, kind: 'turnover', score: 60 + (t.q === 4 ? 15 : 0), title: `${t.by} takeaway: ${t.kind === 'interception' ? 'interception' : 'fumble recovery'}`, play: t.play });
  for (const e of n.explosive) cand.push({ q: e.q, clock: e.clock, team: e.team, kind: 'explosive', score: 20 + e.yards * 1.2 + (e.td ? 25 : 0), title: `${e.team} ${e.yards}-yard ${/pass/.test(e.play) ? 'catch' : /returns/.test(e.play) ? 'return' : 'run'}`, play: e.play });
  for (const f of n.fourthDownStops) cand.push({ q: f.q, clock: f.clock, team: f.offense, kind: '4th-down stop', score: 40 + (f.q === 4 ? 15 : 0), title: `Fourth-down stop: ${f.offense} turned away`, play: f.play });
  // de-duplicate the same snap (e.g. a long TD is both a score and an explosive play)
  const bySnap = new Map();
  for (const c of cand) { const k = `${c.q}|${c.clock}`; if (!bySnap.has(k) || bySnap.get(k).score < c.score) bySnap.set(k, c); }
  // best first (callers take the top N they can locate, then present them in game order)
  return [...bySnap.values()].sort((a, b) => b.score - a.score).slice(0, count);
}
const chrono = (a, b) => a.q - b.q || clockSecs(b.clock) - clockSecs(a.clock);

/** Full pipeline for one game. */
export function buildHighlights({ samples, logText, rename = x => x, videoId, count = 4 }) {
  const n = gameNarrative(logText, rename);
  if (!n) return { error: 'log could not be parsed' };
  const track = buildTrack(samples);
  const picks = pickHighlights(n, count + 4);   // ranked; spares in case one cannot be located
  const out = [];
  for (const p of picks) {
    const at = locate(track, p.q, p.clock);
    if (at == null) continue;
    const { snap, over } = playWindow(samples, at);
    const start = Math.max(0, snap - 4), end = Math.min(over + 1, snap + 22);
    out.push({ ...p, title: playTitle(p), videoId, start, end, url: `https://www.youtube.com/embed/${videoId}?start=${start}&end=${end}&rel=0` });
    if (out.length === count) break;
  }
  out.sort(chrono);
  return { periods: [...new Set(track.map(r => r.q))].length, readings: track.length, highlights: out };
}
