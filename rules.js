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
      id: i, name, pos: 1, skip: 0, stuck: false, rolls: 0,
    }));
    return { players, current: 0, winner: null, turn: 1 };
  }

  /* Avance de `steps` cases depuis `from` avec rebond sur la case finale. */
  function walk(from, steps) {
    const path = [];
    let pos = from, dir = 1, bounced = false;
    for (let i = 0; i < steps; i++) {
      if (pos === TOTAL) { dir = -1; bounced = true; }
      pos += dir;
      path.push(pos);
    }
    return { path, end: pos, bounced };
  }

  function nextIndex(game) {
    return (game.current + 1) % game.players.length;
  }

  /* Passe au joueur suivant en sautant ceux qui sont bloqués. Retourne les événements info. */
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
   * Résout un lancer pour l'équipe courante. Modifie `game` et retourne la liste d'événements :
   *  - { type: "move", id, path: [cases], kind: "walk" | "bounce" | "jump" }
   *  - { type: "info", text, tone: "neutral" | "good" | "bad" }
   * À la fin, game.current désigne déjà la prochaine équipe jouable (ou game.winner est défini).
   */
  function resolveRoll(game, d1, d2) {
    const p = game.players[game.current];
    const events = [];
    const total = d1 + d2;
    const first = p.rolls === 0;
    let extra = false;
    p.rolls++;

    const move = (to, path, kind) => {
      events.push({ type: "move", id: p.id, path, kind });
      p.pos = to;
    };
    const info = (text, tone = "neutral") => events.push({ type: "info", text, tone });

    const pair = [d1, d2].sort().join("");
    if (first && pair === "36") {
      info(`${p.name} lance ${d1}+${d2} dès le premier tour : les dés l'envoient à la case 26 !`, "good");
      move(26, [26], "jump");
    } else if (first && pair === "45") {
      info(`${p.name} lance ${d1}+${d2} dès le premier tour : les dés l'envoient à la case 53 !`, "good");
      move(53, [53], "jump");
    } else {
      const w = walk(p.pos, total);
      info(`${p.name} lance ${d1}+${d2} = ${total}.`);
      if (w.bounced) info(`${p.name} dépasse ${TOTAL} et rebondit jusqu'à la case ${w.end}.`, "bad");
      move(w.end, w.path, w.bounced ? "bounce" : "walk");

      while (cellType(p.pos) === "goose") {
        extra = true;
        info(`Une oie ! ${p.name} avance encore de ${total} et rejoue.`, "good");
        const g = walk(p.pos, total);
        if (g.bounced) info(`${p.name} dépasse ${TOTAL} et rebondit jusqu'à la case ${g.end}.`, "bad");
        move(g.end, g.path, g.bounced ? "bounce" : "walk");
        if (g.bounced) break; // évite une boucle infinie 59 -> 63 -> 59
      }
    }

    const t = cellType(p.pos);
    const spec = SPECIAL[p.pos];
    if (p.pos === TOTAL) {
      game.winner = p.id;
      info(`${p.name} atteint la case ${TOTAL} : victoire !`, "good");
      return events;
    }
    switch (t) {
      case "bridge":
        info(`${p.name} traverse le pont et file jusqu'à la case ${spec.to} !`, "good");
        move(spec.to, [spec.to], "jump");
        break;
      case "maze":
        info(`${p.name} se perd dans le labyrinthe et revient à la case ${spec.to}.`, "bad");
        move(spec.to, [spec.to], "jump");
        break;
      case "death":
        info(`${p.name} croise la Mort… retour à la case ${spec.to} !`, "bad");
        move(spec.to, [spec.to], "jump");
        break;
      case "inn":
        p.skip = INN_TURNS;
        extra = false;
        info(`${p.name} s'arrête à l'auberge : ${INN_TURNS} tours à passer.`, "bad");
        break;
      case "well":
      case "prison": {
        const label = t === "well" ? "tombe dans le puits" : "est jetée en prison";
        game.players.forEach((q) => {
          if (q.id !== p.id && q.stuck && q.pos === p.pos) {
            q.stuck = false;
            info(`${q.name} est libérée par l'arrivée de ${p.name} !`, "good");
          }
        });
        p.stuck = true;
        extra = false;
        info(`${p.name} ${label} : bloquée jusqu'à l'arrivée d'une autre équipe.`, "bad");
        break;
      }
    }

    if (!extra) advanceTurn(game, events);
    else info(`${p.name} rejoue !`, "good");
    return events;
  }

  const api = {
    TOTAL, MIN_TEAMS, MAX_TEAMS, INN_TURNS, GEESE, SPECIAL,
    cellType, createGame, walk, resolveRoll,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OieRules = api;
})(typeof window !== "undefined" ? window : globalThis);
