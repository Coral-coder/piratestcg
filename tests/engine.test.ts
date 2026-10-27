import { describe, expect, it } from 'vitest';
import { datan2, dcos, dsin, fingerprint, nextU32, seedRng, stableStringify } from '../src/engine';
import { playBotGame } from '../scripts/chaos';

describe('deterministic math', () => {
  it('dsin/dcos/datan2 match Math to 1e-9', () => {
    for (let d = -720; d <= 720; d += 7.3) {
      expect(Math.abs(dsin(d) - Math.sin((d * Math.PI) / 180))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(d) - Math.cos((d * Math.PI) / 180))).toBeLessThan(1e-9);
    }
    for (const [y, x] of [[1, 1], [-2, 3], [0.1, -5], [-4, -0.2], [3, 0], [0, -2]]) {
      expect(Math.abs(datan2(y, x) - (Math.atan2(y, x) * 180) / Math.PI)).toBeLessThan(1e-9);
    }
  });
});

describe('seeded RNG', () => {
  it('same seed, same stream', () => {
    const a = seedRng(7);
    const b = seedRng(7);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });
});

describe('fingerprint', () => {
  it('ignores key order', () => {
    expect(stableStringify({ a: 1, b: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ b: [1, { c: 3, d: 2 }], a: 1 }));
  });
});

describe('bot vs bot', () => {
  it('plays complete games that replay to the same fingerprint', () => {
    for (const seed of [11, 12, 13]) {
      const r = playBotGame(seed, 30, { checkEvery: 1, replay: true });
      expect(r.errors).toEqual([]);
      expect(r.reason).not.toBe('');
    }
  });
  it('is deterministic across runs', () => {
    const a = playBotGame(21, 30, { replay: false });
    const b = playBotGame(21, 30, { replay: false });
    expect(a).toEqual(b);
    void fingerprint;
  });
});
