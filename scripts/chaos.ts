// Chaos harness: the bot plays the bot for many seeded games and we check
// invariants after every move. Usage: tsx scripts/chaos.ts [games] [points]
import { BUILTIN_CARDS } from '../src/data';
import {
  applyMove,
  botMove,
  createGame,
  fingerprint,
  hull,
  makeCatalog,
  polyCircleOverlap,
  polysOverlap,
  quickFleet,
  toAct,
  type GameState,
  type Move,
} from '../src/engine';

export interface ChaosResult {
  seed: number;
  turns: number;
  moves: number;
  winner: number | null;
  reason: string;
  errors: string[];
}

export function checkInvariants(st: GameState): string[] {
  const errs: string[] = [];
  const where = new Map<number, string>();
  const put = (id: number, w: string) => {
    if (where.has(id)) errs.push(`coin ${id} in ${where.get(id)} and ${w}`);
    where.set(id, w);
  };
  for (const isl of st.islands) for (const id of isl.coins) put(id, `island ${isl.id}`);
  for (const s of st.ships) {
    if (s.sunk) {
      if (s.cargo.length || s.uniques.length) errs.push(`sunk ship ${s.id} still holds cargo`);
      continue;
    }
    for (const id of [...s.cargo, ...s.uniques]) put(id, `ship ${s.id}`);
  }
  for (const c of st.coins) {
    if (c.gone && where.has(c.id)) errs.push(`gone coin ${c.id} still in ${where.get(c.id)}`);
    if (!c.gone && !where.has(c.id)) errs.push(`coin ${c.id} is nowhere`);
  }
  const afloat = st.ships.filter((s) => !s.sunk);
  for (const s of afloat) {
    const h = hull(s);
    for (const p of h) if (p.x < -0.01 || p.y < -0.01 || p.x > st.width + 0.01 || p.y > st.height + 0.01) errs.push(`ship ${s.id} off the table`);
    for (const isl of st.islands) if (polyCircleOverlap(h, isl, isl.r - 0.05)) errs.push(`ship ${s.id} inside island ${isl.id}`);
    for (const o of afloat) if (o.id > s.id && polysOverlap(h, hull(o), 0.12)) errs.push(`ships ${s.id} and ${o.id} overlap`);
    if (s.towing !== null && st.ships[s.towing].towedBy !== s.id) errs.push(`tow link broken on ${s.id}`);
  }
  for (const p of st.players) if (p.bonusGold < 0) errs.push('negative gold');
  return errs;
}

export function setupBotGame(seed: number, points: number): GameState {
  const cat = makeCatalog(BUILTIN_CARDS);
  const packsA = seed % 3 === 0 ? ['original'] : seed % 3 === 1 ? ['spanish-main'] : undefined;
  const fleets = [quickFleet(cat, points, seed * 7 + 1, { packs: packsA }), quickFleet(cat, points, seed * 7 + 2, { packs: packsA })] as [ReturnType<typeof quickFleet>, ReturnType<typeof quickFleet>];
  const uniques = cat.treasure.filter((t) => t.pack === 'original');
  return createGame({ seed, fleets, points }, cat, { uniques: [uniques[seed % uniques.length], uniques[(seed + 2) % uniques.length]] });
}

export function playBotGame(seed: number, points: number, opts: { checkEvery?: number; replay?: boolean } = {}): ChaosResult {
  const start = setupBotGame(seed, points);
  let st = start;
  const errors: string[] = [];
  const moves: Move[] = [];
  let guard = 0;
  while (!st.over && guard++ < 6000) {
    const me = toAct(st);
    const m = botMove(st, me);
    let r = applyMove(st, m);
    if (!r.ok) {
      errors.push(`turn ${st.turn}: bot move ${JSON.stringify(m)} rejected: ${r.error}`);
      const fallback: Move = st.pending ? { t: 'choose', by: me, option: 'none' } : st.current ? { t: 'endAction', by: me } : { t: 'endTurn', by: me };
      r = applyMove(st, fallback);
      if (!r.ok) {
        errors.push(`fallback rejected: ${r.error}`);
        break;
      }
      moves.push(fallback);
    } else moves.push(m);
    st = r.state;
    if (!opts.checkEvery || moves.length % opts.checkEvery === 0) {
      const inv = checkInvariants(st);
      if (inv.length) {
        errors.push(`turn ${st.turn} after ${JSON.stringify(moves[moves.length - 1])}: ${inv.join('; ')}`);
        break;
      }
    }
  }
  if (!st.over) errors.push('game did not finish');
  if (opts.replay !== false) {
    // Lockstep check: replaying the same moves from the start gives the same state.
    let rs = start;
    for (const m of moves) {
      const r = applyMove(rs, m);
      if (!r.ok) {
        errors.push('replay diverged: ' + r.error);
        break;
      }
      rs = r.state;
    }
    if (fingerprint(rs) !== fingerprint(st)) errors.push('replay fingerprint mismatch');
    const round = JSON.parse(JSON.stringify(st)) as GameState;
    if (fingerprint(round) !== fingerprint(st)) errors.push('JSON round trip changes the fingerprint');
  }
  return { seed, turns: st.turn, moves: moves.length, winner: st.winner, reason: st.endReason, errors };
}

const isMain = process.argv[1] && /chaos\.ts$/.test(process.argv[1]);
if (isMain) {
  const games = Number(process.argv[2] ?? 200);
  const points = Number(process.argv[3] ?? 30);
  let failed = 0;
  const wins = [0, 0, 0];
  let turns = 0;
  const reasons = new Map<string, number>();
  for (let s = 1; s <= games; s++) {
    const r = playBotGame(s, points, { checkEvery: 1, replay: s % 5 === 0 });
    turns += r.turns;
    wins[r.winner === null ? 2 : r.winner]++;
    const key = r.reason.replace(/\(.*\)|\d+/g, '#');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    if (r.errors.length) {
      failed++;
      console.log(`seed ${s}: ${r.errors.slice(0, 3).join(' | ')}`);
    }
  }
  console.log(`${games} games, ${failed} with errors. P1 ${wins[0]}, P2 ${wins[1]}, draws ${wins[2]}. Avg ${(turns / games).toFixed(1)} turns.`);
  for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
  if (failed) process.exit(1);
}
