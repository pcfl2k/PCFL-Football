/* ==================================================================
   PCFL Recruitment Center — League files (commissioner)
   Lazy-loaded from recruiting.js (Admin → "League files"). Talks to
   /admin/league/* on the Recruitment Center service:
     upload the current FBPro98 league zip → parsed summary
     preview exactly what the signed recruits change, team by team
     choose roster-limit options → generate the new league package
     download the zip + reconciliation report; history of packages
   The service writes nothing in place: every package is a new zip built
   from the untouched upload and self-checked before it is offered.
   ================================================================== */
let C = null;               // context from recruiting.js: { api, apiBase, token, demo, modal, closeModal, toast, esc, T }
const L = { data: null, base: null, summary: null, preview: null, options: { overflow: 'skip', overflowByTeam: {} }, busy: false, open: {} };
const RATINGS = ['SP', 'AC', 'AG', 'ST', 'HA', 'EN', 'IN', 'DI'];
const esc = s => C.esc(s);
const ht = h => `${Math.floor(h / 12)}-${h % 12}`;
const fmt = iso => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const short = h => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '');

const CSS = `
.rl .rl-sec{border:1px solid var(--line,#e3e6ea);border-radius:12px;padding:14px 16px;margin:0 0 14px;background:var(--card,#fff)}
.rl h4{margin:0 0 8px;font-family:var(--font-head,inherit);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#667)}
.rl .rl-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.rl .rl-kv{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;font-size:13px}
.rl .rl-kv b{font-weight:600}
.rl .rl-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all}
.rl .rl-drop{border:2px dashed var(--line,#cfd5db);border-radius:12px;padding:18px;text-align:center;cursor:pointer;font-size:13px}
.rl .rl-drop.over{background:rgba(0,0,0,.04)}
.rl table{width:100%;border-collapse:collapse;font-size:12.5px}
.rl th,.rl td{padding:5px 6px;border-bottom:1px solid var(--line,#eceff2);text-align:left;white-space:nowrap}
.rl td.n,.rl th.n{text-align:right}
.rl .rl-team{border:1px solid var(--line,#e3e6ea);border-radius:10px;margin:8px 0;overflow:hidden}
.rl .rl-team>header{display:flex;gap:10px;align-items:center;padding:8px 12px;cursor:pointer;background:rgba(0,0,0,.025)}
.rl .rl-team>header b{flex:1}
.rl .rl-team .body{padding:8px 12px;overflow-x:auto}
.rl .rl-pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;background:#eef1f4}
.rl .rl-pill.add{background:#e3f4e8;color:#11632a}.rl .rl-pill.rel{background:#fdecea;color:#8a1c12}.rl .rl-pill.left{background:#fff3dc;color:#7a4b00}
.rl .rl-warn{color:#8a5200;font-size:12.5px}.rl .rl-ok{color:#11632a}.rl .rl-bad{color:#a11}
.rl .rl-hint{font-size:12px;color:var(--muted,#667)}
.rl select{font:inherit;padding:4px 6px;border-radius:8px;border:1px solid var(--line,#cfd5db);background:var(--card,#fff);color:inherit}
@media (max-width:640px){.rl .rl-kv{grid-template-columns:1fr}.rl th,.rl td{padding:4px}}
`;

export async function open(ctx) {
  C = ctx;
  if (!document.getElementById('rl-css')) { const st = document.createElement('style'); st.id = 'rl-css'; st.textContent = CSS; document.head.appendChild(st); }
  if (C.demo) { C.toast('Not in demo', 'League files are live-only. Leave demo mode first.', 'err', 6000); return; }
  const ov = C.modal(`<div class="rc-mhead"><div><h3>League files · FBPro98</h3><div class="m"><span>Turn signed recruits into an updated league package — no hand-editing rosters</span></div></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody rl" id="rl-root"><div class="rc-empty">Loading…</div></div>`, 'lg');
  ov.addEventListener('click', onClick);
  ov.addEventListener('change', onChange);
  await reload();
}

async function reload() {
  try {
    L.data = await C.api('/admin/league');
    if (L.data.latestBase && (!L.base || L.base.id !== L.data.latestBase.id)) await loadBase(L.data.latestBase.id, true);
  } catch (e) { setRoot(`<div class="rc-err">${esc(e.message)}</div>`); return; }
  draw();
}
async function loadBase(id, quiet) {
  const r = await C.api(`/admin/league/bases/${id}`);
  L.base = r.base; L.summary = r.summary; L.preview = null;
  if (!quiet) draw();
}
const setRoot = html => { const el = document.getElementById('rl-root'); if (el) el.innerHTML = html; };

