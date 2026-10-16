// Muestra cómo el motor interpreta cartas concretas: node tests/inspect.mjs "Blood Artist" ...
import { readFileSync } from "node:fs";
import { parseCard } from "../app/js/triggers.js";
const { cards } = JSON.parse(readFileSync(new URL("../app/data/cards.json", import.meta.url)));
for (const name of process.argv.slice(2)) {
  const c = cards.find((x) => x.n === name);
  if (!c) { console.log("NO ENCONTRADA:", name); continue; }
  const r = parseCard(c);
  console.log(`\n== ${name}`);
  for (const t of r.triggers) {
    const { id, raw, effect, condition, ...rest } = t;
    console.log(" T", JSON.stringify(rest));
  }
  for (const m of r.modifiers) console.log(" M", m.kind, m.event, m.scope);
  for (const u of r.unknown) console.log(" ?", u.raw);
}
