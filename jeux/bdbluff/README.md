# BDBluff — BD collaborative à l'imposteur

Une bande dessinée dessinée à plusieurs mains : 3 à 6 joueurs reçoivent un
thème secret et dessinent chacun une ou plusieurs cases pour raconter
l'histoire — sauf un, l'**imposteur**, qui ne connaît pas le thème et doit
improviser sans se faire remarquer. À la révélation, tout le monde discute
en chat et vote pour le démasquer.

Le joueur y arrive par `my-gamers-stats.com/game/bdbluff/`, page listée dans
le catalogue `/game/`. Comme l'Arène, il tourne **sur le VPS MGS**, à côté
d'Apache, dans son propre petit conteneur Node.

---

## Pourquoi un serveur à part, et pas du PHP

Un salon de jeu a besoin d'un processus qui **garde l'état de la partie en
mémoire** entre deux messages : qui a rejoint, quelle case appartient à qui,
qui a déjà voté, le score cumulé sur plusieurs manches. Un script PHP
démarre, répond, meurt — il faudrait tout réécrire dans MySQL et le relire
à chaque petite action, pour un jeu qui n'en a pas besoin.

Le conteneur Node, lui, reste vivant. Un salon y est un objet en mémoire
(`class Salon`), et le WebSocket permet au serveur de pousser un changement
de phase sans qu'on le lui demande.

Le reste du site ne bouge pas : comptes, MySQL, stats restent en PHP
derrière Apache. Même schéma que l'Arène, avec son propre chemin :

```
navigateur ──HTTPS──> Apache ──┬── / …            PHP  (le site)
                               ├── /jeu/ …        conteneur arene
                               └── /bd/ …         conteneur bdbluff
                                   /bd/ws         WebSocket, mod_proxy_wstunnel
```

---

## Les fichiers

```
jeux/bdbluff/                   ← ne part PAS dans apache/site/
├── README.md
├── package.json                aucune dépendance, juste `npm test`
├── server/
│   ├── index.js                HTTP, fichiers statiques, salons, garde-fous
│   ├── salon.js                ⭐ toutes les règles : phases, cases, vote, score
│   └── ws.js                   WebSocket minimal (RFC 6455), repris de l'Arène
├── public/
│   ├── index.html              lobby + écran de jeu
│   ├── client.js                réseau, entrées, transitions d'écran
│   ├── dessin.js                canvas : palette, épaisseurs, gomme
│   ├── stickers.js              palette et placement des stickers
│   ├── rendu.js                 composition des cases, planche, chat, vote, scores
│   ├── shared.js                ⭐ les règles chiffrées, partagées client/serveur
│   ├── themes.js                banque de thèmes (familial / soirée)
│   └── stickers/                pack de stickers SVG (+ son README)
├── test/bdbluff.test.js        `npm test`
├── apache/mgs-bdbluff.conf     le ProxyPass à inclure dans le vhost
└── docker/service-bdbluff.yml  le bloc à coller dans docker-compose.yml

site_web/game/bdbluff/index.php                la page du site (navbar + iframe)
site_web/content/css/modules/bdbluff-embed.css son style
```

`public/shared.js` est le fichier le plus important : les bornes de partie,
la répartition des cases, la pioche de l'imposteur, le dépouillement du
vote et le barème de score y sont écrits **une seule fois** et importés des
deux côtés. C'est la règle numéro un — si le client affiche une règle que
le serveur applique différemment, les joueurs se disputent pour de mauvaises
raisons.

### Aucune dépendance, et pourquoi

Comme l'Arène : pas de `ws`, pas d'`express`, pas de `node_modules`. Le
dossier est monté tel quel dans l'image officielle `node:22-alpine` et
lancé par `node server/index.js`. `update-mgs.sh` se contente d'un `rsync`
et d'un `restart`.

---

## Une manche, en détail

