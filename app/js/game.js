// Estado de la partida y cálculo de qué se dispara en cada momento.
import { STEPS, parseCard, eventMatches, phaseMatches, multiplierFor, typesOf } from "./triggers.js";

const KEY = "ca-game-v1";
const parsedCache = new Map();

export function parsed(card) {
  if (!parsedCache.has(card.n)) parsedCache.set(card.n, parseCard(card));
  return parsedCache.get(card.n);
}

export function newGame({ opponents, names, starting }) {
  const players = [{ name: "Tú" }];
  for (let i = 1; i <= opponents; i++) players.push({ name: names?.[i] || `Oponente ${i}` });
  return { players, turn: 1, active: starting, startingPlayer: starting, stepIdx: 0, perms: [], nextUid: 1, done: {} };
}

export function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
export function save(g) {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* sin almacenamiento */ }
}
export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
}

// --- Avance de turno ---------------------------------------------------------

export function currentStep(g) {
  return STEPS[g.stepIdx];
}

// En tu turno se avanza paso a paso; el turno de cada oponente es una sola pantalla.
export function advance(g) {
  g.done = {};
  if (g.active === 0 && g.stepIdx < STEPS.length - 1) { g.stepIdx++; return; }
  g.stepIdx = 0;
  g.active = (g.active + 1) % g.players.length;
  if (g.active === g.startingPlayer) g.turn++;
}

export function nextLabel(g) {
  if (g.active === 0 && g.stepIdx < STEPS.length - 1) return `Next: ${STEPS[g.stepIdx + 1].en}`;
  const next = (g.active + 1) % g.players.length;
  return next === 0 ? "Mi turno ▶" : `Turno de ${g.players[next].name} ▶`;
}

// --- Permanentes ---------------------------------------------------------------

export function addPerm(g, card, controller, zone = "battlefield", qty = 1) {
  const p = { uid: g.nextUid++, name: card.n, controller, zone, qty };
  if (card.custom) p.custom = card;
  g.perms.push(p);
  return p;
}

export function cardOf(perm, db) {
  return perm.custom || db.get(perm.name) || { n: perm.name, t: "", o: "" };
}

function activeIn(trig, perm) {
  if (trig.zone === "command") return perm.zone === "command" || perm.zone === "battlefield";
  return trig.zone === perm.zone;
}

function modifiers(g, db) {
  return g.perms
    .filter((p) => p.zone === "battlefield")
    .flatMap((p) => parsed(cardOf(p, db)).modifiers.map((mod) => ({ mod, perm: p })));
}

function item(g, perm, trig, extra = {}) {
  return {
    key: `${perm.uid}:${trig.id}:${extra.cond || ""}`,
    perm,
    trig,
    mine: perm.controller === 0,
    owner: g.players[perm.controller]?.name ?? "?",
    times: perm.qty || 1,
    notes: [],
    ...extra,
  };
}

function sortItems(list) {
  return list.sort((a, b) => (b.mine - a.mine) || a.perm.name.localeCompare(b.perm.name));
}

// Disparos que provoca un evento (muere, entra, lanza, roba...).
export function triggersForEvent(g, db, event, extra = {}) {
  const mods = modifiers(g, db);
  const out = [];
  for (const perm of g.perms) {
    for (const trig of parsed(cardOf(perm, db)).triggers) {
      // Se calcula antes de mover la carta, así la que muere todavía "ve" su propio disparo.
      if (!activeIn(trig, perm) || !eventMatches(trig, perm, event)) continue;
      const isSource = event.sourceUid === perm.uid;
      const it = item(g, perm, trig, extra);
      if (isSource) it.times = event.count || 1;
      else if (!/one or more/i.test(trig.condition)) it.times *= event.count || 1;
      const m = multiplierFor(trig, perm, event, mods);
      it.times *= m.times;
      it.notes = m.notes;
      out.push(it);
    }
  }
  return sortItems(out);
}

// Disparos de un paso concreto del turno del jugador `active`.
export function triggersForStep(g, db, stepId, active) {
  const out = [];
  for (const perm of g.perms) {
    for (const trig of parsed(cardOf(perm, db)).triggers) {
      if (activeIn(trig, perm) && phaseMatches(trig, perm, stepId, active)) out.push(item(g, perm, trig));
    }
  }
  // Eventos implícitos del paso
  if (stepId === "draw") {
    out.push(...triggersForEvent(g, db, { type: "draw", actor: active }, { cond: "Por el robo normal" }));
  }
  if (stepId === "attackers") {
    out.push(...attackReminders(g, db, active));
  }
  if (stepId === "damage") {
    for (const it of triggersForEvent(g, db, { type: "combatDamage", actor: active })) {
      if (it.perm.controller === active) out.push({ ...it, cond: "Si hace daño" });
    }
    for (const perm of g.perms.filter((p) => p.zone === "battlefield" && p.controller === active)) {
      for (const trig of parsed(cardOf(perm, db)).triggers) {
        if (trig.kind === "event" && trig.self && !trig.generic && trig.events.includes("combatDamage")) {
          out.push(item(g, perm, trig, { cond: "Si hace daño" }));
        }
      }
    }
  }
  return sortItems(dedupe(out));
}

function attackReminders(g, db, active) {
  const out = [];
  for (const it of triggersForEvent(g, db, { type: "attack", actor: active, types: ["creature"] })) {
    if (it.trig.attacksYou) {
      if (it.perm.controller !== active) out.push({ ...it, cond: "Si te atacan" });
    } else if (it.perm.controller === active || it.trig.who !== "you") {
      out.push({ ...it, cond: it.perm.controller === active ? "Si atacas" : "Si atacan" });
    }
  }
  for (const perm of g.perms.filter((p) => p.zone === "battlefield" && p.controller === active)) {
    for (const trig of parsed(cardOf(perm, db)).triggers) {
      if (trig.kind === "event" && trig.self && !trig.generic && trig.events.includes("attack")) {
        out.push(item(g, perm, trig, { cond: "Si ataca" }));
      }
    }
  }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((it) => {
    const k = `${it.perm.uid}:${it.trig.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Mueve un permanente y devuelve los disparos que provoca.
export function movePerm(g, db, perm, to) {
  const card = cardOf(perm, db);
  const types = typesOf(card);
  const from = perm.zone;
  const reactions = [];
  if (from === "battlefield" && to !== "battlefield") {
    if (to === "graveyard" && types.includes("creature")) {
      reactions.push(...triggersForEvent(g, db, { type: "dies", actor: perm.controller, types, sourceUid: perm.uid }));
    }
    reactions.push(...triggersForEvent(g, db, { type: "leaves", actor: perm.controller, types, sourceUid: perm.uid }));
  }
  if ((perm.qty || 1) > 1 && from === "battlefield") {
    perm.qty--;
    if (to !== "gone" && !perm.custom) addPerm(g, card, perm.controller, to);
  } else if (to === "gone" || (perm.custom && to !== "battlefield")) {
    g.perms = g.perms.filter((p) => p !== perm);
  } else {
    perm.zone = to;
  }
  if (to === "battlefield" && from !== "battlefield") reactions.push(...enterReactions(g, db, perm));
  return dedupe(reactions);
}

export function enterReactions(g, db, perm) {
  const types = typesOf(cardOf(perm, db));
  return triggersForEvent(g, db, { type: "etb", actor: perm.controller, types, sourceUid: perm.uid, count: perm.qty || 1 });
}
