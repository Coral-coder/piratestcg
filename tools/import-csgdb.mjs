#!/usr/bin/env node
// One-off importer: turns the community card list at
// https://tilorfire27.github.io/PiratesCSGDB/ (saved locally) into our own
// structured data. Only game facts are kept: name, faction, points, masts,
// cargo, base move and cannons. Ability text is NOT copied; it is mapped to
// our own effect codes, and the UI writes its own descriptions from those.
// Flavor text and images are dropped.
//
// Usage: node tools/import-csgdb.mjs <saved index.html> <SET> <out.json>
import fs from 'node:fs';

const [, , src, setCode, out] = process.argv;
if (!src || !setCode || !out) {
  console.error('usage: import-csgdb.mjs <index.html> <SET> <out.json>');
  process.exit(1);
}
const html = fs.readFileSync(src, 'utf8');
const unescape = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = (s) => unescape(s.replace(/<[^>]+>/g, '')).replace(/[’‘]/g, "'").trim();

const re = new RegExp(`<div class="card${setCode}" id="(${setCode}-\\w+)">(.*?)</div></div></div>`, 'gs');
const FACTIONS = ['Pirate', 'English', 'Spanish', 'French', 'American', 'Cursed', 'Barbary Corsair', 'Jade Rebellion', 'Mercenary', 'Viking'];