function draw() {
  const d = L.data || {};
  setRoot(`${baseSection()}${L.summary ? reconcileSection(d) : ''}${historySection(d)}
    <div class="rl-sec"><h4>Not verified by this tool</h4><ul class="rl-hint" style="margin:0;padding-left:18px">${(d.unverified || []).map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>`);
  const drop = document.getElementById('rl-drop'), file = document.getElementById('rl-file');
  if (drop) {
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
    file.addEventListener('change', () => { if (file.files[0]) upload(file.files[0]); });
  }
}

function baseSection() {
  const b = L.base, s = L.summary;
  const drop = `<div class="rl-drop" id="rl-drop"><b>${b ? 'Upload a newer league zip' : 'Drop the current league zip here'}</b><br><span class="rl-hint">The zip of PCFL.lge, .pyr, .rst, .lg2, .pyf, .pyc, .dat, .idx, .lgc, .dft, .tmn — validated by parsing every file; stored versioned, never modified.</span><input type="file" id="rl-file" accept=".zip" style="display:none"></div>`;
  if (!b) return `<div class="rl-sec"><h4>1 · Base league</h4>${drop}</div>`;
  const teams = s.teams.map(t => `<tr><td>${esc(t.name)}</td><td class="n">${t.count}</td><td class="n">${t.nonIr}</td><td class="n">${t.ir}</td><td class="n"><b class="${t.openSlots ? '' : 'rl-bad'}">${t.openSlots}</b></td><td>${Object.entries(t.byYear).sort().map(([y, n]) => `${y === 'R' ? 'R' : 'Yr ' + y}:${n}`).join(' · ')}</td></tr>`).join('');
  return `<div class="rl-sec"><h4>1 · Base league</h4>
    <div class="rl-kv"><span>File</span><b>${esc(b.originalName || b.file)}</b><span>Uploaded</span><span>${fmt(b.createdAt)} by ${esc(b.by)}</span>
    <span>League</span><span>${esc(s.league)} · ${s.teams.length} teams · ${s.players} player records · ${s.freeAgents} free agents · ${s.draftPool} in the college draft pool</span>
    <span>Zip SHA-256</span><span class="rl-mono">${esc(b.zipSha256)}</span></div>
    ${s.warnings?.length ? `<details style="margin-top:8px"><summary class="rl-warn">${s.warnings.length} notes from the reader</summary><ul class="rl-hint">${s.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    <details style="margin-top:8px"><summary style="cursor:pointer">Team rosters in this file (open non-IR slots of 53)</summary><div style="overflow-x:auto"><table><thead><tr><th>Team</th><th class="n">Players</th><th class="n">Non-IR</th><th class="n">IR</th><th class="n">Open</th><th>By year</th></tr></thead><tbody>${teams}</tbody></table></div></details>
    <details style="margin-top:8px"><summary style="cursor:pointer">File checksums</summary><div class="rl-kv rl-mono">${Object.entries(b.files || {}).map(([k, v]) => `<span>${esc(s.league)}.${k}</span><span>${v}</span>`).join('')}</div></details>
    <div style="margin-top:10px">${drop}</div></div>`;
}

function reconcileSection(d) {
  const p = L.preview, o = L.options;
  const opts = d.overflowOptions || {};
  const sel = (val, attr) => `<select ${attr}>${Object.keys(opts).map(k => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(labelOf(k))}</option>`).join('')}</select>`;
  let body = `<div class="rl-row"><span><b>${d.signedRecruits ?? 0}</b> signed recruits in the live season.</span>
    <label class="rl-hint">When a team would exceed 53 non-IR players: ${sel(o.overflow, 'data-rlc="overflow"')}</label>
    <button class="rc-btn" data-rl="preview">Preview changes</button></div>
    <p class="rl-hint" style="margin:6px 0 0">${esc(opts[o.overflow] || '')} Available any time — round by round or after the last round; each preview reflects the signings at that moment.</p>`;
  if (p) {
    const sm = p.summary;
    const changed = p.teams.filter(t => t.added.length || t.releases.length || t.left.length);
    body += `<div class="rl-row" style="margin-top:12px"><span class="rl-pill add">+${sm.added} added</span><span class="rl-pill rel">${sm.released} released</span><span class="rl-pill left">${sm.leftOut} left out</span>${sm.rejected ? `<span class="rl-pill">${sm.rejected} not applicable</span>` : ''}<span class="rl-hint">New player ids ${p.firstNewId}–${p.lastNewId}</span></div>
      ${sm.overflowTeams.length ? `<p class="rl-warn">Roster limit reached for ${sm.overflowTeams.map(t => `${esc(t.name)} (${t.excess} over)`).join(', ')}. Nothing is guessed: pick an option per team below, or keep the default (${esc(labelOf(o.overflow))}).</p>` : ''}
      ${p.notes?.length ? `<p class="rl-hint">${p.notes.map(esc).join('<br>')}</p>` : ''}
      ${changed.map(teamCard).join('') || '<div class="rc-empty">No roster changes — no signed recruits yet.</div>'}
      ${p.rejected.length ? `<details style="margin-top:8px"><summary class="rl-warn">${p.rejected.length} signings not applied</summary><ul class="rl-hint">${p.rejected.map(r => `<li>${esc(r.name)} (${esc(r.position)}, ${esc(r.team)}) — ${esc(r.reason)}</li>`).join('')}</ul></details>` : ''}
      <div class="rc-mactions" style="margin-top:12px"><button class="rc-btn primary" data-rl="generate" ${sm.added + sm.released ? '' : 'disabled'}>Generate league files</button></div>`;
  }
  return `<div class="rl-sec"><h4>2 · Reconcile signed recruits</h4>${body}</div>`;
}
const labelOf = k => ({ skip: 'Leave the excess recruits out (default)', 'release-seniors': 'Release lowest-rated Yr 4+ seniors', 'release-lowest': 'Release lowest-rated players (any year)' }[k] || k);

function teamCard(t) {
  const isOpen = L.open[t.team] ?? (t.excess > 0);
  const rows = t.added.map(a => `<tr><td>${esc(a.name)}${a.warnings?.length ? ` <span class="rl-warn" title="${esc(a.warnings.join('; '))}">⚠</span>` : ''}</td><td>${a.pos}</td><td>${a.status === 'I' ? 'inactive' : a.status === 'IR' ? 'IR' : 'active'} · slot ${a.slot}</td><td class="n">#${a.jersey}</td><td>${ht(a.height)} / ${a.weight}${a.sizeSource === 'workbook' ? '' : '*'}</td>${a.act.map((v, i) => `<td class="n" title="${RATINGS[i]} actual/potential">${v}/${a.pot[i]}</td>`).join('')}</tr>`).join('');
  return `<div class="rl-team"><header data-rl="toggle:${t.team}"><b>${esc(t.name)}</b>
    ${t.added.length ? `<span class="rl-pill add">+${t.added.length}</span>` : ''}${t.releases.length ? `<span class="rl-pill rel">−${t.releases.length}</span>` : ''}${t.left.length ? `<span class="rl-pill left">${t.left.length} left out</span>` : ''}
    <span class="rl-hint">${t.before.nonIr} → ${t.nonIrAfter} of 53</span></header>
    ${isOpen ? `<div class="body">
      ${t.excess ? `<p class="rl-warn" style="margin:0 0 6px">${t.added.length + t.left.length} signings for ${t.before.open} open slots. Option for ${esc(t.name)}: <select data-rlc="team:${t.team}">${['skip', 'release-seniors', 'release-lowest'].map(k => `<option value="${k}" ${k === t.overflow ? 'selected' : ''}>${esc(labelOf(k))}</option>`).join('')}</select></p>` : ''}
      ${rows ? `<table><thead><tr><th>Added</th><th>Pos</th><th>Roster</th><th class="n">No.</th><th>Ht / Wt</th>${RATINGS.map(r => `<th class="n">${r}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : ''}
      ${t.releases.length ? `<p style="margin:6px 0 0"><b>Released to the free-agent pool:</b> ${t.releases.map(r => `${esc(r.name)} (${r.pos}, Yr ${r.yr}, ovr ${r.ovr})`).join('; ')}</p>` : ''}
      ${t.left.length ? `<p class="rl-warn" style="margin:6px 0 0"><b>Not added:</b> ${t.left.map(x => `${esc(x.name)} (${x.pos}${x.star ? `, ${x.star}★` : ''})`).join('; ')} — ${esc(t.left[0].reason)}</p>` : ''}
      ${t.added.some(a => a.sizeSource !== 'workbook') ? '<p class="rl-hint" style="margin:6px 0 0">* height/weight not in the recruit workbook: median of the league\'s current players at that position.</p>' : ''}
    </div>` : ''}</div>`;
}

function historySection(d) {
  const pk = d.packages || [];
  return `<div class="rl-sec"><h4>3 · Generated packages</h4>${pk.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Generated</th><th>Added</th><th>Released</th><th>Left out</th><th>Base</th><th>Self-check</th><th>Download</th></tr></thead><tbody>
    ${pk.map(x => `<tr><td>${fmt(x.createdAt)}<br><span class="rl-hint">${esc(x.by)}</span></td><td class="n">${x.summary?.added ?? 0}</td><td class="n">${x.summary?.released ?? 0}</td><td class="n">${x.summary?.leftOut ?? 0}</td><td class="rl-hint">${esc(x.baseFile || x.baseId)}</td><td>${x.selfCheck?.ok ? '<span class="rl-ok">passed</span>' : '<span class="rl-bad">failed</span>'}</td>
    <td><button class="rc-btn sm primary" data-rl="dl:${x.id}:zip">League zip</button> <button class="rc-btn sm" data-rl="dl:${x.id}:html">Report</button> <button class="rc-btn sm ghost" data-rl="dl:${x.id}:csv">CSV</button><div class="rl-mono rl-hint" title="${esc(x.zipSha256)}">${short(x.zipSha256)}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="rc-empty">No league packages generated yet.</div>'}
    ${(d.bases || []).length > 1 ? `<details style="margin-top:8px"><summary style="cursor:pointer">Base uploads (${d.bases.length})</summary><ul class="rl-hint">${d.bases.map(b => `<li>${fmt(b.createdAt)} · ${esc(b.originalName || b.file)} · <span class="rl-mono">${short(b.zipSha256)}</span> ${L.base?.id === b.id ? '<b>(in use)</b>' : `<button class="rc-btn sm ghost" data-rl="usebase:${b.id}">Use</button>`}</li>`).join('')}</ul></details>` : ''}</div>`;
}

async function upload(f) {
  if (!/\.zip$/i.test(f.name)) { C.toast('Zip required', 'Upload the league folder zipped (PCFL-YYYY-M-D.zip).', 'err'); return; }
  setRoot(`<div class="rc-empty">Validating ${esc(f.name)} — parsing every league file…</div>`);
  const dataBase64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.onerror = rej; rd.readAsDataURL(f); });
  try {
    const r = await C.api('/admin/league/bases', { method: 'POST', body: { filename: f.name, dataBase64 } });
    L.base = r.base; L.summary = r.summary; L.preview = null;
    C.toast(r.duplicate ? 'Already uploaded' : '✓ League uploaded', `${r.summary.league}: ${r.summary.teams.length} teams, ${r.summary.players} player records.`, 'ok');
    await reload();
  } catch (e) { C.toast('Upload refused', e.message, 'err', 9000); await reload(); }
}

async function preview() {
  if (L.busy) return; L.busy = true;
  try { const r = await C.api('/admin/league/preview', { method: 'POST', body: { baseId: L.base.id, ...L.options } }); L.preview = r.preview; L.data.signedRecruits = r.preview.summary.signings; }
  catch (e) { C.toast('Preview failed', e.message, 'err', 8000); }
  finally { L.busy = false; draw(); }
}

async function generate() {
  const p = L.preview; if (!p || L.busy) return;
  if (!confirm(`Generate a new league package?\n\n+${p.summary.added} recruits added, ${p.summary.released} released, ${p.summary.leftOut} left out.\nThe uploaded base files are not modified; a new zip is created and self-checked.`)) return;
  L.busy = true;
  try {
    const r = await C.api('/admin/league/generate', { method: 'POST', body: { baseId: L.base.id, ...L.options } });
    C.toast('✓ League files generated', `${r.package.summary.added} recruits added — self-check passed. Download the zip below.`, 'ok', 8000);
    L.preview = r.preview;
    await reload();
  } catch (e) { C.toast('Not generated', `${e.message}${e.extra?.details?.length ? ' — ' + e.extra.details.slice(0, 3).join('; ') : ''}`, 'err', 12000); }
  finally { L.busy = false; draw(); }
}

async function download(id, kind) {
  try {
    const res = await fetch(`${C.apiBase}/admin/league/packages/${id}/download?file=${kind}`, { headers: { Authorization: `Bearer ${C.token()}` } });
    if (!res.ok) { let m = `Download failed (${res.status})`; try { m = (await res.json()).error?.message || m; } catch {} throw new Error(m); }
    const blob = await res.blob();
    const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || `${id}.${kind}`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) { C.toast('Download failed', e.message, 'err', 8000); }
}

function onClick(e) {
  const a = e.target.closest('[data-rl]'); if (!a) return;
  e.preventDefault();
  const [act, x, y] = a.dataset.rl.split(':');
  if (act === 'preview') preview();
  else if (act === 'generate') generate();
  else if (act === 'toggle') { L.open[x] = !(L.open[x] ?? (L.preview?.teams.find(t => t.team === +x)?.excess > 0)); draw(); }
  else if (act === 'dl') download(x, y);
  else if (act === 'usebase') loadBase(x).catch(err => C.toast('Base not loaded', err.message, 'err'));
}
function onChange(e) {
  const a = e.target.closest('[data-rlc]'); if (!a) return;
  const [act, x] = a.dataset.rlc.split(':');
  if (act === 'overflow') { L.options.overflow = a.value; L.preview = null; draw(); }
  else if (act === 'team') { L.options.overflowByTeam[x] = a.value; preview(); }
}
