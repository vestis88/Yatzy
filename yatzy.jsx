import React, { useState, useRef, useEffect } from 'react';
import { Trophy, Undo2, Volume2, VolumeX, Pencil } from 'lucide-react';

// Personal storage keys
const STORAGE_KEY = 'yatzy-game-state-v3';
const STATS_KEY = 'yatzy-stats';

// ─── Player color palettes ────────────────────────────────────────────────────
// Four distinct themes, one per player slot. Each has Tailwind class strings
// for the various places the color is used.
const PLAYER_COLORS = [
  {
    id: 'red',
    emoji: '🔴',
    header:    'bg-red-600 text-stone-50',
    headerBorder: 'border-red-700',
    light:     'bg-red-50',
    accent:    'text-red-700',
    badge:     'bg-red-100 text-red-800 border-red-300',
    dot:       'bg-red-500',
    finish:    'bg-red-100 border-red-400',
  },
  {
    id: 'blue',
    emoji: '🔵',
    header:    'bg-sky-600 text-stone-50',
    headerBorder: 'border-sky-700',
    light:     'bg-sky-50',
    accent:    'text-sky-700',
    badge:     'bg-sky-100 text-sky-800 border-sky-300',
    dot:       'bg-sky-500',
    finish:    'bg-sky-100 border-sky-400',
  },
  {
    id: 'amber',
    emoji: '🟡',
    header:    'bg-amber-500 text-stone-900',
    headerBorder: 'border-amber-600',
    light:     'bg-amber-50',
    accent:    'text-amber-700',
    badge:     'bg-amber-100 text-amber-800 border-amber-300',
    dot:       'bg-amber-500',
    finish:    'bg-amber-100 border-amber-400',
  },
  {
    id: 'emerald',
    emoji: '🟢',
    header:    'bg-emerald-600 text-stone-50',
    headerBorder: 'border-emerald-700',
    light:     'bg-emerald-50',
    accent:    'text-emerald-700',
    badge:     'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot:       'bg-emerald-500',
    finish:    'bg-emerald-100 border-emerald-400',
  },
];

// Emoji avatar options per player (shown on setup and scorecard header)
const AVATAR_OPTIONS = ['😀','😎','🤩','🥳','🧠','👻','🦊','🐻','🐼','🦄','🎩'];

const LEADERBOARD_KEY = 'yatzy-leaderboard';
const TOURNAMENT_KEY  = 'yatzy-tournament';
// ─── House rules ──────────────────────────────────────────────────────────────
const DEFAULT_HOUSE_RULES = {
  joker:            false, // Yatzy used as wildcard in lower section if yatzy-slot is filled
  bonusYatzy:       false, // Each Yatzy beyond the first adds +50 bonus points
  naturalBonus:     false, // Yatzy on first roll scores 100 instead of 50
  strictUpper:      false, // Upper section must be completed before lower can be started
  forcedOrder:      false, // Categories must be filled top-to-bottom (no free choice)
};

// Rule-aware scoring — replaces raw cat.calc(dice) calls during gameplay
// Pass houseRules=null to get the plain calculation (used in scorecard preview)
function calcScore(catId, dice, houseRules, scores) {
  const hr = houseRules || DEFAULT_HOUSE_RULES;

  // Generous straights: remove one duplicate then test
  // Generous straights: 4 of the 5 required values suffice — the 5th die can be

  // Natural bonus: Yatzy on roll 1 (rollsLeft===2 when scored, since one roll was used)
  // We detect this via the scores context — but we can't know rollsLeft here.
  // Instead we pass it separately. For simplicity, naturalBonus is handled in recordScore.

  // Joker: if scoring a lower-section category and the player has a Yatzy,
  // and the yatzy slot is already filled, allow the joker score.
  // The joker score for lower cats = the natural score of that dice combo.
  // This is handled by NOT blocking the score — the calc itself is unchanged.
  // We just need to unlock the category when joker applies.

  const cat = CATEGORIES.find(c => c.id === catId);
  if (!cat) return 0;

  return cat.calc(dice);
}

// With joker rule: a Yatzy roll unlocks certain lower categories even if the
// "natural" score is 0. Returns true if this dice+catId combo is joker-eligible.
function isJokerEligible(catId, dice, scores, houseRules) {
  if (!houseRules?.joker) return false;
  if (!counts(dice).includes(5)) return false;          // must be a Yatzy roll
  if (scores['yatzy'] === undefined) return false;       // yatzy slot must be filled
  // Joker applies to lower section categories (except yatzy itself)
  const cat = CATEGORIES.find(c => c.id === catId);
  return cat && cat.section === 'lower' && catId !== 'yatzy';
}

// Forced-order: return the catId that must be filled next, or null if free choice
function forcedOrderCat(scores) {
  for (const cat of CATEGORIES) {
    if (scores[cat.id] === undefined) return cat.id;
  }
  return null;
}





