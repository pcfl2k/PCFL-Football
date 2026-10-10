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
 *     sampling is once per second); the clip starts 3 s earlier (formation) and
 *     ends 2 s after the box disappears (end of play), capped at 25 s.
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

/** End of the play: first second after `start` when the clock box is off-screen. */
export function playEnd(samples, start) {
  const idx = samples.findIndex(([t]) => t >= start);
  for (let i = idx; i >= 0 && i < samples.length; i++) if (samples[i][1].trim() === '' && samples[i][0] > start + 2) return samples[i][0];
  return start + 18;
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
    cand.push({ q: s.q, clock: s.clock, team: s.team, kind: isDecisive ? 'game-winner' : s.kind, score: (isDecisive ? 100 : 0) + (s.kind === 'touchdown' ? 40 : s.kind === 'field goal' ? 15 : 30) + (+yards || 0) * 0.6,
      title: `${isDecisive ? 'Game-winner: ' : ''}${s.team} ${s.kind === 'field goal' ? `${yards}-yard field goal` : s.kind === 'touchdown' ? `touchdown${yards ? ` (${yards} yds)` : ''}` : s.kind}`, play: s.play, after: s.score });
  }
  for (const t of n.turnovers) cand.push({ q: t.q, clock: t.clock, team: t.by, kind: 'turnover', score: 60 + (t.q === 4 ? 15 : 0), title: `${t.by} takeaway: ${t.kind}`, play: t.play });
  for (const e of n.explosive) cand.push({ q: e.q, clock: e.clock, team: e.team, kind: 'explosive', score: e.yards * 0.9, title: `${e.team} ${e.yards}-yard ${/pass/.test(e.play) ? 'catch' : /returns/.test(e.play) ? 'return' : 'run'}`, play: e.play });
  for (const f of n.fourthDownStops) cand.push({ q: f.q, clock: f.clock, team: f.offense, kind: '4th-down stop', score: 35 + (f.q === 4 ? 15 : 0), title: `Fourth-down stop`, play: f.play });
  // de-duplicate the same snap (e.g. a long TD is both a score and an explosive play)
  const bySnap = new Map();
  for (const c of cand) { const k = `${c.q}|${c.clock}`; if (!bySnap.has(k) || bySnap.get(k).score < c.score) bySnap.set(k, c); }
  return [...bySnap.values()].sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => a.q - b.q || clockSecs(b.clock) - clockSecs(a.clock));
}

/** Full pipeline for one game. */
export function buildHighlights({ samples, logText, rename = x => x, videoId, count = 4 }) {
  const n = gameNarrative(logText, rename);
  if (!n) return { error: 'log could not be parsed' };
  const track = buildTrack(samples);
  const picks = pickHighlights(n, count + 2);   // spares in case one cannot be located
  const out = [];
  for (const p of picks) {
    const at = locate(track, p.q, p.clock);
    if (at == null) continue;
    const start = Math.max(0, at - 3), end = Math.min(playEnd(samples, at) + 2, at + 25);
    out.push({ ...p, videoId, start, end, url: `https://www.youtube.com/embed/${videoId}?start=${start}&end=${end}&rel=0` });
    if (out.length === count) break;
  }
  return { periods: [...new Set(track.map(r => r.q))].length, readings: track.length, highlights: out };
}
