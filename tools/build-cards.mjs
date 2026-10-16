// Descarga el bulk "Oracle Cards" de Scryfall y genera app/data/cards.json
// con solo las cartas legales en Commander y los campos que usa la app.
// Uso: node tools/build-cards.mjs
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "app", "data", "cards.json");
const headers = { "User-Agent": "ComboAssistant/0.1", Accept: "application/json" };

const meta = await (await fetch("https://api.scryfall.com/bulk-data/oracle-cards", { headers })).json();
const url = meta.jsonl_download_uri || meta.download_uri;
console.log("Descargando", url);
const res = await fetch(url, { headers });
if (!res.ok) throw new Error(`HTTP ${res.status}`);

let body = Readable.fromWeb(res.body);
if (url.endsWith(".gz")) body = body.pipe(createGunzip());
const lines = createInterface({ input: body, crlfDelay: Infinity });

const cards = [];
for await (const line of lines) {
  const s = line.trim().replace(/,$/, "");
  if (!s || s === "[" || s === "]") continue;
  const c = JSON.parse(s);
  if (c.legalities?.commander !== "legal") continue;
  if (["token", "emblem", "art_series", "double_faced_token"].includes(c.layout)) continue;

  const faces = c.card_faces;
  const img = c.image_uris?.normal || faces?.[0]?.image_uris?.normal || "";
  const card = {
    n: c.name,
    t: c.type_line || faces?.map((f) => f.type_line).join(" // ") || "",
    m: c.mana_cost ?? faces?.[0]?.mana_cost ?? "",
    o: c.oracle_text ?? faces?.map((f) => `${f.name}:\n${f.oracle_text}`).join("\n//\n") ?? "",
  };
  if (c.power != null) card.p = `${c.power}/${c.toughness}`;
  if (img) card.i = img.replace("https://cards.scryfall.io/", "");
  cards.push(card);
}

cards.sort((a, b) => a.n.localeCompare(b.n));
mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify({ updated: meta.updated_at, cards });
writeFileSync(out, json);
console.log(`${cards.length} cartas -> ${out} (${(json.length / 1e6).toFixed(1)} MB)`);