const FONT_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
  .font-display { font-family: 'Space Grotesk', system-ui, sans-serif; }
  .font-mono-score { font-family: 'IBM Plex Mono', 'Courier New', monospace; }
  .confetti-piece {
    position: absolute;
    top: -10px;
    animation-name: confetti-fall;
    animation-timing-function: ease-in;
    animation-fill-mode: forwards;
  }
  @keyframes confetti-fall {
    from { transform: translateY(0) rotate(0deg); opacity: 1; }
    to { transform: translateY(110vh) rotate(540deg); opacity: 0; }
  }
  @keyframes celebration-pop {
    0% { transform: scale(0.6) rotate(-6deg); opacity: 0; }
    50% { transform: scale(1.08) rotate(2deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }
`;

// ---------- Sound & haptic feedback ----------
// Sounds are synthesized with the Web Audio API (no audio files needed).
let audioCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(ctx, { freq = 440, duration = 0.1, type = 'sine', gain = 0.15, time = 0 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(ctx.destination);
  const start = ctx.currentTime + time;
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.start(start);
  osc.stop(start + duration);
}

// A short burst of filtered noise — used for percussive "clicks" and "thuds"
function noiseBurst(ctx, { time = 0, duration = 0.03, filterType = 'highpass', filterFreq = 2000, gain = 0.3, q = 0.7 }) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  source.connect(filter);
  filter.connect(g);
  g.connect(ctx.destination);
  source.start(ctx.currentTime + time);
}

// Deterministic pseudo-random generator so each "variant" sounds the same every time it's picked
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const ROLL_SOUND_VARIANTS = 15;

// Dice-clatter sound: a handful of short, filtered "tap" clicks with a bit of low body,
// timed like dice tumbling and settling. 15 fixed variants are cycled through.
function playRollSound(variant = 0) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const rand = seededRandom((((variant % ROLL_SOUND_VARIANTS) + ROLL_SOUND_VARIANTS) % ROLL_SOUND_VARIANTS) * 977 + 41);
  const clickCount = 6 + Math.floor(rand() * 4); // 6-9 clicks
  for (let i = 0; i < clickCount; i++) {
    const progress = i / clickCount;
    const time = progress * 0.38 + rand() * 0.025;
    const duration = 0.018 + rand() * 0.02;
    const filterFreq = 1400 + rand() * 3200;
    // Clicks get gentler and closer together as the dice "settle"
    const gain = (0.22 - progress * 0.12) * (0.8 + rand() * 0.4);
    noiseBurst(ctx, { time, duration, filterType: 'bandpass', filterFreq, gain, q: 1.2 });
    if (rand() > 0.55) {
      tone(ctx, { freq: 70 + rand() * 90, duration: 0.05, type: 'sine', gain: 0.04, time });
    }
  }
}

function playHoldSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  noiseBurst(ctx, { duration: 0.02, filterType: 'bandpass', filterFreq: 2600, gain: 0.18, q: 1.5 });
  tone(ctx, { freq: 640, duration: 0.03, type: 'square', gain: 0.04 });
}

// A reassuring low "thud" for locking in a score, with slight pitch/timing variation each time
function playConfirmSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const wobble = 1 + (Math.random() - 0.5) * 0.08; // ±4%
  tone(ctx, { freq: 92 * wobble, duration: 0.26, type: 'sine', gain: 0.32 });
  tone(ctx, { freq: 55 * wobble, duration: 0.32, type: 'sine', gain: 0.2, time: 0.015 });
  noiseBurst(ctx, { duration: 0.07, filterType: 'lowpass', filterFreq: 220, gain: 0.16 });
}

function playStrokeSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  tone(ctx, { freq: 160, duration: 0.14, type: 'sawtooth', gain: 0.1 });
}

function playYatzySound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    tone(ctx, { freq, duration: 0.22, type: 'triangle', gain: 0.18, time: i * 0.1 });
  });
}

// A shorter, warmer arpeggio for reaching the upper-section bonus —
// similar idea to the Yatzy fanfare, but a different chord and timbre
function playBonusSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  [392.0, 493.88, 587.33, 783.99].forEach((freq, i) => {
    tone(ctx, { freq, duration: 0.18, type: 'sine', gain: 0.2, time: i * 0.08 });
  });
}

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}

// Torn-paper edge: flat top, jagged bottom
const TORN_EDGE =
  'polygon(0% 0%, 100% 0%, 100% 40%, 96% 100%, 92% 40%, 88% 100%, 84% 40%, 80% 100%, 76% 40%, 72% 100%, 68% 40%, 64% 100%, 60% 40%, 56% 100%, 52% 40%, 48% 100%, 44% 40%, 40% 100%, 36% 40%, 32% 100%, 28% 40%, 24% 100%, 20% 40%, 16% 100%, 12% 40%, 8% 100%, 4% 40%, 0% 100%)';

// ---------- Scoring (svenska regler) ----------
function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach((d) => c[d]++);
  return c;
}
const upperScore = (dice, face) => dice.filter((d) => d === face).length * face;
function onePair(dice) {
  const c = counts(dice);
  for (let v = 6; v >= 1; v--) if (c[v] >= 2) return v * 2;
  return 0;
}
function twoPairs(dice) {
  const c = counts(dice);
  const p = [];
  for (let v = 6; v >= 1; v--) if (c[v] >= 2) p.push(v);
  return p.length >= 2 ? p[0] * 2 + p[1] * 2 : 0;
}
function threeKind(dice) {
  const c = counts(dice);
  for (let v = 6; v >= 1; v--) if (c[v] >= 3) return v * 3;
  return 0;
}
function fourKind(dice) {
  const c = counts(dice);
  for (let v = 6; v >= 1; v--) if (c[v] >= 4) return v * 4;
  return 0;
}
function smallStraight(dice) {
  return [...dice].sort((a, b) => a - b).join('') === '12345' ? 15 : 0;
}
function largeStraight(dice) {
  return [...dice].sort((a, b) => a - b).join('') === '23456' ? 20 : 0;
}
function fullHouse(dice) {
  const c = counts(dice);
  return c.includes(3) && c.includes(2) ? dice.reduce((a, b) => a + b, 0) : 0;
}
function chance(dice) {
  return dice.reduce((a, b) => a + b, 0);
}
function yatzyScore(dice) {
  return counts(dice).includes(5) ? 50 : 0;
}

const CATEGORIES = [
  { id: 'ones', label: 'Ettor', sub: 'Summan av ettor', section: 'upper', calc: (d) => upperScore(d, 1) },
  { id: 'twos', label: 'Tvåor', sub: 'Summan av tvåor', section: 'upper', calc: (d) => upperScore(d, 2) },
  { id: 'threes', label: 'Treor', sub: 'Summan av treor', section: 'upper', calc: (d) => upperScore(d, 3) },
  { id: 'fours', label: 'Fyror', sub: 'Summan av fyror', section: 'upper', calc: (d) => upperScore(d, 4) },
  { id: 'fives', label: 'Femmor', sub: 'Summan av femmor', section: 'upper', calc: (d) => upperScore(d, 5) },
  { id: 'sixes', label: 'Sexor', sub: 'Summan av sexor', section: 'upper', calc: (d) => upperScore(d, 6) },
  { id: 'pair', label: 'Ett par', sub: '2 × högsta paret', section: 'lower', calc: onePair },
  { id: 'twopairs', label: 'Två par', sub: '2 × vardera paret', section: 'lower', calc: twoPairs },
  { id: 'threekind', label: 'Tretal', sub: '3 × tre lika', section: 'lower', calc: threeKind },
  { id: 'fourkind', label: 'Fyrtal', sub: '4 × fyra lika', section: 'lower', calc: fourKind },
  { id: 'smallstraight', label: 'Liten stege', sub: '1-2-3-4-5 = 15 p', section: 'lower', calc: smallStraight },
  { id: 'largestraight', label: 'Stor stege', sub: '2-3-4-5-6 = 20 p', section: 'lower', calc: largeStraight },
  { id: 'house', label: 'Kåk', sub: 'Tretal + par, alla tärningar', section: 'lower', calc: fullHouse },
  { id: 'chance', label: 'Chans', sub: 'Summan av alla tärningar', section: 'lower', calc: chance },
  { id: 'yatzy', label: 'Yatzy', sub: 'Fem lika = 50 p', section: 'lower', calc: yatzyScore },
];

// Every possible 5-dice roll, used to figure out which scores are actually achievable per category
const ALL_ROLLS = (() => {
  const rolls = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++)
        for (let d = 1; d <= 6; d++)
          for (let e = 1; e <= 6; e++) rolls.push([a, b, c, d, e]);
  return rolls;
})();

// Set of valid (achievable) scores per category, derived from the scoring rules above
const VALID_SCORES = CATEGORIES.reduce((acc, cat) => {
  const set = new Set();
  ALL_ROLLS.forEach((dice) => set.add(cat.calc(dice)));
  acc[cat.id] = set;
  return acc;
}, {});

function isValidScore(catId, score) {
  const valid = VALID_SCORES[catId];
  return valid ? valid.has(score) : true;
}

// Fixed defaults: Ettor–Sexor use 3-of-a-kind (the bonus baseline), stegar/Yatzy use their fixed value.
// Every other category defaults to the highest score actually possible there.
const FIXED_DEFAULTS = {
  ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
  smallstraight: 15,
  largestraight: 20,
  yatzy: 50,
};
const DEFAULT_SCORES = CATEGORIES.reduce((acc, cat) => {
  acc[cat.id] = cat.id in FIXED_DEFAULTS ? FIXED_DEFAULTS[cat.id] : Math.max(...VALID_SCORES[cat.id]);
  return acc;
}, {});

function getDefaultScore(catId) {
  return catId in DEFAULT_SCORES ? DEFAULT_SCORES[catId] : null;
}

function calcTotals(scores) {
  const upperIds = CATEGORIES.filter((c) => c.section === 'upper').map((c) => c.id);
  const lowerIds = CATEGORIES.filter((c) => c.section === 'lower').map((c) => c.id);
  const upperSum = upperIds.reduce((a, id) => a + (scores[id] ?? 0), 0);
  const bonus = upperSum >= 63 ? 50 : 0;
  const lowerSum = lowerIds.reduce((a, id) => a + (scores[id] ?? 0), 0);
  return { upperSum, bonus, lowerSum, total: upperSum + bonus + lowerSum };
}

// ---------- Dice ----------
const PIPS = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

// A normal die roll. A "lucky" player gets the better of two rolls; an "unlucky"
// player gets the worse of two. Always lands on a valid 1-6 face either way.
function rollDie(lucky, unlucky) {
  const a = Math.ceil(Math.random() * 6);
  if (lucky) return Math.max(a, Math.ceil(Math.random() * 6));
  if (unlucky) return Math.min(a, Math.ceil(Math.random() * 6));
  return a;
}

// Parses a name input into a trimmed display name (used for stats too) plus the
// hidden "lucky" flag — a trailing space toggles it. Trimming first means the
// same person shows up as one stats entry whether or not the flag is set.
function parseNameInput(raw, fallback) {
  const lucky = typeof raw === 'string' && raw.endsWith(' ') && raw.trim().length > 0;
  const trimmed = (raw || '').trim();
  return { name: trimmed || fallback, lucky };
}

// ---------- AI opponent ----------
const AI_DIFFICULTIES = {
  svinlatt: { label: 'Svinlätt', errorRate: 0.55, lucky: false, unlucky: true },
  latt:     { label: 'Lätt',     errorRate: 0.45, lucky: false, unlucky: false },
  mellan:   { label: 'Mellan',   errorRate: 0.12, lucky: false, unlucky: false },
  svar:     { label: 'Svår',     errorRate: 0,    lucky: false, unlucky: false },
  skitsvar: { label: 'Skitsvår', errorRate: 0,    lucky: true,  unlucky: false },
};
const AI_DIFFICULTY_ORDER = ['svinlatt', 'latt', 'mellan', 'svar', 'skitsvar'];

// ─── Hold logic ───────────────────────────────────────────────────────────────
// Strategy: each turn, pick a TARGET category to aim for and hold dice that
// advance that target. The target is chosen based on what's most valuable
// given the game state (upper section bonus is the biggest lever).
//
// Upper section needs 63 pts for +50 bonus. Target = 3× each face value.
// Actively roll for specific upper categories rather than opportunistically.
function aiChooseTarget(dice, scores) {
  const c = counts(dice);
  const open = (id) => scores[id] === undefined;
  const faceVal = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

  // Current upper pace
  const upperCats = ['ones','twos','threes','fours','fives','sixes'];
  const upperSum = upperCats.reduce((s,id) => s + (scores[id] ?? 0), 0);
  const upperFilled = upperCats.filter(id => scores[id] !== undefined).length;
  const expectedSoFar = upperCats
    .filter(id => scores[id] !== undefined)
    .reduce((s,id) => s + faceVal[id]*3, 0);
  const behindOnBonus = upperSum < expectedSoFar;
  const upperRemaining = upperCats.filter(id => open(id));

  // Priority 1: If we already have 3+ of a face that maps to an open upper category, target it
  for (const id of ['sixes','fives','fours','threes','twos','ones']) {
    if (open(id) && c[faceVal[id]] >= 3) return { type: 'upper', face: faceVal[id], id };
  }

  // Priority 2: Yatzy chase — if we have 4 of a kind
  for (let v = 6; v >= 1; v--) {
    if (c[v] >= 4 && open('yatzy')) return { type: 'yatzy', face: v };
  }

  // Priority 3: Full house if we have 3+2
  if (open('house')) {
    for (let v = 6; v >= 1; v--) {
      if (c[v] === 3) {
        for (let p = 6; p >= 1; p--) {
          if (p !== v && c[p] >= 2) return { type: 'house', face3: v, face2: p };
        }
      }
    }
  }

  // Priority 4: Large straight potential (4 or 5 of the run present)
  if (open('largestraight')) {
    const lr = [2,3,4,5,6];
    if (lr.filter(v => new Set(dice).has(v)).length >= 4) return { type: 'largestraight' };
  }

  // Priority 5: Small straight potential
  if (open('smallstraight')) {
    const sr = [1,2,3,4,5];
    if (sr.filter(v => new Set(dice).has(v)).length >= 4) return { type: 'smallstraight' };
  }

  // Priority 6: Behind on bonus AND have 2+ of an open upper face → keep building it
  if (behindOnBonus || upperFilled < 3) {
    // Target the highest-value open upper category we have the most dice for
    for (const id of ['sixes','fives','fours','threes','twos','ones']) {
      if (open(id) && c[faceVal[id]] >= 2) return { type: 'upper', face: faceVal[id], id };
    }
    // Even a single high die is worth targeting if we're behind
    for (const id of ['sixes','fives']) {
      if (open(id) && c[faceVal[id]] >= 1) return { type: 'upper', face: faceVal[id], id };
    }
  }

  // Priority 7: High pairs / combos for lower section
  const pairs = [];
  for (let v = 6; v >= 1; v--) if (c[v] >= 2) pairs.push(v);
  if (pairs.length >= 2 && open('twopairs') && pairs[0] >= 4) return { type: 'twopairs', pairs };
  if (pairs.length >= 1 && pairs[0] >= 4) return { type: 'pair', face: pairs[0] };
  if (pairs.length >= 1 && pairs[0] === 3 && open('threes')) return { type: 'upper', face: 3, id: 'threes' };
  if (pairs.length >= 1 && pairs[0] >= 3) return { type: 'pair', face: pairs[0] };

  // Priority 8: Target the highest open upper category with at least one matching die
  for (const id of ['sixes','fives','fours','threes']) {
    if (open(id) && c[faceVal[id]] >= 1) return { type: 'upper', face: faceVal[id], id };
  }

  // Fallback: target sixes (always worth rolling for)
  return { type: 'high' };
}

function aiChooseHolds(dice, scores, errorRate, rollsLeft) {
  if (Math.random() < errorRate) return dice.map(() => Math.random() < 0.5);

  const c = counts(dice);
  const has = (id) => scores[id] === undefined;
  const earlyGame = rollsLeft >= 2;
  const present = new Set(dice);

  const holdRun = (run) => {
    const used = new Set();
    return dice.map((d) => {
      if (run.includes(d) && !used.has(d)) { used.add(d); return true; }
      return false;
    });
  };

  // Always hold 5-of-a-kind or 4-of-a-kind regardless of target
  for (let v = 6; v >= 1; v--) if (c[v] >= 5) return dice.map(() => true);
  for (let v = 6; v >= 1; v--) if (c[v] >= 4) return dice.map((d) => d === v);

  // Completed full house — always keep
  const dv = Object.keys(c).filter((v) => c[v] > 0).map(Number);
  if (dv.length === 2 && has('house')) {
    const [a, b] = dv;
    if ((c[a] === 3 && c[b] === 2) || (c[a] === 2 && c[b] === 3)) return dice.map(() => true);
  }

  const target = aiChooseTarget(dice, scores);

  if (target.type === 'upper') {
    // Hold all dice matching this face
    return dice.map((d) => d === target.face);
  }

  if (target.type === 'yatzy') {
    return dice.map((d) => d === target.face);
  }

  if (target.type === 'house') {
    return dice.map((d) => d === target.face3 || d === target.face2);
  }

  if (target.type === 'largestraight') {
    const lr = [2,3,4,5,6];
    if (lr.filter((v) => present.has(v)).length >= 4) return holdRun(lr);
    // Chase 3-in-a-row on first roll
    if (earlyGame) {
      const have = lr.filter((v) => present.has(v));
      if (have.length >= 3) {
        const indices = have.map((v) => lr.indexOf(v)).sort((a,b)=>a-b);
        const best3 = [];
        for (let i = 0; i <= indices.length-3; i++) {
          if (indices[i+2]-indices[i] === 2) { best3.push(...indices.slice(i,i+3)); break; }
        }
        if (best3.length) return holdRun(lr);
      }
    }
    return holdRun([2,3,4,5,6].filter((v) => present.has(v)));
  }

  if (target.type === 'smallstraight') {
    const sr = [1,2,3,4,5];
    if (sr.filter((v) => present.has(v)).length >= 4) return holdRun(sr);
    if (earlyGame) {
      const have = sr.filter((v) => present.has(v));
      if (have.length >= 3) return holdRun(sr.filter((v) => present.has(v)));
    }
    return holdRun([1,2,3,4,5].filter((v) => present.has(v)));
  }

  if (target.type === 'twopairs') {
    const pairs = target.pairs || [];
    if (pairs.length >= 2) return dice.map((d) => pairs.slice(0,2).includes(d));
  }

  if (target.type === 'pair') {
    return dice.map((d) => d === target.face);
  }

  // Fallback 'high': keep 5s and 6s
  const highKeeps = dice.map((d) => d >= 5);
  if (highKeeps.some(Boolean)) return highKeeps;
  const midKeeps = dice.map((d) => d >= 4);
  if (midKeeps.some(Boolean)) return midKeeps;
  return dice.map(() => false);
}

// ─── Category selection ───────────────────────────────────────────────────────
// Core principles (validated by simulation):
// 1. Chance avg 19.6 pts — use it for mediocre rolls rather than burning a category slot
// 2. NEVER score an upper category below its 3× baseline if a competitive lower option exists
// 3. Baseline trap fix: ones=3 beats twopairs=14 if Tier 4 fires naively — compare absolute values
// 4. Low faces (ones=5max, twos=10max) have low ceilings — sacrifice them early when forced to zero
function aiChooseCategory(scores, dice, errorRate) {
  const unfilled = CATEGORIES.filter((cat) => scores[cat.id] === undefined);
  if (Math.random() < errorRate) {
    return unfilled[Math.floor(Math.random() * unfilled.length)].id;
  }

  const catScore = (id) => {
    const cat = CATEGORIES.find((c) => c.id === id);
    return cat && scores[id] === undefined ? cat.calc(dice) : -1;
  };
  const open = (id) => scores[id] === undefined;
  const faceMap = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
  const upperBaseline  = (id) => (faceMap[id] ?? 0) * 3;
  const upperExcellent = (id) => (faceMap[id] ?? 0) * 4;

  const chanceScore = catScore('chance');

  // Best lower-section score currently available (excluding Chance which we handle separately)
  const bestLowerNow = Math.max(
    catScore('pair'), catScore('twopairs'), catScore('threekind'),
    catScore('fourkind'), catScore('smallstraight'), catScore('largestraight'),
    catScore('house'), catScore('yatzy')
  );

  // ── Tier 1: Unmissable ────────────────────────────────────────────────────
  if (open('yatzy')         && catScore('yatzy') === 50)         return 'yatzy';
  if (open('largestraight') && catScore('largestraight') === 20) return 'largestraight';
  if (open('smallstraight') && catScore('smallstraight') === 15) return 'smallstraight';
  if (open('house')         && catScore('house') > 0)            return 'house';

  // ── Tier 2: 4+ of a face (excellent upper + bonus buffer) ─────────────────
  for (const id of ['sixes', 'fives', 'fours', 'threes', 'twos', 'ones']) {
    if (open(id) && catScore(id) >= upperExcellent(id)) return id;
  }

  // ── Tier 3: 4-of-a-kind lower (≥ 20) ────────────────────────────────────
  if (open('fourkind') && catScore('fourkind') >= 20) return 'fourkind';

  // ── Tier 4: Upper at 3× baseline — BUT only if competitive with lower options
  // Key bug fix: ones=3 passes the baseline test but twopairs=14 is far better.
  // Require: upper score > bestLowerNow OR upper score is the clearly dominant play.
  for (const id of ['sixes', 'fives', 'fours', 'threes', 'twos', 'ones']) {
    if (open(id) && catScore(id) >= upperBaseline(id)) {
      // Only take baseline upper if it's competitive with available lower scores
      // Exception: sixes/fives at baseline (18/15) are always worth taking
      const face = faceMap[id];
      const sc = catScore(id);
      if (face >= 5) return id; // always take sixes/fives at baseline
      if (sc >= bestLowerNow) return id; // upper beats lower — take it
      if (sc >= 12 && bestLowerNow <= 14) return id; // close enough
      // Otherwise defer to lower section this turn
    }
  }

  // ── Tier 5: High three-of-a-kind lower (≥ 15) ────────────────────────────
  if (open('threekind') && catScore('threekind') >= 15) return 'threekind';

  // ── Tier 6: Chance when excellent (≥ 22) ─────────────────────────────────
  if (open('chance') && chanceScore >= 22) return 'chance';

  // ── Tier 7: Two pairs ────────────────────────────────────────────────────
  if (open('twopairs') && catScore('twopairs') > 0) return 'twopairs';

  // ── Tier 8: Strong pair (≥ 10) ───────────────────────────────────────────
  if (open('pair') && catScore('pair') >= 10) return 'pair';

  // ── Tier 9: Chance when good (≥ 17) ─────────────────────────────────────
  if (open('chance') && chanceScore >= 17) return 'chance';

  // ── Tier 10: Any four/three of a kind ────────────────────────────────────
  if (open('fourkind')  && catScore('fourkind')  > 0) return 'fourkind';
  if (open('threekind') && catScore('threekind') > 0) return 'threekind';

  // ── Tier 11: Weaker pair (≥ 6) ───────────────────────────────────────────
  if (open('pair') && catScore('pair') >= 6) return 'pair';

  // ── Tier 12: Below-baseline upper — only low faces, min 2 dice ───────────
  for (const id of ['fours', 'threes', 'twos', 'ones']) {
    if (open(id) && catScore(id) >= faceMap[id] * 2) return id;
  }

  // ── Tier 13: Chance safety net ───────────────────────────────────────────
  if (open('chance') && chanceScore > 0) return 'chance';

  // ── Tier 14: Any positive score ──────────────────────────────────────────
  for (const id of ['fours', 'threes', 'twos', 'ones']) {
    if (open(id) && catScore(id) > 0) return id;
  }
  for (const id of ['fives', 'sixes']) {
    if (open(id) && catScore(id) >= faceMap[id] * 2) return id;
  }
  if (open('pair') && catScore('pair') > 0) return 'pair';

  // ── Tier 15: Sacrifice — least valuable first ─────────────────────────────
  const sacrificeOrder = [
    'yatzy', 'ones', 'twos', 'largestraight', 'smallstraight',
    'house', 'fourkind', 'threekind', 'threes', 'twopairs', 'pair',
    'fours', 'fives', 'sixes', 'chance',
  ];
  for (const id of sacrificeOrder) {
    if (open(id)) return id;
  }

  return unfilled[0].id;
}


function Die({ value, held, onClick, disabled, rolling }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={`Tärning visar ${value}${held ? ', sparad' : ''}`}
      className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-[3px] grid grid-cols-3 grid-rows-3 gap-0.5 p-2 transition-transform duration-150
        ${held ? 'bg-amber-400 border-stone-900 -rotate-3' : 'bg-stone-50 border-stone-900'}
        ${rolling && !held ? 'animate-bounce' : ''}
        ${disabled ? 'opacity-70' : 'active:scale-95'}`}
    >
      {(PIPS[value] || []).map(([r, c], i) => (
        <span
          key={i}
          style={{ gridRow: r, gridColumn: c }}
          className="rounded-full bg-stone-900 w-full h-full self-center justify-self-center max-w-[7px] max-h-[7px] sm:max-w-[8px] sm:max-h-[8px]"
        />
      ))}
      {held && <span className="absolute -top-1.5 -right-1 w-4 h-2 bg-emerald-500 rotate-12 rounded-sm" />}
    </button>
  );
}

