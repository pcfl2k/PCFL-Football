/* FBPro98 roster rules, shared word for word by the site (js/roster-rules.js) and the rosters
   service (lib/rules.mjs). The browser uses them for instant feedback; the server runs the same
   checks again and refuses anything illegal.
   Sources: Sierra's ROSTER.H/ROSTER.CPP (slot counts, SlotPosValid, SetJerseyBounds, VerifyNumber,
   AssignedFull) and ER Tool ("There must be 34 Active and 12 Open slots assigned, and no more
   than 7 Inactive and 10 Expanded slots in use"). ER Tool's "Expanded" slots are the game's
   injured-reserve slots, which this league also uses as its Practice Squad. */

export const TOTAL_SLOTS = 63;
export const GAME_PLAYERS = 46;
export const MIN_ASSIGNED = 34;

/** Assigned slots, in file order. A player may only sit in his own group's assigned slots. */
export const GROUPS = [
  { key: 'QB', label: 'Quarterbacks', count: 2, positions: ['QB'], numbers: [[1, 19]] },
  { key: 'RB', label: 'Running Backs', count: 3, positions: ['HB', 'FB'], numbers: [[20, 49]] },
  { key: 'REC', label: 'Receivers', count: 5, positions: ['WR', 'TE'], numbers: [[80, 89]] },
  { key: 'OL', label: 'Offensive Line', count: 6, positions: ['C', 'G', 'T'], numbers: [[50, 69]] },
  { key: 'DL', label: 'Defensive Line', count: 4, positions: ['DE', 'DT'], numbers: [[60, 79], [90, 99]] },
  { key: 'LB', label: 'Linebackers', count: 5, positions: ['LB'], numbers: [[50, 59], [70, 79]] },
  { key: 'DB', label: 'Defensive Backs', count: 7, positions: ['CB', 'S'], numbers: [[20, 49]] },
  { key: 'K', label: 'Kicker', count: 1, positions: ['K'], numbers: [[1, 19]] },
  { key: 'P', label: 'Punter', count: 1, positions: ['P'], numbers: [[1, 19]] },
];

/** The O slots are the game's "Open" slots: any position, and they dress on game day. */
export const SECTIONS = {
  A: { key: 'A', label: 'Active', first: 0, last: 33, count: 34 },
  O: { key: 'O', label: 'Out', first: 34, last: 45, count: 12 },
  I: { key: 'I', label: 'Inactive', first: 46, last: 52, count: 7 },
  IR: { key: 'IR', label: 'IR / Practice Squad', first: 53, last: 62, count: 10 },
};
export const SECTION_ORDER = ['A', 'O', 'I', 'IR'];

const SLOT_GROUP = GROUPS.flatMap(g => Array.from({ length: g.count }, () => g));
const groupByPos = Object.fromEntries(GROUPS.flatMap(g => g.positions.map(p => [p, g])));
export const groupOf = pos => groupByPos[pos] || null;
export const sectionOf = slot => (slot <= 33 ? 'A' : slot <= 45 ? 'O' : slot <= 52 ? 'I' : 'IR');
export const assignedGroup = slot => (slot <= 33 ? SLOT_GROUP[slot] : null);

/** The label the coach sees for a slot: QB1, RB3, O4, I2, IR10. */
export function slotLabel(slot) {
  const g = assignedGroup(slot);
  if (g) return `${g.key}${slot - SLOT_GROUP.indexOf(g) + 1}`;
  const s = SECTIONS[sectionOf(slot)];
  return `${s.key}${slot - s.first + 1}`;
}

/** Roster::SlotPosValid: Open, Inactive and IR take anyone; assigned slots take their own group. */
export function slotAccepts(slot, pos) {
  if (slot < 0 || slot >= TOTAL_SLOTS) return false;
  const g = assignedGroup(slot);
  return !g || g.positions.includes(pos);
}

export function slotsOfGroup(group) {
  const out = [];
  SLOT_GROUP.forEach((g, i) => { if (g === group) out.push(i); });
  return out;
}

