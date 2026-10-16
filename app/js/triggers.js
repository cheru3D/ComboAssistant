// Motor de detección de disparos a partir del texto Oracle (inglés).
// Módulo puro: no toca el DOM, así se puede probar con node.

export const STEPS = [
  { id: "untap", phase: "Fase inicial", es: "Enderezar", en: "Untap" },
  { id: "upkeep", phase: "Fase inicial", es: "Mantenimiento", en: "Upkeep" },
  { id: "draw", phase: "Fase inicial", es: "Robar", en: "Draw" },
  { id: "main1", phase: "Primera fase principal", es: "Principal 1", en: "Main 1" },
  { id: "beginCombat", phase: "Combate", es: "Inicio del combate", en: "Beginning of combat" },
  { id: "attackers", phase: "Combate", es: "Declarar atacantes", en: "Declare attackers" },
  { id: "blockers", phase: "Combate", es: "Declarar bloqueadores", en: "Declare blockers" },
  { id: "damage", phase: "Combate", es: "Daño de combate", en: "Combat damage" },
  { id: "endCombat", phase: "Combate", es: "Final del combate", en: "End of combat" },
  { id: "main2", phase: "Segunda fase principal", es: "Principal 2", en: "Main 2" },
  { id: "end", phase: "Fase final", es: "Paso final", en: "End step" },
  { id: "cleanup", phase: "Fase final", es: "Limpieza", en: "Cleanup" },
];

export const EVENTS = {
  dies: "muere",
  etb: "entra al campo",
  landfall: "entra una tierra",
  leaves: "deja el campo",
  attack: "ataca",
  block: "bloquea",
  combatDamage: "hace daño de combate",
  cast: "lanza un hechizo",
  draw: "roba",
  lifegain: "gana vida",
  lifeloss: "pierde vida",
  sacrifice: "sacrifica",
  discard: "descarta",
  token: "crea fichas",
  counters: "pone contadores",
  mana: "gira por maná",
  targeted: "es objetivo",
  other: "otro",
};