// ---------- Score row & totals ----------
function ScoreRow({ category, players, currentPlayer, dice, rollsLeft, mode, selectedCategory, inputBuffer, onSelect, onSelectCell, lastAiAction, houseRules, forcedCat }) {
  return (
    <>
      <div className="sticky left-0 z-10 bg-stone-50 px-2 py-1.5 border-b border-stone-200">
        <p className="text-sm font-semibold text-stone-800 leading-tight">{category.label}</p>
        <p className="text-[10px] text-stone-400 leading-tight">{category.sub}</p>
      </div>
      {players.map((p, idx) => {
        const filled = p.scores[category.id];
        const isFilled = filled !== undefined;
        const isCurrent = idx === currentPlayer;

        if (mode === 'manual') {
          const isActive = isCurrent && selectedCategory === category.id;
          const canSelect = isCurrent && !isFilled;

          let bg = 'bg-transparent';
          let text = 'text-stone-300';
          let content = '–';

          if (isFilled) {
            text = 'text-stone-900 font-bold';
            if (isCurrent) bg = (PLAYER_COLORS[players[idx]?.colorIndex ?? idx % 4]?.light ?? 'bg-emerald-50');
            content = filled;
          } else if (isActive) {
            bg = 'bg-red-100 ring-2 ring-inset ring-red-600';
            text = 'text-red-700 font-extrabold';
          } else if (canSelect) {
            bg = 'bg-amber-50';
            text = 'text-amber-600';
          }

          return (
            <button
              key={idx}
              disabled={!canSelect}
              onClick={() => onSelectCell(category.id)}
              className={`text-center font-mono-score text-sm py-1.5 border-b border-stone-200 ${bg} ${text} ${
                canSelect ? 'active:scale-95' : ''
              }`}
            >
              {content}
            </button>
          );
        }

        // auto mode (app-rolled dice)
        // With joker rule: a filled slot can still be scored if joker applies
        const jokerApplies = isFilled && isJokerEligible(category.id, dice, players[idx]?.scores ?? {}, houseRules);
        const hr = houseRules || DEFAULT_HOUSE_RULES;
        // Forced order: only the required cat is pickable
        const forcedBlocked = hr.forcedOrder && isCurrent && forcedCat && category.id !== forcedCat;
        // Strict upper: lower blocked until upper done
        const strictBlocked = hr.strictUpper && isCurrent && category.section === 'lower' && (() => {
          const sc = players[idx]?.scores ?? {};
          return !CATEGORIES.filter(c => c.section === 'upper').every(c => sc[c.id] !== undefined);
        })();
        const canPick = isCurrent && (!isFilled || jokerApplies) && rollsLeft < 3 && !forcedBlocked && !strictBlocked;
        const potential = canPick ? calcScore(category.id, dice, houseRules, players[idx]?.scores ?? {}) : null;
        const isLastAiCell = lastAiAction && lastAiAction.playerIndex === idx && lastAiAction.categoryId === category.id;
        let bg = 'bg-transparent';
        let text = 'text-stone-300';
        if (forcedBlocked || strictBlocked) {
          bg = 'bg-stone-100';
          text = 'text-stone-300';
        } else if (isFilled) {
          text = 'text-stone-900 font-bold';
          if (isCurrent) bg = (PLAYER_COLORS[players[idx]?.colorIndex ?? idx % 4]?.light ?? 'bg-emerald-50');
          // Briefly highlight the AI's just-scored cell in a distinct amber-orange
          if (isLastAiCell) bg = 'bg-orange-200';
        } else if (canPick) {
          bg = 'bg-amber-100';
          text = 'text-amber-700 opacity-60';
        }

        return (
          <button
            key={idx}
            disabled={!canPick}
            onClick={() => onSelect(category.id)}
            className={`text-center font-mono-score text-sm py-1.5 border-b border-stone-200 ${bg} ${text} ${
              canPick ? 'active:scale-95' : ''
            }`}
          >
            {isFilled ? filled : canPick ? potential : '–'}
          </button>
        );
      })}
    </>
  );
}

function TotalsRow({ label, sub, values, accent }) {
  let rowBg = 'bg-stone-100';
  let textCls = 'text-stone-700';
  let valCls = 'text-stone-800';
  if (accent === 'amber') {
    rowBg = 'bg-amber-100';
    textCls = 'text-amber-700';
    valCls = 'text-amber-700';
  }
  if (accent === 'dark') {
    rowBg = 'bg-stone-900';
    textCls = 'text-stone-50';
    valCls = 'text-amber-400';
  }
  return (
    <>
      <div className={`sticky left-0 z-10 ${rowBg} px-2 py-1.5 border-b border-stone-300`}>
        <p className={`text-sm font-bold ${textCls}`}>{label}</p>
        {sub && <p className="text-[10px] text-stone-400">{sub}</p>}
      </div>
      {values.map((v, i) => (
        <div key={i} className={`text-center font-mono-score text-sm font-bold py-1.5 border-b border-stone-300 ${rowBg} ${valCls}`}>
          {v}
        </div>
      ))}
    </>
  );
}

// ---------- Celebrations ----------
const CONFETTI_COLORS = ['#DC2626', '#F59E0B', '#059669', '#3B82F6', '#FBBF24', '#F472B6'];
const BONUS_CONFETTI_COLORS = ['#2563EB', '#FACC15', '#0EA5E9', '#FBBF24', '#1D4ED8'];

function YatzyCelebration() {
  const pieces = Array.from({ length: 36 }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.3;
        const duration = 1.4 + Math.random() * 1.1;
        const size = 6 + Math.random() * 7;
        return (
          <span
            key={i}
            className="confetti-piece rounded-sm"
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size * 0.45}px`,
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="bg-stone-900 border-4 border-amber-400 rounded-2xl px-8 py-4 text-center"
          style={{ animation: 'celebration-pop 0.4s ease-out' }}
        >
          <p className="font-display font-extrabold text-3xl text-amber-400 tracking-wide">YATZY!</p>
          <p className="font-mono-score text-stone-50 text-sm mt-1">+50 poäng</p>
        </div>
      </div>
    </div>
  );
}

// Similar to the Yatzy celebration, but a calmer blue/gold palette, fewer
// pieces, and a shorter on-screen time — recognizable as a "smaller" win.
function BonusCelebration() {
  const pieces = Array.from({ length: 22 }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.25;
        const duration = 1.1 + Math.random() * 0.8;
        const size = 5 + Math.random() * 5;
        return (
          <span
            key={i}
            className="confetti-piece rounded-full"
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: BONUS_CONFETTI_COLORS[i % BONUS_CONFETTI_COLORS.length],
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="bg-stone-900 border-4 border-sky-400 rounded-2xl px-8 py-4 text-center"
          style={{ animation: 'celebration-pop 0.4s ease-out' }}
        >
          <p className="font-display font-extrabold text-3xl text-sky-400 tracking-wide">BONUS!</p>
          <p className="font-mono-score text-stone-50 text-sm mt-1">+50 poäng</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Loading screen ----------
function BonusYatzyCelebration() {
  const pieces = Array.from({ length: 18 }, (_, i) => ({
    left: `${8 + Math.random() * 84}%`,
    delay: `${Math.random() * 0.4}s`,
    size: 7 + Math.random() * 8,
    color: ['#f59e0b','#10b981','#f59e0b','#10b981','#fbbf24','#34d399'][i % 6],
    rotate: `${Math.random() * 360}deg`,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center">
      {pieces.map((p, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={{
            left: p.left,
            animation: `confetti-fall 1.4s ${p.delay} ease-in forwards`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: '2px',
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
      <div
        className="bg-emerald-600 border-4 border-stone-900 rounded-2xl px-6 py-4 text-center shadow-2xl"
        style={{ animation: 'celebration-pop 0.4s ease-out' }}
      >
        <div className="text-3xl mb-1">🎲</div>
        <p className="font-display font-extrabold text-stone-50 text-xl tracking-tight">BONUS YATZY!</p>
        <p className="font-mono-score text-emerald-200 text-sm font-bold mt-0.5">+50 extrapoäng</p>
      </div>
    </div>
  );
}

function NaturalYatzyCelebration() {
  const pieces = Array.from({ length: 22 }, (_, i) => ({
    left: `${5 + Math.random() * 90}%`,
    delay: `${Math.random() * 0.3}s`,
    size: 8 + Math.random() * 10,
    color: ['#fbbf24','#f59e0b','#ef4444','#fbbf24','#f97316','#fbbf24'][i % 6],
    rotate: `${Math.random() * 360}deg`,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center">
      {pieces.map((p, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={{
            left: p.left,
            animation: `confetti-fall 1.6s ${p.delay} ease-in forwards`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: '2px',
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
      <div
        className="bg-amber-500 border-4 border-stone-900 rounded-2xl px-6 py-4 text-center shadow-2xl"
        style={{ animation: 'celebration-pop 0.4s ease-out' }}
      >
        <div className="text-3xl mb-1">🎯</div>
        <p className="font-display font-extrabold text-stone-900 text-xl tracking-tight">NATURLIG YATZY!</p>
        <p className="font-mono-score text-stone-700 text-sm font-bold mt-0.5">Första kastet · 100 poäng!</p>
      </div>
    </div>
  );
}


// ─── Tournament standings screen ──────────────────────────────────────────────
function TournamentStandingsScreen({ tournament, onNextRound, onAbort }) {
  const { standings, currentRound, rounds } = tournament;
  const sorted = [...standings].sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins : b.totalScore - a.totalScore
  );
  const isLastRound = currentRound >= rounds;
  const leader = sorted[0];

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center px-6 py-10 font-sans">
      <style>{FONT_STYLES}</style>

      {isLastRound ? (
        <>
          <div className="text-5xl mb-3">🏆</div>
          <h1 className="font-display text-4xl font-extrabold text-stone-900 mb-1 tracking-tight">Turnering klar!</h1>
          <p className="text-stone-400 text-xs uppercase tracking-widest mb-6">{rounds} {rounds === 1 ? 'omgång' : 'omgångar'} spelade</p>
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl font-extrabold text-stone-900 mb-1 tracking-tight">
            Omgång {currentRound} av {rounds} klar
          </h1>
          <p className="text-stone-400 text-xs uppercase tracking-widest mb-6">Ställning</p>
        </>
      )}

      <div className="w-full max-w-sm space-y-2 mb-8">
        {sorted.map((p, i) => {
          const pal = PLAYER_COLORS[p.colorIndex ?? i % 4];
          const medals = ['🥇', '🥈', '🥉'];
          const isLeader = i === 0;
          return (
            <div
              key={p.name}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 border-2 ${isLeader ? `${pal.finish}` : 'bg-stone-50 border-stone-200'}`}
            >
              <span className="text-2xl w-8 text-center shrink-0">{medals[i] || `${i + 1}.`}</span>
              <span className="text-xl shrink-0">{p.avatar || AVATAR_OPTIONS[p.colorIndex ?? i]}</span>
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-stone-900 truncate">{p.name}</p>
                <p className="text-[11px] text-stone-400">
                  {p.wins === Math.floor(p.wins) ? p.wins : p.wins.toFixed(1)} {p.wins === 1 ? 'vinst' : 'vinster'} · Totalt {p.totalScore} p
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono-score text-xl font-extrabold text-stone-900">
                  {p.wins % 1 === 0 ? p.wins : p.wins.toFixed(1)}
                </p>
                <p className="text-[10px] text-stone-400">poäng</p>
              </div>
            </div>
          );
        })}
      </div>

      {!isLastRound && (
        <button
          onClick={onNextRound}
          className="w-full max-w-sm py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition mb-3"
        >
          Omgång {currentRound + 1} →
        </button>
      )}
      {isLastRound && (
        <button
          onClick={onAbort}
          className="w-full max-w-sm py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition mb-3"
        >
          Ny turnering
        </button>
      )}
      <button onClick={onAbort} className="text-sm text-stone-400 underline active:scale-95 transition">
        {isLastRound ? 'Ny turnering' : 'Avbryt turnering'}
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center font-sans">
      <style>{FONT_STYLES}</style>
      <h1 className="font-display text-4xl font-extrabold text-stone-900 mb-2 tracking-tight">YATZY</h1>
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-800 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ---------- Stats modal ----------


