/* ==========================================================================
 * Registre extensible des actions (cases du plateau, cartes Chance, cartes
 * Action en main).  Toute action ajoutée avec `registerGooseAction(spec)` est
 * automatiquement prise en compte par le plateau, les tirages et les réglages.
 * ========================================================================== */
"use strict";

const ACTION_REGISTRY = {};
const CUSTOM_ACTION_SOURCES = {}; // id -> code source (actions injectées à chaud, pour la sauvegarde)

const THEMES = ["green", "blue", "yellow", "purple", "red"];

function registerGooseAction(spec) {
  if (!spec || typeof spec.id !== "string" || typeof spec.execute !== "function") {
    throw new Error("Format invalide : 'id' (String) et 'execute(gameState, playerId, context)' (Function) sont requis.");
  }
  const weight = typeof spec.defaultWeight === "number" ? spec.defaultWeight : 10;
  ACTION_REGISTRY[spec.id] = {
    id: spec.id,
    name: spec.name || spec.id,
    description: spec.description || "",
    icon: spec.icon || "✨",
    theme: THEMES.includes(spec.theme) ? spec.theme : "green",
    defaultWeight: weight,
    weight: typeof spec.weight === "number" ? spec.weight : weight,
    canBeOnBoard: spec.canBeOnBoard !== false,
    canBeChanceCard: spec.canBeChanceCard !== false,
    canBePlayerCard: spec.canBePlayerCard !== false,
    execute: spec.execute
  };
}

/* Borne une position entre 1 et maxCell (avec rebond optionnel sur l'arrivée). */
function clampOrBouncePosition(pos, maxCell = 63, bounce = true) {
  if (pos < 1) return 1;
  if (pos > maxCell) return bounce ? Math.max(1, maxCell - (pos - maxCell)) : maxCell;
  return pos;
}

/* Fabrique une action "déplacement relatif" (avance / recule de n cases). */
function movementAction(spec, delta, text) {
  registerGooseAction(Object.assign({}, spec, {
    execute(gs, playerId) {
      const p = gs.players.find(q => q.id === playerId);
      const from = p.position;
      p.position = delta >= 0
        ? clampOrBouncePosition(p.position + delta, gs.maxCell, gs.config.exactBounce)
        : Math.max(1, p.position + delta);
      return { gameState: gs, message: text(p, from), extraTurn: false, triggerChanceCard: false };
    }
  }));
}

/* ---------------------------- Actions de base ---------------------------- */

registerGooseAction({
  id: "replay", name: "L'Oie (Rejouer)", icon: "🦢", theme: "green", defaultWeight: 26,
  description: "Vous avez le droit de relancer les dés immédiatement !",
  canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true,
  execute(gs, playerId) {
    const p = gs.players.find(q => q.id === playerId);
    return { gameState: gs, message: `${p.name} profite de l'Oie et gagne un lancer supplémentaire !`, extraTurn: true, triggerChanceCard: false };
  }
});

registerGooseAction({
  id: "double_roll", name: "Double foulée", icon: "🪽", theme: "green", defaultWeight: 20,
  description: "Avancez une seconde fois du montant du dernier lancer (ou +4 si joué en carte).",
  canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true,
  execute(gs, playerId, ctx) {
    const p = gs.players.find(q => q.id === playerId);
    const bonus = ctx && ctx.lastRoll > 0 ? ctx.lastRoll : 4;
    p.position = clampOrBouncePosition(p.position + bonus, gs.maxCell, gs.config.exactBounce);
    return { gameState: gs, message: `${p.name} double sa foulée (+${bonus}) et file en case ${p.position} !`, extraTurn: false, triggerChanceCard: false };
  }
});

movementAction(
  { id: "forward_3", name: "Vent arrière (+3)", icon: "🍃", theme: "green", defaultWeight: 18,
    description: "Une brise légère vous porte : avancez de 3 cases.",
    canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true },
  3, p => `${p.name} profite du vent arrière (+3) et arrive en case ${p.position} !`);

movementAction(
  { id: "bridge_boost", name: "Le Pont (+6)", icon: "🌉", theme: "blue", defaultWeight: 14,
    description: "Traversez le pont secret et avancez directement de 6 cases !",
    canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true },
  6, p => `${p.name} emprunte le Pont et bondit jusqu'à la case ${p.position} !`);

