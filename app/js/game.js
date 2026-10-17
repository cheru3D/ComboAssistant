// Estado de la partida y cálculo de qué se dispara en cada momento.
import { STEPS, parseCard, customTrigger, eventMatches, phaseMatches, multiplierFor, typesOf } from "./triggers.js";

const KEY = "ca-game-v1";
const OVERRIDES_KEY = "ca-overrides-v1";
const parsedCache = new Map();

// --- Disparos editados a mano ------------------------------------------------
// Se guardan por nombre de carta y sirven para todas las partidas:
// { [nombre]: { hidden: [idDetectado], custom: [{ id, spec, replaces? }] } }

let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {}; } catch { overrides = {}; }

function saveOverrides() {
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch { /* sin almacenamiento */ }
}

export function overridesFor(name) {
  return overrides[name] || { hidden: [], custom: [] };
}

// Guarda un disparo propio. `replaces` es el id del disparo detectado (o línea ⚠) que sustituye.
export function saveCustom(name, { id, spec, replaces }) {
  const o = (overrides[name] ||= { hidden: [], custom: [] });
  const newId = id || `${name}#c${Date.now()}`;
  o.custom = o.custom.filter((c) => c.id !== newId);
  o.custom.push({ id: newId, spec, replaces: replaces || null });
  if (replaces && !o.hidden.includes(replaces)) o.hidden.push(replaces);
  parsedCache.delete(name);
  saveOverrides();
}

export function deleteCustom(name, id) {
  const o = overridesFor(name);
  const c = o.custom.find((x) => x.id === id);
  o.custom = o.custom.filter((x) => x.id !== id);
  if (c?.replaces) o.hidden = o.hidden.filter((h) => h !== c.replaces);
  overrides[name] = o;
  parsedCache.delete(name);
  saveOverrides();
}

// Ignorar (o volver a usar) un disparo detectado.
export function toggleHidden(name, id) {
  const o = (overrides[name] ||= { hidden: [], custom: [] });
  o.hidden = o.hidden.includes(id) ? o.hidden.filter((h) => h !== id) : [...o.hidden, id];
  parsedCache.delete(name);
  saveOverrides();
}

// Disparos de una carta: lo detectado + lo editado a mano.
export function parsed(card) {
  if (parsedCache.has(card.n)) return parsedCache.get(card.n);
  const base = parseCard(card);
  const o = overrides[card.n];
  let result = base;
  if (o) {
    const replaced = new Set(o.custom.map((c) => c.replaces).filter(Boolean));
    result = {
      triggers: [
        ...base.triggers.filter((t) => !o.hidden.includes(t.id)),
        ...o.custom.map((c) => ({ ...customTrigger(c.spec, c.id), replaces: c.replaces })),
      ],
      modifiers: base.modifiers.filter((m) => !o.hidden.includes(m.id)),
      unknown: base.unknown.filter((u) => !replaced.has(u.id) && !o.hidden.includes(u.id)),
      hidden: [...new Map([...base.triggers, ...base.modifiers, ...base.unknown]
        .filter((t) => o.hidden.includes(t.id) && !replaced.has(t.id))
        .map((t) => [t.id, t])).values()],
    };
  }
  parsedCache.set(card.n, result);
  return result;
}

export function newGame({ opponents, names, starting }) {
  const players = [{ name: "Tú" }];
  for (let i = 1; i <= opponents; i++) players.push({ name: names?.[i] || `Oponente ${i}` });
  return { players, turn: 1, active: starting, startingPlayer: starting, perms: [], nextUid: 1, done: {} };
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

// Cada turno (tuyo o de un oponente) es una sola pantalla con todas sus fases.
export function advance(g) {
  g.done = {};
  g.landPlayed = false;
  g.active = (g.active + 1) % g.players.length;
  if (g.active === g.startingPlayer) g.turn++;
}

export function nextLabel(g) {
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
      reactions.push(...triggersForEvent(g, db, { type: "dies", actor: perm.controller, types, sourceUid: perm.uid, typeLine: card.t }));
    }
    reactions.push(...triggersForEvent(g, db, { type: "leaves", actor: perm.controller, types, sourceUid: perm.uid, typeLine: card.t }));
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
  return triggersForEvent(g, db, { type: "etb", actor: perm.controller, types, sourceUid: perm.uid, count: perm.qty || 1, typeLine: cardOf(perm, db).t });
}
