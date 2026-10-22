/* ==========================================================================
 * Le Jardin des Oies — moteur de jeu (ES6, sans dépendance)
 * ========================================================================== */
"use strict";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const MAX_CELL = 63;
const SAVE_KEY = "jardin-des-oies-save-v1";

const DEFAULT_NAMES = ["Camille", "Inès", "Noé", "Lucas", "Emma", "Léo", "Zoé", "Hugo", "Jade", "Adam"];
const PALETTE = [
  { name: "Terracotta", hex: "#D95338" }, { name: "Ocre doré", hex: "#DDA448" },
  { name: "Vert forêt", hex: "#2E5A44" }, { name: "Bleu azur", hex: "#3E78B2" },
  { name: "Prune", hex: "#7A4988" },      { name: "Orange", hex: "#E8943A" },
  { name: "Rose", hex: "#D9588F" },       { name: "Turquoise", hex: "#1FA3A3" },
  { name: "Ardoise", hex: "#5B6770" },    { name: "Brun", hex: "#8B5A2B" }
];

/* ---------------- Coordonnées de la spirale (11 colonnes × 8 lignes) ---------------- */
const SPIRAL = (() => {
  // [r départ, c départ, dr, dc, nombre de cases]
  const segments = [
    [7, 0, -1, 0, 8], [0, 1, 0, 1, 10], [1, 10, 1, 0, 7], [7, 9, 0, -1, 9], [6, 1, -1, 0, 6],
    [1, 2, 0, 1, 8],  [2, 9, 1, 0, 5],  [6, 8, 0, -1, 7], [5, 2, -1, 0, 3]
  ];
  const coords = {};
  let n = 1;
  segments.forEach(([r, c, dr, dc, len]) => {
    for (let i = 0; i < len; i++) coords[n++] = { r: r + dr * i, c: c + dc * i };
  });
  return coords;
})();

/* ---------------- État ---------------- */
const state = {
  maxCell: MAX_CELL,
  players: [],
  board: [],
  turnIndex: 0,
  round: 1,
  lastRoll: null,
  lastDice: [1, 1],
  pendingExtra: false,
  history: [],
  config: { boardCoverageProb: 45, cardDropProb: 35, diceCount: 2, exactBounce: true }
};
let busy = false;        // un tour est en cours d'animation / résolution
let gameOver = false;
let soundOn = true;
let setupDraft = { count: 4, names: [...DEFAULT_NAMES], diceCount: 2, coverage: 45, drop: 35, bounce: true };

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const currentPlayer = () => state.players[state.turnIndex];

/* ---------------- Sons ---------------- */
let audioCtx = null;
function tone(freq, dur = 0.08, type = "sine", gain = 0.07, delay = 0) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
  } catch (e) { /* audio indisponible */ }
}
function sfx(kind) {
  if (kind === "dice") [300, 380, 330, 420].forEach((f, i) => tone(f, 0.06, "square", 0.04, i * 0.06));
  else if (kind === "step") tone(520, 0.05, "triangle", 0.05);
  else if (kind === "bonus") [523, 659, 784].forEach((f, i) => tone(f, 0.12, "sine", 0.07, i * 0.09));
  else if (kind === "malus") [330, 262, 196].forEach((f, i) => tone(f, 0.15, "sawtooth", 0.05, i * 0.1));
  else if (kind === "win") [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "sine", 0.08, i * 0.14));
}

/* ---------------- Tirages pondérés & plateau ---------------- */
function pickWeightedAction(filter) {
  const eligible = Object.values(ACTION_REGISTRY).filter(a => a.weight > 0 && filter(a));
  if (!eligible.length) return null;
  let r = Math.random() * eligible.reduce((s, a) => s + a.weight, 0);
  for (const a of eligible) { r -= a.weight; if (r <= 0) return a; }
  return eligible[eligible.length - 1];
}

function generateBoard() {
  state.board = [];
  for (let n = 1; n <= state.maxCell; n++) {
    let actionId = null;
    if (n !== 1 && n !== state.maxCell && Math.random() < state.config.boardCoverageProb / 100) {
      const a = pickWeightedAction(x => x.canBeOnBoard);
      actionId = a ? a.id : null;
    }
    state.board.push({ number: n, actionId });
  }
}

function dealStartingCards() {
  state.players.forEach(p => {
    p.hand = [];
    const c = pickWeightedAction(a => a.canBePlayerCard);
    if (c) p.hand.push(c.id);
  });
}

function buildPlayers(count, names) {
  state.players = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: (names[i] || DEFAULT_NAMES[i] || `Équipe ${i + 1}`).trim() || `Équipe ${i + 1}`,
    color: PALETTE[i % PALETTE.length].hex,
    position: 1, skipTurns: 0, hand: []
  }));
}

