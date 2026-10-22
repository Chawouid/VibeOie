/*
 * L'Oie en Fête — règles du jeu (logique pure, sans DOM).
 * Indépendant de l'habillage graphique : modifier le style ne touche jamais à ce fichier.
 *
 * Règles appliquées (jeu de l'oie traditionnel, 63 cases, 2 dés) :
 *  - Les équipes avancent de la somme des deux dés.
 *  - Oies (5, 9, 14, 18, 23, 27, 32, 36, 41, 45, 50, 54, 59) : on avance à nouveau du même
 *    nombre de cases et on rejoue.
 *  - Pont (6) : on saute à la case 12.
 *  - Auberge (19) : on passe 2 tours.
 *  - Puits (31) et Prison (52) : on reste bloqué jusqu'à ce qu'une autre équipe arrive sur la case.
 *  - Labyrinthe (42) : retour à la case 30.
 *  - Mort (58) : retour à la case 1.
 *  - Premier lancer d'une équipe : 6+3 -> case 26, 5+4 -> case 53.
 *  - Il faut tomber exactement sur la case 63 ; l'excédent fait reculer (rebond).
 *
 * Actions ajoutées (cases du plateau, réutilisables plus tard comme cartes action) :
 *  - Marée (47) : on recule d'autant de cases qu'il y a d'équipes.
 *  - Voleur (29) : on échange sa place avec l'équipe de son choix (choix = game.pending).
 *  - Miroir (38) : on rejoue, mais le prochain lancer fait avancer dans le sens inverse.
 */