| Phase | Ce qui se passe |
|---|---|
| `lobby` | Les joueurs rejoignent avec un pseudo, l'hôte règle cases/temps/manches/catégories, puis lance. |
| `dessin` | Chaque joueur dessine SES cases (réparties en round-robin, `repartirCases`). Un seul minuteur pour tout le salon, calé sur le joueur qui a le plus de cases (`dureeDessinPhase`). Personne ne voit les cases des autres. Le chat reste ouvert. |
| `revelation` | La planche complète s'affiche à tous, 8 secondes de pause pour la lire avant que le vote ne s'ouvre. |
| `vote` | 90 secondes de discussion + vote au clic (jamais sur soi-même). Fin anticipée si tout le monde a voté. |
| — résolution — | Imposteur démasqué → il a 30 s pour deviner le thème (`devinetteCorrecte`, comparaison souple sur les mots-clés) et sauver sa manche. Égalité ou vote sur un innocent → il gagne directement. |
| `resultats_manche` | Thème réel et identité de l'imposteur révélés, score mis à jour (`pointsManche`), 12 s de pause avant la manche suivante. |
| `resultats_partie` | Tableau des scores final. L'hôte peut relancer (`rejouer`) : retour au lobby, mêmes joueurs, salon conservé. |

L'imposteur tourne à chaque manche sans jamais repasser deux fois avant que
tout le monde soit passé une fois (`tirerImposteur`, un sac de jetons qu'on
remélange une fois vidé).

### Accès et reconnexion

Aucun compte requis : un salon se crée avec un code (`?salon=`, comme
l'Arène), pseudo libre saisi en entrant — pré-rempli avec le pseudo MGS si
le joueur est connecté au site. Le serveur délivre un jeton de reconnexion
à l'arrivée, stocké en `localStorage` : rouvrir le même lien réattache le
joueur à son siège (rôle, cases déjà dessinées, vote déjà posé conservés).
L'hôte est dynamique — le joueur connecté depuis le plus longtemps — pour
qu'un salon ne reste jamais bloqué si l'hôte d'origine part.

### Sécurité

- Pseudo et nom de salon nettoyés côté serveur (mêmes règles que l'Arène).
- Un joueur ne peut envoyer d'état QUE pour ses propres cases
  (`server/salon.js`, `_surCases`) — vérifié sur l'index de case, pas
  seulement affiché ainsi côté client.
- Traits et stickers sont bornés en nombre et en taille (`CASE_TRAITS_MAX`,
  `TRAIT_POINTS_MAX`, `CASE_STICKERS_MAX` dans `shared.js`) pour qu'un
  client ne puisse pas saturer la mémoire d'un salon.
- Le thème réel n'est jamais envoyé à l'imposteur — pas de leurre, pas de
  valeur partielle, le champ est simplement absent de son message.

---

## Rééquilibrer le jeu

Tout se règle dans `public/shared.js` : bornes de joueurs/cases/manches,
temps de vote et de devinette, barème de score (`POINTS_INNOCENT`,
`POINTS_IMPOSTEUR`), palette de couleurs. Le client reçoit les réglages du
salon dans le message `salon` plutôt que de les redéclarer, donc changer
une borne ne demande pas de toucher à l'interface.

Les thèmes vivent dans `public/themes.js`, en deux catégories activables
par l'hôte à la création du salon — un thème est une simple phrase, sans
format particulier à respecter.

Les stickers vivent dans `public/stickers/*.svg`, catalogués dans
`STICKERS` (`shared.js`) — voir `public/stickers/README.md` pour en
ajouter ou en remplacer.

---

## Tests

`npm test` lance `test/bdbluff.test.js` : un harnais maison (comme l'Arène,
pas de `node --test`), qui vérifie sans réseau la répartition des cases, la
pioche sans répétition de l'imposteur, le dépouillement du vote (majorité,
égalité, devinette), le barème de score et les garde-fous de phase — puis
quelques tests bout-en-bout qui démarrent le vrai serveur et lui parlent en
WebSocket, comme le ferait un navigateur.

---

## Déploiement

Même recette que l'Arène :

1. Coller le bloc de `docker/service-bdbluff.yml` dans le
   `docker-compose.yml` du VPS, à côté du service `arene`.
2. Monter `apache/mgs-bdbluff.conf` dans
   `/etc/apache2/conf-enabled/mgs-bdbluff.conf` (voir les commentaires du
   fichier — modules `proxy_wstunnel` déjà activés pour l'Arène, rien de
   plus à faire côté Apache).
3. Renseigner `MGS_BDBLUFF_URL` en tête de
   `site_web/game/bdbluff/index.php`.
4. `docker compose up -d bdbluff && docker compose restart apache`.