function newGame(keepPlayers = true) {
  if (!keepPlayers || !state.players.length) buildPlayers(setupDraft.count, setupDraft.names);
  generateBoard();
  state.turnIndex = 0; state.round = 1; state.lastRoll = null; state.lastDice = [1, 1];
  state.pendingExtra = false; state.history = [];
  state.players.forEach(p => { p.position = 1; p.skipTurns = 0; });
  dealStartingCards();
  busy = false; gameOver = false;
  log(`Nouvelle partie : ${state.players.length} équipes, plateau de ${state.config.boardCoverageProb}% d'actions. Bonne chance à tous !`, true);
  log(`${currentPlayer().name}, la piste est à vous !`);
  buildBoardDom();
  renderAll();
  showBanner(null);
  save();
}

/* ---------------- Journal ---------------- */
function log(text, highlight = false) {
  state.history.unshift({ text, highlight });
  if (state.history.length > 40) state.history.pop();
  renderHistory();
}

/* ============================ RENDU ============================ */
const ILLUSTRATION = `
<svg viewBox="0 0 220 160" aria-hidden="true">
  <circle cx="72" cy="24" r="6" fill="#E8B84B"/>
  <g stroke="#E8B84B" stroke-width="1.6" stroke-linecap="round"><line x1="72" y1="12" x2="72" y2="15"/><line x1="72" y1="33" x2="72" y2="36"/><line x1="60" y1="24" x2="63" y2="24"/><line x1="81" y1="24" x2="84" y2="24"/></g>
  <path d="M135 130 C165 100 170 45 130 18" fill="none" stroke="#3F6A4E" stroke-width="2" stroke-linecap="round"/>
  <g fill="#3F6A4E"><ellipse cx="148" cy="108" rx="7" ry="3.5" transform="rotate(-25 148 108)"/><ellipse cx="158" cy="92" rx="8" ry="3.5" transform="rotate(-15 158 92)"/><ellipse cx="162" cy="74" rx="8" ry="3.5" transform="rotate(5 162 74)"/><ellipse cx="158" cy="56" rx="8" ry="3.5" transform="rotate(20 158 56)"/><ellipse cx="148" cy="39" rx="7" ry="3.5" transform="rotate(35 148 39)"/></g>
  <ellipse cx="110" cy="136" rx="68" ry="15" fill="#7FA082" opacity=".45"/><ellipse cx="122" cy="138" rx="38" ry="8" fill="#B7D3DF"/>
  <g stroke="#D97938" stroke-width="2.5" stroke-linecap="round"><line x1="96" y1="112" x2="96" y2="132"/><path d="M90 132 L101 132"/><line x1="106" y1="112" x2="109" y2="130"/><path d="M104 130 L114 130"/></g>
  <path d="M68 95 C68 112 92 118 115 112 C128 108 134 98 128 90 C120 82 92 84 84 72 C80 62 83 45 86 36 C88 30 82 26 77 30 C72 35 72 52 70 68 C68 78 68 85 68 95 Z" fill="#fff" stroke="#DCD5C7" stroke-width="1.5"/>
  <path d="M84 90 C96 86 114 90 120 100 C108 106 90 104 84 90 Z" fill="#F5F2EB" stroke="#DCD5C7" stroke-width="1.2"/>
  <path d="M74 56 Q80 59 84 55" stroke="#D95338" stroke-width="3" fill="none" stroke-linecap="round"/>
  <polygon points="75,30 63,34 75,37" fill="#E07A38"/><circle cx="79" cy="32" r="1.6" fill="#2B2927"/>
  <path d="M132 114 C132 121 142 123 149 120 C153 118 153 112 148 111 C143 110 140 104 139 101 C137 99 134 101 134 105 C134 109 132 111 132 114 Z" fill="#FAF6E8" stroke="#DCD5C7" stroke-width="1.2"/>
</svg>`;

function connectorClass(n) {
  if (n >= state.maxCell) return "";
  const a = SPIRAL[n], b = SPIRAL[n + 1];
  if (b.c > a.c) return "to-right";
  if (b.c < a.c) return "to-left";
  return b.r < a.r ? "to-up" : "to-down";
}

