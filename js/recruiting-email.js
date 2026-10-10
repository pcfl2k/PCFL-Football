/* ==================================================================
   PCFL Recruitment Center — email features (lazy, imported by recruiting.js)
     - "Forgot password?" on the sign-in card + reset view (#/recruiting/reset/<token>)
     - Commissioner: ✉ Email coaches composer (recipients, preview, send, outbox),
       per-team "Email login", coach name / email / CPU editing, mail status +
       connection test (also shown in System health), "email coaches" when
       issuing or resetting franchise passwords.
   All mail is sent by the service from the league's no-reply Gmail mailbox.
   Admin UI is added to the existing views by small DOM enhancements so this
   module stays independent of recruiting.js templates.
   ================================================================== */
let X = null;   // context handed over by recruiting.js
const RESET_KEY = 'pcfl-rc-reset';
const NOTICE = 'This message was sent from an unmonitored, read-only PCFL mailbox. Please do not reply — contact your commissioner instead.';
const KIND_LABEL = { compose: 'Commissioner message', 'password-reset': 'Reset link', 'password-reset-done': 'Reset confirmation', 'password-changed': 'Password changed', 'temp-password': 'Temporary password', 'login-reminder': 'Login reminder' };
const MODE_LABEL = { ready: ['ACTIVE', 'Ready'], 'not-configured': ['PAUSED', 'Not configured'], disabled: ['LOCKED', 'Switched off'], misconfigured: ['LOCKED', 'Config problem'], paused: ['PAUSED', 'Paused'] };

export function installEmail(ctx) {
  X = ctx;
  Object.assign(X.ACTIONS, ACTIONS);
  // keep the originals so "email coaches" is an add-on, not a replacement of their behaviour
  ACTIONS._origProvision = ctx.ACTIONS.doprovision;
  X.ACTIONS.doprovision = doProvision;
  X.ACTIONS.resetpw = resetPw;
  injectCss();
  const mo = new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; try { enhance(); } catch (e) { console.error('[recruiting-email]', e); } }); } });
  mo.observe(document.body, { childList: true, subtree: true });
  enhance();
}
let pending = false;

