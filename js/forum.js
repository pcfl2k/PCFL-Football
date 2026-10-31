/* PCFL Forum: coaches-only message board.
   Loaded on demand from the #/forum route. It shares the Recruitment Center sign-in (same stored
   token, same team dropdown) but talks to its own small service, so nothing here can touch
   recruiting. Every piece of user text goes through esc() or renderPost(). */
const HOSTED_API = 'https://pcfl-forum.153.75.235.217.sslip.io/api/forum/v1';
const HOSTED_RECRUITING = 'https://gziar743eun6mwqbrwxjinxc.153.75.235.217.sslip.io/api/recruiting/v1';
const TOKEN_KEY = 'pcfl-rc-token';   // the Recruitment Center's sign-in: one login for both
const DRAFT_KEY = 'pcfl-fm-draft:';
const RE_EMOJI = ['👍', '🔥', '😂', '🏈', '💯', '👎'];
const KIND_LABEL = { 1: 'Sticky', 2: 'Announcement', 3: 'Global' };
const LIST_TITLE = { new: 'New posts', active: 'Active topics', unanswered: 'Unanswered topics', mine: 'Your posts' };

const S = { X: null, me: null, board: [], footer: null, bound: false, poll: null, ctx: null, composerOpen: false };
const api = () => window.PCFL_FORUM?.apiBase || HOSTED_API;
const rcApi = () => window.PCFL_RECRUITING?.apiBase || HOSTED_RECRUITING;
const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = h => { if (location.hash === h) route(); else location.hash = h; };

/* ------------------------------------------------------------ post formatting
   The text is escaped first, so nothing a coach types can become HTML. Only the fixed tags below
   are turned back into markup, and links must be http(s). */
const URL_OK = /^https?:\/\/[^\s<>]+$/i;
const ytId = u => (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?(?:[^\s]*&amp;)?v=|youtu\.be\/)([\w-]{11})(?:[?&#][^\s]*)?$/i.exec(u) || [])[1];
export function renderPost(text) {
  const keep = []; const hold = html => { keep.push(html); return `\u0001${keep.length - 1}\u0001`; };
  let s = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, c => (c === '\r' ? '' : ' '));
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, c) => hold(`<pre class="fm-code">${esc(c.replace(/^\n/, ''))}</pre>`));
  s = esc(s);
  s = s.replace(/\[img\]([^\[\]\s]+)\[\/img\]/gi, (m, u) => (/^https:\/\//i.test(u) && URL_OK.test(u) ? hold(`<a href="${u}" target="_blank" rel="noopener noreferrer"><img class="fm-img" src="${u}" alt="Posted image" loading="lazy" referrerpolicy="no-referrer"></a>`) : m));
  s = s.replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => (URL_OK.test(u) ? `${hold(`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">`)}${t}${hold('</a>')}` : m));
  s = s.replace(/\[url\]([^\[\]\s]+)\[\/url\]/gi, (m, u) => (URL_OK.test(u) ? hold(`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`) : m));
  s = s.replace(/(^|\n)[ \t]*(https?:\/\/[^\s<>]+)[ \t]*(?=\n|$)/gi, (m, pre, u) => { const id = ytId(u); return id ? `${pre}${hold(`<div class="fm-yt"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`)}` : m; });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>\u0001]+)/gi, (m, pre, u) => { const tail = /[.,!?:;)]+$/.exec(u)?.[0] || ''; const core = tail ? u.slice(0, -tail.length) : u; return `${pre}${hold(`<a href="${core}" target="_blank" rel="noopener noreferrer nofollow">${core}</a>`)}${tail}`; });
  for (const [tag, el] of [['b', 'strong'], ['i', 'em'], ['u', 'u'], ['s', 's']]) for (let i = 0; i < 4; i++) s = s.replace(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'gi'), `<${el}>$1</${el}>`);
  s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, body) => { const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean); return hold(`<ul class="fm-ul">${items.map(i => `<li>${i.replace(/\n/g, '<br>')}</li>`).join('')}</ul>`); });
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\[quote(?:=&quot;([^\]]{1,60}?)&quot;)?\]((?:(?!\[quote)[\s\S])*?)\[\/quote\]/i, (_, who, body) => `\u0002${hold(`<blockquote class="fm-quote">${who ? `<cite>${who} wrote</cite>` : ''}<div>${body.trim().replace(/\n/g, '<br>')}</div></blockquote>`)}\u0002`);
    if (next === s) break; s = next;
  }
  s = s.replace(/\u0002\n?/g, '').replace(/\n/g, '<br>');
  for (let guard = 0; guard < 8 && s.includes('\u0001'); guard++) s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i] ?? '');
  return s;
}

/* ------------------------------------------------------------ server calls */
async function call(path, { method = 'GET', body } = {}) {
  let res;
  try { res = await fetch(api() + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch { const e = new Error('Cannot reach the forum right now. Check your connection and try again.'); e.code = 'NETWORK'; throw e; }
  const fresh = res.headers.get('x-pcfl-token');
  if (fresh) { try { localStorage.setItem(TOKEN_KEY, fresh); } catch {} }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || `Request failed (${res.status})`); e.code = j.error?.code || `HTTP_${res.status}`; e.status = res.status; throw e; }
  return j;
}
const SIGNED_OUT = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'TOKEN_INVALID', 'ACCOUNT_LOCKED']);