function buildBoardDom() {
  const grid = $("boardGrid");
  grid.innerHTML = "";
  for (let n = 1; n <= state.maxCell; n++) {
    const { r, c } = SPIRAL[n];
    const action = state.board[n - 1] && state.board[n - 1].actionId ? ACTION_REGISTRY[state.board[n - 1].actionId] : null;
    const el = document.createElement("div");
    el.className = `cell ${connectorClass(n)} ${n === 1 ? "start" : ""} ${n === state.maxCell ? "goal" : action ? action.theme : ""}`;
    el.id = `cell-${n}`;
    el.style.gridRow = r + 1;
    el.style.gridColumn = c + 1;
    let icon = "", name = "", tip = `Case ${n} · Case paisible`;
    if (n === 1) { icon = "🚩"; tip = "Case 1 · Départ — toutes les équipes partent d'ici."; }
    else if (n === state.maxCell) { icon = "🏆"; name = "Arrivée"; tip = "Case 63 · Arrivée — tombez pile dessus pour gagner !"; }
    else if (action) { icon = action.icon; name = action.name.split(" ")[0]; tip = `Case ${n} · ${action.name} — ${action.description}`; }
    el.title = tip;
    el.innerHTML = `<span class="num">${n}</span>${icon ? `<span class="badge-icon">${icon}</span>` : ""}${name ? `<span class="badge-name">${esc(name)}</span>` : ""}`;
    grid.appendChild(el);
  }
  const stage = document.createElement("div");
  stage.className = "center-stage";
  stage.innerHTML = `<h2>La belle aventure</h2><p>En route pour la case ${state.maxCell} !</p>${ILLUSTRATION}<div class="quote">Le hasard fait bien les choses.</div>`;
  grid.appendChild(stage);

  // Pions : un élément par équipe, déplacé en CSS pour animer les déplacements
  const layer = $("pawnLayer");
  layer.innerHTML = "";
  state.players.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "pawn";
    el.id = `pawn-${p.id}`;
    el.style.background = p.color;
    el.textContent = i + 1;
    el.title = p.name;
    layer.appendChild(el);
  });
  renderLegend();
  requestAnimationFrame(layoutPawns);
}

/* Place chaque pion au centre de sa case ; plusieurs pions sur une case se partagent l'espace. */
function layoutPawns() {
  const wrap = $("boardWrap");
  const W = wrap.clientWidth;
  if (!W || !state.players.length) return;
  const groups = {};
  state.players.forEach(p => (groups[p.position] = groups[p.position] || []).push(p));
  Object.entries(groups).forEach(([pos, list]) => {
    const cell = $(`cell-${pos}`);
    if (!cell) return;
    const cx = cell.offsetLeft + cell.offsetWidth / 2;
    const cy = cell.offsetTop + cell.offsetHeight / 2 + (list.length === 1 ? cell.offsetHeight * 0.08 : 0);
    const n = list.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const size = Math.min(cell.offsetWidth * (n === 1 ? 0.5 : 0.95 / cols), cell.offsetHeight * 0.95 / rows, cell.offsetWidth * 0.55);
    list.forEach((p, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const rowCount = row === rows - 1 ? n - row * cols : cols;     // dernière ligne éventuellement plus courte
      const x = cx + (col - (rowCount - 1) / 2) * size * 1.02;
      const y = cy + (row - (rows - 1) / 2) * size * 1.02;
      const el = $(`pawn-${p.id}`);
      el.style.setProperty("--ps", `${size}px`);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  });
  state.players.forEach((p, i) => $(`pawn-${p.id}`).classList.toggle("active", i === state.turnIndex && !gameOver));
  document.querySelectorAll(".cell.current").forEach(c => c.classList.remove("current"));
  const cur = currentPlayer();
  if (cur && $(`cell-${cur.position}`)) $(`cell-${cur.position}`).classList.add("current");
}

function renderLegend() {
  const counts = {};
  state.board.forEach(c => { if (c.actionId) counts[c.actionId] = (counts[c.actionId] || 0) + 1; });
  $("legend").innerHTML = Object.values(ACTION_REGISTRY).filter(a => a.canBeOnBoard && counts[a.id]).slice(0, 6).map(a =>
    `<div class="legend-item"><span class="chip ${a.theme}">${a.icon}</span><span><b>${esc(a.name)}</b> · ${counts[a.id]} case${counts[a.id] > 1 ? "s" : ""}</span></div>`
  ).join("");
  $("boardInfo").textContent = `Plateau aléatoire (${state.config.boardCoverageProb}%) · ${state.config.diceCount} dé${state.config.diceCount > 1 ? "s" : ""} · ${state.maxCell} cases`;
}

function dieSvg(v) {
  const P = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]] };
  return `<svg viewBox="0 0 100 100">${P[v].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#2B2927"/>`).join("")}</svg>`;
}

function renderTurnPanel() {
  const p = currentPlayer();
  if (!p) return;
  $("roundLabel").textContent = `Manche ${state.round}`;
  $("turnTitle").textContent = `C'est à vous, ${p.name} !`;
  $("turnSubtitle").textContent = p.skipTurns > 0 ? "Vous êtes à l'Auberge : ce tour sera passé." : "Jouez une carte Action si vous le souhaitez, puis lancez les dés.";
  $("die1").innerHTML = dieSvg(state.lastDice[0]);
  $("die2").innerHTML = dieSvg(state.lastDice[1]);
  $("die2").classList.toggle("hidden", state.config.diceCount === 1);
  $("rollTotal").textContent = state.lastRoll === null ? "–" : state.lastRoll;
  $("rollInfo").textContent = state.lastRoll === null ? "Pas encore de lancer" : "Dernier lancer";
  $("rollBtn").disabled = busy || gameOver;
  $("rollBtn").textContent = p.skipTurns > 0 ? "🛏️ Passer mon tour" : "🎲 Lancer les dés";
  $("drawChanceBtn").disabled = busy || gameOver;

  const hand = $("handBox");
  if (!p.hand.length) { hand.innerHTML = ""; return; }
  hand.innerHTML = `<div class="hand-title">Vos cartes Action (${p.hand.length}/3)</div>` + p.hand.map((id, i) => {
    const a = ACTION_REGISTRY[id];
    return a ? `<div class="hand-card"><span class="ico">${a.icon}</span><div class="txt"><b>${esc(a.name)}</b><span>${esc(a.description)}</span></div>
      <button class="btn primary small" data-play="${i}" ${busy || gameOver ? "disabled" : ""}>Jouer</button></div>` : "";
  }).join("");
}

