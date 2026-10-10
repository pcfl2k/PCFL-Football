/**
 * Claim-level fact check with Nimble (Bespoke Labs' "System One" decision model, served by
 * Ollama >= 0.35 at /v1/systemone, TypeSafe Jev API). Nimble does not write: it answers typed
 * questions about a piece of text with calibrated probabilities, in one fast pass per question.
 *
 * We give it the exact facts the writer was given (state) and one true/false question per
 * sentence of the draft: "is this sentence fully supported by the facts?". Sentences whose
 * support probability falls below the threshold are sent back to the writer by name.
 *
 *   NIMBLE_URL        Ollama base URL that has `nimble` pulled (e.g. http://127.0.0.1:11434)
 *   NIMBLE_THRESHOLD  minimum support probability for a sentence to pass (default 0.5)
 */
const MAX_Q = 64;

/** Split a recap/preview/wrap JSON into checkable claims (sentences), with where they came from. */
export function claimsOf(doc) {
  const out = [];
  const add = (field, text) => {
    for (const s of String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) {
      const t = s.trim();
      if (t.length >= 12) out.push({ field, text: t });
    }
  };
  if (!doc || typeof doc !== 'object') return out;
  add('headline', doc.headline); add('dek', doc.dek ?? doc.subhead); add('lead', doc.lead);
  (Array.isArray(doc.body) ? doc.body : [doc.body]).forEach((p, i) => add(`body[${i}]`, p));
  add('turningPoint', doc.turningPoint); add('keyMatchup', doc.keyMatchup); add('closer', doc.closer);
  (doc.byTheNumbers || []).forEach((b, i) => add(`byTheNumbers[${i}]`, b));
  if (doc.unsungHero?.why) add('unsungHero', `${doc.unsungHero.name}: ${doc.unsungHero.why}`);
  if (doc.xFactor?.why) add('xFactor', doc.xFactor.why);
  (doc.segments || []).forEach((sg, i) => add(`segments[${i}]`, sg.body));
  return out.slice(0, MAX_Q * 3);
}

const question = claim => ({
  type: 'noul',
  instructions: `Is this sentence from a sports recap fully supported by the facts in the state? Sentence: "${claim}"`,
  criteria: {
    true: 'Every factual element of the sentence (people, teams, numbers, scores, periods, clock times, records, rankings and described events) appears in the state or follows directly from it. Style, adjectives and opinion are fine.',
    false: 'The sentence states or implies a fact the state does not contain, or contradicts it (wrong player, number, time, event, cause, or an invented detail).',
  },
});

/** Ask Nimble about every claim. Returns [{field, text, p}] with p = probability the claim is supported. */
export async function checkClaims({ facts, claims, url = process.env.NIMBLE_URL, timeoutMs = 120000 }) {
  if (!url) throw new Error('NIMBLE_URL is not set');
  const results = [];
  for (let i = 0; i < claims.length; i += MAX_Q) {
    const batch = claims.slice(i, i + MAX_Q);
    const questions = Object.fromEntries(batch.map((c, k) => [`c${i + k}`, question(c.text)]));
    const res = await fetch(url.replace(/\/+$/, '') + '/v1/systemone', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.NIMBLE_MODEL || 'nimble', state: facts, questions, keep_alive: '10m' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`nimble ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    batch.forEach((c, k) => {
      const a = j.answers?.[`c${i + k}`] ?? (Array.isArray(j.answers) ? j.answers[k] : null);
      const p = typeof a?.noul === 'number' ? a.noul : typeof a?.probability === 'number' ? a.probability : a?.probabilities?.true ?? null;
      results.push({ ...c, p });
    });
  }
  return results;
}

/** Claims below the threshold (unsupported). */
export const flagged = (results, threshold = +(process.env.NIMBLE_THRESHOLD || 0.5)) =>
  results.filter(r => typeof r.p === 'number' && r.p < threshold);
