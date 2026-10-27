# Rules

This is how the game plays, written down from the printed rules of the Pirates
of the Spanish Main constructible strategy game (WizKids, 2004) and the later
Pirates of the Caribbean sets. Section numbers (R1, R2…) are cited by the unit
tests in `tests/rules.test.ts`.

Where the printed rules are silent or a physical action doesn't translate to a
screen, we make a call and mark it **Our ruling**.

## Sources

- *Pirates of the Spanish Main* rulebook (WizKids, 2004), as reproduced on
  RulesPal: <https://rulespal.com/pirates-of-the-spanish-main/rulebook>. This
  covers setup, moving, exploring, shooting, ramming, boarding, towing,
  repairing, crew keywords and winning.
- Card statistics (points, masts, cargo, base move, cannons) come from the
  community card database at <https://tilorfire27.github.io/PiratesCSGDB/>.
  We import only the numbers and names. Ability text is not copied; it is mapped to our own
  effect codes, and the game describes each ability in its own words
  (`tools/import-csgdb.mjs`, `src/engine/abilities.ts`).
- Fan rules summaries for the later sets are listed on BoardGameGeek
  (<https://boardgamegeek.com/files/thing/10653/page/6>).

## R1 Building a fleet

- Players agree a point total (30 or 40 is typical). Each fleet's ships plus
  crew may cost no more than that.
- Crew must be the same nationality as their ship, unless the ship or another
  crew says otherwise. One crew uses one cargo space (some, like the Oarsman,
  use none).
- A ship's crew may not cost more points in total than the ship itself.
- Linked crew on the same ship give that ship +1 cargo space.

## R2 Setup

- Islands are placed at least two L lengths apart. Each player has one home
  island; the rest are wild islands. A 30-point game uses six islands.
- Each player adds six treasures worth 12 gold in all. The treasure is shuffled
  face down and three go on each wild island. Unique treasure is worth 0 gold.
- Fleets start with their bows touching their home island.
- Both players roll a d6, re-rolling ties; the higher roll goes first.
- **Our ruling:** the table is 42 × 60 inches. Islands are placed by the
  computer: homes near the two short edges and four wild islands between them,
  all at least 2 L apart. When a player adds a unique treasure, their five
  coins are 1, 2, 2, 3 and 4 gold, so their treasure still totals 12.

## R3 Turns and actions

- Players alternate turns. On your turn each of your ships may take **one
  action**: move, shoot, explore or repair (or come about).
- Free actions (unloading, ramming, boarding, towing, docking) don't use up the
  ship's action.
- A ship's action ends when you start another ship's action or end your turn.

## R4 Moving

- Movement is measured from the bow with the S ruler (3") or the L ruler (6").
  The bow travels up to that length in a straight line; the ship ends facing the
  direction it moved.
- A ship with a base move of, say, S+L may use both rulers in either order and
  may change direction only between rulers.
- Ships may not pass through islands or other ships.
- **Our ruling:** a ruler may turn at most 90° from the ship's heading (it is
  laid off the bow, forward of the beam). A ship that starts docked may lay its
  first ruler any way off the island. The bow stops at the first island or ship
  it reaches, which ends the move. The ship's final position may not overlap
  anything; models may graze by up to 0.1".
- **Come about** is a move action that turns the ship in place, so its bow ends
  where the stern was.
- **Docking:** a ship whose bow touches an island after moving is docked. You
  cannot dock at an enemy home island.
- A **derelict** (no masts left) cannot move or shoot, but still carries cargo
  and crew and may explore or repair.
- **Mast-based speed:** the printed base move stays the same as masts fall;
  only a derelict (no masts) stops. Some ships change speed with masts
  (e.g. "+L while all masts stand").

## R5 Shooting

- Each mast carries one cannon, printed as rank and range, e.g. `3S`: rank 3,
  short range. A shoot action may fire any or all of the ship's cannons, each
  once, at targets in range.