movementAction(
  { id: "back_2", name: "Recul (-2)", icon: "↩️", theme: "red", defaultWeight: 18,
    description: "Un petit caillou dans la chaussure : reculez de 2 cases.",
    canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: false },
  -2, p => `${p.name} recule de 2 cases et se retrouve en case ${p.position}.`);

movementAction(
  { id: "labyrinth_back", name: "Labyrinthe (-4)", icon: "🌀", theme: "purple", defaultWeight: 12,
    description: "Vous vous égarez dans les haies du jardin : reculez de 4 cases.",
    canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: false },
  -4, p => `${p.name} se perd dans le Labyrinthe et recule en case ${p.position}.`);

movementAction(
  { id: "return_start", name: "Faux pas (-8)", icon: "💀", theme: "red", defaultWeight: 7,
    description: "Attention à la mare ! Vous glissez et reculez de 8 cases.",
    canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: false },
  -8, p => `Aïe ! ${p.name} glisse dans la mare et recule en case ${p.position}.`);

registerGooseAction({
  id: "swap_ahead", name: "Échange devant", icon: "🔄", theme: "purple", defaultWeight: 16,
  description: "Échangez votre place avec l'équipe située juste devant vous sur le plateau !",
  canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true,
  execute(gs, playerId) {
    const p = gs.players.find(q => q.id === playerId);
    const ahead = gs.players.filter(q => q.id !== playerId && q.position > p.position)
      .sort((a, b) => a.position - b.position);
    if (ahead.length === 0) {
      p.position = clampOrBouncePosition(p.position + 2, gs.maxCell, gs.config.exactBounce);
      return { gameState: gs, message: `Personne devant ${p.name} ! Elle avance de 2 cases (case ${p.position}).`, extraTurn: false, triggerChanceCard: false };
    }
    const target = ahead[0];
    const old = p.position;
    p.position = target.position;
    target.position = old;
    return { gameState: gs, message: `${p.name} échange sa place avec ${target.name} (${old} ⇄ ${p.position}) !`, extraTurn: false, triggerChanceCard: false };
  }
});

registerGooseAction({
  id: "leader_penalty_or_boost", name: "Équilibre du peloton", icon: "⚖️", theme: "blue", defaultWeight: 18,
  description: "Si vous êtes en tête, reculez d'autant de cases qu'il y a d'équipes ; sinon avancez du même nombre !",
  canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: true,
  execute(gs, playerId) {
    const p = gs.players.find(q => q.id === playerId);
    const n = gs.players.length;
    const isLeader = p.position === Math.max(...gs.players.map(q => q.position));
    if (isLeader) {
      p.position = Math.max(1, p.position - n);
      return { gameState: gs, message: `${p.name} était en tête : elle recule de ${n} cases (nombre d'équipes) vers la case ${p.position}.`, extraTurn: false, triggerChanceCard: false };
    }
    p.position = clampOrBouncePosition(p.position + n, gs.maxCell, gs.config.exactBounce);
    return { gameState: gs, message: `${p.name} n'était pas en tête : coup de pouce de +${n} cases jusqu'en case ${p.position} !`, extraTurn: false, triggerChanceCard: false };
  }
});

registerGooseAction({
  id: "draw_chance", name: "Carte Chance", icon: "🍀", theme: "yellow", defaultWeight: 24,
  description: "Piochez immédiatement une carte Chance et appliquez son effet !",
  canBeOnBoard: true, canBeChanceCard: false, canBePlayerCard: true,
  execute(gs, playerId) {
    const p = gs.players.find(q => q.id === playerId);
    return { gameState: gs, message: `${p.name} pioche une carte Chance !`, extraTurn: false, triggerChanceCard: true };
  }
});

registerGooseAction({
  id: "skip_turn", name: "L'Auberge", icon: "🛏️", theme: "yellow", defaultWeight: 12,
  description: "Faites une sieste bien méritée : vous passez votre prochain tour.",
  canBeOnBoard: true, canBeChanceCard: true, canBePlayerCard: false,
  execute(gs, playerId) {
    const p = gs.players.find(q => q.id === playerId);
    p.skipTurns = (p.skipTurns || 0) + 1;
    return { gameState: gs, message: `${p.name} s'arrête à l'Auberge et passera son prochain tour.`, extraTurn: false, triggerChanceCard: false };
  }
});
