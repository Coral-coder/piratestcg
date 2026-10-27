// Fails if any Disney-pack name leaks into the default bundle. The optional
// pack itself (dist/packs/forbidden-paradise.json) is the only allowed place.
import fs from 'node:fs';
import path from 'node:path';

const pack = JSON.parse(fs.readFileSync('public/packs/forbidden-paradise.json', 'utf8'));
const spanish = new Set(JSON.parse(fs.readFileSync('src/data/spanish-main.json', 'utf8')).map((c) => c.name.toLowerCase()));
// Names unique to the masked pack (generic words like "Rum" or "Explorer" are shared with other packs).
const generic = new Set(['captain', 'explorer', 'rum', 'sword', 'gun', 'marines', 'plunder', 'spyglass', 'jail!', 'cannibals', 'revenge', 'fortune', 'pearl', 'swift', 'otter', 'dragon', 'fancy', 'dolphin', 'paradox', 'princess', 'ranger', 'centurion', 'neptune', 'song', 'empress', 'satisfaction', 'barnacle', 'beastie', 'sea nymph', 'cotton', 'marty', 'lian', 'park', 'mercer', 'maccus', 'pearl']);
const words = new Set(['sparrow', 'barbossa', 'black pearl', 'davy jones', 'flying dutchman', 'norrington', 'turner', 'tia dalma', 'cutler beckett', 'calypso', 'sao feng', 'kraken']);
// ("Disney" itself is allowed: the legal notice must name it.)
for (const c of pack) {
  const n = c.name.toLowerCase();
  if (n.length >= 6 && !spanish.has(n) && !generic.has(n)) words.add(n);
}
const bad = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!p.endsWith(path.join('packs', 'forbidden-paradise.json'))) {
      const text = fs.readFileSync(p, 'utf8').toLowerCase();
      for (const w of words) if (text.includes(w)) bad.push(`${p}: "${w}"`);
    }
  }
}
walk('dist');
if (bad.length) {
  console.error('Masked content leaked into the default bundle:\n' + bad.join('\n'));
  process.exit(1);
}
console.log(`check-mask: ${words.size} masked names, none found outside the optional pack.`);