- **Range:** S cannons reach 3", L cannons 6", measured from the centre of the
  cannon's mast to any part of the target.
- **Line of fire** runs from the mast to the target and is blocked by islands,
  other ships, and the firing ship's own masts.
- **To hit,** roll a d6: equal to or higher than the rank hits. A roll of 1
  always misses.
- **A hit** eliminates one mast. The owner of the hit ship chooses which, unless
  an ability says the shooter does. A cannon is lost with its mast.
- Ships docked at their own home island cannot be targeted.

## R6 Derelicts, sinking and repair

- A ship with every mast eliminated is derelict.
- A hit on a derelict sinks it, with its crew. Its gold is split between the
  players; the shooter gets the odd gold. Unique treasure aboard is lost.
- A ship docked at its own home island may take a repair action to restore one
  mast. A Shipwright lets it repair anywhere.

## R7 Exploring and treasure

- A ship docked at a wild island may take an explore action: look at all the
  treasure there and load what it wants, up to its free cargo space. Each coin
  uses one cargo space.
- Docking and exploring normally take two actions; an **Explorer** does both in
  one move action.
- Unique treasure must be taken by the first ship to explore that island; it
  takes no cargo space and is carried face up, its ability active.
- Treasure is unloaded and scored as a free action when the ship docks at its
  own home island.
- A ship may also explore a friendly ship or a derelict it touches, to move
  treasure aboard.

## R8 Ramming, boarding, pinning and towing

- **Ram:** after moving, a ship whose bow touches an enemy ship may ram as a free
  action. Roll a d6: if it beats the enemy's remaining masts, the enemy loses a
  mast (owner's choice). Unless the enemy is now derelict, the rammer is
  **pinned**.
- **Pinned:** a ship pinned against an enemy can't move until that ship moves
  away or becomes derelict.
- **Board:** right after a ram, either player may start a boarding party (the
  active player decides first). Each side rolls a d6 and adds its remaining
  masts. The winner either eliminates one crew on the other ship or takes one of
  its treasures. **Our ruling:** ties are re-rolled (the rulebook doesn't say).
- **Tow:** after moving, a ship touching a derelict's bow may take it in tow as a
  free action. The derelict joins the towing player's fleet, the tower's base
  move becomes S, and the derelict follows it. **Our ruling:** if the towed
  ship has no room to follow, the tow line parts.

## R9 Winning

- The first player to have more than half of the starting gold at their home
  island wins.
- **Our ruling:** the game also ends when no treasure is left in play (on wild
  islands or ships), when no ship on either side can sail, when a player has no
  ships afloat and is behind, or after 40 rounds. Then the player with more gold
  wins.

## Crew keywords

| Keyword | Effect |
|---|---|
| Captain | The ship may move and shoot in the same move action. |
| Explorer | The ship may dock and explore a wild island in the same move action. |
| Helmsman | +S to the ship's base move. |
| Cannoneer | Once per turn, a cannon that misses may fire again. |
| Musketeer | Adds a 3S cannon that can't be improved and fires from any mast, even a lost one. |
| Oarsman | If the ship is derelict, its base move becomes S. Takes no cargo space. |
| Shipwright | The ship may repair at sea or at any island. |

Identical abilities from different sources don't stack. Card text overrides
these rules, except that a cannon roll of 1 always misses.

## Not modelled yet

- Crew are placed face up (the printed game hides them until used) and can't be
  moved between ships.
- Forts, sea monsters, krakens, whirlpools, fog banks and the later-set ship
  types (junks, galleys) and keywords (Eternal, Fear, Ghost Ship, Parley) are
  not in the engine yet. Cards with them are playable, but those parts of their
  text are ignored and the fleet builder marks them ⚠ partial.
- Some abilities on individual cards; see `docs/coverage.md`.
- The "must leave next turn" clause on home-island raiders isn't enforced.
- Multiplayer (three or more players).
