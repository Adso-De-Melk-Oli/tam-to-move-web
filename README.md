# Tam to Move — page web

Version web de l'appli Android **Tam to Move** : prochains passages TaM (Montpellier) à tes arrêts,
en temps réel, avec « Où est mon bus ». Tes arrêts sont enregistrés **dans ton navigateur** (localStorage) :
aucun compte, rien n'est envoyé ailleurs.

- `site/` : la page (HTML/CSS/JS sans dépendance), publiée sur GitHub Pages.
- `site/engine.js` : le moteur de calcul (même logique que l'appli Android), testé par `test/engine.test.mjs`.
- `scripts/build_data.py` : prépare chaque jour les horaires théoriques (GTFS TaM) dans `site/data/`.
- `relais/worker.js` : relais Cloudflare. Les serveurs TaM n'autorisent pas la lecture depuis un navigateur ;
  ce relais lit les 3 flux temps réel publics et ajoute l'autorisation (cache 15 s). Adresse dans `site/config.js`.

Données TaM · Montpellier Méditerranée Métropole · licence ODbL.
