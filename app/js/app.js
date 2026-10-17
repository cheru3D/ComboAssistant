// Interfaz de Combo Assistant (PWA sin dependencias).
import { STEPS, EVENTS, typesOf } from "./triggers.js";
import * as G from "./game.js";

const IMG_BASE = "https://cards.scryfall.io/";
const app = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");

let db = new Map();
let index = []; // [{key, card}]
let g = G.load();
const ui = { tab: "turn", setup: { opponents: 3, starting: 0, commander: null }, sheet: null };

const STEP_NOTES = {
  untap: "Endereza tus permanentes. Nadie recibe prioridad.",
  draw: "Roba tu carta del turno.",
  cleanup: "Descarta hasta 7 cartas. Se quita el daño y terminan los efectos “hasta el final del turno”.",
};

const EVENT_BUTTONS = [
  { type: "dies", label: "💀 Murió una criatura", types: ["creature"], verb: "perdió una criatura" },
  { type: "etb", label: "➕ Entró una criatura", types: ["creature"], verb: "hizo entrar una criatura" },
  { type: "landfall", label: "⛰️ Entró una tierra", types: ["land"], verb: "jugó una tierra" },
  { type: "cast", label: "✨ Lanzó un hechizo", ask: true, verb: "lanzó" },
  { type: "draw", label: "🃏 Robó una carta", verb: "robó una carta" },
  { type: "lifegain", label: "❤️ Ganó vida", verb: "ganó vida" },
  { type: "sacrifice", label: "🔥 Sacrificó algo", verb: "sacrificó algo" },
  { type: "discard", label: "🗑️ Descartó", verb: "descartó" },
];

// Botones de "Jugar" en las fases principales de tu turno.
const PLAY_BUTTONS = [
  { id: "land", label: "⛰️ Jugar tierra", title: "Jugar tierra", filter: (t) => /\bLand\b/.test(t) },
  { id: "permanent", label: "🐉 Criatura o artefacto", title: "Lanzar criatura o artefacto", filter: (t) => /\b(Creature|Artifact)\b/.test(t) },
  { id: "spell", label: "✨ Conjuro, encantamiento o instantáneo", title: "Lanzar conjuro, encantamiento o instantáneo", filter: (t) => /\b(Sorcery|Enchantment|Instant)\b/.test(t) },
];
const PERMANENT_TYPES = ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"];

const SPELL_TYPES = [
  { label: "Criatura", types: ["creature"] },
  { label: "Instantáneo / Conjuro", types: ["instant", "sorcery"] },
  { label: "Artefacto", types: ["artifact"] },
  { label: "Encantamiento", types: ["enchantment"] },
  { label: "Planeswalker", types: ["planeswalker"] },
];

