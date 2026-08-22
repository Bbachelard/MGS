# Le décor

Deux images : **`meteorite.png`**, et en option **`caca.png`** pour la tête
du projectile (voir plus bas).

## La remplacer

Écrase le fichier, c'est tout. Aucun manifeste, aucune ligne de code à
changer — le jeu le recharge au prochain rafraîchissement de la page (les
images sont mises en cache une heure côté serveur, donc `Ctrl+F5` si tu ne
vois pas ton changement tout de suite).

| | |
|---|---|
| Taille conseillée | 160 × 160 px |
| Fond | transparent |
| Orientation | **aucune** — elle tourne sur elle-même en vol |
| Taille à l'écran | environ 82 px de large (rayon de collision : 34 px) |

La météorite **tourne pendant qu'elle traverse la carte**, donc contrairement
aux personnages, tu n'as pas de « devant » à respecter. Dessine-la vue du
dessus, centrée, et laisse un peu de marge sur les bords : le jeu ajoute déjà
une traînée de feu derrière elle.

Si le fichier manque, le jeu dessine une boule de feu en code. Rien ne casse.

## Bon à savoir sur les météorites

- Elles arrivent **sans aucun avertissement**, toutes les 30 à 45 secondes.
- Elles **volent au-dessus des murs** : se cacher derrière un obstacle ne
  protège pas.
- Elles **éliminent** ce qu'elles traversent, quel que soit le nombre de PV —
  sauf si la victime porte un bouclier, qui annule l'attaque.
- Elles peuvent faucher **plusieurs joueurs** sur leur passage.
- La mort par météorite n'est créditée à personne : le fil affiche
  « l'arène ⇒ *nom* ».

## Le projectile (`caca.png`, optionnel)

Le tir de base est un jet de caca. Sans fichier ici, le jeu en dessine un en
code (trois boules empilées, marron, un reflet) — ce qui suffit largement à
cette taille. Dépose `caca.png` pour le remplacer par ton propre dessin.

| | |
|---|---|
| Taille conseillée | 64 × 64 px |
| Fond | transparent |
| Orientation | **aucune** — dessiné bien droit, jamais tourné vers la trajectoire |
| Taille à l'écran | environ 15 à 25 px de large selon la puissance de l'arme |

Que le sprite vienne du code ou de ton fichier, les deux petites volutes
vertes qui ondulent au-dessus (l'« animation » de l'odeur) restent dessinées
par-dessus — c'est ce qui fait que le projectile a l'air vivant, image ou
pas.