// ─── House rules modal ────────────────────────────────────────────────────────
const HOUSE_RULE_DEFS = [
  {
    id: 'joker',
    label: 'Joker',
    desc: 'Yatzy som joker — om Yatzy-rutan är fylld kan ett Yatzy-kast räknas som ett par, kåk, etc.',
    emoji: '🃏',
  },
  {
    id: 'bonusYatzy',
    label: 'Bonus-Yatzy',
    desc: 'Varje extra Yatzy ger +50 på toppen av den ruta du väljer att fylla i. Du måste fortfarande fylla en öppen ruta — bonusen är ett tillägg, inte en gratistur.',
    emoji: '✨',
  },
  {
    id: 'naturalBonus',
    label: 'Naturlig Yatzy',
    desc: 'Yatzy på första kastet ger 100 poäng istället för 50.',
    emoji: '🎯',
  },
  {
    id: 'strictUpper',
    label: 'Övre sektion först',
    desc: 'Övre sektionen (ettor–sexor) måste fyllas i innan nedre sektionen kan användas.',
    emoji: '🔒',
  },
  {
    id: 'forcedOrder',
    label: 'Tvingad ordning',
    desc: 'Rutorna måste fyllas uppifrån och ner — ingen valfrihet. Snabbspel för yngre.',
    emoji: '⬇️',
  },
];

