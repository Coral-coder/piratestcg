import type { RngState } from './rng';

// ---------------------------------------------------------------- content

export interface Effect {
  code: string;
  n?: number;
  faction?: string;
}

export type Bar = 'S' | 'L';

interface CardBase {
  id: string;
  name: string;
  /** Pack the card comes from: 'original', 'spanish-main', 'forbidden-paradise'. */
  pack: string;
  faction?: string;
  points: number;
  effects: Effect[];
  links?: string[];
  /** Parts of the printed card the engine does not model yet. */
  unsupported?: string[];
}

export interface ShipDef extends CardBase {
  kind: 'ship';
  masts: number;
  cargo: number;
  move: Bar[];
  /** One per mast, bow to stern, like "2S" or "3L". */
  cannons: string[];
}

export interface CrewDef extends CardBase {
  kind: 'crew';
}

export interface TreasureDef extends CardBase {
  kind: 'treasure';
}

export type CardDef = ShipDef | CrewDef | TreasureDef;

export interface FleetEntry {
  ship: string;
  crew: string[];
}

export interface Fleet {
  name: string;
  ships: FleetEntry[];
}

// ---------------------------------------------------------------- state

export interface Island {
  id: number;
  name: string;
  x: number;
  y: number;
  r: number;
  /** Owning player for home islands, null for wild islands. */
  home: number | null;
  /** Coin ids. On a home island these are the player's scored treasure. */
  coins: number[];
  /** Visual seed for the client. */
  look: number;
}

export interface Coin {
  id: number;
  /** Gold value. Unique treasure is worth 0. */
  value: number;
  /** Set for unique treasure. */
  unique?: TreasureDef;
  /** Removed from the game. */
  gone?: boolean;
}

export interface CrewInst {
  id: number;
  def: CrewDef;
  alive: boolean;
}

export interface ShipFlags {
  extraRolled: boolean;
  rerollUsed: boolean;
  hitCrewUsed: boolean;
  firstHitIgnored: boolean;
  pickpocketUsed: boolean;
  peekUsed: boolean;
  /** Turn number on which Rum was loaded; ship cannot act the next turn. */
  rumTurn: number;
  /** Other once-per-turn abilities already used this turn. */
  once: string[];
}

export interface Ship {
  id: number;
  owner: number;
  originalOwner: number;
  def: ShipDef;
  /** Bow position in inches. */
  x: number;
  y: number;
  /** Heading in degrees: 0 = +x, 90 = +y. */
  heading: number;
  /** Alive state per mast, bow to stern. */
  masts: boolean[];
  crew: CrewInst[];
  /** Treasure coins carried face down. */
  cargo: number[];
  /** Unique treasure carried face up (no cargo space). */
  uniques: number[];
  sunk: boolean;
  docked: number | null;
  /** Ship this one is pinned against (its bow touches it after a ram). */
  pinnedTo: number | null;
  towing: number | null;
  towedBy: number | null;
  /** Actions used and allowed this turn. */
  actionsUsed: number;
  actionsAllowed: number;
  lastActionKind: ActionKind | null;
  sameKindOnly: boolean;
  flags: ShipFlags;
}

export type ActionKind = 'move' | 'shoot' | 'explore' | 'repair' | 'comeAbout';

export interface CurrentAction {
  ship: number;
  kind: ActionKind;
  /** Cannons already fired in this action (e.g. "mast:0", "musket:12"). */
  fired: string[];
  /** Captain: a move action that may still shoot. */
  canShoot: boolean;
  /** Explorer: docked this move and may still explore. */
  canExplore: boolean;
  /** Free options used after a move. */
  rammed: number | null;
  boarded: boolean;
  towed: boolean;
  /** Armored targets: hits so far per target id in this shoot action. */
  armorHits: [number, number][];
}

export type Pending =
  | { kind: 'mastLoss'; player: number; ship: number; count: number; by: number | null; cause: 'shot' | 'ram' | 'misfire' }
  | { kind: 'boardSpoils'; player: number; winner: number; loser: number }
  | { kind: 'defenderBoard'; player: number; defender: number; attacker: number };