/* ------------------------------------------------------------ small UI helpers */
const root = () => $('#fm-root');
const T = slug => S.X.T(slug);
const logo = slug => S.X.logo(slug);
const fullDate = iso => { if (!iso) return ''; const d = new Date(iso); const day = d.toLocaleDateString('en-US', { weekday: 'short' }), mon = d.toLocaleDateString('en-US', { month: 'short' }); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${day} ${mon} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`; };
const coachLine = (team, author) => `<img class="fm-mini" src="${logo(team)}" alt=""><b>${esc(author)}</b><span class="fm-dim"> · ${esc(T(team).name)}</span>`;
const isComm = team => team && team === S.footer?.commissionerTeam;
function toast(title, msg = '', kind = 'ok') {
  let h = $('.fm-toasts'); if (!h) { h = document.createElement('div'); h.className = 'fm-toasts'; document.body.appendChild(h); }
  const el = document.createElement('div'); el.className = `fm-toast ${kind}`; el.innerHTML = `<b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}`; h.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 4000);
}
/** In-page confirmation (native dialogs are suppressed in some browsers and in-app web views). */
function ask(message, { title = 'Please confirm', ok = 'Confirm' } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'rc-overlay';
    ov.innerHTML = `<div class="rc-modal sm" role="alertdialog" aria-modal="true"><div class="rc-mhead"><div><h3>${esc(title)}</h3></div></div><div class="rc-mbody"><p>${esc(message)}</p><div class="rc-mactions"><button class="rc-btn ghost" data-ask="0">Cancel</button><button class="rc-btn primary" data-ask="1">${esc(ok)}</button></div></div></div>`;
    const done = v => { ov.remove(); resolve(v); };
    ov.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-ask]'); if (b) done(b.dataset.ask === '1'); else if (e.target === ov) done(false); });
    document.body.appendChild(ov); ov.querySelector('[data-ask="1"]').focus();
  });
}
function pager(page, pages, base) {
  if (pages <= 1) return '';
  const link = p => `<a class="${p === page ? 'on' : ''}" href="${base}${base.includes('?') ? '&' : '?'}page=${p}">${p}</a>`;
  const nums = []; for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 2) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<nav class="fm-pager" aria-label="Pages">${nums.map(n => (n === '…' ? '<span>…</span>' : link(n))).join('')}</nav>`;
}
function errorCard(e) {
  return `<div class="card fm-empty"><b>${e.code === 'BANNED' ? 'Forum access removed' : 'That did not load'}</b><p>${esc(e.message)}</p>${e.code === 'BANNED' ? '' : '<a class="rc-btn" href="#/forum">Back to Forum Home</a>'}</div>`;
}

/* ------------------------------------------------------------ page frame */
function crumbs(items) {
  const parts = [`<a href="#/">PCFL</a>`, `<a href="#/forum">Forum Home</a>`, ...items];
  return `<div class="fm-crumbs">${parts.map((p, i) => (i ? `<span class="sep">‹</span>` : '') + p).join('')}</div>`;
}
function frame(inner, items = []) {
  const m = S.me;
  return `<section class="fm-head"><div class="fm-title"><h1>PCFL Forum</h1><p>The league office for PCFL head coaches</p></div>
    <form class="fm-search" data-fmform="search"><input name="q" type="search" placeholder="Search the forum…" aria-label="Search the forum"><button class="rc-btn sm" type="submit">Search</button></form>
    <div class="fm-user"><img src="${logo(m.team)}" alt=""><div><b>${esc(m.name)}</b><span>${esc(m.teamName)}${m.admin ? ' · Commissioner' : ''}</span></div><button class="fm-link" data-fm="signout">Sign out</button></div></section>
  <nav class="fm-bar">${crumbs(items)}<div class="fm-quick"><a href="#/forum/list/new">New posts</a><a href="#/forum/list/active">Active</a><a href="#/forum/list/unanswered">Unanswered</a><a href="#/forum/list/mine">Your posts</a><a href="#/forum/members">Members</a>${m.admin ? '<a class="fm-admin" href="#/forum/admin">Admin</a>' : ''}</div></nav>
  ${m.mustChangePw ? `<div class="fm-notice">Your team is still on a temporary password. <a href="#/recruiting">Set your own in the Recruitment Center.</a></div>` : ''}
  ${inner}
  <div id="fm-footer">${footerHTML()}</div>`;
}
function footerHTML() {
  const f = S.footer; if (!f) return '';
  const o = f.online, s = f.stats, teams = o.teams;
  return `<section class="card fm-who"><h2>Who is online</h2>
    <div class="fm-online">${teams.length ? teams.map(t => `<a href="#/teams/${esc(t)}" class="fm-onteam ${isComm(t) ? 'comm' : ''}" title="${esc(f.coaches?.[t] || '')}${f.coaches?.[t] ? ' · ' : ''}${esc(T(t).name)}"><img src="${logo(t)}" alt="${esc(T(t).name)}"></a>`).join('') : '<span class="fm-dim">No coaches online</span>'}</div>
    <p>In total there ${o.total === 1 ? 'is' : 'are'} <b>${o.total}</b> user${o.total === 1 ? '' : 's'} online :: ${o.registered} registered, ${o.hidden} hidden and ${o.guests} guests (based on users active over the past ${o.windowMinutes} minutes)<br>Most users ever online was <b>${o.record.count}</b>${o.record.at ? ` on ${fullDate(o.record.at)}` : ''}</p>
    <p>Registered users: ${teams.length ? teams.map(t => `<span class="${isComm(t) ? 'fm-comm' : ''}">${esc(f.coaches?.[t] || T(t).name)} - ${esc(T(t).abbr)}</span>`).join(', ') : 'No registered users'}<br>Legend: <span class="fm-comm">Commissioner</span>, Head coaches</p>
    <h2>Statistics</h2><p>Total posts <b>${s.posts}</b> • Total topics <b>${s.topics}</b> • Total members <b>${s.members}</b>${s.newestMember ? ` • Our newest member <b>${esc(f.coaches?.[s.newestMember] || T(s.newestMember).name)} - ${esc(T(s.newestMember).name)}</b>` : ''}</p></section>`;
}
async function refreshFooter() {
  try { S.footer = await call('/footer'); const f = $('#fm-footer'); if (f) f.innerHTML = footerHTML(); } catch (e) { if (SIGNED_OUT.has(e.code)) route(); }
}