function renderPlayers() {
  $("teamCount").textContent = state.players.length;
  const maxPos = Math.max(...state.players.map(p => p.position));
  $("playersList").innerHTML = state.players.map((p, i) => {
    const turn = i === state.turnIndex;
    let status = "Prête à jouer";
    if (p.skipTurns > 0) status = "Passe son prochain tour 🛏️";
    else if (turn) status = "À son tour de lancer";
    else if (p.position === maxPos && p.position > 1) status = "En tête de la partie";
    return `<div class="player ${turn ? "turn" : ""}">
      <div class="player-row">
        <div class="dot" style="background:${p.color}">${i + 1}</div>
        <div class="info"><b>${esc(p.name)}${p.hand.length ? ` <small>🃏×${p.hand.length}</small>` : ""}</b><span>${status}</span></div>
        <div class="pos"><small>CASE</small><b>${p.position}</b></div>
      </div>
      <div class="bar"><i style="width:${Math.round(p.position / state.maxCell * 100)}%;background:${p.color}"></i></div>
    </div>`;
  }).join("");
}

function renderHistory() {
  $("history").innerHTML = state.history.slice(0, 20).map(h => `<li class="${h.highlight ? "hl" : ""}">${esc(h.text)}</li>`).join("");
}

function renderAll() {
  renderTurnPanel();
  renderPlayers();
  renderHistory();
  layoutPawns();
}

