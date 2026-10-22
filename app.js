/*
 * L'Oie des Brumes — interface (plateau, pions, dés, animations).
 * Toute la logique de jeu vit dans rules.js ; ici on ne fait qu'afficher.
 */
(function () {
  "use strict";
  const R = window.OieRules;
  const COLS = 9, ROWS = 7;
  const STEP_MS = 260, JUMP_MS = 650;
  const COLORS = ["#ff5d73", "#ffb347", "#f4e04d", "#7bd88f", "#2ec4b6", "#4cc9f0", "#7b8cff", "#b583ff", "#ff7ad9", "#e8eef7"];
  const ICONS = { goose: "i-goose", bridge: "i-bridge", inn: "i-inn", well: "i-well", maze: "i-maze", prison: "i-prison", death: "i-death", start: "i-start", end: "i-end" };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let game = null;
  let busy = false;
  let disp = {};       // position affichée de chaque pion (pendant les animations)
  let pawns = {};      // id -> élément
  const coords = [];   // coords[n] = {row, col}

  /* ---------- Plateau en spirale ---------- */
  function buildSpiral() {
    let top = 0, bottom = ROWS - 1, left = 0, right = COLS - 1;
    const seq = [];
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) seq.push([top, c]);
      top++;
      for (let r = top; r <= bottom; r++) seq.push([r, right]);
      right--;
      if (top <= bottom) { for (let c = right; c >= left; c--) seq.push([bottom, c]); bottom--; }
      if (left <= right) { for (let r = bottom; r >= top; r--) seq.push([r, left]); left++; }
    }
    seq.forEach(([row, col], i) => { coords[i + 1] = { row, col }; });
  }

  function buildBoard() {
    const board = $("board");
    board.innerHTML = "";
    for (let n = 1; n <= R.TOTAL; n++) {
      const { row, col } = coords[n];
      const type = R.cellType(n);
      const el = document.createElement("div");
      el.className = `cell t-${type}`;
      el.style.gridRow = row + 1;
      el.style.gridColumn = col + 1;
      el.dataset.n = n;
      const icon = ICONS[type]
        ? `<svg class="cell-icon"><use href="#${ICONS[type]}"/></svg>` : "";
      el.innerHTML = `${icon}<span class="cell-num">${n}</span>`;
      board.appendChild(el);
    }
    const layer = document.createElement("div");
    layer.id = "pawnLayer";
    layer.className = "pawn-layer";
    board.appendChild(layer);
  }

  /* ---------- Pions ---------- */
  function buildPawns() {
    const layer = $("pawnLayer");
    pawns = {};
    game.players.forEach((p) => {
      const el = document.createElement("div");
      el.className = "pawn";
      el.style.setProperty("--pc", COLORS[p.id]);
      el.title = p.name;
      el.textContent = p.id + 1;
      layer.appendChild(el);
      pawns[p.id] = el;
    });
  }

  function layoutPawns() {
    const groups = {};
    game.players.forEach((p) => { (groups[disp[p.id]] ||= []).push(p.id); });
    Object.entries(groups).forEach(([cell, ids]) => {
      const { row, col } = coords[cell];
      const n = ids.length;
      ids.forEach((id, i) => {
        let dx = 0, dy = 0;
        if (n > 1) {
          const outer = n > 6 && i < 6;
          const ringN = n <= 6 ? n : (outer ? 6 : n - 6);
          const idx = n <= 6 || outer ? i : i - 6;
          const r = n === 2 ? 1.9 : !outer && n > 6 ? 1.3 : n <= 4 ? 2.3 : 3.4;
          const a = (idx / ringN) * Math.PI * 2 - Math.PI / 2;
          dx = Math.cos(a) * r; dy = Math.sin(a) * r;
        }
        const el = pawns[id];
        el.style.setProperty("--col", col);
        el.style.setProperty("--row", row);
        el.style.setProperty("--dx", dx.toFixed(2));
        el.style.setProperty("--dy", dy.toFixed(2));
        el.style.zIndex = id === game.current ? 20 : 10 + i;
        el.classList.toggle("active", id === game.current && game.winner === null);
      });
    });
  }

  function syncPawns() {
    game.players.forEach((p) => { disp[p.id] = p.pos; });
    layoutPawns();
  }

  /* ---------- Panneau ---------- */
  function statusOf(p) {
    if (p.stuck) return { cls: "bad", text: p.pos === 31 ? "Au puits" : "En prison" };
    if (p.skip > 0) return { cls: "bad", text: `Auberge ×${p.skip}` };
    return null;
  }

  function renderPanel() {
    const cur = game.players[game.current];
    $("turnName").textContent = cur.name;
    $("turnDot").style.background = COLORS[cur.id];
    $("teamList").innerHTML = game.players.map((p) => {
      const s = statusOf(p);
      return `<li class="${p.id === game.current && game.winner === null ? "current" : ""}">
        <span class="dot" style="background:${COLORS[p.id]}"></span>
        <span class="tname">${escapeHtml(p.name)}</span>
        <span class="tpos">case ${p.pos}</span>
        ${s ? `<span class="chip ${s.cls}">${s.text}</span>` : ""}
      </li>`;
    }).join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function say(text, tone = "neutral") {
    const b = $("banner");
    b.textContent = text;
    b.dataset.tone = tone;
    const li = document.createElement("li");
    li.textContent = text;
    li.dataset.tone = tone;
    const log = $("log");
    log.prepend(li);
    while (log.children.length > 60) log.lastChild.remove();
  }

  /* ---------- Dés ---------- */
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function showDie(el, v) {
    el.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? "pip" : ""}"></i>`).join("");
    el.dataset.v = v;
  }
  const rnd = () => 1 + Math.floor(Math.random() * 6);

  async function rollAnimation() {
    $("die1").classList.add("rolling"); $("die2").classList.add("rolling");
    for (let i = 0; i < 9; i++) { showDie($("die1"), rnd()); showDie($("die2"), rnd()); await sleep(70); }
    const a = rnd(), b = rnd();
    showDie($("die1"), a); showDie($("die2"), b);
    $("die1").classList.remove("rolling"); $("die2").classList.remove("rolling");
    return [a, b];
  }

  /* ---------- Tour de jeu ---------- */
  async function playMove(ev) {
    const pawn = pawns[ev.id];
    if (ev.kind === "jump") {
      pawn.classList.add("jumping");
      disp[ev.id] = ev.path[0];
      layoutPawns();
      await sleep(JUMP_MS);
      pawn.classList.remove("jumping");
    } else {
      for (const c of ev.path) {
        disp[ev.id] = c;
        layoutPawns();
        await sleep(STEP_MS);
      }
    }
  }

  async function takeTurn() {
    if (busy || !game || game.winner !== null) return;
    busy = true;
    $("rollBtn").disabled = true;
    const [a, b] = await rollAnimation();
    const events = R.resolveRoll(game, a, b);
    for (const ev of events) {
      if (ev.type === "move") await playMove(ev);
      else { say(ev.text, ev.tone); await sleep(450); }
    }
    syncPawns();
    renderPanel();
    busy = false;
    if (game.winner !== null) return showWin();
    $("rollBtn").disabled = false;
    $("rollBtn").textContent = `Lancer les dés — ${game.players[game.current].name}`;
  }

  function showWin() {
    const w = game.players[game.winner];
    $("winTitle").textContent = `${w.name} remporte la partie !`;
    $("winText").textContent = `Arrivée exacte sur la case ${R.TOTAL} en ${w.rolls} lancer${w.rolls > 1 ? "s" : ""}. Bravo !`;
    $("winDialog").showModal();
  }

  /* ---------- Préparation ---------- */
  function clampCount() {
    const input = $("teamCount");
    const v = parseInt(input.value, 10);
    const ok = Number.isInteger(v) && v >= R.MIN_TEAMS && v <= R.MAX_TEAMS;
    $("setupError").hidden = ok;
    if (!ok) $("setupError").textContent = `Choisissez un nombre d'équipes entre ${R.MIN_TEAMS} et ${R.MAX_TEAMS}.`;
    return ok ? v : null;
  }

  function renderNameFields() {
    const v = clampCount();
    if (v === null) return;
    const list = $("teamNames");
    const old = Array.from(list.querySelectorAll("input")).map((i) => i.value);
    list.innerHTML = "";
    for (let i = 0; i < v; i++) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span><input type="text" maxlength="20" placeholder="Équipe ${i + 1}" aria-label="Nom de l'équipe ${i + 1}">`;
      li.querySelector("input").value = old[i] || "";
      list.appendChild(li);
    }
  }

  function setCount(v) {
    $("teamCount").value = Math.min(R.MAX_TEAMS, Math.max(R.MIN_TEAMS, v));
    renderNameFields();
  }

  function startGame() {
    const v = clampCount();
    if (v === null) return;
    const names = Array.from($("teamNames").querySelectorAll("input")).map((inp, i) => inp.value.trim() || `Équipe ${i + 1}`);
    game = R.createGame(names);
    busy = false;
    $("setup").hidden = true;
    $("game").hidden = false;
    $("log").innerHTML = "";
    buildBoard();
    buildPawns();
    syncPawns();
    renderPanel();
    showDie($("die1"), 1); showDie($("die2"), 1);
    $("rollBtn").disabled = false;
    $("rollBtn").textContent = `Lancer les dés — ${game.players[0].name}`;
    say(`La partie commence ! ${v} équipes sont sur la case 1.`);
  }

  function backToSetup() {
    $("game").hidden = true;
    $("setup").hidden = false;
    game = null;
  }

  /* ---------- Initialisation ---------- */
  buildSpiral();
  renderNameFields();
  $("teamMinus").onclick = () => setCount((parseInt($("teamCount").value, 10) || 2) - 1);
  $("teamPlus").onclick = () => setCount((parseInt($("teamCount").value, 10) || 2) + 1);
  $("teamCount").addEventListener("input", renderNameFields);
  $("startBtn").onclick = startGame;
  $("rollBtn").onclick = takeTurn;
  $("restartBtn").onclick = () => { if (!busy) backToSetup(); };
  $("replayBtn").onclick = () => { $("winDialog").close(); backToSetup(); };
  $("closeWinBtn").onclick = () => $("winDialog").close();
  document.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => $(b.dataset.open).showModal(); });
})();