/* ------------------------------------------------------------ sign-in */
async function loginView(msg) {
  let teams = [];
  try { teams = (await (await fetch(`${rcApi()}/state`, { signal: AbortSignal.timeout(8000) })).json()).teams || []; } catch {}
  if (!teams.length) { root().innerHTML = `<div class="card fm-empty"><b>Sign-in is unavailable</b><p>The team list could not be loaded. Try again in a moment.</p></div>`; return; }
  root().innerHTML = `<div class="card rc-login fm-login"><h3>PCFL Forum</h3><div class="hint">${esc(msg || 'The forum is for PCFL head coaches. Sign in with your franchise. Your Recruitment Center login works here.')}</div>
    <form data-fmform="login"><label for="fm-login-team">Team</label><div class="rc-teamsel"><img id="fm-login-logo" src="${logo(teams[0].slug)}" alt=""><select id="fm-login-team">${teams.map(t => `<option value="${esc(t.abbr)}" data-slug="${esc(t.slug)}">${esc(t.name)} ${esc(t.nickname)}</option>`).join('')}<option value="COMMISSIONER" data-slug="">— Commissioner —</option></select></div>
    <label for="fm-login-pw">Password</label><div class="rc-field"><input class="rc-input" id="fm-login-pw" type="password" autocomplete="current-password" placeholder="••••••••••••"></div>
    <div class="rc-err" id="fm-login-err"></div>
    <div class="actions"><button class="rc-btn primary" type="submit">Enter the Forum</button><a class="rc-btn ghost" href="#/">Return to PCFL</a></div></form>
    <p class="rc-note" style="margin-top:18px">Forgot your password? Use <a href="#/recruiting">the Recruitment Center sign-in</a> to reset it. Five failed attempts lock the franchise login.</p></div>`;
  $('#fm-login-team').addEventListener('change', e => { const slug = e.target.selectedOptions[0]?.dataset.slug; const img = $('#fm-login-logo'); if (slug) { img.src = logo(slug); img.style.visibility = ''; } else img.style.visibility = 'hidden'; });
  $('#fm-login-pw').focus();
}
async function doLogin(form) {
  const err = $('#fm-login-err'), btn = $('button[type=submit]', form); err.textContent = ''; btn.disabled = true;
  try {
    const res = await fetch(`${rcApi()}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: $('#fm-login-team').value, password: $('#fm-login-pw').value }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = j.error?.message || 'Sign-in failed.'; btn.disabled = false; return; }
    localStorage.setItem(TOKEN_KEY, j.token);
    route();
  } catch { err.textContent = 'The sign-in service could not be reached.'; btn.disabled = false; }
}

/* ------------------------------------------------------------ forum home */
function lastPostCell(l, emptyText = 'No posts') {
  if (!l) return `<div class="fm-last none">${emptyText}</div>`;
  return `<div class="fm-last"><a class="t" href="#/forum/t/${l.topicId}?post=${l.postId}">${esc(l.title)}</a><div class="by">by ${coachLine(l.team, l.author)}</div><div class="at">${fullDate(l.at)}</div></div>`;
}
function homeView() {
  const cats = S.board.map(c => `<section class="card fm-cat"><header class="fm-cathead"><h2>${esc(c.name)}</h2><span>Topics</span><span>Posts</span><span>Last post</span></header>
    ${c.forums.map(f => `<div class="fm-row ${f.unread ? 'unread' : ''}"><span class="fm-dot" title="${f.unread ? 'New posts' : 'No new posts'}"></span><div class="fm-main"><a class="n" href="#/forum/f/${f.id}">${esc(f.name)}</a>${f.locked ? '<span class="fm-tag">Locked</span>' : ''}${f.unread ? `<span class="fm-tag new">${f.unread} new</span>` : ''}<p>${esc(f.description)}</p>${c.name === 'Rules' || f.staffTopics ? `<p class="fm-mods">Moderator: <span class="fm-comm">${esc(S.footer?.coaches?.[S.footer?.commissionerTeam] || 'Commissioner')}</span></p>` : ''}</div><div class="fm-num"><b>${f.topics}</b><small>Topics</small></div><div class="fm-num"><b>${f.posts}</b><small>Posts</small></div>${lastPostCell(f.lastPost)}</div>`).join('') || '<div class="fm-empty-row">No forums yet.</div>'}</section>`).join('');
  return frame(`<div class="fm-now">It is currently ${fullDate(new Date().toISOString())} · <a href="#" data-fm="readall">Mark all forums read</a></div>${cats}`);
}

/* ------------------------------------------------------------ forum page */
function topicRow(t, extra = '') {
  return `<div class="fm-row fm-trow ${t.unread ? 'unread' : ''}"><span class="fm-dot ${t.locked ? 'lock' : ''}" title="${t.locked ? 'Locked' : t.unread ? 'New posts' : 'No new posts'}"></span><div class="fm-main">${t.kind ? `<span class="fm-tag pin">${KIND_LABEL[t.kind]}</span>` : ''}${t.locked ? '<span class="fm-tag">Locked</span>' : ''}<a class="n" href="#/forum/t/${t.id}">${esc(t.title)}</a><p>by ${coachLine(t.team, t.author)}<span class="fm-dim"> · ${fullDate(t.createdAt)}</span>${extra}</p></div><div class="fm-num"><b>${t.replies}</b><small>Replies</small></div><div class="fm-num"><b>${t.views}</b><small>Views</small></div>${lastPostCell(t.lastPost)}</div>`;
}
async function forumView(id, page) {
  const d = await call(`/forums/${+id}?page=${+page || 1}`), f = d.forum;
  const head = `<header class="fm-cathead fm-tophead"><h2>Topics</h2><span>Replies</span><span>Views</span><span>Last post</span></header>`;
  const newBtn = d.canPost ? `<a class="rc-btn primary" href="#/forum/new/${f.id}">New topic</a>` : `<span class="fm-dim">${f.locked ? 'This forum is locked.' : 'The commissioner posts new topics here. You can reply to any open topic.'}</span>`;
  const rows = [...d.pinned.map(t => topicRow(t)), ...d.topics.map(t => topicRow(t))].join('');
  return frame(`<div class="fm-pagehead"><div><h2>${esc(f.name)}</h2><p>${esc(f.description)}</p></div><div class="fm-actions">${newBtn}<button class="rc-btn ghost sm" data-fm="readforum:${f.id}">Mark read</button></div></div>
    <section class="card fm-cat">${head}${rows || '<div class="fm-empty-row">No topics yet. Be the first to post.</div>'}</section>${pager(d.page, d.pages, `#/forum/f/${f.id}`)}`, [`<a href="#/forum/f/${f.id}">${esc(f.name)}</a>`]);
}

/* ------------------------------------------------------------ composer */
function composer({ key, label, title, body = '', titleInput = false, admin = false, form, attrs = '' }) {
  let draft = ''; try { draft = localStorage.getItem(DRAFT_KEY + key) || ''; } catch {}
  return `<form class="card fm-compose" data-fmform="${form}" data-draft="${esc(key)}" ${attrs}>
    ${titleInput ? `<label>Subject<input name="title" maxlength="120" required value="${esc(title || '')}" placeholder="Topic title"></label>` : ''}
    <div class="fm-tools" role="toolbar" aria-label="Formatting">${[['b', 'B'], ['i', 'I'], ['u', 'U'], ['s', 'S']].map(([t, l]) => `<button type="button" data-fm="fmt:${t}" title="${t}">${l}</button>`).join('')}<button type="button" data-fm="fmt:quote">Quote</button><button type="button" data-fm="fmt:url">Link</button><button type="button" data-fm="fmt:img">Image</button><button type="button" data-fm="fmt:list">List</button><button type="button" data-fm="fmt:code">Code</button><span class="grow"></span><button type="button" data-fm="preview">Preview</button></div>
    <textarea name="body" rows="9" maxlength="20000" required placeholder="Write your post…">${esc(body || draft)}</textarea>
    <div class="fm-preview" hidden></div>
    ${admin ? `<div class="fm-opts"><label>Post as <select name="kind"><option value="0">Normal topic</option><option value="1">Sticky</option><option value="2">Announcement</option><option value="3">Global announcement</option></select></label><label class="chk"><input type="checkbox" name="locked"> Lock topic</label></div>` : ''}
    <div class="fm-actions"><span class="rc-err"></span><button class="rc-btn primary" type="submit">${esc(label)}</button></div></form>`;
}
const clearDraft = key => { try { localStorage.removeItem(DRAFT_KEY + key); } catch {} };
function wrapSel(ta, a, b, placeholder = '') {
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder;
  ta.setRangeText(`${a}${sel}${b}`, s, e, 'select'); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ------------------------------------------------------------ topic page */
function postHTML(p, i, d) {
  const num = (d.page - 1) * S.limits.postsPerPage + i + 1, comm = isComm(p.team);
  return `<article class="card fm-post" id="p${p.id}"><aside class="fm-author"><a href="#/teams/${esc(p.team)}"><img src="${logo(p.team)}" alt="${esc(T(p.team).name)}"></a><b class="${comm ? 'fm-comm' : ''}">${esc(p.author)}</b><span>${esc(T(p.team).name)}</span>${comm ? '<em>Commissioner</em>' : ''}<small>Posts: ${p.authorPosts}</small>${p.authorJoined ? `<small>Joined: ${new Date(p.authorJoined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</small>` : ''}</aside>
    <div class="fm-pbody"><div class="fm-phead"><a href="#/forum/t/${p.topicId}?post=${p.id}">${fullDate(p.createdAt)}</a><span>#${num}</span></div><div class="fm-content" data-raw="${esc(p.body)}">${renderPost(p.body)}</div>
      ${p.editedAt ? `<div class="fm-edited">Last edited by ${esc(p.editedBy)} on ${fullDate(p.editedAt)}${p.editCount > 1 ? `, edited ${p.editCount} times` : ''}</div>` : ''}
      <div class="fm-pfoot"><div class="fm-react">${(d.reactions || RE_EMOJI).map(e => `<button class="${p.myReactions.includes(e) ? 'mine' : ''} ${p.reactions[e] ? 'has' : ''}" data-fm="react:${p.id}:${e}" aria-label="React ${e}">${e}${p.reactions[e] ? ` <b>${p.reactions[e]}</b>` : ''}</button>`).join('')}</div>
      <div class="fm-pacts">${d.canReply ? `<button data-fm="quote:${p.id}" data-author="${esc(p.author)}">Quote</button>` : ''}${p.canEdit ? `<button data-fm="edit:${p.id}">Edit</button><button data-fm="delpost:${p.id}">Delete</button>` : ''}</div></div></div></article>`;
}
function topicAdminBar(t) {
  const forums = S.board.flatMap(c => c.forums);
  return `<div class="card fm-modbar"><b>Commissioner</b><button class="rc-btn sm" data-fm="tlock:${t.id}:${t.locked ? 0 : 1}">${t.locked ? 'Unlock' : 'Lock'}</button>
    <label>Type <select data-fmchange="tkind:${t.id}">${[[0, 'Normal'], [1, 'Sticky'], [2, 'Announcement'], [3, 'Global']].map(([k, l]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Move to <select data-fmchange="tmove:${t.id}">${forums.map(f => `<option value="${f.id}" ${f.id === t.forumId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <button class="rc-btn sm ghost rc-danger" data-fm="tdelete:${t.id}">Delete topic</button></div>`;
}
async function topicView(id, q) {
  const qs = q.get('post') ? `post=${+q.get('post')}` : `page=${+q.get('page') || 1}`;
  const d = await call(`/topics/${+id}?${qs}`), t = d.topic;
  S.current = { topicId: t.id };
  return frame(`<div class="fm-pagehead"><div><h2>${t.kind ? `<span class="fm-tag pin">${KIND_LABEL[t.kind]}</span>` : ''}${t.locked ? '<span class="fm-tag">Locked</span>' : ''}${esc(t.title)}</h2></div>${pager(d.page, d.pages, `#/forum/t/${t.id}`)}</div>
    ${S.me.admin ? topicAdminBar(t) : ''}<div class="fm-posts">${d.posts.map((p, i) => postHTML(p, i, d)).join('')}</div>${pager(d.page, d.pages, `#/forum/t/${t.id}`)}
    ${d.canReply ? `<h3 class="fm-replyh">Post a reply</h3>${composer({ key: `t${t.id}`, label: 'Submit reply', form: 'reply', attrs: `data-topic="${t.id}"` })}` : `<div class="fm-notice">This topic is locked.</div>`}`, [`<a href="#/forum/f/${d.forum.id}">${esc(d.forum.name)}</a>`, `<a href="#/forum/t/${t.id}">${esc(t.title)}</a>`]);
}
function newTopicView(fid) {
  const f = S.board.flatMap(c => c.forums).find(x => x.id === +fid);
  if (!f) throw Object.assign(new Error('That forum does not exist.'), { code: 'NOT_FOUND' });
  return frame(`<div class="fm-pagehead"><div><h2>New topic in ${esc(f.name)}</h2></div></div>${composer({ key: `f${f.id}`, label: 'Post topic', titleInput: true, admin: S.me.admin, form: 'topic', attrs: `data-forum="${f.id}"` })}`, [`<a href="#/forum/f/${f.id}">${esc(f.name)}</a>`]);
}
async function listView(view) {
  const d = await call(`/list/${encodeURIComponent(view)}`);
  return frame(`<div class="fm-pagehead"><div><h2>${esc(LIST_TITLE[view] || view)}</h2></div>${view === 'new' && d.topics.length ? '<button class="rc-btn ghost sm" data-fm="readall">Mark all read</button>' : ''}</div>
    <section class="card fm-cat"><header class="fm-cathead fm-tophead"><h2>Topics</h2><span>Replies</span><span>Views</span><span>Last post</span></header>${d.topics.map(t => topicRow(t, `<span class="fm-dim"> · in ${esc(t.forumName)}</span>`)).join('') || '<div class="fm-empty-row">Nothing here right now.</div>'}</section>`, [`<a href="#/forum/list/${esc(view)}">${esc(LIST_TITLE[view] || view)}</a>`]);
}
async function searchView(text) {
  const d = await call(`/search?q=${encodeURIComponent(text)}`);
  return frame(`<div class="fm-pagehead"><div><h2>Search: ${esc(d.query)}</h2><p>${d.results.length} result${d.results.length === 1 ? '' : 's'}${d.results.length === 50 ? ' (showing the newest 50)' : ''}</p></div></div>
    <section class="card fm-cat">${d.results.map(r => `<div class="fm-hit"><a class="n" href="#/forum/t/${r.topicId}?post=${r.postId}">${esc(r.title)}</a><p class="fm-snip">${esc(r.snippet)}</p><p>by ${coachLine(r.team, r.author)}<span class="fm-dim"> · ${esc(r.forumName)} · ${fullDate(r.at)}</span></p></div>`).join('') || '<div class="fm-empty-row">No posts matched.</div>'}</section>`, ['<span>Search</span>']);
}
async function membersView() {
  const d = await call('/members');
  const rows = [...d.members].sort((a, b) => b.posts - a.posts || T(a.team).name.localeCompare(T(b.team).name));
  return frame(`<div class="fm-pagehead"><div><h2>Members</h2><p>${rows.length} head coaches</p></div></div>
    <section class="card fm-members">${rows.map(m => `<a class="fm-member" href="#/teams/${esc(m.team)}"><img src="${logo(m.team)}" alt=""><div><b class="${m.commissioner ? 'fm-comm' : ''}">${esc(m.coach || '—')}</b><span>${esc(T(m.team).name)}${m.commissioner ? ' · Commissioner' : ''}</span></div><div class="fm-num"><b>${m.posts}</b><small>Posts</small></div><div class="fm-seen">${m.lastSeen ? `Last visit ${fullDate(m.lastSeen)}` : 'Has not visited yet'}</div></a>`).join('')}</section>`, ['<span>Members</span>']);
}

/* ------------------------------------------------------------ commissioner admin */
const bytes = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
async function adminView(tab = 'data') {
  if (!S.me.admin) throw Object.assign(new Error('Only the commissioner can open this page.'), { code: 'ADMIN_ONLY' });
  const tabs = [['data', 'Data upkeep'], ['boards', 'Boards'], ['members', 'Members'], ['bin', 'Removed posts'], ['log', 'Moderation log']];
  const nav = `<div class="fm-tabs">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/forum/admin/${k}">${l}</a>`).join('')}</div>`;
  const o = await call('/admin/overview');
  let body = '';
  if (tab === 'data') {
    const c = o.counts, st = o.storage, s = o.settings;
    body = `<section class="card fm-panel"><h3>Where the data lives</h3><p>Forum data is saved to the private GitHub repo <code>${esc(st.repo)}</code>, not on the server. Each new post is a small commit, and the repo's history doubles as a backup.</p>
      <div class="fm-stats">${[['Topics', c.topics], ['Posts', c.posts], ['In the bin', c.binTopics + c.binPosts], ['Read markers', c.readMarkers], ['Log rows', c.logRows], ['Data size', bytes(st.bytes)], ['Files', st.files], ['Unsaved', st.pending]].map(([l, v]) => `<div><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      <p class="fm-dim">Last save: ${st.lastCommitAt ? fullDate(st.lastCommitAt) : 'none since the last restart'}${o.oldestPost ? ` · Oldest post: ${fullDate(o.oldestPost)}` : ''}${o.lastUpkeepAt ? ` · Last auto-upkeep: ${fullDate(o.lastUpkeepAt)}` : ''}</p>${st.lastError ? `<div class="fm-notice bad">The last save to GitHub failed and will retry on its own: ${esc(st.lastError)}</div>` : ''}
      <div class="fm-actions left"><button class="rc-btn sm" data-fm="m:save-now">Save now</button><button class="rc-btn sm" data-fm="m:recount">Recount totals</button><button class="rc-btn sm" data-fm="export">Download everything (JSON)</button></div></section>
    <section class="card fm-panel"><h3>Prune old topics</h3><p>Permanently removes topics with no activity for a chosen time. Sticky, announcement and locked topics are kept unless you include them.</p>
      <form class="fm-inline" data-fmform="prune"><label>Older than <input name="days" type="number" min="30" value="365"> days</label><label>In <select name="forumId"><option value="">All forums</option>${S.board.flatMap(x => x.forums).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label><label class="chk"><input type="checkbox" name="includePinned"> Include pinned</label><label class="chk"><input type="checkbox" name="includeLocked"> Include locked</label><button class="rc-btn sm primary" type="submit">Preview and prune</button></form></section>
    <section class="card fm-panel"><h3>Quick clean-up</h3><div class="fm-clean">
      <div><b>Empty the bin</b><p>Permanently remove ${c.binTopics} topic${c.binTopics === 1 ? '' : 's'} and ${c.binPosts} post${c.binPosts === 1 ? '' : 's'} that were deleted.</p><button class="rc-btn sm" data-fm="m:empty-bin">Empty the bin</button></div>
      <div><b>Trim read markers</b><p>Forget who has read old topics. Topics over 90 days old already count as read.</p><button class="rc-btn sm" data-fm="m:trim-reads">Trim markers</button></div>
      <div><b>Trim moderation log</b><p>Remove log rows older than your auto-upkeep setting.</p><button class="rc-btn sm" data-fm="m:trim-log">Trim log</button></div>
      <div><b>Compact repo history</b><p>Replaces the repo's commit history with a single snapshot to free space. Current posts stay; older versions of them go. Rarely needed.</p><button class="rc-btn sm ghost rc-danger" data-fm="compact">Compact history</button></div></div></section>
    <section class="card fm-panel"><h3>Automatic upkeep</h3><p>Runs once a day by itself, so the data stays small without you doing anything. Use 0 to switch a job off where shown.</p>
      <form class="fm-inline" data-fmform="settings"><label>Empty the bin after <input name="autoPurgeDays" type="number" min="0" value="${s.autoPurgeDays}"> days (0 = off)</label><label>Trim read markers after <input name="autoReadsDays" type="number" min="90" value="${s.autoReadsDays}"> days</label><label>Trim the log after <input name="autoLogDays" type="number" min="30" value="${s.autoLogDays}"> days</label><label>Auto-prune topics after <input name="autoPruneDays" type="number" min="0" value="${s.autoPruneDays}"> days (0 = off)</label><button class="rc-btn sm primary" type="submit">Save settings</button></form></section>`;
  } else if (tab === 'boards') {
    body = S.board.map(c => `<section class="card fm-panel"><div class="fm-panelhead"><h3>${esc(c.name)}</h3><div><button class="rc-btn sm ghost" data-fm="catrename:${c.id}" data-name="${esc(c.name)}">Rename</button><button class="rc-btn sm ghost rc-danger" data-fm="catdelete:${c.id}">Delete</button></div></div>
      ${c.forums.map(f => `<form class="fm-boardrow" data-fmform="forum" data-id="${f.id}"><input name="position" type="number" value="${f.position}" aria-label="Order"><input name="name" value="${esc(f.name)}" aria-label="Name"><input name="description" value="${esc(f.description)}" aria-label="Description"><label class="chk"><input type="checkbox" name="staffTopics" ${f.staffTopics ? 'checked' : ''}> Commissioner starts topics</label><label class="chk"><input type="checkbox" name="locked" ${f.locked ? 'checked' : ''}> Locked</label><button class="rc-btn sm" type="submit">Save</button><button class="rc-btn sm ghost rc-danger" type="button" data-fm="fdelete:${f.id}">Delete</button></form>`).join('') || '<p class="fm-dim">No forums in this category.</p>'}
      <form class="fm-inline" data-fmform="addforum" data-cat="${c.id}"><label>New forum <input name="name" maxlength="60" required></label><label>Description <input name="description" maxlength="240"></label><button class="rc-btn sm primary" type="submit">Add forum</button></form></section>`).join('') + `<section class="card fm-panel"><form class="fm-inline" data-fmform="addcat"><label>New category <input name="name" maxlength="60" required></label><button class="rc-btn sm primary" type="submit">Add category</button></form></section>`;
  } else if (tab === 'members') {
    const d = await call('/members');
    body = `<section class="card fm-panel"><h3>Members</h3><p>A ban blocks a team from the forum only. Their Recruitment Center login is not affected.</p><div class="rc-tablewrap"><table class="fm-table"><thead><tr><th>Team</th><th>Coach</th><th>Posts</th><th>Last visit</th><th>Status</th><th></th></tr></thead><tbody>${d.members.map(m => `<tr><td><img class="fm-mini" src="${logo(m.team)}" alt="">${esc(T(m.team).name)}</td><td>${esc(m.coach || '—')}</td><td>${m.posts}</td><td>${m.lastSeen ? fullDate(m.lastSeen) : '—'}</td><td>${m.banned ? `<span class="fm-tag">Banned</span> ${esc(m.banReason || '')}` : 'Active'}</td><td>${m.commissioner ? '' : m.banned ? `<button class="rc-btn sm" data-fm="unban:${esc(m.team)}">Lift ban</button>` : `<button class="rc-btn sm ghost rc-danger" data-fm="ban:${esc(m.team)}">Ban</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;
  } else if (tab === 'bin') {
    const r = o.removed;
    body = `<section class="card fm-panel"><h3>Removed topics</h3>${r.topics.map(t => `<div class="fm-binrow"><div><b>${esc(t.title)}</b><p class="fm-dim">${esc(t.forum)} · by ${esc(t.author)} · removed by ${esc(t.by)} on ${fullDate(t.at)}</p></div><button class="rc-btn sm" data-fm="trestore:${t.id}">Restore</button></div>`).join('') || '<p class="fm-dim">None.</p>'}</section>
      <section class="card fm-panel"><h3>Removed posts</h3>${r.posts.map(p => `<div class="fm-binrow"><div><b>${esc(p.title)}</b><p>${esc(p.snippet)}</p><p class="fm-dim">by ${esc(p.author)} · removed by ${esc(p.by)} on ${fullDate(p.at)}</p></div><button class="rc-btn sm" data-fm="prestore:${p.id}">Restore</button></div>`).join('') || '<p class="fm-dim">None.</p>'}</section>`;
  } else {
    body = `<section class="card fm-panel"><h3>Moderation log</h3><div class="rc-tablewrap"><table class="fm-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th></tr></thead><tbody>${o.log.map(l => `<tr><td>${fullDate(l.at)}</td><td>${esc(l.actor)}</td><td>${esc(l.action.replace(/_/g, ' ').toLowerCase())}</td><td>${esc(l.target || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="fm-dim">Nothing logged yet.</td></tr>'}</tbody></table></div></section>`;
  }
  return frame(`<div class="fm-pagehead"><div><h2>Forum administration</h2></div></div>${nav}${body}`, ['<a href="#/forum/admin">Administration</a>']);
}

/* ------------------------------------------------------------ routing inside #/forum */
async function route() {
  const c = S.ctx; if (!root()) return;
  if (!token()) { S.me = null; return loginView(); }
  try {
    const b = await call('/bootstrap');
    S.me = b.me; S.board = b.board; S.limits = b.limits; S.footer = { online: b.online, stats: b.stats, commissionerTeam: b.commissionerTeam, coaches: b.coaches };
    let html;
    if (c.sub === 'f') html = await forumView(c.id, c.q.get('page'));
    else if (c.sub === 't') html = await topicView(c.id, c.q);
    else if (c.sub === 'new') html = newTopicView(c.id);
    else if (c.sub === 'list') html = await listView(c.id);
    else if (c.sub === 'search') html = await searchView(c.q.get('q') || '');
    else if (c.sub === 'members') html = await membersView();
    else if (c.sub === 'admin') html = await adminView(c.id);
    else html = homeView();
    if (!root()) return;
    root().innerHTML = html;
    const pid = c.q.get('post'); if (pid) $(`#p${+pid}`)?.scrollIntoView({ block: 'start' });
    startPolling();
  } catch (e) {
    if (SIGNED_OUT.has(e.code)) { if (e.code !== 'UNAUTHENTICATED') { try { localStorage.removeItem(TOKEN_KEY); } catch {} } return loginView(e.code === 'ACCOUNT_LOCKED' ? e.message : 'Your sign-in expired. Sign in again to continue.'); }
    root().innerHTML = S.me ? frame(errorCard(e)) : errorCard(e);
  }
}
function startPolling() {
  clearInterval(S.poll);
  S.poll = setInterval(() => { if (!location.hash.startsWith('#/forum')) { clearInterval(S.poll); S.poll = null; return; } if (!document.hidden) refreshFooter(); }, 60e3);
}
const soft = () => route();

/* ------------------------------------------------------------ actions */
const ACTIONS = {
  signout: async () => { try { await fetch(`${rcApi()}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: '{}' }); } catch {} try { localStorage.removeItem(TOKEN_KEY); } catch {} S.me = null; toast('Signed out', 'You are signed out of the forum and the Recruitment Center.'); route(); },
  readall: async () => { await call('/read-all', { method: 'POST', body: {} }); toast('All forums marked read'); soft(); },
  readforum: async id => { await call(`/forums/${id}/read`, { method: 'POST', body: {} }); toast('Forum marked read'); soft(); },
  fmt: (tag, el) => {
    const ta = $('textarea[name=body]', el.closest('form')); if (!ta) return;
    if (tag === 'url') return wrapSel(ta, '[url=https://]', '[/url]', 'link text');
    if (tag === 'img') return wrapSel(ta, '[img]', '[/img]', 'https://');
    if (tag === 'list') return wrapSel(ta, '[list]\n[*]', '\n[/list]', 'item');
    wrapSel(ta, `[${tag}]`, `[/${tag}]`);
  },
  preview: (_, el) => { const f = el.closest('form'), box = $('.fm-preview', f), ta = $('textarea[name=body]', f); const on = box.hidden; box.hidden = !on; ta.hidden = on; el.textContent = on ? 'Write' : 'Preview'; if (on) box.innerHTML = renderPost(ta.value) || '<span class="fm-dim">Nothing to preview.</span>'; },
  quote: (id, el) => { const raw = $(`#p${id} .fm-content`).dataset.raw.replace(/\[quote[\s\S]*?\[\/quote\]\s*/gi, '').trim(); const ta = $('form[data-fmform=reply] textarea'); if (!ta) return; ta.value += `${ta.value ? '\n' : ''}[quote="${el.dataset.author}"]${raw}[/quote]\n`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.scrollIntoView({ block: 'center' }); ta.focus(); },
  edit: id => {
    const box = $(`#p${id} .fm-content`), raw = box.dataset.raw;
    box.innerHTML = `<form class="fm-editform" data-fmform="edit" data-id="${id}"><textarea name="body" rows="8" maxlength="20000" required>${esc(raw)}</textarea><div class="fm-actions"><span class="rc-err"></span><button class="rc-btn ghost sm" type="button" data-fm="canceledit">Cancel</button><button class="rc-btn primary sm" type="submit">Save</button></div></form>`;
    $('textarea', box).focus();
  },
  canceledit: soft,
  delpost: async id => { if (!await ask('Delete this post? The commissioner can restore it from the bin until it is emptied.', { title: 'Delete post', ok: 'Delete' })) return; const r = await call(`/posts/${id}`, { method: 'DELETE', body: {} }); toast('Post deleted'); if (r.topicDeleted) go('#/forum'); else soft(); },
  react: async arg => { const i = arg.indexOf(':'), id = arg.slice(0, i), emoji = arg.slice(i + 1); const { post } = await call(`/posts/${id}/react`, { method: 'POST', body: { emoji } }); const box = $(`#p${id} .fm-react`); if (box) box.innerHTML = RE_EMOJI.map(e => `<button class="${post.myReactions.includes(e) ? 'mine' : ''} ${post.reactions[e] ? 'has' : ''}" data-fm="react:${id}:${e}" aria-label="React ${e}">${e}${post.reactions[e] ? ` <b>${post.reactions[e]}</b>` : ''}</button>`).join(''); },
  tlock: async arg => { const [id, v] = arg.split(':'); await call(`/topics/${id}`, { method: 'PATCH', body: { locked: v === '1' } }); toast(v === '1' ? 'Topic locked' : 'Topic unlocked'); soft(); },
  tdelete: async id => { if (!await ask('Delete this whole topic? You can restore it from Removed posts until the bin is emptied.', { title: 'Delete topic', ok: 'Delete' })) return; await call(`/topics/${id}`, { method: 'DELETE', body: {} }); toast('Topic deleted'); go('#/forum'); },
  trestore: async id => { await call(`/topics/${id}/restore`, { method: 'POST', body: {} }); toast('Topic restored'); soft(); },
  prestore: async id => { await call(`/posts/${id}/restore`, { method: 'POST', body: {} }); toast('Post restored'); soft(); },
  ban: async team => { const reason = await promptText(`Ban ${T(team).name} from the forum`, 'Reason (shown to the coach)'); if (reason === null) return; await call(`/admin/members/${team}/ban`, { method: 'POST', body: { banned: true, reason } }); toast('Team banned from the forum'); soft(); },
  unban: async team => { await call(`/admin/members/${team}/ban`, { method: 'POST', body: { banned: false } }); toast('Ban lifted'); soft(); },
  catrename: async (id, el) => { const name = await promptText('Rename category', 'Name', el.dataset.name); if (!name) return; await call(`/admin/categories/${id}`, { method: 'PATCH', body: { name } }); soft(); },
  catdelete: async id => { if (!await ask('Delete this category? It must have no forums.', { title: 'Delete category', ok: 'Delete' })) return; await call(`/admin/categories/${id}`, { method: 'DELETE', body: {} }); soft(); },
  fdelete: async id => { if (!await ask('Delete this forum? It must have no topics.', { title: 'Delete forum', ok: 'Delete' })) return; await call(`/admin/forums/${id}`, { method: 'DELETE', body: {} }); toast('Forum deleted'); soft(); },
  m: async action => {
    if (action === 'empty-bin' && !await ask('Permanently remove everything in the bin? They can no longer be restored here.', { title: 'Empty the bin', ok: 'Empty it' })) return;
    const r = await call(`/admin/maintenance/${action}`, { method: 'POST', body: {} });
    toast('Done', r.topics != null ? `${r.topics} topics and ${r.posts} posts removed.` : r.rows != null ? `${r.rows} rows removed.` : ''); soft();
  },
  compact: async () => { const v = await promptText('Compact repo history', 'Type COMPACT to confirm'); if (v === null) return; await call('/admin/maintenance/compact-history', { method: 'POST', body: { confirm: v } }); toast('History compacted'); soft(); },
  export: async () => { const j = await call('/admin/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `pcfl-forum-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); },
};
function promptText(title, label, value = '') {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'rc-overlay';
    ov.innerHTML = `<div class="rc-modal sm" role="dialog" aria-modal="true"><div class="rc-mhead"><div><h3>${esc(title)}</h3></div></div><div class="rc-mbody"><form><div class="rc-form"><div class="full"><label>${esc(label)}</label><input autocomplete="off" value="${esc(value)}"></div></div><div class="rc-mactions"><button class="rc-btn ghost" type="button" data-c="1">Cancel</button><button class="rc-btn primary" type="submit">OK</button></div></form></div></div>`;
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('form').addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); done(ov.querySelector('input').value.trim()); });
    ov.addEventListener('click', e => { e.stopPropagation(); if (e.target.dataset.c || e.target === ov) done(null); });
    document.body.appendChild(ov); ov.querySelector('input').focus();
  });
}
async function runAction(act, arg, el) {
  const fn = ACTIONS[act]; if (!fn || el?.dataset.busy) return;
  if (el) el.dataset.busy = '1';
  try { await fn(arg, el); }
  catch (e) { if (SIGNED_OUT.has(e.code)) route(); else toast('That did not go through', e.message, 'err'); }
  finally { if (el) delete el.dataset.busy; }
}

/* ---- forms */
const FORMS = {
  login: f => doLogin(f),
  search: f => { const v = f.q.value.trim(); if (v.length >= 2) go(`#/forum/search?q=${encodeURIComponent(v)}`); },
  topic: async f => { const r = await call(`/forums/${f.dataset.forum}/topics`, { method: 'POST', body: { title: f.title.value, body: f.body.value, kind: f.kind ? +f.kind.value : 0, locked: !!f.locked?.checked } }); clearDraft(f.dataset.draft); go(`#/forum/t/${r.topicId}`); },
  reply: async f => { const r = await call(`/topics/${f.dataset.topic}/posts`, { method: 'POST', body: { body: f.body.value } }); clearDraft(f.dataset.draft); go(`#/forum/t/${r.topicId}?post=${r.postId}`); },
  edit: async f => { await call(`/posts/${f.dataset.id}`, { method: 'PATCH', body: { body: f.body.value } }); toast('Post updated'); soft(); },
  prune: async f => {
    const body = { days: +f.days.value, forumId: f.forumId.value || null, includePinned: f.includePinned.checked, includeLocked: f.includeLocked.checked };
    const p = await call('/admin/maintenance/prune-preview', { method: 'POST', body });
    if (!p.topics) return toast('Nothing to prune', `No topics are older than ${p.days} days.`, 'info');
    if (!await ask(`Permanently remove ${p.topics} topic${p.topics === 1 ? '' : 's'} and ${p.posts} post${p.posts === 1 ? '' : 's'} older than ${p.days} days?`, { title: 'Prune topics', ok: 'Prune' })) return;
    const r = await call('/admin/maintenance/prune', { method: 'POST', body }); toast('Pruned', `${r.topics} topics and ${r.posts} posts removed.`); soft();
  },
  settings: async f => { await call('/admin/maintenance/settings', { method: 'PATCH', body: { autoPurgeDays: +f.autoPurgeDays.value, autoReadsDays: +f.autoReadsDays.value, autoLogDays: +f.autoLogDays.value, autoPruneDays: +f.autoPruneDays.value } }); toast('Settings saved'); soft(); },
  forum: async f => { await call(`/admin/forums/${f.dataset.id}`, { method: 'PATCH', body: { name: f.name.value, description: f.description.value, position: +f.position.value, staffTopics: f.staffTopics.checked, locked: f.locked.checked } }); toast('Forum saved'); soft(); },
  addforum: async f => { await call('/admin/forums', { method: 'POST', body: { categoryId: +f.dataset.cat, name: f.name.value, description: f.description.value } }); toast('Forum added'); soft(); },
  addcat: async f => { await call('/admin/categories', { method: 'POST', body: { name: f.name.value } }); toast('Category added'); soft(); },
};
function bind() {
  if (S.bound) return; S.bound = true;
  document.addEventListener('click', e => { const a = e.target.closest('[data-fm]'); if (!a || !a.closest('#fm-root')) return; e.preventDefault(); const raw = a.dataset.fm, i = raw.indexOf(':'); runAction(i < 0 ? raw : raw.slice(0, i), i < 0 ? undefined : raw.slice(i + 1), a); });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-fmform]'); if (!f || !f.closest('#fm-root')) return; e.preventDefault();
    if (f.dataset.busy) return; f.dataset.busy = '1';
    const btn = $('button[type=submit]', f); if (btn) btn.disabled = true; const errEl = $('.rc-err', f); if (errEl) errEl.textContent = '';
    try { await FORMS[f.dataset.fmform](f); }
    catch (x) { if (SIGNED_OUT.has(x.code)) route(); else if (errEl) errEl.textContent = x.message; else toast('That did not go through', x.message, 'err'); }
    finally { delete f.dataset.busy; if (btn) btn.disabled = false; }
  });
  document.addEventListener('change', async e => {
    const el = e.target.closest('[data-fmchange]'); if (!el) return; const [what, id] = el.dataset.fmchange.split(':');
    try { await call(`/topics/${id}`, { method: 'PATCH', body: what === 'tkind' ? { kind: +el.value } : { forumId: +el.value } }); toast(what === 'tkind' ? 'Topic type changed' : 'Topic moved'); soft(); } catch (x) { toast('That did not go through', x.message, 'err'); }
  });
  document.addEventListener('input', e => { const ta = e.target.closest('form[data-draft] textarea[name=body]'); if (!ta) return; const k = DRAFT_KEY + ta.form.dataset.draft; try { if (ta.value) localStorage.setItem(k, ta.value); else localStorage.removeItem(k); } catch {} });
}

/** Called by the site router for every #/forum page. */
export function render(ctx) {
  S.X = ctx; S.ctx = ctx; bind();
  setTimeout(route, 0);
  return `<div id="fm-root" class="fm"><div class="card fm-empty"><b>Loading the forum…</b></div></div>`;
}