function showBanner(title, text, icon = "") {
  const b = $("actionBanner");
  if (!title) { b.classList.add("hidden"); return; }
  b.innerHTML = `<b>${icon} ${esc(title)}</b>${esc(text)}`;
  b.classList.remove("hidden");
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ============================ MÉCANIQUE DE JEU ============================ */
async function rollDice() {
  if (busy || gameOver) return;
  const p = currentPlayer();

  if (p.skipTurns > 0) {
    busy = true;
    p.skipTurns--;
    log(`${p.name} passe son tour à l'Auberge.`);
    showBanner("Tour passé", `${p.name} sera prête au prochain tour.`, "🛏️");
    await endTurn();
    return;
  }

  busy = true;
  showBanner(null);
  renderTurnPanel();
  const dice = state.config.diceCount;
  [$("die1"), $("die2")].forEach(d => d.classList.add("rolling"));
  sfx("dice");
  for (let i = 0; i < 8; i++) {
    $("die1").innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
    $("die2").innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
    await sleep(65);
  }
  [$("die1"), $("die2")].forEach(d => d.classList.remove("rolling"));
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = dice === 2 ? 1 + Math.floor(Math.random() * 6) : 0;
  const total = d1 + d2;
  state.lastDice = [d1, d2 || 1];
  state.lastRoll = total;
  renderTurnPanel();
  await sleep(250);

  await moveSteps(p, total);
  if (checkVictory(p)) return;

  const cell = state.board[p.position - 1];
  const action = cell && cell.actionId ? ACTION_REGISTRY[cell.actionId] : null;
  if (action) {
    await sleep(250);
    const res = await resolveAction(action, p.id, { source: "CELL", cellNumber: p.position, lastRoll: total });
    if (res.victory) return;
    if (res.extraTurn) { await grantExtraRoll(p); return; }
  }
  await endTurn();
}

/* Déplacement animé case par case (avec rebond sur la case 63). */
async function moveSteps(player, steps) {
  const start = player.position;
  let pos = start, dir = 1;
  const path = [];
  for (let i = 0; i < steps; i++) {
    if (pos + dir > state.maxCell) {
      if (!state.config.exactBounce) break;
      dir = -1;
    }
    pos += dir;
    path.push(pos);
  }
  const bounced = dir === -1;
  for (const cell of path) {
    player.position = cell;
    sfx("step");
    layoutPawns();
    renderPlayers();
    await sleep(Math.max(90, Math.min(240, 1500 / path.length)));
  }
  await sleep(150);
  if (bounced) log(`${player.name} lance ${steps}, dépasse ${state.maxCell} et rebondit sur la case ${player.position}.`);
  else log(`${player.name} avance de ${steps} cases (case ${start} → ${player.position}).`);
  renderAll();
}

/* Exécute une action (case, carte Chance ou carte en main) et gère ses suites. */
async function resolveAction(action, playerId, context) {
  const cloned = {
    ...state,
    players: state.players.map(p => ({ ...p, hand: [...p.hand] })),
    board: state.board.map(c => ({ ...c })),
    config: { ...state.config }
  };
  let result;
  try {
    result = action.execute(cloned, playerId, context);
  } catch (err) {
    console.error("Erreur dans l'action", action.id, err);
    toast(`⚠️ L'action « ${action.name} » a échoué : ${err.message}`);
    return { extraTurn: false, victory: false };
  }
  if (!result || !result.gameState) result = { gameState: cloned, message: "", extraTurn: false, triggerChanceCard: false };

  // Applique le nouvel état aux joueurs (en conservant les références pour animer les pions)
  result.gameState.players.forEach(np => {
    const op = state.players.find(p => p.id === np.id);
    if (op) { op.position = np.position; op.skipTurns = np.skipTurns || 0; op.hand = np.hand || op.hand; }
  });
  if (result.gameState.board) state.board = result.gameState.board;

  const bad = action.theme === "red";
  sfx(bad ? "malus" : "bonus");
  if (result.message) {
    log(`${action.icon} ${result.message}`);
    showBanner(action.name, result.message, action.icon);
  }
  renderAll();
  await sleep(450);

  const actor = state.players.find(p => p.id === playerId);
  if (checkVictory(actor)) return { extraTurn: false, victory: true };

  if (result.triggerChanceCard) {
    const card = pickWeightedAction(a => a.canBeChanceCard);
    if (card) {
      await showChanceCard(card);
      const sub = await resolveAction(card, playerId, { ...context, source: "CHANCE_CARD" });
      return { extraTurn: result.extraTurn || sub.extraTurn, victory: sub.victory };
    }
  }
  return { extraTurn: !!result.extraTurn, victory: false };
}

function showChanceCard(card) {
  return new Promise(resolve => {
    $("chanceIcon").textContent = card.icon;
    $("chanceTitle").textContent = card.name;
    $("chanceDesc").textContent = card.description;
    openModal("chanceModal");
    $("chanceOk").onclick = () => { closeModals(); resolve(); };
  });
}

async function grantExtraRoll(p) {
  log(`🎲 ${p.name} peut relancer immédiatement !`);
  busy = false;
  renderAll();
  save();
}

async function playHandCard(index) {
  if (busy || gameOver) return;
  const p = currentPlayer();
  const id = p.hand[index];
  const action = ACTION_REGISTRY[id];
  if (!action) return;
  busy = true;
  p.hand.splice(index, 1);
  log(`🃏 ${p.name} joue la carte Action « ${action.name} ».`, true);
  renderAll();
  const res = await resolveAction(action, p.id, { source: "PLAYER_CARD", cellNumber: p.position, lastRoll: state.lastRoll || 0 });
  if (res.victory) return;
  if (res.extraTurn) state.pendingExtra = true;
  busy = false;
  renderAll();
  save();
}

async function drawChanceManual() {
  if (busy || gameOver) return;
  busy = true;
  renderTurnPanel();
  const card = pickWeightedAction(a => a.canBeChanceCard);
  if (!card) { busy = false; renderAll(); return; }
  await showChanceCard(card);
  const p = currentPlayer();
  const res = await resolveAction(card, p.id, { source: "CHANCE_CARD", cellNumber: p.position, lastRoll: state.lastRoll || 0 });
  if (res.victory) return;
  busy = false;
  renderAll();
  save();
}

async function endTurn() {
  const finishing = currentPlayer();
  if (finishing.hand.length < 3 && Math.random() * 100 < state.config.cardDropProb) {
    const gift = pickWeightedAction(a => a.canBePlayerCard);
    if (gift) {
      finishing.hand.push(gift.id);
      log(`🎁 ${finishing.name} reçoit la carte Action « ${gift.name} » !`);
      toast(`🃏 ${finishing.name} reçoit une carte Action : ${gift.name}`);
    }
  }
  if (state.pendingExtra) {
    state.pendingExtra = false;
    log(`🎲 ${finishing.name} rejoue grâce à sa carte !`);
  } else {
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
    if (state.turnIndex === 0) state.round++;
    log(`${currentPlayer().name}, la piste est à vous !`);
  }
  busy = false;
  renderAll();
  save();
}

function checkVictory(player) {
  if (!player || player.position !== state.maxCell) return false;
  gameOver = true;
  busy = false;
  sfx("win");
  log(`🏆 VICTOIRE ! ${player.name} atteint la case ${state.maxCell} et remporte la partie !`, true);
  $("victoryName").textContent = `${player.name} remporte la partie !`;
  renderAll();
  openModal("victoryModal");
  save();
  return true;
}

/* ============================ MODALES ============================ */
function openModal(id) {
  closeModals();
  if (id === "setupModal") renderSetup();
  if (id === "settingsModal") renderWeights();
  if (id === "devModal") renderDev();
  if (id === "allCellsModal") renderCatalog();
  $(id).classList.remove("hidden");
}
function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden")); }

/* --- Nouvelle partie --- */
function renderSetup() {
  $("countGrid").innerHTML = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS)
    .map(n => `<button type="button" data-count="${n}" class="${n === setupDraft.count ? "sel" : ""}">${n}</button>`).join("");
  $("setupCountText").textContent = `${setupDraft.count} équipes`;
  $("namesGrid").innerHTML = Array.from({ length: setupDraft.count }, (_, i) => {
    const pal = PALETTE[i % PALETTE.length];
    return `<div class="name-card"><div class="dot" style="background:${pal.hex}">${i + 1}</div>
      <div class="col"><small><span>Équipe ${i + 1}</span><span style="color:${pal.hex}">${pal.name}</span></small>
      <input type="text" data-name="${i}" maxlength="20" value="${esc(setupDraft.names[i] || DEFAULT_NAMES[i] || "Équipe " + (i + 1))}" /></div></div>`;
  }).join("");
  $("coverageInput").value = setupDraft.coverage; $("coverageVal").textContent = `${setupDraft.coverage}%`;
  $("dropInput").value = setupDraft.drop; $("dropVal").textContent = `${setupDraft.drop}%`;
  $("bounceInput").checked = setupDraft.bounce;
  document.querySelectorAll("[data-dice]").forEach(b => b.classList.toggle("sel", +b.dataset.dice === setupDraft.diceCount));
  $("resumeBtn").classList.toggle("hidden", !state.players.length || gameOver);
}
function syncNames() {
  document.querySelectorAll("[data-name]").forEach(i => { if (i.value.trim()) setupDraft.names[+i.dataset.name] = i.value.trim(); });
}
function startFromSetup() {
  syncNames();
  state.config.boardCoverageProb = setupDraft.coverage;
  state.config.cardDropProb = setupDraft.drop;
  state.config.diceCount = setupDraft.diceCount;
  state.config.exactBounce = setupDraft.bounce;
  buildPlayers(setupDraft.count, setupDraft.names);
  closeModals();
  newGame(true);
  toast(`🎲 Partie lancée avec ${setupDraft.count} équipes !`);
}

