/*
 * PCFL broadcast clock scanner — paste into the browser console on the game's
 * YouTube page (or run via automation). Reads the FBPro LED game clock once per
 * second of video, entirely in-page (nothing is downloaded), and leaves the
 * result in window.__scan.samples as [[videoSecond, "MMSS" | "    "], ...]
 * for scripts/highlights.mjs.
 *
 * Calibrated on the PCFL Network 1080p recordings (FBPro98 window centred in a
 * 1920x1080 frame): the clock box's 4 dot-matrix digits are 4 x 5 dots with an
 * ~8.5 px pitch. If the recording layout changes, re-measure COLS/ROWS
 * (see the prototype notes in the commit history).
 */
(async () => {
  const GL = {
    '1111/1001/1001/1001/1111': '0', '0010/0110/0010/0010/0111': '1', '1111/0001/1111/1000/1111': '2', '1111/0001/1111/0001/1111': '3', '1001/1001/1111/0001/0001': '4',
    '1111/1000/1111/0001/1111': '5', '1111/1000/1111/1001/1111': '6', '1111/0001/0001/0001/0001': '7', '1111/1001/1111/1001/1111': '8', '1111/1001/1111/0001/1111': '9' };
  const COLS = [[394.5, 402.5, 411, 419.5], [432, 440.5, 449, 457.5], [487, 495.5, 504, 512], [525, 533.5, 542, 550]], ROWS = [963.5, 972, 980.5, 989, 997];
  const p = document.getElementById('movie_player');
  try { p.mute(); p.setPlaybackQualityRange('hd1080', 'hd1080'); p.playVideo(); await new Promise(r => setTimeout(r, 2500)); p.pauseVideo(); } catch {}
  const v = document.querySelector('video'); v.pause();
  if (v.videoHeight !== 1080) console.warn('expected a 1080p stream, got', v.videoHeight);
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const ctx = c.getContext('2d', { willReadFrequently: true });
  window.__scan = { samples: [], done: 0, finished: false };
  for (let t = 0; t <= Math.floor(v.duration); t++) {
    v.currentTime = t;
    await Promise.race([new Promise(r => v.addEventListener('seeked', r, { once: true })), new Promise(r => setTimeout(r, 5000))]);
    ctx.drawImage(v, 0, 0, 1920, 1080);
    const d = ctx.getImageData(380, 950, 190, 60).data;
    const lit = (x, y) => { let n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const xx = Math.round(x) - 380 + dx, yy = Math.round(y) - 950 + dy, i = (yy * 190 + xx) * 4; if (d[i] > 150 && d[i + 1] > 90 && d[i + 2] < 110) n++; } return n >= 3 ? 1 : 0; };
    const ds = COLS.map(cs => { const code = ROWS.map(y => cs.map(x => lit(x, y)).join('')).join('/'); return GL[code] ?? (code.replace(/[0/]/g, '') === '' ? ' ' : '?'); }).join('');
    window.__scan.samples.push([t, ds]); window.__scan.done = t;
  }
  window.__scan.finished = true;
  console.log('clock scan finished:', window.__scan.samples.length, 'seconds');
})();
