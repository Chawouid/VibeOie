# L'Oie en Fête

Jeu de l'oie en équipes (2 à 10) jouable dans le navigateur, sans dépendance : ouvrir `index.html`.

- `rules.js` : règles du jeu (logique pure, sans DOM) — oies, pont, auberge, puits, labyrinthe, prison, mort, plus Voleur (29), Miroir (38) et Marée (47)
- `app.js` : interface (plateau en spirale, pions animés, dés, journal)
- `index.html` / `style.css` : structure et habillage (thème clair et coloré : ciel d'été, prairie, bonbons)

L'habillage (couleurs, pictogrammes SVG, ambiance) est isolé dans `style.css` et le sprite SVG de `index.html` :
on peut le changer entièrement sans toucher aux règles.
