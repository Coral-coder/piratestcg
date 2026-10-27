// Seeded RNG (sfc32). The state is four uint32 numbers stored in the game
// state, so it serializes and replays exactly.

export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 to spread the seed over four words.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  // Warm up.
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(st: RngState): number {
  let [a, b, c, d] = st;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  st[0] = a >>> 0;
  st[1] = b >>> 0;
  st[2] = c;
  st[3] = d;
  return t;
}

/** Integer in [0, n). */
export function randInt(st: RngState, n: number): number {
  return Math.floor((nextU32(st) * n) / 4294967296);
}

export function rollD6(st: RngState): number {
  return 1 + randInt(st, 6);
}

/** Fisher-Yates shuffle, in place, deterministic. */
export function shuffle<T>(st: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(st, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