/* --- Paramètres (poids des actions) --- */
function renderWeights() {
  $("weightsBody").innerHTML = Object.values(ACTION_REGISTRY).map(a => `<tr>
    <td>${a.icon} <b>${esc(a.name)}</b></td>
    <td><input type="number" min="0" max="100" value="${a.weight}" data-w="${a.id}" /></td>
    <td><input type="checkbox" data-b="${a.id}" ${a.canBeOnBoard ? "checked" : ""} /></td>
    <td><input type="checkbox" data-c="${a.id}" ${a.canBeChanceCard ? "checked" : ""} /></td>
    <td><input type="checkbox" data-h="${a.id}" ${a.canBePlayerCard ? "checked" : ""} /></td></tr>`).join("");
}
function applySettings() {
  Object.values(ACTION_REGISTRY).forEach(a => {
    const w = document.querySelector(`[data-w="${a.id}"]`);
    if (!w) return;
    a.weight = Math.max(0, Math.min(100, parseInt(w.value, 10) || 0));
    a.canBeOnBoard = document.querySelector(`[data-b="${a.id}"]`).checked;
    a.canBeChanceCard = document.querySelector(`[data-c="${a.id}"]`).checked;
    a.canBePlayerCard = document.querySelector(`[data-h="${a.id}"]`).checked;
  });
}