// --- Utilidades ----------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const playerName = (i) => (i === 0 ? "Tú" : g.players[i]?.name);
const persist = () => G.save(g);

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function search(q, limit = 30, filter = null) {
  const n = norm(q.trim());
  if (n.length < 2) return [];
  const starts = [], contains = [];
  for (const e of index) {
    if (filter && !filter(e.card.t)) continue;
    if (e.key.startsWith(n)) starts.push(e.card);
    else if (contains.length < limit && e.key.includes(n)) contains.push(e.card);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// --- Hojas (modales) -------------------------------------------------------------

function openSheet(html) {
  sheetRoot.innerHTML = `<div class="backdrop" data-act="close-sheet"><div class="sheet" data-stop>${html}</div></div>`;
  const input = sheetRoot.querySelector("input[autofocus]");
  if (input) setTimeout(() => input.focus(), 50);
}
function closeSheet() {
  sheetRoot.innerHTML = "";
  ui.sheet = null;
}

// --- Render ----------------------------------------------------------------------

function render() {
  if (!g) return renderSetup();
  const title = g.active === 0 ? "Mi turno" : `Turno de ${esc(g.players[g.active].name)}`;
  const count = g.perms.filter((p) => p.zone === "battlefield").length;
  app.innerHTML = `
    <header class="top">
      <div class="top-row">
        <h1>${title} <span class="turn-no">· Ronda ${g.turn}</span></h1>
        <button class="icon-btn" data-act="menu" aria-label="Menú">⋮</button>
      </div>
      <nav class="tabs">
        <button class="${ui.tab === "turn" ? "on" : ""}" data-act="tab" data-tab="turn">Turno</button>
        <button class="${ui.tab === "board" ? "on" : ""}" data-act="tab" data-tab="board">Campo (${count})</button>
      </nav>
    </header>
    <main>${ui.tab === "turn" ? renderTurn() : renderBoard()}</main>
    <div class="bottom-bar"><div class="inner">
      <button class="btn primary" data-act="next">${esc(G.nextLabel(g))}</button>
    </div></div>`;
}

function renderTrig(it, doneKey, { checkable = true } = {}) {
  const done = doneKey && g.done[doneKey];
  const tags = [];
  tags.push(`<span class="tag">${esc(it.mine ? "Tuyo" : it.owner)}</span>`);
  if (it.times === 0) tags.push(`<span class="tag zero">anulado</span>`);
  else if (it.times !== 1) tags.push(`<span class="tag times">×${it.times}</span>`);
  if (it.cond) tags.push(`<span class="tag cond">${esc(it.cond)}</span>`);
  const notes = it.notes?.length ? `<div class="text">${esc(it.notes.join(" · "))}</div>` : "";
  return `
    <div class="trig ${it.mine ? "" : "opp"} ${done ? "done" : ""}">
      ${checkable ? `<input type="checkbox" ${done ? "checked" : ""} data-act="toggle" data-key="${esc(doneKey)}" aria-label="Hecho">` : ""}
      <div class="body" data-act="detail" data-uid="${it.perm.uid}">
        <div class="name">${esc(it.perm.name)}${tags.join("")}</div>
        <div class="text">${esc(it.trig.raw)}</div>
        ${notes}
      </div>
    </div>`;
}

function renderTurn() {
  let html = "";
  if (g.active === 0) {
    const step = G.currentStep(g);
    const items = G.triggersForStep(g, db, step.id, 0);
    html += `<div class="steps">${STEPS.map((s, i) => `<span class="${i < g.stepIdx ? "done" : i === g.stepIdx ? "now" : ""}"></span>`).join("")}</div>
      <div class="phase-label">${esc(step.phase)}</div>
      <div class="step-title">${esc(step.es)}<small>${esc(step.en)}</small></div>
      ${STEP_NOTES[step.id] ? `<p class="step-note">${esc(STEP_NOTES[step.id])}</p>` : ""}
      ${items.length ? items.map((it) => renderTrig(it, `${step.id}|${it.key}`)).join("") : `<div class="empty">Nada se dispara en este paso</div>`}
      ${["main1", "main2"].includes(step.id) ? renderPlay() : ""}`;
  } else {
    let mine = "", others = "", othersCount = 0;
    for (const step of STEPS) {
      const items = G.triggersForStep(g, db, step.id, g.active);
      const m = items.filter((it) => it.mine), o = items.filter((it) => !it.mine);
      if (m.length) mine += `<h2>${esc(step.es)} · ${esc(step.en)}</h2>` + m.map((it) => renderTrig(it, `${step.id}|${it.key}`)).join("");
      if (o.length) {
        othersCount += o.length;
        others += `<h2>${esc(step.es)}</h2>` + o.map((it) => renderTrig(it, `${step.id}|${it.key}`)).join("");
      }
    }
    html += mine || `<div class="empty big">Nada que hacer en este turno</div>`;
    if (othersCount) html += `<details class="others"><summary>Disparos de los oponentes (${othersCount})</summary>${others}</details>`;
  }
  html += `<h2>¿Pasó algo?</h2><div class="events">${EVENT_BUTTONS.map((b, i) => `<button data-act="event" data-i="${i}">${b.label}</button>`).join("")}</div>`;
  return html;
}

function renderPlay() {
  return `<h2>Jugar</h2><div class="play">${PLAY_BUTTONS.map((b) => {
    const off = b.id === "land" && g.landPlayed;
    return `<button data-act="play" data-id="${b.id}" ${off ? "disabled" : ""}>${off ? "⛰️ Tierra ya jugada este turno" : b.label}</button>`;
  }).join("")}</div>`;
}

function permRow(p) {
  const card = G.cardOf(p, db);
  const parsed = G.parsed(card);
  const badges = [];
  if (p.qty > 1) badges.push(`<span class="tag times">×${p.qty}</span>`);
  if (parsed.triggers.length + parsed.modifiers.length) badges.push(`<span class="tag">⚡${parsed.triggers.length + parsed.modifiers.length}</span>`);
  if (parsed.unknown.length) badges.push(`<span class="tag cond">⚠</span>`);
  return `<button class="perm" data-act="detail" data-uid="${p.uid}">
    <div class="pname"><div>${esc(p.name)}</div><div class="ptype">${esc(card.t)}</div></div>${badges.join("")}
  </button>`;
}

function renderBoard() {
  return g.players.map((pl, i) => {
    const perms = g.perms.filter((p) => p.controller === i);
    const zone = (z) => perms.filter((p) => p.zone === z);
    const cmd = zone("command"), bf = zone("battlefield"), gy = zone("graveyard"), ex = zone("exile");
    return `<section class="player">
      <div class="player-head">
        <h3 class="${i === 0 ? "mine" : "opp"}">${esc(i === 0 ? "Tú" : pl.name)}</h3>
        <button class="btn small" data-act="add" data-player="${i}">+ Carta</button>
      </div>
      ${cmd.length ? `<div class="zone-label">Zona de mando</div>${cmd.map(permRow).join("")}` : ""}
      ${bf.length ? bf.map(permRow).join("") : `<div class="empty">Sin permanentes</div>`}
      ${gy.length ? `<div class="zone-label">Cementerio (${gy.length})</div>${gy.map(permRow).join("")}` : ""}
      ${ex.length ? `<details><summary class="zone-label">Exilio (${ex.length})</summary>${ex.map(permRow).join("")}</details>` : ""}
    </section>`;
  }).join("");
}

function renderSetup() {
  const s = ui.setup;
  const startOpts = ["Yo", ...Array.from({ length: s.opponents }, (_, i) => `Oponente ${i + 1}`)];
  if (s.starting > s.opponents) s.starting = 0;
  app.innerHTML = `<div class="setup">
    <h1>Combo Assistant</h1>
    <p class="lead">Nueva partida de Commander. ${db.size ? `${db.size.toLocaleString("es")} cartas disponibles sin conexión.` : ""}</p>
    <label class="field"><span>¿Cuántos oponentes?</span>
      <div class="seg">${[1, 2, 3, 4, 5].map((n) => `<button class="${s.opponents === n ? "on" : ""}" data-act="setup-opp" data-n="${n}">${n}</button>`).join("")}</div>
    </label>
    <label class="field"><span>¿Quién empieza?</span>
      <select data-act="setup-start">${startOpts.map((o, i) => `<option value="${i}" ${s.starting === i ? "selected" : ""}>${o}</option>`).join("")}</select>
    </label>
    <label class="field"><span>Tu comandante (opcional)</span>
      <button class="chip" style="width:100%" data-act="setup-cmd">${s.commander ? esc(s.commander.n) : "Elegir comandante…"}</button>
    </label>
    <p class="lead" style="font-size:14px">El orden de turnos sigue la mesa: tú y luego Oponente 1, 2, 3…</p>
    <button class="btn primary full" data-act="start">Empezar partida</button>
  </div>`;
}

// --- Hojas concretas ---------------------------------------------------------------

function showReactions(title, items) {
  if (!items.length) { toast(`${title}: nada reacciona`); return; }
  const key = (it) => `react|${it.key}`;
  ui.sheet = { kind: "reactions", title, items };
  openSheet(`<h3>⚡ ${esc(title)}</h3><p class="sub">Esto se dispara. Pon en la pila los tuyos en el orden que quieras.</p>
    ${items.map((it) => renderTrig(it, key(it))).join("")}
    <button class="btn primary full" data-act="close-sheet">Listo</button>`);
}

function describeTrig(t) {
  if (t.kind === "phase") {
    const whose = { you: "tuyo", opp: "de cada oponente", each: "de cada jugador", other: "⚠ de otro jugador" }[t.whose];
    return `⏱ Al comienzo de ${t.steps.map((s) => STEPS.find((x) => x.id === s).es).join(" y ")} (${whose})`;
  }
  const who = t.generic ? { you: "tú / lo tuyo", opp: "un oponente", any: "cualquiera" }[t.who] : "esta carta";
  const ev = t.events.map((e) => EVENTS[e]).join(", ");
  const zone = t.zone === "graveyard" ? " · desde el cementerio" : t.zone === "command" ? " · también en la zona de mando" : "";
  return `⚡ Cuando ${who}${t.self && t.generic ? " (o esta carta)" : ""}: ${ev}${zone}`;
}

function showDetail(uid) {
  const p = g.perms.find((x) => x.uid === uid);
  if (!p) return;
  const card = G.cardOf(p, db);
  const parsed = G.parsed(card);
  const det = [
    ...parsed.triggers.map((t) => `<div class="det">${esc(describeTrig(t))}</div>`),
    ...parsed.modifiers.map((m) => `<div class="det">${m.kind === "double" ? "✖2 Duplica disparos" : "🚫 Anula disparos"} por: ${esc(EVENTS[m.event] || "cualquier evento")}</div>`),
    ...parsed.unknown.map((u) => `<div class="det warn">⚠ Revisar a mano: ${esc(u.raw)}</div>`),
  ].join("");
  const actions = {
    battlefield: [
      ["graveyard", "💀 Al cementerio"], ["exile", "🚫 Exiliar"], ["gone", "↩ A la mano / quitar"],
      ...(p.controller === 0 && !p.custom ? [["command", "👑 A la zona de mando"]] : []),
    ],
    graveyard: [["battlefield", "▶ Regresa al campo"], ["gone", "Quitar"]],
    exile: [["battlefield", "▶ Regresa al campo"], ["gone", "Quitar"]],
    command: [["battlefield", "▶ Lanzar (entra al campo)"], ["gone", "Quitar"]],
  }[p.zone] || [];
  openSheet(`
    ${card.i ? `<img class="card-img" src="${IMG_BASE}${esc(card.i)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <h3>${esc(p.name)}</h3>
    <p class="sub">${esc(card.t)}${card.p ? ` · ${esc(card.p)}` : ""} · ${esc(playerName(p.controller))}</p>
    ${card.o ? `<div class="oracle">${esc(card.o)}</div>` : ""}
    ${det ? `<h2>Lo que detecta la app</h2>${det}` : ""}
    ${p.zone === "battlefield" ? `<div class="row"><span style="align-self:center;color:var(--muted)">Copias: ${p.qty || 1}</span>
      <button class="btn small" data-act="qty" data-uid="${uid}" data-d="-1">−1</button>
      <button class="btn small" data-act="qty" data-uid="${uid}" data-d="1">+1</button></div>` : ""}
    <div class="row">${actions.map(([to, label]) => `<button class="btn small ${to === "graveyard" ? "danger" : ""}" data-act="move" data-uid="${uid}" data-to="${to}">${label}</button>`).join("")}</div>`);
}

function showAdd(player, mode = "card") {
  ui.sheet = { kind: "add", player, zone: "battlefield", mode };
  const zones = [["battlefield", "Campo"], ["graveyard", "Cementerio"], ...(player === 0 ? [["command", "Mando"]] : [])];
  openSheet(`<h3>Agregar a ${esc(playerName(player))}</h3>
    <div class="seg" style="margin:10px 0">${zones.map(([z, l]) => `<button class="${z === "battlefield" ? "on" : ""}" data-act="add-zone" data-z="${z}">${l}</button>`).join("")}</div>
    <input type="search" placeholder="Buscar carta por nombre (en inglés)…" data-input="search" autofocus>
    <div class="results" id="results"></div>
    <details style="margin-top:16px"><summary style="color:var(--muted)">Agregar una ficha (token)</summary>
      <label class="field"><span>Nombre</span><input type="text" id="tok-name" value="Ficha"></label>
      <label class="field"><span>Tipo</span><select id="tok-type">
        <option value="Token Creature">Criatura</option><option value="Token Artifact">Artefacto (Tesoro, Pista…)</option><option value="Token Enchantment">Encantamiento</option>
      </select></label>
      <label class="field"><span>Cantidad</span><input type="text" inputmode="numeric" id="tok-qty" value="1"></label>
      <button class="btn primary full" data-act="add-token">Agregar ficha</button>
    </details>`);
}

function showSearchOnly(onPick) {
  ui.sheet = { kind: "pick", onPick };
  openSheet(`<h3>Elegir carta</h3><input type="search" placeholder="Buscar por nombre…" data-input="search" autofocus><div class="results" id="results"></div>`);
}

function showPlay(id) {
  const b = PLAY_BUTTONS.find((x) => x.id === id);
  ui.sheet = { kind: "play", button: b, filter: b.filter };
  openSheet(`<h3>${esc(b.title)}</h3>
    <input type="search" placeholder="Buscar carta por nombre (en inglés)…" data-input="search" autofocus>
    <div class="results" id="results"></div>`);
}

// Juega una carta tuya: disparos al lanzarla y, si es un permanente, al entrar.
function playCard(button, card) {
  const types = typesOf(card);
  const reactions = [];
  if (button.id === "land") {
    g.landPlayed = true;
  } else {
    // Disparos "when you cast this spell" de la propia carta (todavía en la pila)
    const ghost = { uid: -1, name: card.n, controller: 0, zone: "stack", qty: 1 };
    for (const trig of G.parsed(card).triggers) {
      if (trig.kind === "event" && trig.self && trig.events.includes("cast")) {
        reactions.push({ key: `cast-self:${trig.id}`, perm: ghost, trig, mine: true, owner: "Tú", times: 1, notes: [], cond: "Al lanzar" });
      }
    }
    reactions.push(...G.triggersForEvent(g, db, { type: "cast", actor: 0, types }, { cond: "Al lanzar" }));
  }
  if (types.some((t) => PERMANENT_TYPES.includes(t))) {
    const p = G.addPerm(g, card, 0, "battlefield");
    reactions.push(...G.enterReactions(g, db, p).map((it) => ({ ...it, cond: it.cond || "Al entrar", key: `etb|${it.key}` })));
  } else {
    // Instantáneos y conjuros terminan en el cementerio
    G.addPerm(g, card, 0, "graveyard");
  }
  closeSheet();
  persist();
  render();
  showReactions(button.id === "land" ? `Jugaste ${card.n}` : `Lanzaste ${card.n}`, reactions);
}

function showEvent(i) {
  const b = EVENT_BUTTONS[i];
  ui.sheet = { kind: "event", button: b };
  openSheet(`<h3>${b.label}</h3><p class="sub">¿Quién?</p>
    <div class="row">${g.players.map((_, p) => `<button class="chip" data-act="event-who" data-p="${p}">${esc(playerName(p))}</button>`).join("")}</div>`);
}

function fireEvent(b, actor, types = b.types) {
  closeSheet();
  const items = G.triggersForEvent(g, db, { type: b.type, actor, types });
  const who = actor === 0 ? "Tú" : g.players[actor].name;
  showReactions(`${who} ${b.verb}`, items);
}

function afterMove(reactions, title) {
  persist();
  render();
  if (reactions.length) showReactions(title, reactions);
  else { closeSheet(); toast(title); }
}

// --- Acciones -------------------------------------------------------------------------

const actions = {
  "close-sheet": () => { closeSheet(); render(); },
  tab: (el) => { ui.tab = el.dataset.tab; render(); },
  next: () => { G.advance(g); persist(); render(); window.scrollTo(0, 0); },
  toggle: (el) => { g.done[el.dataset.key] = el.checked; persist(); el.closest(".trig")?.classList.toggle("done", el.checked); },
  detail: (el) => showDetail(Number(el.dataset.uid)),
  add: (el) => showAdd(Number(el.dataset.player)),
  "add-zone": (el) => {
    ui.sheet.zone = el.dataset.z;
    el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el));
  },
  pick: (el) => {
    const card = db.get(el.dataset.name);
    if (ui.sheet?.kind === "play") return playCard(ui.sheet.button, card);
    if (ui.sheet?.kind === "pick") { const cb = ui.sheet.onPick; closeSheet(); cb(card); return; }
    const { player, zone } = ui.sheet;
    const p = G.addPerm(g, card, player, zone);
    const reactions = zone === "battlefield" ? G.enterReactions(g, db, p) : [];
    afterMove(reactions, `${card.n} entró`);
  },
  "add-token": () => {
    const name = document.getElementById("tok-name").value.trim() || "Ficha";
    const t = document.getElementById("tok-type").value;
    const qty = Math.max(1, parseInt(document.getElementById("tok-qty").value, 10) || 1);
    const card = { n: name, t, o: "", custom: true };
    const p = G.addPerm(g, card, ui.sheet.player, "battlefield", qty);
    afterMove(G.enterReactions(g, db, p), `${qty > 1 ? qty + " fichas" : name} entró`);
  },
  qty: (el) => {
    const p = g.perms.find((x) => x.uid === Number(el.dataset.uid));
    const d = Number(el.dataset.d);
    if (d < 0 && (p.qty || 1) <= 1) return;
    p.qty = (p.qty || 1) + d;
    const reactions = d > 0 ? G.triggersForEvent(g, db, { type: "etb", actor: p.controller, types: typesOf(G.cardOf(p, db)), sourceUid: p.uid }) : [];
    persist();
    if (reactions.length) { render(); showReactions(`Otra copia de ${p.name} entró`, reactions); }
    else { showDetail(p.uid); render(); }
  },
  move: (el) => {
    const p = g.perms.find((x) => x.uid === Number(el.dataset.uid));
    const to = el.dataset.to;
    const reactions = G.movePerm(g, db, p, to);
    const label = { graveyard: "fue al cementerio", exile: "fue exiliada", gone: "salió", battlefield: "entró al campo", command: "volvió a la zona de mando" }[to];
    afterMove(reactions, `${p.name} ${label}`);
  },
  event: (el) => showEvent(Number(el.dataset.i)),
  play: (el) => { if (!el.disabled) showPlay(el.dataset.id); },
  "event-who": (el) => {
    const b = ui.sheet.button;
    const actor = Number(el.dataset.p);
    if (!b.ask) return fireEvent(b, actor);
    ui.sheet.actor = actor;
    openSheet(`<h3>${b.label}</h3><p class="sub">¿Qué tipo de hechizo?</p>
      <div class="row">${SPELL_TYPES.map((s, i) => `<button class="chip" data-act="event-type" data-i="${i}">${s.label}</button>`).join("")}</div>`);
  },
  "event-type": (el) => {
    const s = SPELL_TYPES[Number(el.dataset.i)];
    const b = { ...ui.sheet.button, verb: `lanzó un hechizo (${s.label.toLowerCase()})` };
    fireEvent(b, ui.sheet.actor, s.types);
  },
  menu: () => openSheet(`<h3>Menú</h3>
    <div class="row" style="flex-direction:column">
      <button class="btn full" data-act="close-sheet">Volver a la partida</button>
      <button class="btn danger full" data-act="new-game">Terminar y empezar otra partida</button>
    </div>`),
  "new-game": () => {
    if (!confirm("¿Borrar esta partida y empezar otra?")) return;
    G.clear(); g = null; closeSheet(); render();
  },
  "setup-opp": (el) => { ui.setup.opponents = Number(el.dataset.n); renderSetup(); },
  "setup-cmd": () => showSearchOnly((card) => { ui.setup.commander = card; renderSetup(); }),
  start: () => {
    const s = ui.setup;
    g = G.newGame({ opponents: s.opponents, starting: s.starting });
    if (s.commander) G.addPerm(g, s.commander, 0, "command");
    ui.tab = g.active === 0 ? "turn" : "board";
    persist();
    render();
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  // Un clic dentro de la hoja no debe cerrarla por llegar al fondo
  if (el.dataset.act === "close-sheet" && el.classList.contains("backdrop") && e.target !== el) return;
  if (el.dataset.act === "toggle") e.stopPropagation();
  actions[el.dataset.act]?.(el, e);
});

document.addEventListener("change", (e) => {
  if (e.target.dataset.act === "setup-start") ui.setup.starting = Number(e.target.value);
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.input !== "search") return;
  const box = document.getElementById("results");
  const found = search(e.target.value, 30, ui.sheet?.filter);
  box.innerHTML = found.map((c) => `<button class="result" data-act="pick" data-name="${esc(c.n)}">${esc(c.n)}<small>${esc(c.t)}</small></button>`).join("")
    || (e.target.value.trim().length >= 2 ? `<div class="empty">Sin resultados</div>` : "");
});

// --- Arranque --------------------------------------------------------------------------

async function boot() {
  try {
    const res = await fetch("data/cards.json");
    const data = await res.json();
    for (const c of data.cards) db.set(c.n, c);
    index = data.cards.map((card) => ({ key: norm(card.n), card }));
  } catch (err) {
    app.innerHTML = `<div class="loading">No se pudo cargar la base de cartas.<br>${esc(err.message)}</div>`;
    return;
  }
  render();
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
