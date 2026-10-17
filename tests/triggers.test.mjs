// Pruebas del motor de disparos con cartas reales. Uso: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCard, eventMatches, phaseMatches, multiplierFor, typesOf } from "../app/js/triggers.js";

const { cards } = JSON.parse(readFileSync(new URL("../app/data/cards.json", import.meta.url)));
const byName = (n) => cards.find((c) => c.n === n);
let uid = 0;
const perm = (name, controller = 0) => {
  const card = byName(name);
  return { uid: ++uid, name, controller, card, parsed: parseCard(card) };
};

function phaseTriggers(perms, step, active) {
  return perms.flatMap((p) => p.parsed.triggers.filter((t) => phaseMatches(t, p, step, active)).map((t) => p.name));
}
function eventTriggers(perms, event) {
  const mods = perms.flatMap((p) => p.parsed.modifiers.map((mod) => ({ mod, perm: p })));
  return perms.flatMap((p) =>
    p.parsed.triggers
      .filter((t) => eventMatches(t, p, event))
      .map((t) => ({ name: p.name, times: multiplierFor(t, p, event, mods).times })),
  );
}

test("mantenimiento propio vs. de oponente", () => {
  const board = [perm("Phyrexian Arena"), perm("Bitterblossom"), perm("Sulfuric Vortex", 1)];
  assert.deepEqual(phaseTriggers(board, "upkeep", 0).sort(), ["Bitterblossom", "Phyrexian Arena", "Sulfuric Vortex"]);
  assert.deepEqual(phaseTriggers(board, "upkeep", 1), ["Sulfuric Vortex"]);
  assert.deepEqual(phaseTriggers(board, "end", 0), []);
});

test("Teysa duplica los disparos por muerte", () => {
  const board = [perm("Teysa Karlov"), perm("Blood Artist"), perm("Bastion of Remembrance"), perm("Zulaport Cutthroat", 1)];
  const res = eventTriggers(board, { type: "dies", actor: 0, types: ["creature"] });
  assert.deepEqual(res.find((r) => r.name === "Blood Artist"), { name: "Blood Artist", times: 2 });
  assert.deepEqual(res.find((r) => r.name === "Bastion of Remembrance"), { name: "Bastion of Remembrance", times: 2 });
  // Zulaport solo mira criaturas de su controlador
  assert.equal(res.find((r) => r.name === "Zulaport Cutthroat"), undefined);
});

test("disparos en el turno del oponente", () => {
  const board = [perm("Smothering Tithe"), perm("Rhystic Study"), perm("Esper Sentinel")];
  assert.deepEqual(eventTriggers(board, { type: "draw", actor: 2 }).map((r) => r.name), ["Smothering Tithe"]);
  assert.deepEqual(eventTriggers(board, { type: "draw", actor: 0 }), []);
  const creatureSpell = eventTriggers(board, { type: "cast", actor: 1, types: ["creature"] }).map((r) => r.name);
  assert.deepEqual(creatureSpell, ["Rhystic Study"]);
  const instant = eventTriggers(board, { type: "cast", actor: 1, types: ["instant"] }).map((r) => r.name);
  assert.deepEqual(instant, ["Rhystic Study", "Esper Sentinel"]);
});

test("disparos al entrar: propio, genérico y Panharmonicon", () => {
  const bastion = perm("Bastion of Remembrance");
  const board = [perm("Soul Warden"), perm("Panharmonicon"), bastion];
  const res = eventTriggers(board, { type: "etb", actor: 0, types: typesOf(bastion.card), sourceUid: bastion.uid });
  assert.deepEqual(res.map((r) => r.name), ["Bastion of Remembrance"]);
  assert.equal(res[0].times, 1); // es un encantamiento: Panharmonicon no aplica
  const creature = eventTriggers(board, { type: "etb", actor: 1, types: ["creature"] });
  // Panharmonicon también duplica si la criatura que entra es de un oponente
  assert.deepEqual(creature.map((r) => [r.name, r.times]), [["Soul Warden", 2]]);
  const land = perm("Lotus Cobra");
  const res2 = eventTriggers([land, perm("Panharmonicon")], { type: "etb", actor: 0, types: ["land"] });
  assert.deepEqual(res2.map((r) => [r.name, r.times]), [["Lotus Cobra", 1]]);
});

test("Torpor Orb anula disparos al entrar", () => {
  const board = [perm("Soul Warden"), perm("Torpor Orb", 1)];
  assert.equal(eventTriggers(board, { type: "etb", actor: 0, types: ["creature"] })[0].times, 0);
});

test("tierras: landfall sí, criatura no", () => {
  const board = [perm("Bloodghast")];
  assert.equal(board[0].parsed.triggers[0].zone, "graveyard");
  assert.equal(eventTriggers(board, { type: "etb", actor: 0, types: ["land"] }).length, 1);
  assert.equal(eventTriggers(board, { type: "etb", actor: 0, types: ["creature"] }).length, 0);
});

test("palabras con 'self' no se confunden con la propia carta", () => {
  for (const c of cards.filter((c) => /yourself|itself/.test(c.o)).slice(0, 200)) parseCard(c);
  const t = parseCard(byName("Blood Artist")).triggers[0];
  assert.equal(t.self, true);
  assert.equal(parseCard(byName("Grim Haruspex")).triggers[0].self, false);
});

test("mazo Villain: Strucker solo con Villains, Iron Monger con connive", () => {
  const strucker = perm("Baron Strucker, HYDRA Overlord");
  const monger = perm("Iron Monger, Sadistic Tycoon");
  const doom = perm("Doctor Doom, King of Latveria");
  const board = [strucker, monger, doom];
  // Entra un Villain tuyo -> Strucker
  const villain = byName("Doctor Doom");
  assert.deepEqual(eventTriggers(board, { type: "etb", actor: 0, types: ["creature"], typeLine: villain.t }).map((r) => r.name), ["Baron Strucker, HYDRA Overlord"]);
  // Entra un Elfo -> nada
  assert.deepEqual(eventTriggers(board, { type: "etb", actor: 0, types: ["creature"], typeLine: "Creature — Elf Druid" }), []);
  // Conspira una criatura tuya -> Iron Monger
  assert.deepEqual(eventTriggers(board, { type: "connive", actor: 0, types: ["creature"] }).map((r) => r.name), ["Iron Monger, Sadistic Tycoon"]);
  // Doom: inicio del combate en tu turno
  assert.deepEqual(phaseTriggers(board, "beginCombat", 0), ["Doctor Doom, King of Latveria"]);
  assert.deepEqual(phaseTriggers(board, "beginCombat", 1), []);
});

test("disparo definido a mano", async () => {
  const { customTrigger } = await import("../app/js/triggers.js");
  const t = customTrigger({ kind: "event", event: "connive", who: "you", cardType: "creature", subtype: "Villain", zone: "battlefield", text: "+1/+1" }, "x#c1");
  const p = { uid: 99, controller: 0 };
  assert.equal(eventMatches(t, p, { type: "connive", actor: 0, types: ["creature"], typeLine: "Creature — Human Villain" }), true);
  assert.equal(eventMatches(t, p, { type: "connive", actor: 0, types: ["creature"], typeLine: "Creature — Elf" }), false);
  assert.equal(eventMatches(t, p, { type: "connive", actor: 1, types: ["creature"] }), false);
  const ph = customTrigger({ kind: "phase", step: "end", whose: "opp", text: "x" }, "x#c2");
  assert.equal(phaseMatches(ph, p, "end", 2), true);
  assert.equal(phaseMatches(ph, p, "end", 0), false);
});