/** First empty slot a player can take in a section, or -1. */
export function firstFree(layout, section, pos) {
  const s = SECTIONS[section];
  for (let k = s.first; k <= s.last; k++) if (!layout[k] && slotAccepts(k, pos)) return k;
  return -1;
}

/** Where a new arrival goes: his group's assigned slots, then Out, Inactive, Practice Squad. */
export function placementFor(layout, pos) {
  for (const section of SECTION_ORDER) {
    const k = firstFree(layout, section, pos);
    if (k >= 0) return k;
  }
  return -1;
}

const inRanges = (n, ranges) => ranges.some(([a, b]) => n >= a && n <= b);
/** Roster::SetJerseyBounds. */
export const numberInRange = (pos, n) => { const g = groupOf(pos); return !!g && Number.isInteger(n) && inRanges(n, g.numbers); };

/** Roster::VerifyNumber as a list: numbers legal for this position that nobody else wears. */
export function availableNumbers(layout, pos, playerId = null) {
  const g = groupOf(pos);
  if (!g) return [];
  const taken = new Set(layout.filter(p => p && p.id !== playerId).map(p => p.jersey));
  const out = [];
  for (const [a, b] of g.numbers) for (let n = a; n <= b; n++) if (!taken.has(n)) out.push(n);
  return out;
}

/** A number for a new arrival: the game's range first; if that range is used up, any free number. */
export function pickNumber(layout, pos) {
  const free = availableNumbers(layout, pos);
  if (free.length) return free[0];
  const taken = new Set(layout.filter(Boolean).map(p => p.jersey));
  for (let n = 1; n <= 99; n++) if (!taken.has(n)) return n;
  return 0;
}

/** FBPro name fields hold 12 printable ASCII characters. */
export function nameProblem(value, label) {
  const v = String(value ?? '');
  if (!v.trim()) return `${label} is required.`;
  if (v !== v.trim()) return `${label} cannot start or end with a space.`;
  if (v.length > 12) return `${label} can be at most 12 characters.`;
  if (!/^[\x20-\x7e]+$/.test(v)) return `${label} can only use plain letters, numbers and punctuation.`;
  return null;
}

/**
 * Check a whole roster. `layout` is 63 entries of null or { id, first, last, pos, jersey }.
 * `before` maps player id to the jersey and name currently in the league files, so only changes
 * face the number and name checks: the game itself leaves some duplicates when a range runs out.
 *
 * A misconfigured roster is always an error. A roster that is merely short of players is a
 * warning until the season starts (strict), because the game only demands all 46 from
 * STAGE_SEASON_START (League::AssignedFull) and no arrangement can fix a missing player.
 */
