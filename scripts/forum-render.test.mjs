// The forum's post formatter: nothing a coach types may become live HTML.
//   node scripts/forum-render.test.mjs
import assert from 'node:assert/strict';
import { renderPost as r } from '../js/forum.js';

// Escaped text is harmless, so only real tags are inspected: every tag must be on the list,
// with no event handlers, and any link or image must point at http(s).
const TAGS = new Set(['strong', 'em', 'u', 's', 'br', 'a', 'img', 'ul', 'li', 'blockquote', 'cite', 'div', 'pre', 'iframe']);
function assertSafe(html, input) {
  for (const m of html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
    const [tag, name, attrs] = m, why = `unsafe tag ${tag} from ${input}`;
    assert.ok(TAGS.has(name.toLowerCase()), why);
    assert.doesNotMatch(attrs, /\son[a-z]+\s*=/i, why);
    for (const u of attrs.matchAll(/\b(?:href|src)="([^"]*)"/gi)) assert.match(u[1], /^https?:\/\//i, why);
    if (name.toLowerCase() === 'iframe' && !tag.startsWith('</')) assert.match(attrs, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}"/, why);
    assert.equal((attrs.match(/"/g) || []).length % 2, 0, why);
  }
}
const attacks = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '"><script>alert(1)</script>', "'><img src=x onerror=alert(1)>",
  '[img]javascript:alert(1)[/img]', '[img]http://plain-http.example/a.png[/img]', '[img]https://a.example/x.png" onerror="alert(1)[/img]', '[img]https://a.example/x.png"onerror="alert(1)[/img]',
  '[url=javascript:alert(1)]click[/url]', '[url=data:text/html,<script>alert(1)</script>]x[/url]', '[url=https://a.example" onclick="alert(1)]x[/url]', '[url]javascript:alert(1)[/url]', '[url=vbscript:x]y[/url]',
  '[quote="<script>alert(1)</script>"]hi[/quote]', '[quote="a&quot; onclick=&quot;alert(1)"]hi[/quote]', '[b]<script>alert(1)</script>[/b]', '[list][*]<img src=x onerror=alert(1)>[/list]',
  '[code]<script>alert(1)</script>[/code]', 'https://a.example/"><script>alert(1)</script>', 'https://www.youtube.com/watch?v=aaaaaaaaaaa"><script>alert(1)</script>',
  '\u00010\u0001', '\u0002[quote]x[/quote]\u0002', '[url=https://a.example][img]javascript:alert(1)[/img][/url]', '[b][i][u][s]<b onmouseover=alert(1)>x[/s][/u][/i][/b]',
];
for (const a of attacks) {
  const out = r(a);
  assertSafe(out, a);
  assert.doesNotMatch(out, /[\u0001\u0002]/, `placeholder leaked: ${a}`);
}

assert.equal(r('[b]bold[/b] [i]it[/i] [u]u[/u] [s]s[/s]'), '<strong>bold</strong> <em>it</em> <u>u</u> <s>s</s>');
assert.equal(r('a\nb'), 'a<br>b');
assert.match(r('[url=https://a.example/x?y=1&z=2]link[/url]'), /href="https:\/\/a\.example\/x\?y=1&amp;z=2"[^>]*rel="noopener noreferrer nofollow"[^>]*>link<\/a>/);
assert.match(r('see https://a.example/page. Next'), /href="https:\/\/a\.example\/page"[^>]*>https:\/\/a\.example\/page<\/a>\. Next/);
assert.match(r('[img]https://a.example/x.png[/img]'), /<img class="fm-img" src="https:\/\/a\.example\/x\.png"/);
assert.doesNotMatch(r('[img]http://a.example/x.png[/img]'), /<img/, 'images must be https');
assert.match(r('[quote="Dean"]old[/quote]\nnew'), /<blockquote class="fm-quote"><cite>Dean wrote<\/cite><div>old<\/div><\/blockquote>new/);
assert.equal((r('[quote="A"][quote="B"]x[/quote]y[/quote]').match(/<blockquote/g) || []).length, 2, 'nested quotes');
assert.match(r('[code][b]not bold[/b] <x>[/code]'), /<pre class="fm-code">\[b\]not bold\[\/b\] &lt;x&gt;<\/pre>/);
assert.match(r('[list][*]one[*]two[/list]'), /<ul class="fm-ul"><li>one<\/li><li>two<\/li><\/ul>/);
assert.match(r('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
assert.match(r('https://youtu.be/dQw4w9WgXcQ'), /embed\/dQw4w9WgXcQ/);
assert.doesNotMatch(r('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), /<iframe/, 'lookalike host is a plain link');
assert.doesNotMatch(r('watch https://www.youtube.com/watch?v=dQw4w9WgXcQ today'), /<iframe/, 'embeds only on a line of its own');
console.log(`forum-render.test: ${attacks.length} attacks blocked, formatting ok`);
