# Stickers de BDBluff

40 stickers de départ, en SVG plutôt qu'en PNG (contrairement aux
personnages de l'Arène) : ça permet d'en écrire tout le pack en code, ça
reste net à n'importe quelle taille, et une bulle "BOOM !" est plus
naturelle en vecteur/texte qu'en image bitmap.

## Format

- Chaque fichier fait `<id>.svg`, `viewBox="0 0 100 100"`, carré.
- Pas de couleur imposée par le client : le SVG porte ses propres couleurs
  (`fill`/`stroke` en dur), le client l'affiche tel quel dans un `<img>` ou
  inline.
- Le style général : traits noirs (`#1f1f1f`) assez épais (2,5 à 4 px à
  cette échelle), formes simples, couleurs plates — lisible même réduit à
  40×40 px dans la palette.

## Ajouter ou remplacer un sticker

1. Déposer `mon-sticker.svg` ici, `viewBox="0 0 100 100"`.
2. L'ajouter à `STICKERS` dans `public/shared.js` :
   ```js
   { id: "mon-sticker", categorie: "objet" }
   ```
   L'id **doit** correspondre exactement au nom de fichier (sans `.svg`) :
   c'est `STICKER_IDS` (dérivé de `STICKERS`) qui sert de liste blanche
   côté serveur — un sticker posé avec un id absent de cette liste est
   rejeté silencieusement (`caseValide` dans `shared.js`).
3. Rien d'autre à toucher : `stickers.js` construit sa palette à partir de
   `STICKERS`.

Catégories actuelles : `personnage`, `emotion`, `objet`, `decor`, `effet`.
En ajouter une nouvelle ne demande aucun changement de code, juste de
l'utiliser comme valeur de `categorie`.

## Catalogue actuel (40)

| Catégorie | Stickers |
|---|---|
| personnage | bonhomme, bonhomme-content, bonhomme-triste, robot, fantome, chat, chien, extraterrestre |
| emotion | coeur, coeur-brise, etoile, eclair-colere, point-interrogation, point-exclamation |
| objet | chapeau, lunettes, epee, bouclier, valise, telephone, cadeau, cle, bombe, potion |
| decor | soleil, lune, nuage, arbre, maison, montagne, porte, fenetre |
| effet | boom, paf, zzz, bulle-parole, bulle-pensee, splash, etincelles, fumee |
