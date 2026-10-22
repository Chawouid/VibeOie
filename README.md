# Le Jardin des Oies

Jeu de l'oie en équipes (2 à 10), sans dépendance : ouvrir `index.html` dans un navigateur.

- `index.html` : structure de la page et fenêtres (nouvelle partie, paramètres, API Actions, règles…)
- `style.css` : présentation
- `actions.js` : registre des actions (`registerGooseAction`) et actions de base
- `game.js` : moteur (plateau en spirale, tours, pions animés, cartes, sauvegarde automatique)

## Ajouter une action

Via le bouton **« API Actions (IA / Dev) »** (injection à chaud, conservée dans la sauvegarde) ou en appelant
`registerGooseAction(actionObject)` dans `actions.js`. Le contrat complet (champs `id`, `name`, `description`,
`icon`, `theme`, `defaultWeight`, `canBeOnBoard`, `canBeChanceCard`, `canBePlayerCard`,
`execute(gameState, playerId, context)` → `{ gameState, message, extraTurn, triggerChanceCard }`)
est affiché dans cette fenêtre.