/* ------------------------------------------------------------ helpers */
const esc = s => X.esc(s);
const $ = (s, r) => X.$(s, r);
const $$ = (s, r) => X.$$(s, r);
const teamName = slug => { try { return X.T(slug).name; } catch { return slug; } };
function injectCss() {
  if (document.getElementById('rc-email-css')) return;
  const l = document.createElement('link'); l.id = 'rc-email-css'; l.rel = 'stylesheet';
  l.href = new URL('../css/recruiting-email.css?v=__BUILD__', import.meta.url).href;
  document.head.appendChild(l);
}
/** Auth endpoints: plain fetch (never the demo header or a stale sign-in). */
async function authPost(path, body) {
  let res, json = {};
  try { res = await fetch(X.CFG.apiBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch { const e = new Error('Cannot reach the Recruitment Center service.'); e.code = 'NETWORK'; throw e; }
  try { json = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(json.error?.message || `Request failed (${res.status})`); e.code = json.error?.code; e.extra = json.error || {}; throw e; }
  return json;
}
const statusChip = st => { const [cls, label] = MODE_LABEL[st?.mode] || ['', st?.mode || '—']; return `<span class="rc-status ${cls}">${esc(label)}</span>`; };
const fmt = iso => iso ? X.fmtDate(iso) : '—';

/* ------------------------------------------------------------ DOM enhancements */
function enhance() {
  // sign-in card → "Forgot password?"
  const login = $('.rc-login #rc-login-team')?.closest('.rc-login');
  if (login && !login.querySelector('.rc-forgot')) login.querySelector('.actions')?.insertAdjacentHTML('beforeend', `<a href="#" class="rc-forgot" data-rc="forgot">Forgot password?</a>`);
  if (!X.isCommish()) return;
  // admin action bar → ✉ Email coaches
  const bar = $('.rc-admin-actions');
  if (bar && !X.S.demo && !bar.querySelector('[data-rc="emailcompose"]')) {
    const anchor = bar.querySelector('[data-rc="provision"]') || bar.querySelector('[data-rc="audit"]');
    const html = `<button class="rc-btn" data-rc="emailcompose">✉ Email coaches</button>`;
    if (anchor) anchor.insertAdjacentHTML('afterend', html); else bar.insertAdjacentHTML('beforeend', html);
  }
  // franchise table → coach column + per-team buttons
  const table = $$('table.rc-adm').find(t => /Temp password/i.test(t.tHead?.textContent || ''));
  if (table && !X.S.demo && !table.dataset.em) {
    table.dataset.em = '1';
    table.tHead.rows[0].cells[0].insertAdjacentHTML('afterend', '<th>Coach</th>');
    const teams = new Map((X.S.adminData?.teams || []).map(t => [t.slug, t]));
    for (const tr of table.tBodies[0]?.rows || []) {
      const slug = (tr.querySelector('[data-rc^="adjust:"]')?.dataset.rc || '').split(':')[1];
      const t = teams.get(slug);
      tr.cells[0].insertAdjacentHTML('afterend', `<td class="rc-em-coach">${t ? coachCell(t) : ''}</td>`);
      const acts = tr.querySelector('.acts');
      if (acts && t) acts.insertAdjacentHTML('afterbegin', `<button class="rc-btn sm rc-em-ico" data-rc="emaillogin:${slug}" aria-label="Email login" ${t.cpu || !t.coachEmail ? `disabled title="${t.cpu ? 'CPU franchise — no coach email' : 'No coach email on file'}"` : 'title="Email login to this coach"'}>✉</button><button class="rc-btn sm ghost rc-em-ico" data-rc="editcoach:${slug}" aria-label="Edit coach" title="Edit coach name, email, CPU">✎</button>`);
    }
  }
  // Team logins modal → "email each coach" option
  const prov = $$('.rc-modal').find(m => m.querySelector('[data-rc^="doprovision"]'));
  if (prov && !prov.querySelector('#rc-prov-email')) {
    const withEmail = (X.S.adminData?.teams || []).filter(t => !t.cpu && t.coachEmail).length;
    prov.querySelector('.rc-mactions')?.insertAdjacentHTML('beforebegin', `<label class="rc-em-check"><input type="checkbox" id="rc-prov-email" ${X.S.demo ? 'disabled' : 'checked'}> Email each coach their new temporary password <span class="rc-note">(${withEmail} coaches with an email; CPU teams are skipped)</span></label>`);
  }
  // System health → Email row
  const health = $$('.rc-modal').find(m => /System health/i.test(m.querySelector('.rc-mhead h3')?.textContent || ''));
  if (health && !health.querySelector('.rc-em-health')) {
    const tbl = health.querySelector('table.rc-adm');
    if (tbl) {
      tbl.insertAdjacentHTML('beforeend', `<tr class="rc-em-health"><td>Outgoing email</td><td><span class="rc-note">checking…</span></td></tr>`);
      X.api('/admin/email/status', { silent: true }).then(st => {
        const td = health.querySelector('.rc-em-health td:last-child'); if (!td) return;
        td.innerHTML = st ? `${statusChip(st)} <span class="rc-note">${st.counts.queued} queued · ${st.sentLastDay} sent today${st.counts.failed ? ` · ${st.counts.failed} failed` : ''}</span> <button class="rc-btn sm ghost" data-rc="emailtest">Test connection</button>` : '<span class="rc-note">unavailable</span>';
      });
    }
  }
}
function coachCell(t) {
  if (t.cpu) return `<span class="rc-tag">CPU</span>`;
  return `<b>${esc(t.coachFirstName || '—')}</b>${t.commissioner ? ' <span class="rc-tag star">Comm</span>' : ''}<div class="rc-note rc-em-addr">${t.coachEmail ? esc(t.coachEmail) : '<span class="rc-em-warn">no email</span>'}</div>`;
}

/* ------------------------------------------------------------ forgot / reset */
export function resetHTML() {
  if (!X.S.resetToken) { try { X.S.resetToken = sessionStorage.getItem(RESET_KEY) || null; } catch {} }
  setTimeout(checkReset, 0);
  return `<div class="card rc-login reveal in" id="rc-reset"><h3>Reset password</h3><div class="hint">Checking your reset link…</div></div>`;
}
async function checkReset() {
  const box = $('#rc-reset'); if (!box) return;
  const token = X.S.resetToken;
  if (!token) { box.innerHTML = resetProblem('This reset link is missing or incomplete. Copy the whole link from the email, or request a new one.'); return; }
  let v;
  try { v = await authPost('/auth/reset/check', { token }); }
  catch (e) { box.innerHTML = resetProblem(e.message); return; }
  if (!v.valid) { box.innerHTML = resetProblem(v.message); return; }
  const slug = v.team;
  box.innerHTML = `<h3>Choose a new password</h3><div class="hint">Resetting the recruiting password for <b>${esc(v.label)}</b>. The link expires ${esc(X.fmtDate(v.expiresAt))}.</div>
    <label>Franchise login</label><div class="rc-teamsel">${slug ? `<img src="${X.logo(slug)}" alt="">` : ''}<code class="rc-em-login">${esc(v.loginId)}</code></div>
    <label>New password (8+ characters)</label><div class="rc-field"><input class="rc-input" id="rc-reset-pw" type="password" autocomplete="new-password" data-rc-enter="doreset"></div>
    <label>Confirm new password</label><div class="rc-field"><input class="rc-input" id="rc-reset-pw2" type="password" autocomplete="new-password"></div>
    <div class="rc-err" id="rc-reset-err"></div>
    <div class="actions"><button class="rc-btn primary" data-rc="doreset">Save password &amp; sign in</button><a class="rc-btn ghost" href="#/recruiting">Cancel</a></div>
    <p class="rc-note" style="margin-top:18px">Saving signs out every device that was signed in to this franchise, unlocks the login, and emails a confirmation to the coach.</p>`;
  const pw = $('#rc-reset-pw'); pw?.focus();
  $$('#rc-reset input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ACTIONS.doreset(); }));
}
const resetProblem = msg => `<h3>Reset password</h3><div class="hint">${esc(msg)}</div><div class="actions"><button class="rc-btn primary" data-rc="forgot">Email me a new link</button><a class="rc-btn ghost" href="#/recruiting">Back to the board</a></div>`;

function forgotModal() {
  const teams = X.S.state?.teams || [];
  const cur = $('#rc-login-team')?.value || '';
  X.modal(`<div class="rc-mhead"><div><h3>Forgot password</h3><div class="m"><span>We'll email a reset link to the coach on file</span></div></div><button class="x" data-rc="close">×</button></div>
    <div class="rc-mbody" id="rc-forgot-body"><div class="rc-form"><div class="full"><label>Franchise</label><select id="rc-forgot-team">${teams.map(t => `<option value="${esc(t.abbr)}" ${t.abbr === cur ? 'selected' : ''}>${esc(t.name)} ${esc(t.nickname || '')}</option>`).join('')}<option value="COMMISSIONER" ${cur === 'COMMISSIONER' ? 'selected' : ''}>— Commissioner —</option></select></div></div>
    <p class="rc-note" style="margin-top:12px">If the franchise has a coach email on file, a single-use link valid for 60 minutes is sent from the league's no-reply mailbox. CPU franchises have no email — ask your commissioner instead.</p>
    <div class="rc-err" id="rc-forgot-err"></div>
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doforgot">Send reset link</button></div></div>`, 'sm');
}

/* ------------------------------------------------------------ composer */
const C = { tab: 'compose', rcpt: 'humans', picked: new Set(), subject: '', body: '', preview: null, status: null };
async function teamsForAdmin() {
  if (!X.S.adminData?.teams) { const t = await X.api('/admin/teams'); X.S.adminData = { ...(X.S.adminData || {}), teams: t.teams }; }
  return X.S.adminData.teams;
}
function selection(teams) {
  const chosen = C.rcpt === 'all' ? teams : C.rcpt === 'humans' ? teams.filter(t => !t.cpu) : C.rcpt === 'cpu' ? teams.filter(t => t.cpu) : teams.filter(t => C.picked.has(t.slug));
  const to = chosen.filter(t => !t.cpu && t.coachEmail);
  return { to, cpu: chosen.filter(t => t.cpu).length, noEmail: chosen.filter(t => !t.cpu && !t.coachEmail) };
}
function countLine(teams) {
  const s = selection(teams);
  return `<b>${s.to.length}</b> coach${s.to.length === 1 ? '' : 'es'} will get an individual copy${s.cpu ? ` · ${s.cpu} CPU team${s.cpu > 1 ? 's' : ''} skipped (no email)` : ''}${s.noEmail.length ? ` · <span class="rc-em-warn">${s.noEmail.length} without an email: ${s.noEmail.map(t => esc(t.abbr)).join(', ')}</span>` : ''}`;
}
async function openComposer(tab) {
  if (tab) C.tab = tab;
  const teams = await teamsForAdmin();
  C.status = await X.api('/admin/email/status', { silent: true });
  drawComposer(teams);
}
function composerHead() {
  const st = C.status;
  return `<div class="rc-mhead"><div><h3>Email coaches</h3><div class="m"><span>From ${esc(st?.config?.fromName || 'PCFL Network (no-reply)')} &lt;${esc(st?.config?.user || 'pcfl2k@gmail.com')}&gt;</span>${st ? `<span>${statusChip(st)}</span>` : ''}</div></div><button class="x" data-rc="close">×</button></div>`;
}
function drawComposer(teams) {
  const st = C.status;
  const tabs = `<div class="rc-em-tabs">${[['compose', 'Compose'], ['outbox', 'Outbox & history'], ['settings', 'Mail status']].map(([k, l]) => `<button class="${C.tab === k ? 'on' : ''}" data-rc="emtab:${k}">${l}</button>`).join('')}</div>`;
  const warn = st && st.mode !== 'ready' ? `<div class="rc-em-banner">${esc(st.message)}</div>` : '';
  let body = '';
  if (C.tab === 'compose') {
    const chip = (k, l) => `<button class="rc-chip ${C.rcpt === k ? 'on' : ''}" data-rc="emrcpt:${k}">${l}</button>`;
    body = `<h4>Recipients</h4><div class="rc-em-chips">${chip('humans', 'All human coaches')}${chip('all', 'All franchises')}${chip('cpu', 'CPU teams')}${chip('pick', 'Pick teams…')}</div>
      ${C.rcpt === 'pick' ? `<div class="rc-em-pick">${teams.map(t => `<label class="${t.cpu || !t.coachEmail ? 'off' : ''}"><input type="checkbox" data-rcc="empick:${t.slug}" ${C.picked.has(t.slug) ? 'checked' : ''}><img src="${X.logo(t.slug)}" alt=""><span><b>${esc(t.name)}</b><small>${t.cpu ? 'CPU · no email' : t.coachEmail ? esc(t.coachFirstName || 'Coach') : 'no email'}</small></span></label>`).join('')}</div>` : ''}
      <div class="rc-note rc-em-count" id="rc-em-count">${countLine(teams)}</div>
      <div class="rc-form" style="margin-top:12px"><div class="full"><label>Subject</label><input id="rc-em-subj" maxlength="150" value="${esc(C.subject)}" data-rci="emdraft" placeholder="Round 1 opens Friday at 8pm ET"></div>
      <div class="full"><label>Message (plain text)</label><textarea id="rc-em-body" rows="9" maxlength="10000" data-rci="emdraft" placeholder="Coaches,&#10;&#10;…">${esc(C.body)}</textarea></div></div>
      <p class="rc-note">Each coach gets their own copy greeted by first name, in the PCFL template with an "Open the Recruitment Center" button. A blank line starts a new paragraph; links become clickable. Every message ends with: <i>${esc(NOTICE)}</i></p>
      <div class="rc-err" id="rc-em-err"></div>
      <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn" data-rc="empreview">Preview</button><button class="rc-btn primary" data-rc="emsend">Send</button></div>`;
  } else if (C.tab === 'preview' && C.preview) {
    const p = C.preview;
    body = `<h4>Preview · as ${esc(p.recipients[0]?.name || 'Coach')} will see it</h4><iframe class="rc-em-frame" sandbox="" title="Email preview"></iframe>
      <h4>Recipients (${p.count})</h4><div class="rc-note">${p.recipients.map(r => `${esc(r.name || 'Coach')} · ${esc(r.teamName)} &lt;${esc(r.address)}&gt;`).join('<br>') || 'Nobody — no selected franchise has a coach email.'}${p.skipped.cpu ? `<br><i>${p.skipped.cpu} CPU team(s) skipped.</i>` : ''}${p.skipped.noEmail.length ? `<br><i>No email on file: ${p.skipped.noEmail.map(s => esc(teamName(s))).join(', ')}.</i>` : ''}</div>
      <div class="rc-err" id="rc-em-err"></div>
      <div class="rc-mactions"><button class="rc-btn ghost" data-rc="emtab:compose">← Edit</button><button class="rc-btn primary" data-rc="emsend" ${p.count ? '' : 'disabled'}>Send to ${p.count} coach${p.count === 1 ? '' : 'es'}</button></div>`;
  } else if (C.tab === 'outbox') {
    body = `<div id="rc-em-outbox"><div class="rc-empty">Loading…</div></div>`;
  } else {
    const c = st?.config || {};
    body = st ? `<table class="rc-adm"><tr><td>Status</td><td>${statusChip(st)} <span class="rc-note">${esc(st.message)}</span></td></tr>
      <tr><td>Sending account</td><td>${esc(c.fromName)} &lt;${esc(c.user)}&gt;</td></tr>
      <tr><td>Server</td><td><code>${esc(c.host)}:${esc(c.port)}</code> <span class="rc-note">${esc(String(c.secure).toUpperCase())}</span></td></tr>
      <tr><td>App password</td><td>${c.passwordSet ? '<span class="rc-status ACTIVE">set on server</span>' : '<span class="rc-status PAUSED">not set (SMTP_PASS)</span>'}</td></tr>
      <tr><td>Links point to</td><td><code>${esc(c.siteUrl)}</code></td></tr>
      <tr><td>Commissioner email</td><td>${st.commissionerEmailSet ? 'on file (commissioner team coach)' : '<span class="rc-em-warn">none — commissioner resets cannot be emailed</span>'}</td></tr>
      <tr><td>Volume</td><td>${st.sentLastHour}/${st.limits.perHour} this hour · ${st.sentLastDay}/${st.limits.perDay} today · ${st.limits.perRecipientHour}/hour per coach</td></tr>
      <tr><td>Queue</td><td>${st.counts.queued} queued · ${st.counts.sent} sent · ${st.counts.failed} failed</td></tr>
      <tr><td>Last delivery</td><td>${fmt(st.sender.lastSentAt)}${st.sender.lastError ? ` <span class="rc-em-warn">last error: ${esc(st.sender.lastError)}</span>` : ''}</td></tr>
      <tr><td>Last test</td><td id="rc-em-lasttest">${st.lastTest ? `${st.lastTest.ok ? '✓' : '✕'} ${esc(st.lastTest.message)} <span class="rc-note">${fmt(st.lastTest.at)}</span>` : '—'}</td></tr></table>
      <p class="rc-note" style="margin-top:10px">Test connection signs in to the mail server and disconnects without sending anything. The app password is configured on the server only and is never shown here.</p>
      <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Close</button><button class="rc-btn dark" data-rc="emailtest">Test connection</button></div>` : '<div class="rc-empty">Mail status unavailable.</div>';
  }
  X.modal(composerHead() + `<div class="rc-mbody">${tabs}${warn}${body}</div>`, 'lg');
  if (C.tab === 'preview' && C.preview) { const f = $('.rc-em-frame'); if (f) f.srcdoc = C.preview.html; }
  if (C.tab === 'outbox') loadOutbox();
}
async function loadOutbox() {
  const box = $('#rc-em-outbox'); if (!box) return;
  const o = await X.api('/admin/email/outbox?limit=150', { silent: true });
  if (!o) { box.innerHTML = '<div class="rc-empty">Outbox unavailable.</div>'; return; }
  const st = s => `<span class="rc-status ${s === 'sent' ? 'ACTIVE' : s === 'failed' ? 'LOCKED' : 'PAUSED'}">${esc(s.toUpperCase())}</span>`;
  box.innerHTML = `<h4>Commissioner messages</h4>${o.batches.length ? `<table class="rc-adm"><thead><tr><th>Sent</th><th>Subject</th><th class="n">Coaches</th><th class="n">Delivered</th><th class="n">Waiting</th><th class="n">Failed</th></tr></thead><tbody>${o.batches.map(b => `<tr><td>${fmt(b.createdAt)}</td><td>${esc(b.subject)}</td><td class="n">${b.total}</td><td class="n">${b.sent}</td><td class="n">${b.queued}</td><td class="n">${b.failed ? `<b class="rc-em-warn">${b.failed}</b>` : 0}</td></tr>`).join('')}</tbody></table>` : '<div class="rc-empty">No commissioner messages yet.</div>'}
    <h4>All outgoing mail</h4>${o.messages.length ? `<div class="rc-tablewrap"><table class="rc-adm"><thead><tr><th>Queued</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th><th>Detail</th><th></th></tr></thead><tbody>${o.messages.map(m => `<tr><td>${fmt(m.createdAt)}</td><td>${esc(KIND_LABEL[m.kind] || m.kind)}</td><td>${m.team ? `<img src="${X.logo(m.team)}" alt="">` : ''}${esc(m.toName || '')} <span class="rc-note">${esc(m.to)}</span></td><td>${esc(m.subject)}</td><td>${st(m.status)}</td><td class="rc-note">${m.status === 'sent' ? fmt(m.sentAt) : esc(m.lastError || (m.attempts ? `${m.attempts} attempt(s)` : 'waiting'))}</td><td>${m.status === 'failed' && !m.sensitive ? `<button class="rc-btn sm ghost" data-rc="emretry:${m.id}">Retry</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="rc-empty">Nothing has been queued yet.</div>'}
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Close</button><button class="rc-btn" data-rc="emtab:outbox">Refresh</button></div>`;
}
function readDraft() { C.subject = $('#rc-em-subj')?.value ?? C.subject; C.body = $('#rc-em-body')?.value ?? C.body; }
const recipientsPayload = () => C.rcpt === 'pick' ? [...C.picked] : C.rcpt;

/* ------------------------------------------------------------ admin flows */
async function doProvision(mode) {
  const email = !!$('#rc-prov-email')?.checked;
  if (!email) return ACTIONS._origProvision(mode);
  if (mode === 'reset' && !confirm('Reset every franchise password, sign everyone out, and email each coach the new temporary password?')) return;
  try {
    const out = await X.api('/admin/teams/provision', { method: 'POST', body: { reset: mode === 'reset', email: true } });
    X.closeModal();
    const e = out.emailed || { queued: 0, skipped: { cpu: 0, noEmail: [] } };
    X.toast('✓ Passwords issued', `${out.issued.length} logins updated · ${e.queued} emailed${e.skipped.cpu ? ` · ${e.skipped.cpu} CPU skipped` : ''}${e.skipped.noEmail.length ? ` · no email: ${e.skipped.noEmail.map(teamName).join(', ')}` : ''}`, 'ok', 9000);
    X.draw();
  } catch (err) { X.toast('Not issued', err.message, 'err'); }
}
function resetPw(slug) {
  const t = (X.S.adminData?.teams || []).find(x => x.slug === slug) || {};
  const canEmail = !t.cpu && !!t.coachEmail && !X.S.demo;
  X.modal(`<div class="rc-mhead"><div><h3>Reset password · ${esc(teamName(slug))}</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody">
    <p>Issues a new temporary password, signs the franchise out everywhere and forces a password change at next sign-in.</p>
    <label class="rc-em-check"><input type="checkbox" id="rc-reset-email" ${canEmail ? 'checked' : 'disabled'}> Email it to ${canEmail ? `${esc(t.coachFirstName || 'the coach')} &lt;${esc(t.coachEmail)}&gt;` : `the coach <span class="rc-note">(${t.cpu ? 'CPU franchise' : 'no email on file'})</span>`}</label>
    <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doresetpw:${slug}">Reset password</button></div></div>`, 'sm');
}

/* ------------------------------------------------------------ actions */
const ACTIONS = {
  forgot: () => forgotModal(),
  doforgot: async (_, el) => {
    const id = $('#rc-forgot-team')?.value; const errEl = $('#rc-forgot-err');
    el.disabled = true;
    try {
      const out = await authPost('/auth/forgot', { loginId: id });
      $('#rc-forgot-body').innerHTML = `<div class="rc-em-sent">✉</div><p style="text-align:center">${esc(out.message)}</p><p class="rc-note" style="text-align:center">Check spam/junk too — it comes from <b>pcfl2k@gmail.com</b>. That mailbox is unmonitored; don't reply to it.</p><div class="rc-mactions"><button class="rc-btn primary" data-rc="close">Done</button></div>`;
    } catch (e) { if (errEl) errEl.textContent = e.message; el.disabled = false; }
  },
  doreset: async () => {
    const p1 = $('#rc-reset-pw')?.value || '', p2 = $('#rc-reset-pw2')?.value || '', errEl = $('#rc-reset-err');
    if (p1.length < 8) { errEl.textContent = 'New password must be at least 8 characters.'; return; }
    if (p1 !== p2) { errEl.textContent = 'Passwords do not match.'; return; }
    const btn = $('#rc-reset [data-rc="doreset"]'); if (btn) btn.disabled = true;
    try {
      const out = await authPost('/auth/reset', { token: X.S.resetToken, newPassword: p1 });
      X.S.resetToken = null; try { sessionStorage.removeItem(RESET_KEY); } catch {}
      X.S.token = out.token; localStorage.setItem(X.TOKEN_KEY, out.token); X.S.sessionLost = null; X.S.forcePw = false;
      await X.loadState(); X.connectSSE();
      X.toast('✓ Password reset', out.team ? `Signed in as ${teamName(out.team)}. Other devices were signed out.` : 'Signed in as commissioner.', 'ok', 7000);
      X.S.view = out.role === 'commissioner' ? 'admin' : 'board'; X.nav(X.S.view === 'board' ? '' : X.S.view); X.draw();
    } catch (e) { errEl.textContent = e.message; if (btn) btn.disabled = false; }
  },
  emailcompose: () => { C.preview = null; openComposer('compose').catch(e => X.toast('Email unavailable', e.message, 'err')); },
  emtab: tab => { readDraft(); openComposer(tab).catch(e => X.toast('Email unavailable', e.message, 'err')); },
  emrcpt: k => { readDraft(); C.rcpt = k; drawComposer(X.S.adminData.teams); },
  empick: (slug, el) => { el.checked ? C.picked.add(slug) : C.picked.delete(slug); const c = $('#rc-em-count'); if (c) c.innerHTML = countLine(X.S.adminData.teams); },
  emdraft: () => readDraft(),
  empreview: async () => {
    readDraft(); const errEl = $('#rc-em-err');
    try { C.preview = await X.api('/admin/email/preview', { method: 'POST', body: { recipients: recipientsPayload(), subject: C.subject, body: C.body } }); C.tab = 'preview'; drawComposer(X.S.adminData.teams); }
    catch (e) { if (errEl) errEl.textContent = e.message; }
  },
  emsend: async (_, el) => {
    readDraft(); const errEl = $('#rc-em-err');
    const n = selection(X.S.adminData.teams).to.length;
    if (!confirm(`Send "${C.subject}" to ${n} coach${n === 1 ? '' : 'es'}?`)) return;
    el.disabled = true;
    try {
      const out = await X.api('/admin/email', { method: 'POST', body: { recipients: recipientsPayload(), subject: C.subject, body: C.body } });
      X.toast('✓ Message queued', `${out.queued} coach${out.queued === 1 ? '' : 'es'}${out.skipped.cpu ? ` · ${out.skipped.cpu} CPU skipped` : ''}${out.mail !== 'ready' ? ' · mail is not sending yet — see Mail status' : ''}`, out.mail === 'ready' ? 'ok' : 'info', 8000);
      C.subject = ''; C.body = ''; C.preview = null; C.tab = 'outbox'; openComposer();
    } catch (e) { if (errEl) errEl.textContent = e.message; el.disabled = false; }
  },
  emretry: async id => { try { await X.api(`/admin/email/outbox/${id}/retry`, { method: 'POST', body: {} }); X.toast('Queued again', '', 'ok'); loadOutbox(); } catch (e) { X.toast('Not retried', e.message, 'err'); } },
  emailtest: async (_, el) => {
    if (el) { el.disabled = true; el.textContent = 'Testing…'; }
    try {
      const out = await X.api('/admin/email/test', { method: 'POST', body: {} });
      X.toast(out.ok ? '✓ Mail server connection OK' : 'Mail connection failed', out.message, out.ok ? 'ok' : 'err', 10000);
      const lt = $('#rc-em-lasttest'); if (lt) lt.innerHTML = `${out.ok ? '✓' : '✕'} ${esc(out.message)}`;
    } catch (e) { X.toast('Test failed', e.message, 'err'); }
    if (el) { el.disabled = false; el.textContent = 'Test connection'; }
  },
  emaillogin: slug => {
    const t = (X.S.adminData?.teams || []).find(x => x.slug === slug); if (!t) return;
    const what = t.tempPassword ? 'their current temporary password (not used yet)' : t.provisioned ? 'a login reminder — their login id and how to reset a forgotten password (passwords they chose are never emailed)' : 'a new temporary password (none has been issued yet)';
    X.modal(`<div class="rc-mhead"><div><h3>Email login · ${esc(t.name)}</h3></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody">
      <p>Sends ${esc(t.coachFirstName || 'the coach')} &lt;${esc(t.coachEmail)}&gt; ${what}.</p>
      ${t.provisioned ? `<label class="rc-em-check"><input type="checkbox" id="rc-el-reset"> Reset the password first and email a new temporary password <span class="rc-note">(signs the franchise out)</span></label>` : ''}
      <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doemaillogin:${slug}">Send email</button></div></div>`, 'sm');
  },
  doemaillogin: async slug => {
    try {
      const out = await X.api(`/admin/teams/${slug}/email-login`, { method: 'POST', body: { reset: !!$('#rc-el-reset')?.checked } });
      X.closeModal(); X.toast('✓ Email queued', `${teamName(slug)}: ${out.kind === 'reminder' ? 'login reminder' : 'temporary password'}${out.reset ? ' (password reset)' : ''}${out.mail !== 'ready' ? ' · mail is not sending yet' : ''}`, 'ok', 7000);
      if (out.reset) X.draw();
    } catch (e) { X.toast('Not sent', e.message, 'err'); }
  },
  editcoach: slug => {
    const t = (X.S.adminData?.teams || []).find(x => x.slug === slug); if (!t) return;
    X.modal(`<div class="rc-mhead"><div><h3>Coach · ${esc(t.name)}</h3><div class="m"><span>First name is public; email is private (coaches + commissioner only)</span></div></div><button class="x" data-rc="close">×</button></div><div class="rc-mbody">
      <div class="rc-form"><div><label>Coach first name</label><input id="rc-ec-name" maxlength="40" value="${esc(t.coachFirstName || '')}"></div>
      <div class="full"><label>Coach email</label><input id="rc-ec-email" type="email" maxlength="254" value="${esc(t.coachEmail || '')}" placeholder="coach@example.com"></div>
      <div><label>Controlled by</label><select id="rc-ec-cpu"><option value="0" ${t.cpu ? '' : 'selected'}>Human coach</option><option value="1" ${t.cpu ? 'selected' : ''}>CPU (commissioner bids)</option></select></div></div>
      <p class="rc-note" style="margin-top:10px">Marking a franchise CPU makes it OPEN so the commissioner can bid for it with ACT AS TEAM; CPU franchises never receive email.</p>
      <div class="rc-err" id="rc-ec-err"></div>
      <div class="rc-mactions"><button class="rc-btn ghost" data-rc="close">Cancel</button><button class="rc-btn primary" data-rc="doeditcoach:${slug}">Save</button></div></div>`, 'sm');
  },
  doeditcoach: async slug => {
    const errEl = $('#rc-ec-err');
    try {
      await X.api(`/admin/teams/${slug}/coach`, { method: 'PATCH', body: { coachFirstName: $('#rc-ec-name').value, email: $('#rc-ec-email').value, cpu: $('#rc-ec-cpu').value === '1' } });
      X.closeModal(); X.toast('✓ Coach updated', teamName(slug), 'ok'); X.draw();
    } catch (e) { if (errEl) errEl.textContent = e.message; }
  },
  doresetpw: async slug => {
    const email = !!$('#rc-reset-email')?.checked;
    try {
      const out = await X.api(`/admin/teams/${slug}/password/reset`, { method: 'POST', body: { email } });
      X.closeModal();
      X.toast('✓ Password reset', `${out.loginId}: ${out.tempPassword}${email ? (out.emailed?.queued ? ' · emailed to the coach' : ' · not emailed (no coach email)') : ''}`, 'ok', 12000);
      X.draw();
    } catch (e) { X.toast('Not reset', e.message, 'err'); }
  },
};
