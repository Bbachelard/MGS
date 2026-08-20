# Tes sons

Dépose ici tes enregistrements. **Rien à déclarer nulle part** : le jeu
cherche chaque nom au démarrage, et chaque fichier trouvé remplace le son
synthétique de secours. Un fichier absent n'est pas une erreur — le jeu
continue avec sa version « arcade » générée en WebAudio.

## Les treize sons attendus

| Fichier | Quand il joue | Durée conseillée |
|---|---|---|
| `tir.ogg` | à chaque missile parti — c'est **le** son le plus entendu | 60 – 120 ms |
| `impact.ogg` | missile qui finit dans un mur | 100 – 200 ms |
| `touche.ogg` | missile qui touche un joueur | 100 – 200 ms |
| `mort.ogg` | une élimination (fort si c'est toi) | 300 – 700 ms |
| `kill.ogg` | tu viens d'éliminer quelqu'un | 250 – 600 ms |
| `soin.ogg` | croix verte ramassée, ou pleine vie gagnée sur un kill | 200 – 400 ms |
| `bouclier.ogg` | bouclier ramassé **et** bouclier qui encaisse | 150 – 350 ms |
| `meteorite.ogg` | une météorite entre dans l'arène — grondement | 800 ms – 1,5 s |
| `palier.ogg` | arme améliorable, puis arme améliorée | 300 – 700 ms |
| `ulti.ogg` | la pause temporelle se déclenche | 600 ms – 1,2 s |
| `ulti-tir.ogg` | le rayon part | 100 – 250 ms |
| `ulti-touche.ogg` | le rayon a touché | 400 – 800 ms |
| `ulti-rate.ogg` | 1 tour et demi pour rien | 300 – 500 ms |

Si tu n'en enregistres que trois, prends `tir`, `mort` et `meteorite` : ce
sont ceux qui donnent le plus de caractère au jeu.

## Formats acceptés

`.ogg`, `.mp3`, `.wav`, `.webm` — dans cet ordre de préférence. Le jeu prend
le premier trouvé, donc inutile de fournir les quatre.

- **`.ogg` (Vorbis ou Opus)** : le meilleur compromis poids/qualité, lu par
  Firefox, Chrome et Edge. Safari sait lire l'Opus en `.webm` mais pas
  toujours l'`.ogg` — si tu veux Safari, fournis plutôt du `.mp3`.
- **48 kHz, mono** : c'est un jeu, pas un album. Le mono divise le poids par
  deux et personne n'entendra la différence.
- **Vise 20 à 60 Ko par son.** `tir` peut jouer 4 fois par seconde et par
  joueur : c'est le seul qui mérite vraiment d'être court et léger.

## Les trois pièges à éviter

1. **Le silence en début de fichier.** Un son de tir avec 80 ms de blanc
   devant paraîtra en retard, quoi que tu fasses. Coupe au plus près de
   l'attaque.
2. **Le niveau trop fort.** Normalise autour de **-6 dBFS** plutôt qu'à 0 :
   plusieurs sons se superposent en permanence, et la somme sature vite.
   Le jeu applique déjà un volume général de 0,6 et baisse ce qui est loin.
3. **Le son de tir trop long ou trop « riche ».** À 4 tirs/s, un son de 400 ms
   se chevauche avec lui-même et devient une bouillie. Court et sec.

## Comment les fabriquer

- **Enregistrer** : n'importe quel micro + Audacity (gratuit). Souffler dans
  sa main, claquer un stylo, taper une boîte en carton — la plupart des sons
  d'arcade sont des objets du quotidien réenregistrés et transposés.
- **Générer** : [sfxr / jsfxr](https://sfxr.me) fabrique des sons de tir et
  d'explosion 8 bits en un clic, et exporte en `.wav`. Convertis ensuite en
  `.ogg` avec Audacity ou `ffmpeg -i tir.wav -c:a libvorbis -q:a 4 tir.ogg`.
- **Banques libres** : freesound.org (vérifie la licence, CC0 de préférence)
  ou les packs de Kenney (kenney.nl/assets), tous en CC0.

## Vérifier que ça marche

Ouvre le jeu, joue un tir. Si tu entends un bip synthétique, ton fichier n'a
pas été trouvé : vérifie le nom exact (tout en minuscules, tiret compris) et
l'extension. La console du navigateur ne dit rien — un 404 sur un son est
volontairement silencieux, sinon le jeu crierait à chaque son manquant.
