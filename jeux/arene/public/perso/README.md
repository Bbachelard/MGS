# Tes personnages

Un personnage = **une seule image PNG**, vue du dessus, **le nez tourné vers
la droite**. Le jeu la fait pivoter vers ta souris : tu n'as donc qu'un dessin
à faire, pas huit.

## Ajouter le tien

1. Pars de `gabarit.png` (96 × 96, avec les repères) — ou de n'importe quelle
   image carrée à fond transparent.
2. Enregistre-la ici sous `mon-perso.png`. **Le nom ne contient que des
   minuscules, des chiffres et des tirets** : il finit dans une URL et il est
   filtré des deux côtés, tout le reste est jeté.
3. Ajoute une ligne dans `persos.json` :

```json
[
  { "id": "defaut",     "nom": "Recrue" },
  { "id": "mon-perso",  "nom": "Mon perso" }
]
```

4. Recharge la page : il apparaît dans la liste de l'écran d'accueil. Le choix
   est mémorisé dans le navigateur pour la fois suivante.

## Le gabarit, ligne par ligne

- **Le grand cercle violet** : la limite utile. Ce qui déborde sera rogné à
  l'affichage.
- **Le petit cercle** : le vrai rayon de collision (18 px de monde). Le sprite
  est dessiné un peu plus grand que lui — c'est normal et voulu, un
  personnage pile à la taille de sa boîte paraît minuscule.
- **La flèche rouge** : le devant. C'est vers là que part le missile.

## Conseils

- **96 × 96 suffit.** Le personnage est affiché autour de 43 px de large :
  plus grand ne sert à rien, plus petit devient flou sur écran Retina.
- **Fond transparent obligatoire**, sinon tu joueras un carré.
- **Garde le contour lisible.** Un anneau de couleur est dessiné derrière
  chaque joueur (c'est lui qui distingue deux joueurs ayant choisi le même
  personnage) : un sprite très sombre et très fin disparaît dessus.
- **Dessine en 4× puis réduis.** Les quatre personnages fournis ont été
  produits comme ça : les bords sont nets sans travail d'anti-crénelage.
- Le sprite est **purement décoratif** : il ne change ni la vitesse, ni les
  PV, ni la taille de la boîte de collision. Personne ne gagne à choisir le
  plus petit.

## Les quatre fournis

`defaut`, `vaisseau`, `robot`, `fantome` — des placeholders honnêtes, faits
pour être remplacés. Tu peux écraser leurs fichiers sans rien changer
d'autre.