/* --- API Actions (IA / Dev) --- */
const CONTRACT_TEXT = `Format de l'objet passé à registerGooseAction(actionObject) — JavaScript ES6 :

{
  id: "identifiant_snake_case",       // String, unique
  name: "Nom court",                  // String, affiché sur la case et la carte
  description: "Règle expliquée",     // String, affichée au survol / au tirage
  icon: "🚀",                         // String, emoji
  theme: "green",                     // 'green' | 'blue' | 'yellow' | 'purple' | 'red'
  defaultWeight: 15,                  // Number 0..100, fréquence d'apparition
  canBeOnBoard: true,                 // peut apparaître sur une case du plateau
  canBeChanceCard: true,              // peut être une carte Chance
  canBePlayerCard: true,              // peut être une carte Action en main
  execute(gameState, playerId, context) {
    // gameState : { players:[{id,name,position(1..63),skipTurns,hand}], board:[{number,actionId}],
    //               turnIndex, round, maxCell:63, config:{exactBounce,...} }
    // context   : { source: 'CELL'|'CHANCE_CARD'|'PLAYER_CARD', cellNumber, lastRoll }
    // Modifier gameState puis le retourner :
    return { gameState, message: "Texte affiché", extraTurn: false, triggerChanceCard: false };
  }
}`;
const EXAMPLE_ACTION = `{
  id: "swap_last_player",
  name: "Coup de pouce",
  description: "Échangez votre place avec l'équipe la plus en retard !",
  icon: "🚀",
  theme: "purple",
  defaultWeight: 10,
  canBeOnBoard: true,
  canBeChanceCard: true,
  canBePlayerCard: true,
  execute(gameState, playerId, context) {
    const me = gameState.players.find(p => p.id === playerId);
    const last = [...gameState.players].sort((a, b) => a.position - b.position)[0];
    if (last.id !== me.id) {
      const tmp = me.position; me.position = last.position; last.position = tmp;
    }
    return { gameState, message: me.name + " échange sa place avec " + last.name + " !", extraTurn: false, triggerChanceCard: false };
  }
}`;
function renderDev() { $("contractBox").textContent = CONTRACT_TEXT; }
function injectAction() {
  const code = $("actionCode").value.trim();
  const fb = $("actionFeedback");
  try {
    if (!code) throw new Error("Collez d'abord un objet action.");
    const spec = new Function(`return (${code});`)();
    registerGooseAction(spec);
    CUSTOM_ACTION_SOURCES[spec.id] = code;
    fb.textContent = `✅ Action « ${spec.name || spec.id} » (${spec.id}) enregistrée !`;
    fb.className = "feedback ok";
    if (state.players.length) { generateBoard(); buildBoardDom(); renderAll(); log(`⚡ Action « ${spec.name || spec.id} » injectée : plateau régénéré.`, true); save(); }
    setTimeout(closeModals, 900);
  } catch (err) {
    fb.textContent = `❌ Erreur de syntaxe ou de contrat : ${err.message}`;
    fb.className = "feedback err";
  }
}
function copyPrompt() {
  const prompt = `Je souhaite que tu développes une nouvelle action pour mon jeu de l'oie.\n\n${CONTRACT_TEXT}\n\nRéponds uniquement par l'objet JavaScript, sans explication. Voici l'action voulue : `;
  (navigator.clipboard ? navigator.clipboard.writeText(prompt) : Promise.reject()).then(
    () => toast("📋 Prompt copié dans le presse-papiers"), () => toast("Copie impossible : sélectionnez le contrat manuellement."));
}

/* --- Catalogue --- */
function renderCatalog() {
  $("catalog").innerHTML = Object.values(ACTION_REGISTRY).map(a => `<div class="cat-item">
    <div class="chip ${a.theme}" style="background:var(--t-${a.theme})">${a.icon}</div>
    <div><b>${esc(a.name)}</b> <span class="muted">· poids ${a.weight}</span><div>${esc(a.description)}</div>
    <div class="tags">${a.canBeOnBoard ? "<span>Case plateau</span>" : ""}${a.canBeChanceCard ? "<span>Carte Chance</span>" : ""}${a.canBePlayerCard ? "<span>Carte en main</span>" : ""}</div></div></div>`).join("");
}