(function (root) {
  "use strict";

  const TOTAL = 63;
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 10;
  const INN_TURNS = 2;

  const GEESE = [5, 9, 14, 18, 23, 27, 32, 36, 41, 45, 50, 54, 59];
  const SPECIAL = {
    6: { type: "bridge", to: 12 },
    19: { type: "inn" },
    31: { type: "well" },
    42: { type: "maze", to: 30 },
    52: { type: "prison" },
    29: { type: "thief" },
    38: { type: "mirror" },
    47: { type: "tide" },
    58: { type: "death", to: 1 },
  };

  function cellType(n) {
    if (n === 1) return "start";
    if (n === TOTAL) return "end";
    if (GEESE.includes(n)) return "goose";
    return SPECIAL[n] ? SPECIAL[n].type : "plain";
  }

  function createGame(names) {
    const players = names.map((name, i) => ({
      id: i, name, pos: 1, skip: 0, stuck: false, rolls: 0, mirror: false,
    }));
    return { players, current: 0, winner: null, turn: 1, pending: null };
  }

  /*
   * Déplace de `steps` cases depuis `from`.
   * dir = 1 : vers l'avant avec rebond sur la case finale ; dir = -1 : vers l'arrière, arrêt à la case 1.
   */
  function walk(from, steps, dir = 1) {
    const path = [];
    let pos = from, d = dir, bounced = false;
    for (let i = 0; i < steps; i++) {
      if (d === 1 && pos === TOTAL) { d = -1; bounced = true; }
      if (d === -1 && pos === 1) break;
      pos += d;
      path.push(pos);
    }
    return { path, end: pos, bounced };
  }

  function nextIndex(game) {
    return (game.current + 1) % game.players.length;
  }

  /* Passe au joueur suivant en sautant ceux qui sont bloqués. */
  function advanceTurn(game, events) {
    game.current = nextIndex(game);
    game.turn++;
    for (let guard = 0; guard < game.players.length * 3; guard++) {
      const p = game.players[game.current];
      if (game.players.every((q) => q.stuck)) {
        game.players.forEach((q) => { q.stuck = false; });
        events.push({ type: "info", tone: "good", text: "Toutes les équipes sont bloquées : le brouillard se lève, tout le monde est libéré !" });
        break;
      }
      if (p.stuck) {
        events.push({ type: "info", tone: "bad", text: `${p.name} est bloquée (case ${p.pos}) et passe son tour.` });
      } else if (p.skip > 0) {
        p.skip--;
        events.push({ type: "info", tone: "bad", text: `${p.name} se repose à l'auberge${p.skip > 0 ? ` (encore ${p.skip} tour)` : " et repartira au prochain tour"}.` });
      } else break;
      game.current = nextIndex(game);
      game.turn++;
    }
  }

  /*
   * Applique l'effet de la case où se trouve l'équipe courante.
   * ctx = { total, dir, goose } : `goose` vaut true pour un déplacement de dés (les oies ne
   * s'enchaînent pas après un recul ou un saut). Retourne { extra, done }.
   */
  function settle(game, p, ctx, events) {
    const info = (text, tone = "neutral") => events.push({ type: "info", text, tone });
    const move = (to, path, kind) => {
      events.push({ type: "move", id: p.id, path, kind });
      p.pos = to;
    };
    let extra = false;
    let goose = ctx.goose;

    for (let guard = 0; guard < 30; guard++) {
      const t = cellType(p.pos);
      const spec = SPECIAL[p.pos];

      if (p.pos === TOTAL) {
        game.winner = p.id;
        info(`${p.name} atteint la case ${TOTAL} : victoire !`, "good");
        return { extra: false, done: true };
      }

      if (t === "goose" && goose) {
        extra = true;
        info(`Une oie ! ${p.name} avance encore de ${ctx.total}${ctx.dir === -1 ? " (sens inverse)" : ""} et rejoue.`, "good");
        const g = walk(p.pos, ctx.total, ctx.dir);
        if (g.bounced) info(`${p.name} dépasse ${TOTAL} et rebondit jusqu'à la case ${g.end}.`, "bad");
        move(g.end, g.path, g.bounced ? "bounce" : "walk");
        if (g.bounced || g.path.length === 0) goose = false; // évite une boucle infinie 59 -> 63 -> 59
        continue;
      }
      goose = false;

      switch (t) {
        case "bridge":
        case "maze":
        case "death":
          info(t === "bridge" ? `${p.name} traverse le pont et file jusqu'à la case ${spec.to} !`
            : t === "maze" ? `${p.name} se perd dans le labyrinthe et revient à la case ${spec.to}.`
            : `${p.name} croise la Mort… retour à la case ${spec.to} !`, t === "bridge" ? "good" : "bad");
          move(spec.to, [spec.to], "jump");
          continue;
        case "tide": {
          const n = game.players.length;
          const w = walk(p.pos, n, -1);
          info(`La marée monte ! ${p.name} recule de ${n} case${n > 1 ? "s" : ""} (autant que d'équipes).`, "bad");
          if (w.path.length) move(w.end, w.path, "walk");
          continue;
        }
        case "mirror":
          p.mirror = true;
          extra = true;
          info(`${p.name} traverse le miroir : elle rejoue, mais en avançant dans le sens inverse !`, "good");
          return { extra, done: false };
        case "thief": {
          const options = game.players.filter((q) => q.id !== p.id && q.pos !== p.pos).map((q) => q.id);
          if (!options.length) { info(`${p.name} arrive chez le Voleur, mais personne n'est à échanger.`); return { extra, done: false }; }
          game.pending = { type: "thief", id: p.id, options, extra };
          info(`${p.name} rencontre le Voleur : elle peut échanger sa place avec l'équipe de son choix.`, "good");
          return { extra, done: false, waiting: true };
        }
        case "inn":
          p.skip = INN_TURNS;
          info(`${p.name} s'arrête à l'auberge : ${INN_TURNS} tours à passer.`, "bad");
          return { extra: false, done: false };
        case "well":
        case "prison": {
          game.players.forEach((q) => {
            if (q.id !== p.id && q.stuck && q.pos === p.pos) {
              q.stuck = false;
              info(`${q.name} est libérée par l'arrivée de ${p.name} !`, "good");
            }
          });
          p.stuck = true;
          info(`${p.name} ${t === "well" ? "tombe dans le puits" : "est jetée en prison"} : bloquée jusqu'à l'arrivée d'une autre équipe.`, "bad");
          return { extra: false, done: false };
        }
      }
      return { extra, done: false };
    }
    return { extra, done: false };
  }

  function finish(game, p, res, events) {
    if (res.done || res.waiting) return;
    if (res.extra) events.push({ type: "info", tone: "good", text: `${p.name} rejoue !` });
    else advanceTurn(game, events);
  }

  /*
   * Résout un lancer pour l'équipe courante. Modifie `game` et retourne la liste d'événements :
   *  - { type: "move", id, path: [cases], kind: "walk" | "bounce" | "jump" }
   *  - { type: "swap", moves: [{ id, to }] }
   *  - { type: "info", text, tone: "neutral" | "good" | "bad" }
   * À la fin, game.current désigne déjà la prochaine équipe jouable, sauf si game.winner est défini
   * ou si game.pending attend un choix (voir resolveThief).
   */
  function resolveRoll(game, d1, d2) {
    const p = game.players[game.current];
    const events = [];
    const total = d1 + d2;
    const first = p.rolls === 0;
    const dir = p.mirror ? -1 : 1;
    p.mirror = false;
    p.rolls++;

    const info = (text, tone = "neutral") => events.push({ type: "info", text, tone });
    const pair = [d1, d2].sort().join("");
    let ctx = { total, dir, goose: true };

    if (first && pair === "36") {
      info(`${p.name} lance ${d1}+${d2} dès le premier tour : les dés l'envoient à la case 26 !`, "good");
      events.push({ type: "move", id: p.id, path: [26], kind: "jump" });
      p.pos = 26;
      ctx.goose = false;
    } else if (first && pair === "45") {
      info(`${p.name} lance ${d1}+${d2} dès le premier tour : les dés l'envoient à la case 53 !`, "good");
      events.push({ type: "move", id: p.id, path: [53], kind: "jump" });
      p.pos = 53;
      ctx.goose = false;
    } else {
      const w = walk(p.pos, total, dir);
      info(`${p.name} lance ${d1}+${d2} = ${total}${dir === -1 ? " et recule (miroir)" : ""}.`);
      if (w.bounced) info(`${p.name} dépasse ${TOTAL} et rebondit jusqu'à la case ${w.end}.`, "bad");
      if (w.path.length) events.push({ type: "move", id: p.id, path: w.path, kind: w.bounced ? "bounce" : "walk" });
      p.pos = w.end;
    }

    finish(game, p, settle(game, p, ctx, events), events);
    return events;
  }

  /* Résout le choix du Voleur : échange des places avec l'équipe `targetId`. */
  function resolveThief(game, targetId) {
    const pend = game.pending;
    if (!pend || pend.type !== "thief" || !pend.options.includes(targetId)) return [];
    const p = game.players[pend.id];
    const q = game.players[targetId];
    const events = [];
    game.pending = null;

    [p.pos, q.pos] = [q.pos, p.pos];
    [p.stuck, q.stuck] = [q.stuck, p.stuck];
    events.push({ type: "info", tone: "good", text: `${p.name} échange sa place avec ${q.name} : case ${p.pos} pour l'une, case ${q.pos} pour l'autre !` });
    events.push({ type: "swap", moves: [{ id: p.id, to: p.pos }, { id: q.id, to: q.pos }] });
    if (p.stuck) events.push({ type: "info", tone: "bad", text: `${p.name} se retrouve bloquée (case ${p.pos}) !` });
    if (q.stuck) events.push({ type: "info", tone: "bad", text: `${q.name} se retrouve bloquée (case ${q.pos}) !` });

    finish(game, p, { extra: pend.extra, done: false }, events);
    return events;
  }

  const api = {
    TOTAL, MIN_TEAMS, MAX_TEAMS, INN_TURNS, GEESE, SPECIAL,
    cellType, createGame, walk, resolveRoll, resolveThief,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OieRules = api;
})(typeof window !== "undefined" ? window : globalThis);