const TYPE_WORDS = ["creature", "artifact", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle"];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normaliza una línea: quita texto recordatorio y cambia el nombre propio por ~.
function normalize(line, name) {
  let s = line.replace(/\([^)]*\)/g, "").trim();
  const names = new Set([name]);
  for (const part of name.split(" // ")) {
    names.add(part);
    if (part.includes(",")) names.add(part.split(",")[0]);
  }
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (n.length > 2) s = s.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "g"), "~");
  }
  s = s.replace(/\bthis (creature|artifact|enchantment|permanent|land|planeswalker|card|vehicle|equipment|aura|battle|saga|spacecraft)\b/gi, "~");
  // Palabra de habilidad: "Landfall — Whenever ..." -> "Whenever ..."
  s = s.replace(/^[A-Z][A-Za-z' ,-]{1,40} — (?=(When|Whenever|At)\b)/, "");
  return s;
}

function stepsFromPhrase(p) {
  if (/each of your main phases|each main phase/.test(p)) return ["main1", "main2"];
  if (/upkeep/.test(p)) return ["upkeep"];
  if (/draw step/.test(p)) return ["draw"];
  if (/precombat main|first main phase/.test(p)) return ["main1"];
  if (/postcombat main|second main phase/.test(p)) return ["main2"];
  if (/main phase/.test(p)) return ["main1"];
  if (/end of combat/.test(p)) return ["endCombat"];
  if (/declare attackers/.test(p)) return ["attackers"];
  if (/combat/.test(p)) return ["beginCombat"];
  if (/end step|end of turn/.test(p)) return ["end"];
  if (/cleanup/.test(p)) return ["cleanup"];
  return null;
}

function whoseFromPhrase(p) {
  if (/enchanted|equipped|chosen|that player|target|defending|its controller|their/.test(p)) return "other";
  if (/opponent/.test(p)) return "opp";
  if (/\byour\b|\byou\b/.test(p)) return "you";
  return "each";
}

// Quién realiza el evento según la condición: "you" (el controlador), "opp", "any".
function whoFromCondition(c) {
  const you = c.search(/\byou control\b|\byour\b|\byou (cast|draw|gain|lose|sacrifice|attack|discard|create|put|tap|activate|cycle|expend|commit)\b|^you\b/);
  const opp = c.search(/\bopponents?\b|\ban opponent\b/);
  if (you === -1 && opp === -1) return "any";
  if (opp === -1) return "you";
  if (you === -1) return "opp";
  return you < opp ? "you" : "opp";
}

function eventsFromCondition(c) {
  const ev = [];
  if (/\bdies\b|\bdie\b|put into (a|your|an opponent's|their) graveyard from the battlefield/.test(c)) ev.push("dies");
  if (/\benters?\b/.test(c)) {
    const landOnly = /\blands?\b/.test(c) && !/creature|artifact|enchantment|permanent|planeswalker/.test(c);
    ev.push(landOnly ? "landfall" : "etb");
  }
  if (/leaves the battlefield/.test(c)) ev.push("leaves");
  if (/\battacks?\b|\battack with\b/.test(c)) ev.push("attack");
  if (/\bblocks?\b|becomes blocked/.test(c)) ev.push("block");
  if (/deals combat damage|deal combat damage/.test(c)) ev.push("combatDamage");
  if (/\bcasts?\b|\bcopy\b/.test(c)) ev.push("cast");
  if (/\bdraws?\b/.test(c)) ev.push("draw");
  if (/gains? life/.test(c)) ev.push("lifegain");
  if (/loses? life/.test(c)) ev.push("lifeloss");
  if (/sacrifices?/.test(c)) ev.push("sacrifice");
  if (/discards?/.test(c)) ev.push("discard");
  if (/create.*tokens?|tokens? (is|are) created/.test(c)) ev.push("token");
  if (/counters? (is|are) put|put one or more .*counters?/.test(c)) ev.push("counters");
  if (/tapped for mana|tap .* for mana/.test(c)) ev.push("mana");
  if (/becomes the target/.test(c)) ev.push("targeted");
  return ev.length ? ev : ["other"];
}

function typesFromCondition(c) {
  const types = TYPE_WORDS.filter((t) => new RegExp(`\\b${t}s?\\b`).test(c) && !new RegExp(`\\bnon${t}`).test(c));
  const non = TYPE_WORDS.filter((t) => new RegExp(`\\bnon-?${t}`).test(c));
  return { types, non };
}

// Analiza una carta y devuelve sus disparos y modificadores.
export function parseCard(card) {
  const result = { triggers: [], modifiers: [], unknown: [] };
  if (!card?.o) return result;
  const lines = card.o.split("\n").filter((l) => l && l !== "//" && !/^[^:]+:$/.test(l));

  lines.forEach((raw, idx) => {
    const s = normalize(raw, card.n);
    const lower = s.toLowerCase();
    const zone = /command zone/.test(lower) ? "command"
      : /(return|exile|cast) ~ from your graveyard|~ is in your graveyard/.test(lower) ? "graveyard"
      : "battlefield";
    const base = { id: `${card.n}#${idx}`, raw: raw.replace(/\([^)]*\)/g, "").trim(), zone };

    // Modificadores de disparos (Teysa, Panharmonicon, Torpor Orb...)
    if (/triggers? an additional time/.test(lower)) {
      const ev = /dying|dies|put into a graveyard/.test(lower) ? "dies"
        : /entering|enter/.test(lower) ? "etb"
        : /attacking|attack/.test(lower) ? "attack"
        : "any";
      const scope = /you control/.test(lower) ? "you" : "any";
      const cause = lower.split(/causes?/)[0];
      result.modifiers.push({ ...base, kind: "double", event: ev, scope, types: typesFromCondition(cause).types });
      return;
    }
    if (/(don't|doesn't|can't) cause abilities to trigger|abilities .* can't trigger/.test(lower)) {
      const cause = lower.split(/(don't|doesn't|can't)/)[0];
      result.modifiers.push({ ...base, kind: "suppress", event: /enter/.test(lower) ? "etb" : "any", scope: "any", types: typesFromCondition(cause).types });
      return;
    }

    let m = s.match(/^At the beginning of ([^,]+),\s*(.*)$/i);
    if (m) {
      const phrase = m[1].toLowerCase();
      if (/\bnext\b/.test(phrase)) return; // disparo retrasado, no permanente
      const steps = stepsFromPhrase(phrase);
      if (!steps) { result.unknown.push(base); return; }
      result.triggers.push({ ...base, kind: "phase", steps, whose: whoseFromPhrase(phrase), effect: m[2] });
      return;
    }

    m = s.match(/^(Whenever|When)\s+([^,]+),\s*(.*)$/);
    if (m) {
      const cond = m[2];
      const condL = cond.toLowerCase();
      const events = eventsFromCondition(condL);
      const hasSelf = /~/.test(condL);
      const generic = !hasSelf || /\bor another\b|\banother\b|\bor a\b|\bor one or more\b/.test(condL);
      result.triggers.push({
        ...base,
        kind: "event",
        events,
        self: hasSelf,
        generic,
        who: generic ? whoFromCondition(condL.replace(/~/g, "")) : "you",
        attacksYou: /attacks you\b|attack you\b/.test(condL),
        ...typesFromCondition(condL),
        condition: cond,
        effect: m[3],
      });
      if (events[0] === "other") result.unknown.push(base);
      return;
    }

    if (/^(When|Whenever|At)\b/.test(s)) result.unknown.push(base);
  });
  return result;
}

// Tipos de una carta según su línea de tipo.
export function typesOf(card) {
  const t = (card?.t || "").toLowerCase();
  return TYPE_WORDS.filter((w) => t.includes(w));
}

function typeMatches(trig, eventTypes) {
  if (!eventTypes?.length) return true;
  if (trig.non.some((t) => eventTypes.includes(t))) return false;
  const relevant = trig.types.filter((t) => t !== "land" || trig.events.includes("landfall") || eventTypes.includes("land"));
  if (!relevant.length) return true;
  return relevant.some((t) => eventTypes.includes(t));
}

// ¿Un disparo de evento reacciona a este evento?
// event: { type, actor, types?, sourceUid? }  — actor = índice de jugador
// perm:  { uid, controller }
export function eventMatches(trig, perm, event) {
  if (trig.kind !== "event") return false;
  const evType = event.type === "landfall" ? ["landfall", "etb"] : [event.type];
  if (event.type === "etb" && event.types?.includes("land")) evType.push("landfall");
  if (!trig.events.some((e) => evType.includes(e))) return false;

  const isSource = event.sourceUid != null && event.sourceUid === perm.uid;
  if (isSource && trig.self) return true;
  if (!trig.generic) return false;
  if (isSource && /\banother\b/.test(trig.condition.toLowerCase())) return false;

  if (trig.who === "you" && event.actor !== perm.controller) return false;
  if (trig.who === "opp" && event.actor === perm.controller) return false;
  if (trig.attacksYou && event.target != null && event.target !== perm.controller) return false;
  return typeMatches(trig, event.types);
}

// ¿Un disparo de fase ocurre en este paso del turno del jugador `active`?
export function phaseMatches(trig, perm, step, active) {
  if (trig.kind !== "phase" || !trig.steps.includes(step)) return false;
  if (trig.whose === "you") return active === perm.controller;
  if (trig.whose === "opp") return active !== perm.controller;
  return true;
}

// Cuántas veces se dispara una habilidad dado el conjunto de modificadores en juego.
export function multiplierFor(trig, perm, event, modifiers) {
  let times = 1;
  const notes = [];
  const evType = event.type === "landfall" ? "etb" : event.type;
  for (const { mod, perm: mp } of modifiers) {
    if (mod.event !== "any" && mod.event !== evType) continue;
    if (mod.types?.length && event.types?.length && !mod.types.some((t) => event.types.includes(t))) continue;
    if (mod.scope === "you" && mp.controller !== perm.controller) continue;
    if (mod.kind === "double") { times += 1; notes.push(`+1 por ${mp.name}`); }
    if (mod.kind === "suppress") { times = 0; notes.push(`anulado por ${mp.name}`); break; }
  }
  return { times, notes };
}