/* ============================ SAUVEGARDE ============================ */
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      state: { ...state, history: state.history.slice(0, 20) }, gameOver,
      weights: Object.fromEntries(Object.values(ACTION_REGISTRY).map(a => [a.id, [a.weight, a.canBeOnBoard, a.canBeChanceCard, a.canBePlayerCard]])),
      custom: CUSTOM_ACTION_SOURCES
    }));
  } catch (e) { /* stockage indisponible */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    Object.entries(data.custom || {}).forEach(([id, code]) => {
      try { registerGooseAction(new Function(`return (${code});`)()); CUSTOM_ACTION_SOURCES[id] = code; } catch (e) { /* action ignorée */ }
    });
    Object.entries(data.weights || {}).forEach(([id, w]) => {
      const a = ACTION_REGISTRY[id];
      if (a) [a.weight, a.canBeOnBoard, a.canBeChanceCard, a.canBePlayerCard] = w;
    });
    const s = data.state;
    if (!s || !Array.isArray(s.players) || s.players.length < MIN_PLAYERS || s.players.length > MAX_PLAYERS || !Array.isArray(s.board)) return false;
    Object.assign(state, s);
    gameOver = !!data.gameOver;
    busy = false;
    setupDraft.count = state.players.length;
    state.players.forEach((p, i) => { setupDraft.names[i] = p.name; });
    Object.assign(setupDraft, { coverage: state.config.boardCoverageProb, drop: state.config.cardDropProb, diceCount: state.config.diceCount, bounce: state.config.exactBounce });
    return true;
  } catch (e) { return false; }
}

/* ============================ ÉVÉNEMENTS ============================ */
function bindEvents() {
  document.addEventListener("click", e => {
    const t = e.target.closest("button, .modal");
    if (!t) return;
    const d = t.dataset;
    if (d.open !== undefined) d.open ? openModal(d.open) : closeModals();
    else if ("close" in d) closeModals();
    else if (d.count) { syncNames(); setupDraft.count = +d.count; renderSetup(); }
    else if (d.dice) { setupDraft.diceCount = +d.dice; renderSetup(); }
    else if (d.play !== undefined) playHandCard(+d.play);
  });
  $("rollBtn").onclick = rollDice;
  $("drawChanceBtn").onclick = drawChanceManual;
  $("newBoardBtn").onclick = () => { if (!busy) { newGame(true); toast("✨ Nouveau plateau généré !"); } };
  $("startBtn").onclick = startFromSetup;
  $("resumeBtn").onclick = closeModals;
  $("resetNamesBtn").onclick = () => { setupDraft.names = [...DEFAULT_NAMES]; renderSetup(); };
  $("coverageInput").oninput = e => { setupDraft.coverage = +e.target.value; $("coverageVal").textContent = `${e.target.value}%`; };
  $("dropInput").oninput = e => { setupDraft.drop = +e.target.value; $("dropVal").textContent = `${e.target.value}%`; };
  $("bounceInput").onchange = e => { setupDraft.bounce = e.target.checked; };
  $("applySettingsBtn").onclick = () => { applySettings(); save(); closeModals(); toast("Paramètres appliqués"); };
  $("applyRegenBtn").onclick = () => { applySettings(); closeModals(); newGame(true); };
  $("resetWeightsBtn").onclick = () => { Object.values(ACTION_REGISTRY).forEach(a => { a.weight = a.defaultWeight; }); renderWeights(); };
  $("injectBtn").onclick = injectAction;
  $("copyPromptBtn").onclick = copyPrompt;
  $("loadExampleBtn").onclick = () => { $("actionCode").value = EXAMPLE_ACTION; };
  $("victoryAgainBtn").onclick = () => { closeModals(); newGame(true); };
  $("victorySetupBtn").onclick = () => { openModal("setupModal"); };
  $("soundBtn").onclick = () => { soundOn = !soundOn; $("soundBtn").textContent = soundOn ? "🔊" : "🔇"; };
  window.addEventListener("resize", layoutPawns);
  if (window.ResizeObserver) new ResizeObserver(layoutPawns).observe($("boardWrap"));
}

window.addEventListener("load", () => {
  bindEvents();
  if (load()) {
    buildBoardDom();
    renderAll();
    toast("Partie précédente restaurée");
    if (gameOver) openModal("setupModal");
  } else {
    buildPlayers(setupDraft.count, setupDraft.names);
    newGame(true);
    openModal("setupModal");
  }
});