export interface LogEntry {
  turn: number;
  player: number;
  text: string;
}

export interface PlayerState {
  name: string;
  home: number;
  /** Gold from sunk ships, which has no coin of its own. */
  bonusGold: number;
  /** Coin ids this player has seen (explored or peeked). */
  known: number[];
  resigned: boolean;
}

export interface GameConfig {
  seed: number;
  fleets: [Fleet, Fleet];
  names?: [string, string];
  /** Point limit both fleets were built to. */
  points: number;
  /** Table size in inches. */
  width?: number;
  height?: number;
  /** Turn cap (rounds) after which the game ends on gold. */
  maxRounds?: number;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: RngState;
  width: number;
  height: number;
  points: number;
  maxRounds: number;
  players: PlayerState[];
  islands: Island[];
  coins: Coin[];
  ships: Ship[];
  /** 1-based turn counter; a round is two turns. */
  turn: number;
  active: number;
  current: CurrentAction | null;
  pending: Pending | null;
  /** Set while closing an action (or the turn) waits on a pending choice. */
  closing: null | 'action' | 'turn';
  startingGold: number;
  winner: number | null;
  draw: boolean;
  over: boolean;
  endReason: string;
  log: LogEntry[];
  nextId: number;
}

// ---------------------------------------------------------------- moves

export interface Segment {
  bar: Bar;
  /** Absolute heading in degrees for this segment. */
  heading: number;
  /** Inches, at most the bar's length. */
  dist: number;
}

export type Move =
  | { t: 'move'; by: number; ship: number; segs: Segment[] }
  | { t: 'comeAbout'; by: number; ship: number }
  | { t: 'fire'; by: number; ship: number; cannon: string; target: number; long?: boolean }
  | { t: 'explore'; by: number; ship: number; take: number[] }
  | { t: 'exploreShip'; by: number; ship: number; target: number; take: number[] }
  | { t: 'repair'; by: number; ship: number }
  | { t: 'ram'; by: number; ship: number; target: number }
  | { t: 'board'; by: number; ship: number; target: number }
  | { t: 'tow'; by: number; ship: number; target: number }
  | { t: 'pickpocket'; by: number; ship: number; target: number }
  | { t: 'plunder'; by: number; ship: number; target: number }
  | { t: 'peekIsland'; by: number; ship: number; island: number }
  | { t: 'peekCargo'; by: number; ship: number; target: number }
  | { t: 'endAction'; by: number }
  | { t: 'endTurn'; by: number }
  | { t: 'choose'; by: number; option: string }
  | { t: 'resign'; by: number };

// ---------------------------------------------------------------- events
// Emitted by applyMove so the client can animate what happened.

export type GameEvent =
  | { e: 'moved'; ship: number; path: { x: number; y: number; heading: number }[] }
  | { e: 'docked'; ship: number; island: number }
  | { e: 'unloaded'; ship: number; island: number; gold: number }
  | { e: 'shot'; ship: number; cannon: string; target: number; roll: number; need: number; hit: boolean; from: { x: number; y: number } }
  | { e: 'mastLost'; ship: number; mast: number }
  | { e: 'mastRepaired'; ship: number; mast: number }
  | { e: 'sunk'; ship: number }
  | { e: 'derelict'; ship: number }
  | { e: 'ram'; ship: number; target: number; roll: number; hit: boolean }
  | { e: 'board'; ship: number; target: number; rolls: [number, number]; totals: [number, number]; winner: number }
  | { e: 'crewLost'; ship: number; crew: number }
  | { e: 'treasureMoved'; from: string; to: string; coin: number }
  | { e: 'explored'; ship: number; island: number; took: number[] }
  | { e: 'extraAction'; ship: number; roll: number; granted: boolean }
  | { e: 'towed'; ship: number; target: number }
  | { e: 'turn'; player: number; turn: number }
  | { e: 'gameOver'; winner: number | null; reason: string }
  | { e: 'info'; text: string };