export function validateRoster(layout, { strict = false, before = null } = {}) {
  const errors = [], warnings = [];
  const add = (list, code, message, extra = {}) => list.push({ code, message, ...extra });
  const name = p => `${p.first} ${p.last}`.trim() || `Player ${p.id}`;
  const counts = { A: 0, O: 0, I: 0, IR: 0, total: 0 };
  const seen = new Set();

  if (layout.length !== TOTAL_SLOTS) add(errors, 'SLOTS', `A roster has exactly ${TOTAL_SLOTS} slots.`);
  layout.forEach((p, k) => {
    if (!p) return;
    counts[sectionOf(k)]++; counts.total++;
    if (seen.has(p.id)) add(errors, 'DUPLICATE_PLAYER', `${name(p)} is listed twice.`, { slot: k });
    seen.add(p.id);
    if (!slotAccepts(k, p.pos)) add(errors, 'WRONG_SLOT', `${name(p)} (${p.pos}) cannot play the ${slotLabel(k)} slot.`, { slot: k });
    const was = before?.get(p.id);
    if (!was || was.first !== p.first) { const m = nameProblem(p.first, 'First name'); if (m) add(errors, 'BAD_NAME', `${name(p)}: ${m}`, { slot: k }); }
    if (!was || was.last !== p.last) { const m = nameProblem(p.last, 'Last name'); if (m) add(errors, 'BAD_NAME', `${name(p)}: ${m}`, { slot: k }); }
  });

  // numbers: a changed number must be in the position's range and unique
  const wearers = new Map();
  layout.forEach(p => { if (p) wearers.set(p.jersey, [...(wearers.get(p.jersey) || []), p]); });
  layout.forEach((p, k) => {
    if (!p) return;
    const changed = before && before.get(p.id)?.jersey !== p.jersey && !p.incoming;
    if (changed && !numberInRange(p.pos, p.jersey)) add(errors, 'BAD_NUMBER', `${name(p)} (${p.pos}) cannot wear #${p.jersey}.`, { slot: k });
    if ((wearers.get(p.jersey) || []).length > 1) {
      if (changed || p.incoming) add(errors, 'NUMBER_TAKEN', `#${p.jersey} is already worn, so ${name(p)} needs another number.`, { slot: k });
    }
  });
  const dupes = [...wearers].filter(([, list]) => list.length > 1).map(([n]) => n);
  if (dupes.length && !errors.some(e => e.code === 'NUMBER_TAKEN')) add(warnings, 'SHARED_NUMBER', `Players share ${dupes.length === 1 ? 'number' : 'numbers'} ${dupes.map(n => `#${n}`).join(', ')}.`);

  // Assigned slots must be filled by anyone in the group who is sitting lower on the roster.
  const shortages = [];
  for (const g of GROUPS) {
    const slots = slotsOfGroup(g), empty = slots.filter(k => !layout[k]);
    if (!empty.length) continue;
    const spare = [];
    for (let k = MIN_ASSIGNED; k < TOTAL_SLOTS; k++) if (layout[k] && g.positions.includes(layout[k].pos)) spare.push(layout[k]);
    if (spare.length) add(errors, 'FILL_ACTIVE', `The ${slotLabel(empty[0])} slot is empty, but ${name(spare[0])} (${sectionLabel(spare[0], layout)}) can fill it. All ${g.count} ${g.label} slots must be filled.`, { slot: empty[0] });
    const missing = empty.length - spare.length;
    if (missing > 0) shortages.push({ group: g, missing, slot: empty[empty.length - 1] });
  }
  // Out slots fill from Inactive and the Practice Squad, so 46 dress whenever the team has them.
  const openEmpty = []; for (let k = SECTIONS.O.first; k <= SECTIONS.O.last; k++) if (!layout[k]) openEmpty.push(k);
  if (openEmpty.length) {
    const below = layout.slice(SECTIONS.I.first).filter(Boolean);
    if (below.length) add(errors, 'FILL_OPEN', `The ${slotLabel(openEmpty[0])} slot is empty, but ${name(below[0])} is ${sectionLabel(below[0], layout)}. All ${SECTIONS.O.count} Out slots must be filled before anyone sits Inactive or on the Practice Squad.`, { slot: openEmpty[0] });
  }

  // Short of bodies: no arrangement can fix this, so it blocks saving only once the season starts.
  const list = strict ? errors : warnings;
  for (const s of shortages) add(list, 'SHORT_GROUP', `${s.group.label}: ${s.missing} more needed to fill the ${s.group.count} assigned slots.`, { slot: s.slot });
  const dressed = layout.slice(0, GAME_PLAYERS).filter(Boolean).length;
  if (counts.total < GAME_PLAYERS) add(list, 'SHORT_ROSTER', `${counts.total} of ${GAME_PLAYERS} game-day players. The game needs all ${GAME_PLAYERS} before the season starts.`);

  return { legal: !errors.length, errors, warnings, counts, gameReady: dressed === GAME_PLAYERS, room: TOTAL_SLOTS - counts.total };
}
function sectionLabel(p, layout) {
  const s = SECTIONS[sectionOf(layout.indexOf(p))];
  return s.key === 'O' ? 'in Out' : s.key === 'I' ? 'Inactive' : 'on the Practice Squad';
}