/** Map one ability sentence (lower case) to effect codes. Returns [] if unknown. */
function classify(t) {
  const fx = [];
  const add = (code, extra = {}) => fx.push({ code, ...extra });
  const fac = (s) => s[0].toUpperCase() + s.slice(1);
  let m;
  if (/move and shoot using the same move action/.test(t)) add('moveShoot');
  if (/dock and explore a wild island using the same move action/.test(t)) add('dockExplore');
  if (/^this ship gets \+s to her base move\.?$/.test(t)) add('plusS');
  if (/carries no cargo, she gets \+s to her base move/.test(t)) add('plusSWhenEmpty');
  if (/\+l to her base move if she has all of her masts/.test(t)) add('plusLWhenFull');
  if (/base move becomes s when she reaches her cargo limit/.test(t)) add('slowWhenLoaded');
  if (/cannons (may|can) shoot again if it misses/.test(t)) add('rerollMiss');
  if (/gains one (rank 3 cannon with s range cannon|3s cannon)/.test(t)) add('musket');
  if (/if derelict, this ship gains a base move of s/.test(t)) add('derelictMoveS');
  if (/this crew takes up no cargo space/.test(t)) add('noCargoSpace');
  if (/repair at sea or at any island/.test(t)) add('shipwright');
  if (/^this ship gets \+1 to her boarding rolls\.?$/.test(t)) add('boardBonus', { n: 1 });
  if ((m = /\+1 to her cannon rolls against (english|pirate|spanish) ships/.exec(t))) add('cannonBonusVs', { faction: fac(m[1]) });
  if ((m = /\+1 to her cannon rolls and boarding rolls against (english|pirate|spanish) ships/.exec(t))) {
    add('cannonBonusVs', { faction: fac(m[1]) });
    add('boardBonusVs', { faction: fac(m[1]) });
  }
  if ((m = /\+1 to her cannon rolls against non-(english|pirate|spanish) ships/.exec(t))) add('cannonBonusVsNot', { faction: fac(m[1]) });
  if (/has a captain crew, she gets \+1 to her cannon rolls/.test(t)) add('cannonBonusWithCaptain');
  if (/has a captain crew, she gets \+1 to her cannon rolls and \+s to her base move/.test(t)) add('plusSWithCaptain');
  if (/has a captain crew, she gets \+l to her base move/.test(t)) add('plusLWithCaptain');
  if (/\+1 to her cannon rolls for every friendly ship within s/.test(t)) add('cannonBonusPerFriendly');
  if (/friendly ships within s of this ship get \+1 to their cannon rolls/.test(t)) add('cannonAura');
  if (/l-range cannons (cannot|can't) hit this ship/.test(t)) add('immuneL');
  if (/other ships do not block this ship's line of fire/.test(t)) add('clearShot');
  if (/eliminates two masts with one hit/.test(t)) add('doubleHit');
  if (/you choose which mast is eliminated/.test(t)) add('chooseMast');
  if (/ignores the first hit she takes each turn as long as she has all of her masts/.test(t)) add('ignoreFirstHit');
  if (/ramming cannot eliminate this ship's masts/.test(t)) add('ramImmune');
  if (/roll a d6\. on a 5 or 6, this ship (may|can) be given an extra action/.test(t)) add('extraAction');
  if (/before you give this ship an action, roll a d6\. on a 5 or 6, this ship may be given the same action twice/.test(t)) add('doubleAction');
  if (/sinks when her last mast is eliminated/.test(t)) add('sinksAtZero');
  if (/eliminate one of this ship's masts when she rolls a 1 on any cannon roll/.test(t)) add('misfire');
  if (/once per turn when this ship hits an enemy ship, also eliminate one crew/.test(t)) add('hitKillsCrew');
  if (/when this ship hits an enemy ship, you (may|can) also eliminate one cargo/.test(t)) add('hitKillsCargo');
  if (/dock at an enemy home island and load one treasure/.test(t)) add('raidHome');
  if (/crew (cannot|can't) be eliminated unless she sinks/.test(t)) add('crewImmortal');
  if (/this ship gets \+1 cargo spaces/.test(t)) add('cargoPlus');
  if (/unload cargo at your home island if she's within s of it/.test(t)) add('unloadWithinS');
  if (/all of this ship's cannons have l range/.test(t)) add('allLRange');
  if (/crew of any nationality (may|can) use their abilities on this ship/.test(t)) add('anyCrew');
  if ((m = /^(english|spanish|pirate) crew may use their abilities on this ship/.exec(t))) add('allowCrew', { faction: fac(m[1]) });
  if (/(never|can't) load the last treasure from an island/.test(t)) add('cantLoadLast');
  if (/this ship can't be pinned/.test(t)) add('unpinnable');
  if (/on the turn this ship is pinned, eliminate one crew from the enemy ship/.test(t)) add('pinKillsCrew');
  if (/cannons (may not|can't) be eliminated/.test(t)) add('fixedCannons');
  if (/randomly take one treasure from any ship she touches/.test(t)) add('pickpocket');
  if (/when this ship sinks another ship, you may repair one/.test(t)) add('repairOnSink');
  if (/you own any derelict this ship explores/.test(t)) add('salvager');
  if (/two hits from the same shoot action are required/.test(t)) add('armored');
  if ((m = /^(english|spanish|pirate) ships get \+1 to their cannon rolls against this ship/.exec(t))) add('weakVs', { faction: fac(m[1]) });
  if (/double the range of this ship's cannons each turn, but you must roll a 6 to hit/.test(t)) add('longShot');
  if ((m = /one of this ship's treasures is worth \+(\d) gold when she docks at your home island/.exec(t))) add('treasureBonus', { n: Number(m[1]) });
  if (/cannon ranges of enemy ships are reduced to s against this ship/.test(t)) add('shortenEnemyRange');
  if (/place this crew face up during setup\. reduce the cost of all other crew placed on this ship by 1/.test(t)) add('crewDiscount');
  if ((m = /when touching a (pirate|english|spanish) ship, this ship (may|can) load as much of that ship's treasure as she can carry/.exec(t))) add('plunder', { faction: fac(m[1]) });
  if (/look at one face-down treasure on any island/.test(t)) add('peekIsland');
  if (/look at one face-down cargo on any ship/.test(t)) add('peekCargo');
  if (/this ship can't shoot when she carries treasure/.test(t)) add('noShootLoaded');
  if (/if this ship wins a boarding party, she can take as much treasure/.test(t)) add('greedyBoarder');
  if (/rum is worth gold equal to 6 minus the number of this ship's crew/.test(t)) add('rum');
  if (/move s after unloading cargo/.test(t)) add('moveAfterUnload');
  return fx;
}

// Second sentences that belong to an effect matched on the same line.
const CONTINUATIONS = [
  /^if able, she must leave on your next turn/,
  /^it can shoot from any mast/,
  /^this crew takes up no cargo space/,
  /^reduce the cost of all other crew placed on this ship by 1/,
  /^do not give this ship an action the turn after loading rum/,
  /^if derelict, (she|this ship) (cannot|can't) shoot/,
  /^forts cannot shoot at this ship/,
  /^place this crew face up during setup/,
];
const SPANNING = [/roll a d6\. on a 5 or 6, this ship (may|can) be given/];

const cards = [];
for (const [, id, body] of html.matchAll(re)) {
  const p = /<p style="margin-left: 73px">(.*?)<\/p>/s.exec(body);
  const t = p ? p[1] : body;
  const flavor = new Set([...t.matchAll(/<i>(.*?)<\/i>/gs)].map((x) => strip(x[1])));
  const data = Object.fromEntries([...t.matchAll(/<data name="(\w+)" value="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  const cannons = [...t.matchAll(/class="dieImg lazy" data-src="img\/(\d[SL])\.png"/g)].map((x) => x[1]);
  const facM = [...t.matchAll(/alt="([^"]+)"/g)].map((x) => x[1]).find((a) => FACTIONS.includes(a));
  let name = strip(t.split('<')[0]);
  let lines = t
    .split('<br>')
    .map(strip)
    .filter((x) => x && !x.startsWith('Points') && !/^[\d\sSL+]*$/.test(x))
    .filter((x) => !flavor.has(x) && !/^[“"]/.test(x) && !/—/.test(x));
  if (!name && lines.length) name = lines.shift();
  lines = lines.filter((x) => x !== name);
  const links = [];
  const effects = [];
  const unsupported = [];
  for (const line of lines) {
    if (line.startsWith('Link:')) {
      links.push(...line.slice(5).split(',').map((s) => s.trim().replace(/\*$/, '')));
      continue;
    }
    // Strip keyword prefixes like "Junk." or "Fear." (later-set rules we do
    // not model yet), then map the rest of the line.
    let rest = line.toLowerCase().replace(/[’]/g, "'").trim();
    let km;
    while ((km = /^(junk|galley|fear|eternal|ghost ship|parley|kraken)\.\s*/.exec(rest))) {
      unsupported.push(km[1]);
      rest = rest.slice(km[0].length);
    }
    if (!rest) continue;
    effects.push(...classify(rest));
    for (const s of rest.split(/(?<=\.)\s+/)) {
      if (classify(s).length || CONTINUATIONS.some((c) => c.test(s))) continue;
      // Multi-sentence abilities are matched on the whole line above; a
      // sentence counts as mapped when the whole line matched one effect
      // whose pattern spans it.
      if (classify(rest).length && SPANNING.some((c) => c.test(rest))) continue;
      unsupported.push('ability');
    }
  }
  const kind = data.masts ? 'ship' : data.points === '0' ? 'treasure' : 'crew';
  const card = { id, name, kind };
  if (facM) card.faction = facM;
  card.points = Number(data.points ?? 0);
  if (kind === 'ship') {
    card.masts = Number(data.masts);
    card.cargo = Number(data.cargo);
    card.move = (data.speed || 'S').split('');
    card.cannons = cannons;
  }
  if (links.length) card.links = links;
  // De-duplicate effect codes.
  const seen = new Set();
  card.effects = effects.filter((e) => {
    const k = JSON.stringify(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unsupported.length) card.unsupported = [...new Set(unsupported)];
  cards.push(card);
}
fs.writeFileSync(out, JSON.stringify(cards, null, 1) + '\n');
const sup = cards.filter((c) => !c.unsupported).length;
console.log(`${setCode}: ${cards.length} cards, ${sup} fully mapped`);