function HouseRulesModal({ rules, onChange, onClose }) {
  return (
    <div className="fixed inset-0 bg-stone-900/60 flex items-end justify-center z-50 px-4 pb-6">
      <div className="bg-stone-50 border-4 border-stone-900 rounded-2xl w-full max-w-sm" style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="p-5 pb-3" style={{ flexShrink: 0 }}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display font-extrabold text-xl text-stone-900">⚙️ Husregler</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center font-bold text-stone-900">✕</button>
          </div>
          <p className="text-xs text-stone-400">Aktiva husregler gäller hela spelet. Kan inte ändras efter start.</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 20px 8px' }}>
          <div className="space-y-3">
            {HOUSE_RULE_DEFS.map(def => (
              <label key={def.id} className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition ${rules[def.id] ? 'bg-amber-50 border-amber-400' : 'bg-white border-stone-200'}`}>
                <input
                  type="checkbox"
                  checked={!!rules[def.id]}
                  onChange={e => onChange({ ...rules, [def.id]: e.target.checked })}
                  className="w-5 h-5 mt-0.5 accent-red-600 shrink-0"
                />
                <div>
                  <p className="font-display font-bold text-stone-900 text-sm">{def.emoji} {def.label}</p>
                  <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{def.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="p-5 pt-3" style={{ flexShrink: 0 }}>
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-stone-900 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition text-sm">
            Spara & stäng
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Leaderboard modal ────────────────────────────────────────────────────────
function LeaderboardModal({ leaderboard, onClose, onClear }) {
  const entries = Object.entries(leaderboard)
    .map(([name, d]) => ({ name, ...d, avgScore: d.games > 0 ? Math.round(d.totalScore / d.games) : 0 }))
    .sort((a, b) => b.wins - a.wins || b.bestScore - a.bestScore);

  return (
    <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 px-4">
      <div className="bg-stone-50 border-4 border-stone-900 rounded-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-extrabold text-xl text-stone-900">🏆 Topplista</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center font-bold text-stone-900">✕</button>
        </div>
        {entries.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-4">Inga resultat ännu.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {entries.map((e, i) => (
              <div key={e.name} className={`rounded-xl border-2 px-3 py-2 flex items-center gap-3 ${i === 0 ? 'bg-amber-50 border-amber-400' : 'bg-white border-stone-200'}`}>
                <span className="font-mono-score text-lg font-bold text-stone-400 w-5 text-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-stone-900 truncate">{e.name}</p>
                  <p className="text-[11px] text-stone-400">{e.games} {e.games === 1 ? 'match' : 'matcher'} · Snitt {e.avgScore} p · Bäst {e.bestScore} p</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono-score font-extrabold text-stone-900">{e.wins}</p>
                  <p className="text-[10px] text-stone-400">{e.wins === 1 ? 'vinst' : 'vinster'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-stone-900 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition text-sm">Stäng</button>
          {entries.length > 0 && (
            <button onClick={onClear} className="px-4 py-2.5 rounded-xl border-2 border-stone-300 text-stone-500 font-display font-bold uppercase tracking-wide active:scale-95 transition text-sm">Rensa</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsModal({ stats, onClose, onClear }) {
  const entries = Object.entries(stats).sort((a, b) => b[1].wins - a[1].wins || b[1].bestScore - a[1].bestScore);
  return (
    <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-stone-50 rounded-2xl max-w-sm w-full max-h-[80vh] overflow-auto p-5 border-4 border-stone-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl font-extrabold text-stone-900 mb-1">Statistik</h2>
        <p className="text-xs text-stone-400 mb-3">Sparad på den här enheten, per namn</p>

        {entries.length === 0 ? (
          <p className="text-sm text-stone-500">Inga avslutade matcher än.</p>
        ) : (
          <div className="space-y-2">
            {entries.map(([name, s]) => (
              <div key={name} className="border-b border-stone-100 pb-2">
                <div className="flex items-center justify-between">
                  <p className="font-display font-bold text-stone-800">{name}</p>
                  <p className="font-mono-score text-sm font-bold text-stone-900">{s.bestScore} p</p>
                </div>
                <p className="text-[11px] text-stone-400">
                  {s.games} {s.games === 1 ? 'match' : 'matcher'} · {s.wins} {s.wins === 1 ? 'vinst' : 'vinster'} · Snitt{' '}
                  {Math.round(s.totalScore / s.games)} p · Yatzy ×{s.yatzys}
                </p>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} className="mt-4 w-full py-2.5 rounded-xl bg-stone-900 text-stone-50 font-display font-bold uppercase tracking-wide">
          Stäng
        </button>
        {entries.length > 0 && (
          <button onClick={onClear} className="mt-2 w-full py-2 text-xs text-stone-400 underline">
            Rensa statistik
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Setup screen ----------
function SetupScreen({ numPlayers, setNumPlayers, names, setNames, avatars, setAvatars, aiFlags, setAiFlags, aiDifficulties, setAiDifficulties, onStart, stats, showStats, setShowStats, onClearStats, leaderboard, showLeaderboard, setShowLeaderboard, onClearLeaderboard, rules, onRulesChange, tournamentMode, setTournamentMode, tournamentRounds, setTournamentRounds }) {
  const [shuffleFlash, setShuffleFlash] = React.useState(false);
  const [showHouseRules, setShowHouseRules] = React.useState(false);

  function shufflePlayers() {
    // Shuffle all player slots together (name + avatar + ai flag + difficulty)
    const slots = Array.from({ length: numPlayers }, (_, i) => ({
      name: names[i], avatar: avatars[i], ai: aiFlags[i], diff: aiDifficulties[i],
    }));
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const n = [...names]; const av = [...avatars]; const fl = [...aiFlags]; const di = [...aiDifficulties];
    slots.forEach((s, i) => { n[i] = s.name; av[i] = s.avatar; fl[i] = s.ai; di[i] = s.diff; });
    setNames(n); setAvatars(av); setAiFlags(fl); setAiDifficulties(di);
    setShuffleFlash(true);
    setTimeout(() => setShuffleFlash(false), 500);
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center px-6 py-10 font-sans">
      <style>{FONT_STYLES}</style>
      <h1 className="font-display text-5xl font-extrabold text-stone-900 mb-1 tracking-tight">YATZY</h1>
      <p className="text-stone-400 text-xs uppercase tracking-widest mb-8">Svenska poängregler</p>

      <div className="w-full max-w-sm bg-stone-50 border-4 border-stone-900 rounded-2xl p-5">
        {/* Player count row */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-display font-bold text-stone-800">Antal spelare</p>
          {numPlayers > 1 && (
            <button
              onClick={shufflePlayers}
              className={`text-xs px-3 py-1 rounded-full border-2 border-stone-300 text-stone-500 font-display font-bold active:scale-95 transition ${shuffleFlash ? 'bg-amber-100 border-amber-400 text-amber-700' : ''}`}
            >
              🔀 Blanda
            </button>
          )}
        </div>
        <div className="flex items-center justify-center gap-4 mb-5">
          <button
            onClick={() => setNumPlayers(Math.max(1, numPlayers - 1))}
            className="w-10 h-10 rounded-full border-2 border-stone-900 font-display font-bold text-xl text-stone-900 active:scale-95"
          >
            −
          </button>
          <span className="font-mono-score text-3xl font-bold w-10 text-center text-stone-900">{numPlayers}</span>
          <button
            onClick={() => setNumPlayers(Math.min(4, numPlayers + 1))}
            className="w-10 h-10 rounded-full border-2 border-stone-900 font-display font-bold text-xl text-stone-900 active:scale-95"
          >
            +
          </button>
        </div>

        <div className="space-y-4 mb-6">
          {Array.from({ length: numPlayers }).map((_, i) => {
            const pal = PLAYER_COLORS[i];
            return (
              <div key={i} className={`rounded-xl border-2 p-3 ${pal.light} border-stone-200`}>
                {/* Avatar row */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {AVATAR_OPTIONS.map((em) => (
                    <button
                      key={em}
                      onClick={() => { const a = [...avatars]; a[i] = em; setAvatars(a); }}
                      className={`text-lg rounded-lg p-0.5 transition leading-none ${avatars[i] === em ? 'ring-2 ring-stone-900 bg-white/80' : 'opacity-50 active:opacity-100'}`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <input
                  value={names[i]}
                  onChange={(e) => { const n = [...names]; n[i] = e.target.value; setNames(n); }}
                  placeholder={aiFlags[i] ? `Dator ${i + 1}` : `Spelare ${i + 1}`}
                  className={`w-full px-3 py-2 rounded-lg border-2 border-stone-300 focus:outline-none text-stone-800 bg-white focus:border-stone-600`}
                />
                <div className="flex items-center gap-3 mt-1.5 pl-1">
                  <label className="flex items-center gap-1.5 text-xs text-stone-500">
                    <input
                      type="checkbox"
                      checked={aiFlags[i]}
                      onChange={(e) => { const flags = [...aiFlags]; flags[i] = e.target.checked; setAiFlags(flags); }}
                      className="w-4 h-4 accent-red-600"
                    />
                    Dator
                  </label>
                  {aiFlags[i] && (
                    <select
                      value={aiDifficulties[i]}
                      onChange={(e) => { const diffs = [...aiDifficulties]; diffs[i] = e.target.value; setAiDifficulties(diffs); }}
                      className="text-xs px-2 py-1 rounded-lg border-2 border-stone-300 text-stone-700 bg-stone-50 focus:border-red-600 focus:outline-none"
                    >
                      {AI_DIFFICULTY_ORDER.map((id) => (
                        <option key={id} value={id}>{AI_DIFFICULTIES[id].label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tournament mode toggle */}
        <div className={`rounded-xl border-2 p-3 mb-4 transition ${tournamentMode ? 'bg-amber-50 border-amber-400' : 'bg-white border-stone-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tournamentMode}
              onChange={e => setTournamentMode(e.target.checked)}
              className="w-5 h-5 accent-red-600 shrink-0"
            />
            <div className="flex-1">
              <p className="font-display font-bold text-stone-900 text-sm">🏆 Turnering</p>
              <p className="text-xs text-stone-500 mt-0.5">Spela flera omgångar med poängställning</p>
            </div>
          </label>
          {tournamentMode && (
            <div className="mt-3 flex items-center gap-3 pl-8">
              <p className="text-xs text-stone-600 font-display font-bold">Omgångar:</p>
              {[1, 2, 3, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setTournamentRounds(n)}
                  className={`w-9 h-9 rounded-full font-display font-bold text-sm transition active:scale-95 ${tournamentRounds === n ? 'bg-red-600 text-stone-50' : 'border-2 border-stone-300 text-stone-600'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active house rules badge */}
        {Object.values(rules).some(Boolean) && (
          <div className="mb-3 flex flex-wrap gap-1">
            {HOUSE_RULE_DEFS.filter(d => rules[d.id]).map(d => (
              <span key={d.id} className="text-xs bg-amber-100 border border-amber-400 text-amber-800 rounded-full px-2 py-0.5 font-display font-bold">
                {d.emoji} {d.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => setShowHouseRules(true)}
            className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-display font-bold uppercase tracking-wide active:scale-95 transition text-sm"
          >
            ⚙️ Husregler
          </button>
          <button
            onClick={onStart}
            className="flex-1 py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition text-sm"
          >
            Starta spelet
          </button>
        </div>
      </div>

      <div className="flex gap-4 mt-4">
        <button onClick={() => setShowStats(true)} className="text-sm text-stone-500 underline active:scale-95 transition">
          Visa statistik
        </button>
        <button onClick={() => setShowLeaderboard(true)} className="text-sm text-stone-500 underline active:scale-95 transition">
          🏆 Topplista
        </button>
      </div>

      <p className="text-stone-400 text-xs mt-6 text-center max-w-xs leading-relaxed">
        15 omgångar per spelare. Tre kast per omgång – tryck på en tärning för att spara den till nästa kast.
      </p>

      {showStats && <StatsModal stats={stats} onClose={() => setShowStats(false)} onClear={onClearStats} />}
      {showLeaderboard && <LeaderboardModal leaderboard={leaderboard} onClose={() => setShowLeaderboard(false)} onClear={onClearLeaderboard} />}
      {showHouseRules && <HouseRulesModal rules={rules} onChange={onRulesChange} onClose={() => setShowHouseRules(false)} />}
    </div>
  );
}

// ---------- Finished screen ----------
function FinishedScreen({ players, onRestart, onUndo, canUndo, stats, leaderboard, onClearLeaderboard, tournament, onNextRound, onEndTournament }) {
  const results = players.map((p) => ({ ...p, ...calcTotals(p.scores) })).sort((a, b) => b.total - a.total);
  const [showLeaderboard, setShowLeaderboard] = React.useState(false);
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center px-6 py-10 font-sans">
      <style>{FONT_STYLES}</style>
      <h1 className="font-display text-4xl font-extrabold text-stone-900 mb-1 tracking-tight">Slutresultat</h1>
      <p className="text-stone-400 text-xs uppercase tracking-widest mb-6">15 rutor avklarade</p>

      <div className="w-full max-w-sm space-y-2">
        {results.map((r, i) => {
          const pal = PLAYER_COLORS[r.colorIndex ?? i % 4];
          return (
            <div
              key={i}
              className={`flex items-center justify-between rounded-xl px-4 py-3 border-2 ${
                i === 0 ? `${pal.finish}` : 'bg-stone-50 border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">{r.avatar || AVATAR_OPTIONS[r.colorIndex ?? i]}</span>
                {i === 0 && <Trophy className="w-5 h-5 text-amber-600 shrink-0" />}
                <div>
                  <p className="font-display font-bold text-stone-900">{r.name}</p>
                  <p className="text-[11px] text-stone-400">
                    Övre {r.upperSum}
                    {r.bonus ? ` (+${r.bonus} bonus)` : ''} · Nedre {r.lowerSum}
                  </p>
                  {stats[r.name] && (
                    <p className="text-[11px] text-stone-400">
                      {stats[r.name].games} {stats[r.name].games === 1 ? 'match' : 'matcher'} totalt · {stats[r.name].wins}{' '}
                      {stats[r.name].wins === 1 ? 'vinst' : 'vinster'} · Bästa {stats[r.name].bestScore} p
                    </p>
                  )}
                </div>
              </div>
              <span className="font-mono-score text-2xl font-extrabold text-stone-900">{r.total}</span>
            </div>
          );
        })}
      </div>

      {tournament ? (
        <div className="mt-8 w-full max-w-sm space-y-3">
          <div className="rounded-xl bg-stone-800 text-stone-50 px-4 py-2 text-center text-xs font-display font-bold uppercase tracking-widest">
            Omgång {tournament.currentRound} av {tournament.rounds}
          </div>
          {tournament.currentRound < tournament.rounds ? (
            <button
              onClick={onNextRound}
              className="w-full py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition"
            >
              Omgång {tournament.currentRound + 1} →
            </button>
          ) : (
            <button
              onClick={onEndTournament}
              className="w-full py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition"
            >
              🏆 Visa resultat
            </button>
          )}
          <button onClick={onRestart} className="w-full text-sm text-stone-400 underline active:scale-95 transition text-center">
            Avbryt turnering
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={onRestart}
            className="mt-8 px-8 py-3 rounded-xl bg-red-600 text-stone-50 font-display font-bold uppercase tracking-wide active:scale-95 transition"
          >
            Spela igen
          </button>

          <button onClick={() => setShowLeaderboard(true)} className="mt-3 text-sm text-stone-500 underline active:scale-95 transition">
            🏆 Topplista
          </button>
        </>
      )}

      {canUndo && !tournament && (
        <button onClick={onUndo} className="mt-3 text-sm text-stone-400 underline active:scale-95 transition">
          Ångra senaste registreringen
        </button>
      )}

      {showLeaderboard && <LeaderboardModal leaderboard={leaderboard} onClose={() => setShowLeaderboard(false)} onClear={onClearLeaderboard} />}
    </div>
  );
}

// ---------- Main app ----------
export default function YatzyApp() {
  const [phase, setPhase] = useState('setup'); // setup | playing | finished
  const [numPlayers, setNumPlayers] = useState(1);
  const [names, setNames] = useState(['', '', '', '']);
  const [aiFlags, setAiFlags] = useState([false, false, false, false]);
  const [aiDifficulties, setAiDifficulties] = useState(['mellan', 'mellan', 'mellan', 'mellan']);
  const [avatars, setAvatars] = useState([null, null, null, null]);
  const [leaderboard, setLeaderboard] = useState({});
  const [houseRules, setHouseRules] = useState({ ...DEFAULT_HOUSE_RULES });

  // Tournament state
  const [tournamentMode, setTournamentMode] = useState(false);
  const [tournamentRounds, setTournamentRounds] = useState(3);
  // tournament: null | { rounds, currentRound, standings: [{name,avatar,colorIndex,wins,totalScore,gamesPlayed}] }
  const [tournament, setTournament] = useState(null);
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const [players, setPlayers] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [dice, setDice] = useState([1, 2, 3, 4, 5]);
  const [held, setHeld] = useState([false, false, false, false, false]);
  const [rollsLeft, setRollsLeft] = useState(3);
  const [rolling, setRolling] = useState(false);
  const [turnsPlayed, setTurnsPlayed] = useState(0);
  const [history, setHistory] = useState([]); // stack of {playerIndex, categoryId} for undo
  const [mode, setMode] = useState('auto'); // 'auto' = app rolls, 'manual' = type in scores yourself
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [inputBuffer, setInputBuffer] = useState('');
  const [inputError, setInputError] = useState(null);

  const [showRules, setShowRules] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [celebration, setCelebration] = useState(null); // null | 'yatzy' | 'bonus'
  const [editingPlayer, setEditingPlayer] = useState(null); // player index being renamed, or null
  const [editNameValue, setEditNameValue] = useState('');

  // Cross-session stats (per player name): games, wins, totalScore, bestScore, yatzys
  const [stats, setStats] = useState({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsRecorded, setStatsRecorded] = useState(false); // has this finished game been added to stats?
  const [statsSnapshot, setStatsSnapshot] = useState(null); // pre-update stats, for undo
  const [showStats, setShowStats] = useState(false);

  // Track what the AI just did so we can show its dice + highlight its scored category
  const [lastAiAction, setLastAiAction] = useState(null); // { dice, categoryId, playerIndex } | null

  const intervalRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const celebrationTimeoutRef = useRef(null);
  const rollSoundIndexRef = useRef(0);
  const initialRollRef = useRef(false); // true on the very first roll of a turn (for naturalBonus)
  const aiTimeoutRef = useRef(null);
  const houseRulesRef = useRef(houseRules);
  useEffect(() => { houseRulesRef.current = houseRules; }, [houseRules]);
  useEffect(() => () => intervalRef.current && clearInterval(intervalRef.current), []);
  useEffect(() => () => celebrationTimeoutRef.current && clearTimeout(celebrationTimeoutRef.current), []);
  useEffect(() => () => aiTimeoutRef.current && clearTimeout(aiTimeoutRef.current), []);

  // Plays a sound + haptic pattern together, respecting the sound toggle
  function feedback(soundFn, pattern) {
    if (!soundEnabled) return;
    soundFn();
    if (pattern) vibrate(pattern);
  }

  // Restore a saved game (if any) on first load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.storage) {
          const result = await window.storage.get(STORAGE_KEY);
          const saved = result && result.value ? JSON.parse(result.value) : null;
          if (saved && !cancelled) {
            if (Array.isArray(saved.names)) setNames(saved.names);
            if (typeof saved.numPlayers === 'number') setNumPlayers(saved.numPlayers);
            if (Array.isArray(saved.aiFlags)) setAiFlags(saved.aiFlags);
            if (Array.isArray(saved.aiDifficulties)) setAiDifficulties(saved.aiDifficulties);
            if (Array.isArray(saved.avatars)) setAvatars(saved.avatars);
            if (saved.houseRules && typeof saved.houseRules === 'object') setHouseRules({ ...DEFAULT_HOUSE_RULES, ...saved.houseRules });
            if (saved.tournament) setTournament(saved.tournament);
            if (typeof saved.tournamentMode === 'boolean') setTournamentMode(saved.tournamentMode);
            if (typeof saved.tournamentRounds === 'number') setTournamentRounds(saved.tournamentRounds);
            if (saved.mode === 'auto' || saved.mode === 'manual') setMode(saved.mode);
            if (typeof saved.soundEnabled === 'boolean') setSoundEnabled(saved.soundEnabled);
            if (typeof saved.statsRecorded === 'boolean') setStatsRecorded(saved.statsRecorded);
            if (saved.statsSnapshot && typeof saved.statsSnapshot === 'object') setStatsSnapshot(saved.statsSnapshot);
            if ((saved.phase === 'playing' || saved.phase === 'finished') && Array.isArray(saved.players) && saved.players.length > 0) {
              setPlayers(saved.players);
              setCurrentPlayer(saved.currentPlayer ?? 0);
              setDice(Array.isArray(saved.dice) ? saved.dice : [1, 2, 3, 4, 5]);
              const restoredHeld = Array.isArray(saved.held) ? saved.held.map(Boolean) : [false, false, false, false, false];
              setHeld(restoredHeld);
              setRollsLeft(saved.rollsLeft ?? 3);
              setTurnsPlayed(saved.turnsPlayed ?? 0);
              setHistory(Array.isArray(saved.history) ? saved.history : []);
              setPhase(saved.phase);
            }
          }
        }
      } catch {
        // No saved game, or storage unavailable — start fresh
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load cross-session stats (per player name)
  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.storage) {
          const result = await window.storage.get(STATS_KEY);
          const savedStats = result && result.value ? JSON.parse(result.value) : null;
          if (savedStats && typeof savedStats === 'object') setStats(savedStats);
        }
      } catch {
        // No stats yet
      } finally {
        setStatsLoaded(true);
      }
    })();
  }, []);

  // Load leaderboard
  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.storage) {
          const result = await window.storage.get(LEADERBOARD_KEY);
          const saved = result && result.value ? JSON.parse(result.value) : null;
          if (saved && typeof saved === 'object') setLeaderboard(saved);
        }
      } catch {}
      finally { setLeaderboardLoaded(true); }
    })();
  }, []);

  // Auto-save the game so it can be resumed later (debounced to avoid spamming storage)
  useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined' || !window.storage) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const state = {
        phase, numPlayers, names, aiFlags, aiDifficulties, avatars, houseRules, tournament, tournamentMode, tournamentRounds, players, currentPlayer, dice, held, rollsLeft, turnsPlayed, history, mode, soundEnabled,
        statsRecorded, statsSnapshot,
      };
      window.storage.set(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [loading, phase, numPlayers, names, aiFlags, aiDifficulties, avatars, houseRules, tournament, tournamentMode, tournamentRounds, players, currentPlayer, dice, held, rollsLeft, turnsPlayed, history, mode, soundEnabled, statsRecorded, statsSnapshot]);

  function persistStats(newStats) {
    setStats(newStats);
    if (typeof window !== 'undefined' && window.storage) {
      window.storage.set(STATS_KEY, JSON.stringify(newStats)).catch(() => {});
    }
  }

  function persistLeaderboard(lb) {
    setLeaderboard(lb);
    if (typeof window !== 'undefined' && window.storage) {
      window.storage.set(LEADERBOARD_KEY, JSON.stringify(lb)).catch(() => {});
    }
  }

  // Record this game's results into cross-session stats, once
  // Skip entirely if any house rule is active — modified rules inflate scores.
  useEffect(() => {
    if (loading || !statsLoaded || phase !== 'finished' || statsRecorded) return;
    if (Object.values(houseRules).some(Boolean)) { setStatsRecorded(true); return; }
    const totals = players.map((p) => calcTotals(p.scores).total);
    const maxTotal = Math.max(...totals);

    const snapshot = {};
    const newStats = { ...stats };
    players.forEach((p, idx) => {
      // AI players never appear in statistics
      if (p.isAI) return;
      snapshot[p.name] = newStats[p.name] ? { ...newStats[p.name] } : null;
      const prev = newStats[p.name] || { games: 0, wins: 0, totalScore: 0, bestScore: 0, yatzys: 0 };
      const isWinner = numPlayers > 1 && totals[idx] === maxTotal;
      const yatzyCount = p.scores.yatzy === 50 ? 1 : 0;
      newStats[p.name] = {
        games: prev.games + 1,
        wins: prev.wins + (isWinner ? 1 : 0),
        totalScore: prev.totalScore + totals[idx],
        bestScore: Math.max(prev.bestScore, totals[idx]),
        yatzys: prev.yatzys + yatzyCount,
      };
    });

    persistStats(newStats);
    setStatsSnapshot(snapshot);
    setStatsRecorded(true);

    // Update leaderboard (all-time wins + best score, including AI for now)
    const newLb = { ...leaderboard };
    players.forEach((p, idx) => {
      if (p.isAI) return;
      const isWinner = numPlayers > 1 && totals[idx] === maxTotal;
      const prev = newLb[p.name] || { wins: 0, games: 0, bestScore: 0, totalScore: 0 };
      newLb[p.name] = {
        wins: prev.wins + (isWinner ? 1 : 0),
        games: prev.games + 1,
        bestScore: Math.max(prev.bestScore, totals[idx]),
        totalScore: prev.totalScore + totals[idx],
      };
    });
    persistLeaderboard(newLb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, statsLoaded, phase, statsRecorded]);

  function startGame() {
    const initPlayers = Array.from({ length: numPlayers }, (_, i) => {
      if (aiFlags[i]) {
        const diff = AI_DIFFICULTIES[aiDifficulties[i]] || AI_DIFFICULTIES.mellan;
        const { name } = parseNameInput(names[i], `Dator ${i + 1}`);
        return { name, scores: {}, isAI: true, difficulty: aiDifficulties[i], lucky: diff.lucky, unlucky: diff.unlucky, colorIndex: i, avatar: avatars[i] || AVATAR_OPTIONS[i] };
      }
      const { name, lucky } = parseNameInput(names[i], `Spelare ${i + 1}`);
      return { name, scores: {}, isAI: false, lucky, unlucky: false, colorIndex: i, avatar: avatars[i] || AVATAR_OPTIONS[i] };
    });
    // Initialise tournament if mode is on
    if (tournamentMode) {
      setTournament({
        rounds: tournamentRounds,
        currentRound: 1,
        standings: initPlayers.map(p => ({ name: p.name, avatar: p.avatar, colorIndex: p.colorIndex, wins: 0, totalScore: 0, gamesPlayed: 0 })),
      });
    } else {
      setTournament(null);
    }
    setPlayers(initPlayers);
    setCurrentPlayer(0);
    setDice([1, 2, 3, 4, 5]);
    setHeld([false, false, false, false, false]);
    setRollsLeft(3);
    setTurnsPlayed(0);
    setHistory([]);
    setStatsRecorded(false);
    setStatsSnapshot(null);
    if (aiFlags.slice(0, numPlayers).some(Boolean)) setMode('auto');
    setPhase('playing');
  }

  // Start next tournament round — carry over players but clear scores
  function nextTournamentRound() {
    const totals = players.map(p => calcTotals(p.scores).total);
    const maxTotal = Math.max(...totals);
    // Count winners (ties split the win)
    const winnerCount = totals.filter(t => t === maxTotal).length;
    const newStandings = tournament.standings.map((s, idx) => {
      const roundTotal = totals[idx] ?? 0;
      const isWinner = roundTotal === maxTotal;
      return {
        ...s,
        wins: s.wins + (isWinner ? 1 / winnerCount : 0),
        totalScore: s.totalScore + roundTotal,
        gamesPlayed: s.gamesPlayed + 1,
      };
    });
    const newTournament = {
      ...tournament,
      currentRound: tournament.currentRound + 1,
      standings: newStandings,
    };
    setTournament(newTournament);
    // Reset game state for next round
    setPlayers(prev => prev.map(p => ({ ...p, scores: {} })));
    setCurrentPlayer(0);
    setDice([1, 2, 3, 4, 5]);
    setHeld([false, false, false, false, false]);
    setRollsLeft(3);
    setTurnsPlayed(0);
    setHistory([]);
    setStatsRecorded(false);
    setStatsSnapshot(null);
    setPhase('playing');
  }

  // End tournament — update standings for final round then show champion screen
  function endTournament() {
    const totals = players.map(p => calcTotals(p.scores).total);
    const maxTotal = Math.max(...totals);
    const winnerCount = totals.filter(t => t === maxTotal).length;
    const finalStandings = tournament.standings.map((s, idx) => ({
      ...s,
      wins: s.wins + (totals[idx] === maxTotal ? 1 / winnerCount : 0),
      totalScore: s.totalScore + (totals[idx] ?? 0),
      gamesPlayed: s.gamesPlayed + 1,
    }));
    setTournament({ ...tournament, currentRound: tournament.rounds, standings: finalStandings });
    setPhase('tournament-standings');
  }

  function abortTournament() {
    setTournament(null);
    setTournamentMode(false);
    resetGame();
  }

  function resetGame() {
    setPhase('setup');
    setPlayers([]);
    setHistory([]);
    setStatsRecorded(false);
    setStatsSnapshot(null);
    setConfirmReset(false);
    setTournament(null);
    setTournamentMode(false);
  }

  function rollDice(forcedHeld) {
    if (rolling || rollsLeft === 0) return;
    // When a human rolls, clear the AI's last-action display
    if (!players[currentPlayer]?.isAI) setLastAiAction(null);
    const isFirstRoll = rollsLeft === 3;
    if (isFirstRoll) initialRollRef.current = true;
    const player = players[currentPlayer];
    const lucky = !!player?.lucky;
    const unlucky = !!player?.unlucky;
    // Snapshot the effective held state right now so the interval closure never goes stale
    const safeForced = Array.isArray(forcedHeld) && forcedHeld.length === 5
      ? forcedHeld.map(Boolean)
      : null;
    const heldSnapshot = safeForced || held.map(Boolean);
    if (safeForced) setHeld(safeForced);
    const variant = rollSoundIndexRef.current;
    rollSoundIndexRef.current = (rollSoundIndexRef.current + 1) % ROLL_SOUND_VARIANTS;
    feedback(() => playRollSound(variant), [10, 40, 10, 40, 10, 40, 30]);
    setRolling(true);
    let ticks = 0;
    intervalRef.current = setInterval(() => {
      ticks++;
      setDice((prev) => prev.map((d, i) => (heldSnapshot[i] ? d : rollDie(lucky, unlucky))));
      if (ticks >= 8) {
        clearInterval(intervalRef.current);
        setRolling(false);
        setRollsLeft((r) => r - 1);
      }
    }, 70);
  }

  function toggleHold(i) {
    if (rolling || rollsLeft === 3 || rollsLeft === 0) return;
    feedback(playHoldSound, 8);
    setHeld((h) => {
      if (!Array.isArray(h)) return [false, false, false, false, false].map((v, idx) => idx === i);
      return h.map((v, idx) => (idx === i ? !v : v));
    });
  }

  // Shared logic: record a score for the current player and advance to the next turn
  function recordScore(catId, score, bonusYatzyFired = false) {
    const cat = CATEGORIES.find((c) => c.id === catId);
    const prevUpperSum = calcTotals(players[currentPlayer].scores).upperSum;
    const isAITurn = !!players[currentPlayer]?.isAI;
    const updated = players.map((p, idx) =>
      idx === currentPlayer ? { ...p, scores: { ...p.scores, [catId]: score } } : p
    );
    const newUpperSum = calcTotals(updated[currentPlayer].scores).upperSum;
    setPlayers(updated);
    // Remember what the AI just scored so we can show its dice + highlight its category
    if (isAITurn) {
      setLastAiAction({ dice: [...dice], categoryId: catId, playerIndex: currentPlayer });
    } else {
      setLastAiAction(null);
    }
    setHistory((h) => [
      ...h,
      {
        playerIndex: currentPlayer,
        categoryId: catId,
        prevDice: [...dice],
        prevHeld: [...held],
        prevRollsLeft: rollsLeft,
      },
    ]);
    setSelectedCategory(null);
    setInputBuffer('');
    setInputError(null);

    const justGotBonus = cat.section === 'upper' && prevUpperSum < 63 && newUpperSum >= 63;

    if (catId === 'yatzy' && (score === 50 || score === 100)) {
      feedback(playYatzySound, [60, 50, 60, 50, 60, 50, 120]);
      setCelebration(score === 100 ? 'naturalyatzy' : 'yatzy');
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = setTimeout(() => setCelebration(null), 2200);
    } else if (bonusYatzyFired) {
      feedback(playBonusSound, [30, 30, 60, 30, 30, 60, 80]);
      setCelebration('bonusyatzy');
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = setTimeout(() => setCelebration(null), 1600);
    } else if (justGotBonus) {
      feedback(playBonusSound, [40, 40, 40, 40, 90]);
      setCelebration('bonus');
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = setTimeout(() => setCelebration(null), 1800);
    } else if (score === 0) {
      feedback(playStrokeSound, 20);
    } else {
      feedback(playConfirmSound, 18);
    }

    const nextTurn = turnsPlayed + 1;
    setTurnsPlayed(nextTurn);

    if (nextTurn === numPlayers * 15) {
      if (tournament) {
        // Let the stats effect fire (it won't save if houseRules active), then go to standings
        setPhase('finished'); // will redirect below
      } else {
        setPhase('finished');
      }
      return;
    }
    setCurrentPlayer((currentPlayer + 1) % numPlayers);
    setDice([1, 2, 3, 4, 5]);
    setHeld([false, false, false, false, false]);
    setRollsLeft(3);
    initialRollRef.current = false;
  }

  // Undo the most recent score, one entry at a time. Restores the dice/holds/rolls
  // exactly as they were before that score was picked, so it can be reassigned.
  function undo() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setPlayers((prev) =>
      prev.map((p, idx) => {
        if (idx !== last.playerIndex) return p;
        const newScores = { ...p.scores };
        delete newScores[last.categoryId];
        return { ...p, scores: newScores };
      })
    );
    setTurnsPlayed((t) => t - 1);
    setCurrentPlayer(last.playerIndex);
    setDice(Array.isArray(last.prevDice) ? last.prevDice : [1, 2, 3, 4, 5]);
    setHeld(Array.isArray(last.prevHeld) ? last.prevHeld.map(Boolean) : [false, false, false, false, false]);
    setRollsLeft(last.prevRollsLeft);
    setSelectedCategory(null);
    setInputBuffer('');
    setInputError(null);
    if (phase === 'finished') {
      setPhase('playing');
      if (statsRecorded && statsSnapshot) {
        const restored = { ...stats };
        Object.entries(statsSnapshot).forEach(([name, prevValue]) => {
          if (prevValue === null) delete restored[name];
          else restored[name] = prevValue;
        });
        persistStats(restored);
        setStatsSnapshot(null);
        setStatsRecorded(false);
      }
    }
    if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    setCelebration(null);
    setLastAiAction(null);
  }

  // Auto mode: score is derived from the app-rolled dice
  function selectCategory(catId) {
    if (rolling || rollsLeft === 3) return;
    const current = players[currentPlayer];
    const hr = houseRulesRef.current;

    // Forced order: only the next unfilled category is allowed
    if (hr.forcedOrder) {
      const required = forcedOrderCat(current.scores);
      if (catId !== required) return;
    }

    // Strict upper: lower section locked until all upper cats are filled
    if (hr.strictUpper) {
      const cat = CATEGORIES.find(c => c.id === catId);
      if (cat?.section === 'lower') {
        const upperDone = CATEGORIES.filter(c => c.section === 'upper').every(c => current.scores[c.id] !== undefined);
        if (!upperDone) return;
      }
    }

    if (current.scores[catId] !== undefined) {
      // Joker: if slot is filled but joker applies, we can still use it
      if (!isJokerEligible(catId, dice, current.scores, hr)) return;
    }

    // Calculate score with house rules
    let score = calcScore(catId, dice, hr, current.scores);

    // Joker: if natural score is 0 but joker applies, treat as non-zero pair/whatever
    // The scored value is just the natural calcScore result (already handled above)

    // Natural bonus: Yatzy on first roll scores 100
    if (catId === 'yatzy' && score === 50 && hr.naturalBonus && initialRollRef.current && rollsLeft === 2) {
      score = 100;
    }

    // Bonus Yatzy: already scored a Yatzy (50 or 100), rolling another — add 50
    let bonusYatzyFired = false;
    if (catId !== 'yatzy' && counts(dice).includes(5) && hr.bonusYatzy && current.scores['yatzy'] !== undefined && current.scores['yatzy'] > 0) {
      score = Math.max(score, 0) + 50;
      bonusYatzyFired = true;
    }

    initialRollRef.current = false;
    recordScore(catId, score, bonusYatzyFired);
  }

  // AI turn: roll, hold/re-roll twice more, then lock in a category — paced with
  // short "thinking" pauses so it plays out like a human turn.
  useEffect(() => {
    if (loading || phase !== 'playing' || mode !== 'auto') return;
    if (rolling || celebration) return;
    if (showRules || confirmReset || editingPlayer !== null || showStats) return;
    const player = players[currentPlayer];
    if (!player?.isAI) return;

    const errorRate = AI_DIFFICULTIES[player.difficulty]?.errorRate ?? 0;

    aiTimeoutRef.current = setTimeout(() => {
      if (rollsLeft === 3) {
        rollDice();
      } else if (rollsLeft > 0) {
        rollDice(aiChooseHolds(dice, player.scores, errorRate, rollsLeft));
      } else {
        {
          const hr = houseRulesRef.current;
          let catId = aiChooseCategory(player.scores, dice, errorRate);
          // If forced order is on, override the AI's choice
          if (hr.forcedOrder) {
            catId = forcedOrderCat(player.scores) || catId;
          }
          // If strict upper is on, only allow upper cats until all are done
          if (hr.strictUpper) {
            const upperDone = CATEGORIES.filter(c => c.section === 'upper').every(c => player.scores[c.id] !== undefined);
            if (!upperDone) {
              const upperCat = aiChooseCategory(player.scores, dice, errorRate);
              const cat = CATEGORIES.find(c => c.id === upperCat);
              if (cat?.section === 'lower') {
                catId = CATEGORIES.find(c => c.section === 'upper' && player.scores[c.id] === undefined)?.id || upperCat;
              }
            }
          }
          selectCategory(catId);
        }
      }
    }, 700);

    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, phase, mode, rolling, celebration, showRules, confirmReset, editingPlayer, showStats, players, currentPlayer, rollsLeft, dice]);

  // Manual mode: pick which category to enter a score for
  function onSelectCell(catId) {
    setSelectedCategory((prev) => (prev === catId ? null : catId));
    setInputBuffer('');
    setInputError(null);
  }

  function pressDigit(n) {
    if (!selectedCategory) return;
    setInputError(null);
    setInputBuffer((b) => (b.length >= 2 ? b : b + String(n)));
  }

  function backspace() {
    setInputError(null);
    setInputBuffer((b) => b.slice(0, -1));
  }

  // Manual mode: confirm the typed number, or the suggested default if nothing was typed
  function confirmScore() {
    if (!selectedCategory) return;
    const score = inputBuffer !== '' ? parseInt(inputBuffer, 10) : getDefaultScore(selectedCategory);
    if (score === null) return;
    if (!isValidScore(selectedCategory, score)) {
      const label = CATEGORIES.find((c) => c.id === selectedCategory)?.label;
      setInputError(`${score} p går inte att få på ${label}. Kontrollera värdet eller tryck ✕ för att stryka.`);
      return;
    }
    recordScore(selectedCategory, score);
  }

  // Manual mode: cross out the category for 0 points ("streck")
  function crossOut() {
    if (!selectedCategory) return;
    recordScore(selectedCategory, 0);
  }

  function switchMode(newMode) {
    setMode(newMode);
    setSelectedCategory(null);
    setInputBuffer('');
    setInputError(null);
  }

  function closeKeypad() {
    setSelectedCategory(null);
    setInputBuffer('');
    setInputError(null);
  }

  // In-game name editing. Pre-fills with a trailing space if the "lucky" flag is
  // already on, so saving without changes doesn't silently flip it off.
  function openEditName(idx) {
    const p = players[idx];
    setEditingPlayer(idx);
    setEditNameValue(p.lucky ? `${p.name} ` : p.name);
  }

  function saveEditName() {
    if (editingPlayer === null) return;
    const { name, lucky } = parseNameInput(editNameValue, players[editingPlayer].name);
    setPlayers((prev) => prev.map((p, idx) => (idx === editingPlayer ? { ...p, name, lucky } : p)));
    setEditingPlayer(null);
    setEditNameValue('');
  }

  function cancelEditName() {
    setEditingPlayer(null);
    setEditNameValue('');
  }

  if (loading) {
    return <LoadingScreen />;
  }
  if (phase === 'setup') {
    return (
      <SetupScreen
        numPlayers={numPlayers}
        setNumPlayers={setNumPlayers}
        names={names}
        setNames={setNames}
        avatars={avatars}
        setAvatars={setAvatars}
        aiFlags={aiFlags}
        setAiFlags={setAiFlags}
        aiDifficulties={aiDifficulties}
        setAiDifficulties={setAiDifficulties}
        onStart={startGame}
        stats={stats}
        showStats={showStats}
        setShowStats={setShowStats}
        onClearStats={() => persistStats({})}
        leaderboard={leaderboard}
        showLeaderboard={showLeaderboard}
        setShowLeaderboard={setShowLeaderboard}
        onClearLeaderboard={() => persistLeaderboard({})}
        rules={houseRules}
        onRulesChange={setHouseRules}
        tournamentMode={tournamentMode}
        setTournamentMode={setTournamentMode}
        tournamentRounds={tournamentRounds}
        setTournamentRounds={setTournamentRounds}
      />
    );
  }
  if (phase === 'finished') {
    // If tournament is active and this was the final round, go straight to standings
    if (tournament && statsRecorded && tournament.currentRound >= tournament.rounds) {
      // Trigger endTournament once (statsRecorded means the score effect has fired)
      // We use a different approach: just show FinishedScreen with tournament next-round button
    }
    return <FinishedScreen
      players={players}
      onRestart={resetGame}
      onUndo={undo}
      canUndo={history.length > 0}
      stats={stats}
      leaderboard={leaderboard}
      onClearLeaderboard={() => persistLeaderboard({})}
      tournament={tournament}
      onNextRound={tournament && tournament.currentRound < tournament.rounds ? nextTournamentRound : endTournament}
      onEndTournament={endTournament}
    />;
  }

  if (phase === 'tournament-standings') {
    return <TournamentStandingsScreen
      tournament={tournament}
      onNextRound={nextTournamentRound}
      onAbort={abortTournament}
    />;
  }

  const gridCols = `116px repeat(${numPlayers}, minmax(56px, 1fr))`;
  const round = Math.floor(turnsPlayed / numPlayers) + 1;
  const diceDisabled = rolling || rollsLeft === 3 || rollsLeft === 0;
  const selDefault = selectedCategory ? getDefaultScore(selectedCategory) : null;
  const selLabel = selectedCategory ? CATEGORIES.find((c) => c.id === selectedCategory)?.label : null;
  const canConfirm = !!selectedCategory;
  const hasAI = players.some((p) => p.isAI);
  const currentIsAI = !!players[currentPlayer]?.isAI;

  const currentScores = players[currentPlayer]?.scores ?? {};
  const currentTotals = calcTotals(currentScores);
  const upperSum = currentTotals.upperSum;
  const upperFilledCount = CATEGORIES.filter((c) => c.section === 'upper' && currentScores[c.id] !== undefined).length;
  const bonusAchieved = upperSum >= 63;
  const bonusMissed = !bonusAchieved && upperFilledCount === 6;
  const pointsToBonus = Math.max(0, 63 - upperSum);
  const bonusProgressPct = Math.min(100, (upperSum / 63) * 100);
  const leaderTotal = Math.max(...players.map((p) => calcTotals(p.scores).total));

  // Pace toward the bonus: compare actual upper-section sum so far to the
  // "3 of a kind" baseline (FIXED_DEFAULTS) for only the categories already filled.
  const expectedSoFar = CATEGORIES.filter((c) => c.section === 'upper' && currentScores[c.id] !== undefined).reduce(
    (sum, c) => sum + FIXED_DEFAULTS[c.id],
    0
  );
  const paceDiff = upperSum - expectedSoFar;
  const paceText = paceDiff > 0 ? `${paceDiff} p före` : paceDiff < 0 ? `${Math.abs(paceDiff)} p efter` : 'jämnt läge';

  return (
    <div className="h-screen flex flex-col bg-stone-100 font-sans overflow-hidden">
      <style>{FONT_STYLES}</style>

      {/* Header */}
      <header className="px-4 pt-4 pb-2 bg-stone-50 border-b-4 border-stone-900 flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-stone-900 leading-none">YATZY</h1>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <p className="text-[10px] uppercase tracking-widest text-stone-400">
              {tournament ? `Omgång ${tournament.currentRound}/${tournament.rounds}` : 'Svenska regler'}
            </p>
            {Object.entries(houseRules).filter(([,v]) => v).map(([k]) => {
              const def = HOUSE_RULE_DEFS.find(d => d.id === k);
              return def ? <span key={k} className="text-[9px] bg-amber-100 text-amber-700 rounded-full px-1.5 font-bold border border-amber-300">{def.emoji}</span> : null;
            })}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setSoundEnabled((s) => !s)}
            className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center text-stone-900"
            aria-label={soundEnabled ? 'Stäng av ljud och vibration' : 'Sätt på ljud och vibration'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center text-stone-900 disabled:opacity-30"
            aria-label="Ångra senaste registrering"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowRules(true)}
            className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center font-display font-bold text-stone-900"
            aria-label="Visa regler"
          >
            ?
          </button>
          <button
            onClick={() => setConfirmReset(true)}
            className="w-8 h-8 rounded-full border-2 border-stone-900 flex items-center justify-center text-stone-900 text-lg"
            aria-label="Nytt spel"
          >
            ↺
          </button>
        </div>
      </header>

      {/* Celebration overlay */}
      {celebration === 'yatzy' && <YatzyCelebration />}
      {celebration === 'naturalyatzy' && <NaturalYatzyCelebration />}
      {celebration === 'bonus' && <BonusCelebration />}
      {celebration === 'bonusyatzy' && <BonusYatzyCelebration />}

      {/* Turn banner */}
      <div className="bg-red-600 shrink-0">
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="font-display font-bold uppercase tracking-wide text-sm text-stone-50">
            {players[currentPlayer]?.name}s tur
          </span>
          <span className="font-mono-score text-xs text-red-100">Omgång {round} / 15</span>
        </div>
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-[10px] uppercase tracking-widest font-display font-bold text-red-100 truncate min-w-0">
              {bonusAchieved
                ? 'Bonus säkrad — +50'
                : bonusMissed
                ? 'Bonus missad'
                : `${pointsToBonus} p till bonus${upperFilledCount > 0 ? ` · ${paceText}` : ''}`}
            </span>
            <span className="text-[10px] font-mono-score text-red-100 shrink-0">{upperSum} / 63</span>
          </div>
          <div className="h-1.5 bg-red-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                bonusAchieved ? 'bg-emerald-400' : bonusMissed ? 'bg-stone-400' : 'bg-amber-400'
              }`}
              style={{ width: `${bonusProgressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Input mode toggle */}
      {hasAI ? (
        <div className="px-4 py-1.5 bg-stone-50 border-b border-stone-200 flex items-center justify-center shrink-0">
          <p className="text-[11px] text-stone-400 uppercase tracking-widest font-display font-bold">
            {currentIsAI ? `Datorn (${AI_DIFFICULTIES[players[currentPlayer]?.difficulty]?.label ?? ''}) spelar …` : 'Din tur'}
          </p>
        </div>
      ) : (
        <div className="px-4 py-1.5 bg-stone-50 border-b border-stone-200 flex flex-col items-center gap-1 shrink-0">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => switchMode('auto')}
              className={`px-3 py-1 rounded-full text-[11px] font-display font-bold uppercase tracking-wide transition ${
                mode === 'auto' ? 'bg-stone-900 text-stone-50' : 'text-stone-400'
              }`}
            >
              Slumpa i appen
            </button>
            <button
              onClick={() => switchMode('manual')}
              className={`px-3 py-1 rounded-full text-[11px] font-display font-bold uppercase tracking-wide transition ${
                mode === 'manual' ? 'bg-stone-900 text-stone-50' : 'text-stone-400'
              }`}
            >
              Egna tärningar
            </button>
          </div>
          {mode === 'manual' && !selectedCategory && (
            <p className="text-[11px] text-stone-400">Tryck på en gul ruta i tabellen för att registrera poäng</p>
          )}
        </div>
      )}

      {/* Dice tray (auto mode only) */}
      {mode === 'auto' && (
        <div className="bg-emerald-800 px-4 py-4 shrink-0">
          {/* When showing the AI's last result before the human rolls, display those dice dimmed */}
          {lastAiAction && rollsLeft === 3 && !currentIsAI ? (
            <div className="flex justify-center gap-2 sm:gap-3 mb-3">
              {lastAiAction.dice.map((v, i) => (
                <Die key={i} value={v} held={false} disabled={true} rolling={false} onClick={() => {}} />
              ))}
            </div>
          ) : (
            <div className="flex justify-center gap-2 sm:gap-3 mb-3">
              {dice.map((v, i) => (
                <Die key={i} value={v} held={held[i]} disabled={diceDisabled || currentIsAI} rolling={rolling} onClick={() => toggleHold(i)} />
              ))}
            </div>
          )}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={rollDice}
              disabled={rolling || rollsLeft === 0}
              className="px-6 py-2.5 rounded-full bg-amber-400 border-2 border-stone-900 font-display font-bold text-stone-900 text-sm uppercase tracking-wide disabled:opacity-50 active:scale-95 transition"
            >
              {rollsLeft === 3 ? 'Kasta tärningarna' : rollsLeft === 0 ? 'Välj en rad nedan' : `Kasta igen (${rollsLeft} kvar)`}
            </button>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < rollsLeft ? 'bg-amber-400' : 'bg-emerald-600'}`} />
              ))}
            </div>
            {rollsLeft < 3 && rollsLeft > 0 && (
              <p className="text-emerald-100 text-[11px] text-center mt-1">Tryck på en tärning för att spara den till nästa kast.</p>
            )}
          </div>
        </div>
      )}

      {/* Torn paper edge (auto mode only) */}
      {mode === 'auto' && <div className="h-3 bg-stone-50 shrink-0" style={{ clipPath: TORN_EDGE }} />}

      {/* Scorecard */}
      <div className={`flex-1 min-h-0 overflow-auto bg-stone-50 px-3 ${mode === 'manual' && selectedCategory ? 'pb-80' : 'pb-6'}`}>
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div className="sticky left-0 bg-stone-50 z-20" />
          {players.map((p, i) => {
            const total = calcTotals(p.scores).total;
            const isLeader = numPlayers > 1 && total > 0 && total === leaderTotal;
            return (
              <button
                key={i}
                onClick={() => openEditName(i)}
                className={`text-center py-1.5 px-1 rounded-t-lg font-display font-bold text-xs uppercase tracking-wide active:scale-95 transition ${
                  i === currentPlayer
                    ? (PLAYER_COLORS[p.colorIndex ?? i % 4]?.header ?? 'bg-emerald-600 text-stone-50')
                    : 'bg-stone-200 text-stone-500'
                }`}
              >
                <div className="flex items-center justify-center gap-1 truncate">
                  {isLeader && <Trophy className="w-3 h-3 text-amber-400 shrink-0" />}
                  <span className="text-base leading-none">{p.avatar || AVATAR_OPTIONS[i]}</span>
                  <span className="truncate">{p.name}</span>
                  <Pencil className={`w-2.5 h-2.5 shrink-0 opacity-60`} />
                </div>
                <div className={`font-mono-score text-[11px] font-bold mt-0.5 opacity-80`}>
                  {total} p
                </div>
              </button>
            );
          })}

          <div
            className="py-1.5 px-1 mt-2 bg-slate-700 text-stone-50 font-display font-bold text-[11px] uppercase tracking-widest rounded"
            style={{ gridColumn: '1 / -1' }}
          >
            Övre sektion
          </div>

          {CATEGORIES.filter((c) => c.section === 'upper').map((cat) => (
            <ScoreRow
              key={cat.id}
              category={cat}
              players={players}
              currentPlayer={currentPlayer}
              dice={dice}
              rollsLeft={rollsLeft}
              mode={mode}
              selectedCategory={selectedCategory}
              inputBuffer={inputBuffer}
              onSelect={selectCategory}
              onSelectCell={onSelectCell}
              lastAiAction={lastAiAction}
              houseRules={houseRules}
              forcedCat={houseRules.forcedOrder ? forcedOrderCat(players[currentPlayer]?.scores ?? {}) : null}
            />
          ))}

          <TotalsRow label="Summa" sub="Ettor–Sexor" values={players.map((p) => calcTotals(p.scores).upperSum)} />
          <TotalsRow label="Bonus" sub="63 p → +50" values={players.map((p) => calcTotals(p.scores).bonus)} accent="amber" />

          <div
            className="py-1.5 px-1 mt-2 bg-emerald-800 text-stone-50 font-display font-bold text-[11px] uppercase tracking-widest rounded"
            style={{ gridColumn: '1 / -1' }}
          >
            Nedre sektion
          </div>

          {CATEGORIES.filter((c) => c.section === 'lower').map((cat) => (
            <ScoreRow
              key={cat.id}
              category={cat}
              players={players}
              currentPlayer={currentPlayer}
              dice={dice}
              rollsLeft={rollsLeft}
              mode={mode}
              selectedCategory={selectedCategory}
              inputBuffer={inputBuffer}
              onSelect={selectCategory}
              onSelectCell={onSelectCell}
              lastAiAction={lastAiAction}
              houseRules={houseRules}
              forcedCat={houseRules.forcedOrder ? forcedOrderCat(players[currentPlayer]?.scores ?? {}) : null}
            />
          ))}

          <TotalsRow label="TOTALT" values={players.map((p) => calcTotals(p.scores).total)} accent="dark" />
        </div>
      </div>

      {/* Keypad overlay (manual mode, shown only when a cell is selected) */}
      {mode === 'manual' && selectedCategory && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-emerald-800 border-t-4 border-stone-900 rounded-t-2xl px-4 pt-2 pb-4 shadow-2xl">
          <div className="w-10 h-1 bg-emerald-600 rounded-full mx-auto mb-2" />
          <div className="max-w-xs mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-display font-bold text-stone-50 text-sm uppercase tracking-wide">{selLabel}</p>
                <p className={`font-mono-score text-3xl font-extrabold leading-none mt-0.5 ${inputError ? 'text-red-400' : 'text-amber-400'}`}>
                  {inputBuffer !== '' ? inputBuffer : selDefault}
                </p>
              </div>
              <button
                onClick={closeKeypad}
                aria-label="Stäng"
                className="w-8 h-8 rounded-full border-2 border-emerald-600 text-emerald-100 flex items-center justify-center text-sm shrink-0"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => pressDigit(n)}
                  className="py-3 rounded-xl bg-stone-50 border-2 border-stone-900 font-mono-score text-xl font-bold text-stone-900 active:scale-95 transition"
                >
                  {n}
                </button>
              ))}
              <button
                onClick={backspace}
                disabled={inputBuffer === ''}
                className="py-3 rounded-xl bg-stone-200 border-2 border-stone-900 font-display text-base font-bold text-stone-700 disabled:opacity-40 active:scale-95 transition"
              >
                ⌫
              </button>
              <button
                onClick={() => pressDigit(0)}
                className="py-3 rounded-xl bg-stone-50 border-2 border-stone-900 font-mono-score text-xl font-bold text-stone-900 active:scale-95 transition"
              >
                0
              </button>
              <button
                onClick={confirmScore}
                disabled={!canConfirm}
                className="py-3 rounded-xl bg-amber-400 border-2 border-stone-900 font-display text-xl font-bold text-stone-900 disabled:opacity-40 active:scale-95 transition"
              >
                ✓
              </button>
            </div>

            <button
              onClick={crossOut}
              className="w-full mt-2 py-2.5 rounded-xl bg-red-600 border-2 border-stone-900 font-display font-bold text-stone-50 uppercase tracking-wide text-sm active:scale-95 transition"
            >
              ✕ Stryk (0 poäng)
            </button>

            {inputError ? (
              <p className="text-red-300 text-[11px] text-center mt-2 leading-relaxed font-semibold">⚠ {inputError}</p>
            ) : (
              <p className="text-emerald-200 text-[11px] text-center mt-2 leading-relaxed">
                {inputBuffer !== ''
                  ? `Tryck ✓ för att registrera ${inputBuffer} p.`
                  : selectedCategory in FIXED_DEFAULTS
                  ? `✓ ger ${selDefault} p direkt – eller skriv ett eget värde.`
                  : `✓ ger ${selDefault} p (högsta möjliga) – eller skriv ett eget värde.`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Rules modal */}
      {showRules && (
        <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 p-4" onClick={() => setShowRules(false)}>
          <div className="bg-stone-50 rounded-2xl max-w-sm w-full max-h-[85vh] overflow-auto p-5 border-4 border-stone-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-extrabold text-stone-900 mb-1">Poängregler</h2>
            <p className="text-xs text-stone-400 mb-3">Svensk Yatzy · 15 rutor per spelare</p>
            <div className="space-y-1.5">
              {CATEGORIES.map((c) => (
                <div key={c.id} className="flex justify-between items-baseline border-b border-stone-100 pb-1">
                  <span className="text-sm font-semibold text-stone-800">{c.label}</span>
                  <span className="text-xs text-stone-400 text-right">{c.sub}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-3 leading-relaxed">
              Bonus: om summan av Ettor–Sexor är minst 63 poäng får du 50 extra poäng.
            </p>
            <p className="text-xs text-stone-500 mt-2 leading-relaxed">
              Spelar ni med egna tärningar? Växla till "Egna tärningar" högst upp. Tryck på en ruta i tabellen, skriv poängen
              eller tryck bara ✓ för förslaget: 3-i-rad för Ettor–Sexor, 15/20/50 för stegar och Yatzy, och högsta möjliga
              poäng för övriga rader (t.ex. 30 för Chans, 28 för Kåk). Tryck ✕ för att stryka en ruta (0 poäng). Appen
              kontrollerar att den inskrivna poängen verkligen går att få i den rutan – annars visas ett felmeddelande.
            </p>
            <p className="text-xs text-stone-500 mt-2 leading-relaxed">
              Spelet sparas automatiskt på den här enheten, så du kan stänga appen och fortsätta partiet senare. Ljud och
              vibration vid kast, registrering och Yatzy kan stängas av med högtalarikonen högst upp.
            </p>
            <button onClick={() => setShowRules(false)} className="mt-4 w-full py-2.5 rounded-xl bg-stone-900 text-stone-50 font-display font-bold uppercase tracking-wide">
              Stäng
            </button>
          </div>
        </div>
      )}

      {/* Reset confirm modal */}
      {confirmReset && (
        <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 p-4" onClick={() => setConfirmReset(false)}>
          <div className="bg-stone-50 rounded-2xl max-w-xs w-full p-5 border-4 border-stone-900 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-extrabold text-stone-900 mb-2">Avsluta spelet?</h2>
            <p className="text-sm text-stone-500 mb-4">Pågående poäng går förlorade.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmReset(false)} className="flex-1 py-2.5 rounded-xl border-2 border-stone-900 font-display font-bold text-stone-900">
                Avbryt
              </button>
              <button onClick={resetGame} className="flex-1 py-2.5 rounded-xl bg-red-600 text-stone-50 font-display font-bold">
                Avsluta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit name modal */}
      {editingPlayer !== null && (
        <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 p-4" onClick={cancelEditName}>
          <div className="bg-stone-50 rounded-2xl max-w-xs w-full p-5 border-4 border-stone-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-extrabold text-stone-900 mb-3">Redigera namn</h2>
            <input
              autoFocus
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEditName()}
              className="w-full px-3 py-2 rounded-lg border-2 border-stone-300 focus:border-red-600 focus:outline-none text-stone-800 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={cancelEditName} className="flex-1 py-2.5 rounded-xl border-2 border-stone-900 font-display font-bold text-stone-900">
                Avbryt
              </button>
              <button onClick={saveEditName} className="flex-1 py-2.5 rounded-xl bg-red-600 text-stone-50 font-display font-bold">
                Spara
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
