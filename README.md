# Pirates of the Spanish Main — fan edition

A free, browser-playable 3D fan take on WizKids' constructible pirate ship
game (2004–2008). Build a fleet to a point limit, snap your ships together
from their punch-out pieces, then race the computer for the treasure.

**Play:** https://coral-coder.github.io/piratestcg/

> Unofficial fan project. Not affiliated with, endorsed by or sponsored by
> WizKids or Disney. All models, art and sounds are made in code for this
> project; no card scans or studio art are used.

## What's here

- `src/engine/`: the rules engine. Pure, deterministic TypeScript with a seeded RNG,
  serializable moves and a state fingerprint (ready for lockstep online play).
- `src/client/`: the Three.js + Vite client (3D table, assembly view, menus).
- `src/data/`: card content. Original fleets plus the Spanish Main set (names
  and stats only).
- `public/packs/forbidden-paradise.json`: an optional pack, downloaded only when
  the "Forbidden Paradise" setting is switched on. The default bundle never
  contains it (`npm run check-mask` enforces this).
- `docs/rules.md`: the rules as implemented, with sources.
- `docs/coverage.md`: which cards the engine fully models.

## Develop

```sh
npm ci
npm run dev          # local server
npm test             # unit tests (rules cite docs/rules.md)
npm run chaos        # bot plays bot for 200 games and checks invariants
npm run typecheck && npm run lint
npm run bundle       # production files in dist/
```

The card stats were imported with `tools/import-csgdb.mjs` from a saved copy of
the community database at https://tilorfire27.github.io/PiratesCSGDB/. The importer keeps
numbers and names only and maps ability text to the engine's own effect codes.

## Licence

Source code: MIT (see `LICENSE`). Uses three.js (MIT).
