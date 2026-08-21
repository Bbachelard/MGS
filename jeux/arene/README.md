# Arène MGS — jeu multijoueur temps réel

Une arène 2D où plusieurs joueurs se déplacent en même temps, se voient bouger
et se bousculent. Elle tourne **sur le VPS MGS**, à côté d'Apache, dans un
conteneur Node de quelques dizaines de mégaoctets.

Le joueur y arrive par `my-gamers-stats.com/game/arene/`, page listée dans le
catalogue `/game/`.

---

## Pourquoi un serveur à part, et pas du PHP

Un jeu temps réel a besoin d'un processus qui **garde l'état de la partie en
mémoire** entre deux messages et qui pousse la position de tout le monde 20
fois par seconde. Un script PHP démarre, répond, meurt : entre deux requêtes,
il ne reste rien. Faire la même chose en PHP obligerait à écrire les positions
dans MySQL et à les relire en boucle toutes les 200 ms — jouable, mais mou, et
lourd pour la base.

Le conteneur Node, lui, reste vivant. Une salle de jeu y est simplement un
objet en mémoire (`class Salle`), et le WebSocket permet au serveur de parler
sans qu'on lui demande.

Le reste du site ne bouge pas : comptes, MySQL, stats Steam et Riot restent en
PHP derrière Apache. Les deux cohabitent, Apache faisant simplement passerelle.

```
navigateur ──HTTPS──> Apache ──┬── / …            PHP  (le site)
                               └── /jeu/ …        conteneur node (le jeu)
                                   /jeu/ws        WebSocket, mod_proxy_wstunnel
```

---

## Les fichiers

```
jeux/arene/                     ← ne part PAS dans apache/site/
├── README.md
├── package.json                aucune dépendance, juste `npm test`
├── server/
│   ├── index.js                HTTP, fichiers statiques, salons, garde-fous
│   ├── salle.js                ⭐ toutes les règles : tir, dégâts, mort, ulti
│   └── ws.js                   WebSocket minimal (RFC 6455), sans bibliothèque
├── public/
│   ├── index.html              la page : mise en forme, HUD, écran d'accueil
│   ├── client.js               réseau, entrées, prédiction, réconciliation
│   ├── rendu.js                tout ce qui se dessine dans le canvas
│   ├── sprites.js              chargement des personnages PNG
│   ├── sons.js                 tes sons, avec repli synthétisé
│   ├── shared.js               ⭐ la physique + les règles chiffrées, partagées
│   ├── perso/                  tes personnages (+ gabarit.png et son README)
│   ├── decor/                  meteorite.png, à remplacer (voir son README)
│   └── sons/                   tes enregistrements (voir son README)
├── test/arene.test.js          111 contrôles, `npm test`
├── apache/mgs-arene.conf       le ProxyPass à inclure dans le vhost
└── docker/service-arene.yml    le bloc à coller dans docker-compose.yml

site_web/game/arene/index.php                la page du site (navbar + iframe)
site_web/content/css/modules/arene-embed.css son style
```

`shared.js` est le fichier le plus important : `simuler()` y est écrite **une
seule fois** et importée des deux côtés. C'est la règle numéro un du
multijoueur — si le client et le serveur ne calculent pas le mouvement à
l'identique, le personnage tressaute en permanence.

### Aucune dépendance, et pourquoi

Pas de `ws`, pas d'`express`, pas de `node_modules`, pas de Dockerfile. Le
dossier est monté tel quel dans l'image officielle `node:22-alpine` et lancé
par `node server/index.js`. Conséquences concrètes :

- `update-mgs.sh` se contente d'un `rsync` et d'un `restart` — pas de `npm
  install` sur le VPS, pas d'image à reconstruire ;
- rien à surveiller côté failles de dépendances ;
- `server/ws.js` fait 200 lignes commentées, ce qui est à peu près le prix
  d'un WebSocket sans compression ni extensions.

---

## Le combat

| | |
|---|---|
| Points de vie | **20** |
| Arme de départ | **4 dégâts**, **0,5 s** entre deux tirs (2 tirs/s) |
| Progression | **tous les 3 kills** : +15 % de cadence **ou** +15 % de puissance, au choix, sans plafond |
| Vitesse du missile | 720 px/s — dur à esquiver |
| Mort | réapparition **immédiate**, à un endroit **tiré au sort**, 1 s d'invulnérabilité |
| Éliminer | remet à **pleine vie** |
| Zones de soin | **4**, rendent **toute** la vie, reviennent **15 s** après |
| Boucliers | **2**, annulent **une** attaque quelle qu'elle soit, reviennent 20 s après |
| Météorites | toutes les **30 à 45 s**, **sans prévenir**, élimination |
| Charge d'ulti | **+10 %** par missile touché — 10 touches pour une ulti |
| Ulti | **pause temporelle** de 3 s : une aiguille tourne, on tire au bon moment |
| Flash | bond de 220 px **à travers les murs** — **5 s** de recharge, réinitialisée à chaque élimination |
| Zone de ralentissement | instantanée, portée 300 px, rayon 90 px, ralentit et grignote 3 s — **10 s** de recharge |

### Les contrôles

Le déplacement se fait **au clic droit**, comme dans un MOBA : maintenu ou
non, il fait aller vers là où pointe la souris, avec un ping animé à
l'endroit cliqué (purement local, jamais envoyé au serveur). Le clic gauche
ne fait rien : le clavier gère tout le reste.

| Touche (par défaut) | Action |
|---|---|
| `A` | Tirer (maintenir pour tirer en continu) |
| `E` | Flash |
| `Z` | Zone de ralentissement |
| `R` | Ulti (pause temporelle) |
| `Tab` | Tout le tableau des scores |
| `M` | Couper le son |
| `Maj+A` / `Maj+Z` | Choisir l'amélioration proposée (cadence / puissance), sans cliquer |

Les cinq premières touches, ainsi que la sensibilité de la souris, se règlent
dans le panneau ⚙ (en bas à droite de l'écran, accessible avant et pendant la
partie) et sont mémorisées dans le navigateur (`localStorage`).
`Maj+A`/`Maj+Z` sont **fixes**, indépendantes du remappage — comme la
position des boutons du panneau d'amélioration à l'écran.

Le viseur affiché à l'écran n'est **pas** le curseur du système — il est
caché (`cursor: none`) — mais un viseur virtuel déplacé par les mouvements
*relatifs* de la souris, multipliés par la sensibilité réglée. C'est ce qui
rend ce réglage réel : avec un curseur absolu, un simple facteur d'échelle
sur la position ne changerait rien à l'angle de visée.

Tout se règle en un seul endroit : le bloc `COMBAT` de `public/shared.js`. Le
client reçoit ces valeurs dans le message `init` plutôt que de les redéclarer,
donc rééquilibrer le jeu ne demande pas de toucher au HUD.

### Le tir, et l'arme qui progresse

Le client envoie deux choses en plus dans chaque commande : `a`, l'angle vers
la souris, et `f`, « je maintiens le tir ». **Il ne crée jamais de missile.**
C'est le serveur qui décide, et sa cadence ne descend qu'au rythme des ticks :
envoyer 100 ordres de tir dans le même tick ne produit qu'un seul missile.
C'est vérifié par les tests, parce que c'est très exactement ce qu'on essaiera
en premier depuis la console.

L'arme de départ est **volontairement médiocre** : 4 dégâts, 2 tirs/s, cinq
touches pour éliminer. C'est le point bas d'une progression.

**Tous les 3 kills**, un palier est mis de côté — mais il n'est **pas**
appliqué tout de suite : il est proposé **à la mort suivante**, sous la forme
d'un choix entre *cadence* et *puissance*. On ne coupe pas un duel pour
afficher un menu ; en revanche, mourir devient un moment où l'on gagne quelque
chose. `Maj+A` (cadence) et `Maj+Z` (puissance) choisissent directement, sans
cliquer sur le panneau — utile en plein combat.

```
cadence = 0,5 s ÷ 1,15^n       puissance = arrondi(4 × 1,15^n)
n=0 : 2,0 tirs/s               n=0 : 4 dégâts
n=3 : 3,0 tirs/s               n=3 : 6 dégâts
n=6 : 4,6 tirs/s               n=6 : 9 dégâts
```

Les paliers se cumulent **sans plafond** et ne se perdent pas à la mort. Le
projectile change d'allure avec eux : la tête grossit avec la puissance (teintes
chaudes), la traînée s'allonge avec la cadence (teintes froides). On voit donc
à qui on a affaire avant même d'encaisser.

Les dégâts sont **figés au départ du missile** : améliorer son arme n'augmente
pas les tirs déjà en vol.

### Les boucliers

Deux emplacements seulement, au milieu du terrain — c'est un enjeu de
position, pas un bonbon qu'on ramasse en passant. Un bouclier **annule une
attaque entière**, qu'elle vienne d'un missile, d'une météorite ou du rayon
d'ulti, puis disparaît. Il ne survit pas à son porteur et ne s'empile pas.

Détail volontaire : le tireur dont le missile est absorbé **charge quand même
son ulti**. Un bouclier annule des dégâts, pas la progression de l'adversaire —
sinon il punirait deux fois.

### Les météorites

Toutes les 30 à 45 secondes, une météorite traverse la carte **sans le
moindre avertissement** et **élimine** ce qu'elle touche, quel que soit le
nombre de PV. Elle **vole au-dessus des murs** : se cacher ne protège pas.
Elle peut faucher plusieurs joueurs d'affilée et n'est créditée à personne —
le fil affiche « l'arène ⇒ *nom* ».

Seul le bouclier l'arrête.

L'image se remplace : `public/decor/meteorite.png` (voir le README du
dossier). Elle tourne sur elle-même en vol, donc il n'y a pas de « devant » à
respecter.

### La pause temporelle

À 100 %, <kbd>R</kbd> fige **toute la salle** : plus personne ne bouge, plus
rien ne vole, les pastilles ne rechargent plus, les météorites restent
suspendues.

Une **aiguille** se met alors à tourner autour du lanceur : un tour et demi en
3 secondes. À lui d'**appuyer sur la touche de tir au bon moment** — le rayon
part dans l'axe de l'aiguille, en ligne droite, et **élimine** le premier
joueur rencontré. Un mur l'arrête net. Pas de tir au bout d'un tour et demi :
l'ulti est perdue.

C'est donc un exercice de **rythme**, pas de visée. Pour que ce soit un
exercice et non une loterie, le cadran affiche un **repère de la couleur de
chaque adversaire**, à sa direction exacte : on sait où il faut tirer, il reste
à le faire au bon instant.

La même touche sert à tirer normalement et à déclencher le rayon : pendant sa
propre ulti, <kbd>A</kbd> lance le rayon au lieu d'un missile. Un geste à
retenir, pas deux.

### Le flash

<kbd>E</kbd> propulse le joueur de 220 px dans la direction visée — et
**traverse les murs** : seules les limites de la carte l'arrêtent. C'est ce
qui en fait un vrai outil d'évasion (et de finish) : se réfugier derrière un
mur ne suffit plus à être à l'abri. Une petite animation de téléportation
marque l'arrivée, visible par tout le monde.

C'est une compétence d'évasion **et** d'agression : elle recharge en 5
secondes, mais surtout, **elle se réinitialise instantanément à chaque
élimination**. Enchaîner les kills, c'est donc aussi enchaîner les flashs.

Comme l'ulti, le client ne fait que **demander** (`{ "t": "flash" }`) : c'est
le serveur qui vérifie la recharge et calcule l'arrivée. Aucune prédiction
locale — un aller-retour serveur suffit, le bond est trop rare et trop court
pour valoir la complexité d'une prédiction avec réconciliation.

### La zone de ralentissement

<kbd>Z</kbd> pose, **instantanément** (pas de temps de charge, contrairement à
l'ulti), une zone au sol dans la direction visée par la souris — portée 300 px
(la même que le rayon visuel de l'ulti), bornée par les murs comme le rayon.
Quiconque s'y attarde (sauf le lanceur) est **ralenti de moitié** et encaisse
2 dégâts toutes les 0,5 s, pendant 3 s. Recharge : 10 secondes.

C'est un outil de zone, pas de précision : on la pose pour tenir un couloir ou
couper une fuite, pas pour viser un joueur précis. Le ralenti est **prédit
côté client** comme le déplacement (`simuler()` prend un facteur de vitesse en
4ᵉ paramètre) : sans ça, on sentirait un rattrapage élastique à chaque
snapshot en entrant ou sortant de la zone.

### Ce que le client ne calcule jamais

Les dégâts, la mort, les scores, les soins, le flash, la zone et l'ulti sont
**entièrement** côté serveur. Le client reçoit un résultat (`pv`, `k`, `m`,
`d`, `u`, `fl`, `zr`, `rl` dans le snapshot) et une liste d'événements (`ev`)
dont il tire les sons et le fil des éliminations. Il ne prédit que son propre
déplacement (et le facteur de ralenti qui l'affecte) — et même ça, il s'en
abstient pendant le gel, sinon on avancerait tout seul avant de se faire
rappeler en arrière au tick suivant.

---

## Tes personnages et tes sons

Deux dossiers sont faits pour être remplis à la main, et chacun a son README :

- **`public/perso/`** — un PNG par personnage, vu du dessus, **nez à droite**.
  Le jeu le fait pivoter vers la souris : un seul dessin suffit, pas huit.
  `gabarit.png` donne les repères (limite utile, rayon de collision, avant).
  Une ligne dans `persos.json` et il apparaît dans l'écran d'accueil.
- **`public/decor/`** — `meteorite.png`, à écraser tel quel. Elle tourne en
  vol : aucune orientation à respecter.
- **`public/sons/`** — quinze sons (`tir`, `impact`, `touche`, `mort`, `kill`,
  `soin`, `bouclier`, `meteorite`, `palier`, `ulti`, `ulti-tir`,
  `ulti-touche`, `ulti-rate`, `flash`, `zone`). Chaque fichier trouvé remplace
  automatiquement le son synthétisé de secours. Rien à déclarer : le jeu
  cherche le nom, et se tait poliment s'il ne le trouve pas.

Les quatre personnages livrés (`defaut`, `vaisseau`, `robot`, `fantome`) sont
des placeholders assumés : écrase leurs fichiers, rien d'autre à changer.

---

## Lancer en local

```bash
cd jeux/arene
node server/index.js        # http://localhost:8080
```

Deux onglets sur cette adresse = deux joueurs qui se voient bouger.

```bash
npm test                    # 111 contrôles, ~8 s, aucune dépendance
```

Les tests font deux choses. D'abord ils démarrent le vrai serveur et s'y
connectent avec le client WebSocket intégré à Node 22 : mouvement, salons,
anti-triche, déconnexion, pseudos hostiles, traversée de dossier. Ensuite ils
instancient une salle **sans réseau** et la font avancer tick par tick : c'est
la seule façon d'avoir des positions connues, puisqu'en passant par le
WebSocket tout le monde apparaît au hasard.

---

## Mettre en ligne sur le VPS

Trois choses à mettre en place **une fois**, ensuite `update-mgs.sh` suffit.

### 1. Le conteneur

Coller le contenu de `docker/service-arene.yml` dans
`~/apache/docker-compose.yml`, sous `services:`, à la même indentation que
`apache`.

### 2. Apache

Activer les modules dans le `Dockerfile` de l'image Apache (sinon ils
disparaissent au prochain rebuild) :

```dockerfile
RUN a2enmod proxy proxy_http proxy_wstunnel
```

Puis inclure `apache/mgs-arene.conf` **dans le `<VirtualHost>`** du site.

### 3. Le script de mise à jour

`update-mgs.sh` doit maintenant copier deux dossiers : `site_web/` vers
`site/` et `jeux/arene/` vers `arene/`. La version à jour est fournie.

### Vérifier

```bash
docker compose up -d
docker compose logs arene            # « Arène MGS — en écoute sur le port 8080 »
curl -s https://my-gamers-stats.com/jeu/sante
# {"ok":true,"connexions":0,"salons":[],"depuis":"12 s"}
```

`/jeu/sante` dit à tout moment combien de joueurs sont connectés et sur quels
salons. C'est aussi ce que Docker interroge pour le `healthcheck`.

---

## Comment ça marche

### 1. Le serveur fait autorité

Le client n'a pas le droit de dire « je suis en (500, 300) ». Il envoie
seulement **ce qu'il demande** :

```json
{ "t": "cmd", "seq": 412, "dt": 0.0333, "c": { "x": 940, "y": 210 },
  "a": -1.204, "f": true }
```

`c` est la **destination cliquée** (ou `null` si le joueur n'a rien cliqué, ou
vient d'arriver), `a` l'angle vers la souris, `f` veut dire « je maintiens le
tir ». Là encore, ce sont des **intentions**, pas des faits : le client ne
déplace personne lui-même côté serveur, ne crée ni missile ni dégât — il
prédit seulement, chez lui, ce que `simuler()` en fera.

C'est le serveur qui calcule la position et la renvoie à tout le monde. Sinon
n'importe qui ouvrirait la console et se téléporterait où il veut. Le serveur
borne `dt` (0,1 s max) et le nombre de commandes traitées par tick (5) :
envoyer 1000 commandes d'un coup ne rend pas 1000 fois plus rapide, ça remplit
juste une file qui se vide au rythme normal.

### 2. Une salle = un objet en mémoire

```js
const salles = new Map();   // "mgs" -> Salle
```

`/game/arene/?salon=copains` ouvre une arène complètement séparée. Une salle
vide s'arrête d'elle-même (`clearInterval`) et disparaît de la Map : un serveur
sans joueur ne consomme rien.

Le nom du salon crée une salle : il est filtré des **deux** côtés (PHP et
Node) en `[a-z0-9-]`, 24 caractères, avec un plafond de 20 salles.

### 3. La boucle 20 Hz

Toutes les 50 ms : appliquer les commandes reçues, séparer les joueurs qui se
chevauchent, avancer les missiles, résoudre les touches, recharger les
pastilles de soin, diffuser un *snapshot*.

```json
{ "t": "etat", "tick": 1042,
  "joueurs": [ { "i":1, "n":"Ben", "c":"#7c5cff", "sp":"robot", "x":812.4, "y":301.0,
                 "a":-1.2, "s":412, "pv":15, "k":3, "m":1, "d":45, "u":30, "iv":0,
                 "b":1, "fl":2.4, "zr":0, "rl":0, "nc":2, "nd":0, "kp":3, "ch":0 } ],
  "pr": [ { "i":88, "x":640, "y":210, "a":0.8, "p":1, "td":0, "tv":2 } ],
  "mt": [ { "i":4, "x":-40, "y":700, "a":0.31 } ],
  "zo": [ { "i":7, "x":900, "y":420, "v":1.8 } ],
  "so": [ 0, 12.4, 0, 0 ],
  "bo": [ 0, 18.2 ],
  "ev": [ { "t":"tir", "x":830, "y":300 } ] }
```

Les noms de champs font une lettre : à 20 messages par seconde et par joueur,
chaque octet compte. `pr` ce sont les missiles (avec `td`/`tv`, les paliers du
tireur, pour dessiner le bon projectile), `mt` les météorites, `zo` les zones
de ralentissement actives (`v` = vie restante), `so` et `bo` la recharge des
pastilles, `ev` ce qui vient de se passer (le client en tire les sons et le
fil des éliminations). Côté joueur : `b` le bouclier, `fl` la recharge du
flash restante (0 = prêt), `zr` celle de la zone, `rl` = 1 si un ralenti est
actif en ce moment, `nc`/`nd` les paliers d'arme, `kp` les kills depuis le
dernier palier, `ch` le nombre d'améliorations à choisir.

Quand une ulti est en cours, un champ `g` décrit le gel, l'angle courant de
l'aiguille et, une fois le clic parti, la position du rayon.

La trame WebSocket est fabriquée **une seule fois** par tick puis écrite telle
quelle sur chaque socket.

### 4. Les trois techniques qui font que ça ne rame pas

Avec 60 ms de latence, attendre la réponse du serveur avant de bouger donnerait
un jeu injouable. Donc :

**Prédiction** — le client applique `simuler()` chez lui immédiatement. Le
personnage répond au clavier dans la milliseconde.

**Réconciliation** — le snapshot contient `s`, le numéro de la dernière
commande que le serveur a traitée. Le client repart de la position officielle,
jette les commandes déjà prises en compte, et **rejoue** celles encore en vol :

```js
monPerso.x = officiel.x;
monPerso.y = officiel.y;
enAttente = enAttente.filter(c => c.seq > officiel.s);
for (const c of enAttente) simuler(monPerso, c.c, c.dt);
```

Si la prédiction était juste, on retombe exactement au même endroit : rien ne
bouge à l'écran. Sinon (un mur, un autre joueur), la correction s'applique.

**Interpolation** — les autres joueurs ne sont pas prédits : on les affiche
**100 ms dans le passé**, entre les deux derniers snapshots. On perd 100 ms de
fraîcheur, on gagne un mouvement lisse même quand un paquet se perd.

Ces trois idées viennent de Quake III et de Source (Valve). Elles n'ont pas
changé depuis 25 ans.

### 5. Le pas de temps fixe

Le client simule par pas de 1/30 s exactement, jamais avec le `dt` de l'écran.
Sinon un écran 144 Hz et un écran 60 Hz ne calculeraient pas la même chose et
la réconciliation corrigerait sans arrêt. L'affichage, lui, interpole entre le
pas précédent et le pas courant.

---

## Le lien avec le compte MGS

`/game/arene/` passe le pseudo du visiteur connecté dans l'URL de l'iframe
(`?nom=…`). Le jeu **pré-remplit** le champ, il ne se connecte pas tout seul :
le joueur doit pouvoir corriger son nom, et une iframe qui ouvrirait une
connexion sans clic n'aurait de toute façon pas le clavier.

Ce pseudo n'est **pas une preuve d'identité** : on peut ouvrir `/jeu/` à la
main et se déclarer comme on veut. Tant qu'il n'y a ni score ni classement, ça
n'a aucune conséquence. Le jour où un classement remonte dans la base MGS, il
faudra un jeton signé par le PHP et vérifié par Node — c'est le point à ne pas
oublier.

Le serveur nettoie quand même le pseudo (balises, guillemets, sauts de ligne,
16 caractères) : il est réaffiché à tous les autres joueurs.

## Garde-fous en place

| | |
|---|---|
| Commandes traitées par tick et par joueur | 5 |
| `dt` accepté | 0 à 0,1 s |
| File de commandes par joueur | 60, le surplus est jeté |
| Joueurs par salle | 32 |
| Salles simultanées | 20 |
| Connexions totales | 200 |
| Message WebSocket | 256 Ko, au-delà : fermeture |
| File d'écriture par socket | 1 Mo, au-delà : déconnexion |
| Mémoire du conteneur | 256 Mo (`mem_limit`) |
| Fichiers servis | `public/` uniquement, traversée bloquée |
| Cadence de tir | imposée par les ticks, pas par le client |
| Identifiant de personnage | `[a-z0-9-]`, 24 caractères, filtré des deux côtés |
| Ulti | refusée en dessous de 100 %, une seule à la fois par salle |
| Rayon d'ulti | seul le lanceur peut le déclencher, une seule fois |
| Amélioration d'arme | refusée sans palier en réserve et hors proposition |
| Flash | refusé pendant la recharge (5 s) et pendant le gel — la distance et l'arrivée sont calculées par le serveur |
| Zone de ralentissement | refusée pendant la recharge (10 s) et pendant le gel — portée et blocage par les murs calculés côté serveur |

## La suite, dans l'ordre

1. **Un sprint** — touche Maj, `VITESSE * 1.8`, avec une jauge d'endurance.
   Bon exercice : il faut y penser des deux côtés dans `shared.js` pour que la
   prédiction reste juste.
2. **Rattacher au compte MGS** — jeton signé côté PHP, vérifié par Node, puis
   remontée du score dans la base. C'est le vrai prochain gros morceau : tant
   qu'un pseudo n'est pas une preuve d'identité, un classement ne vaut rien.
3. **Optimisation réseau** — le snapshot renvoie `n`, `c` et `sp` de chaque
   joueur 20 fois par seconde alors qu'ils ne changent jamais. Les sortir dans
   un message « roster » envoyé à l'arrivée et au départ diviserait le trafic
   par deux dans une salle pleine.
4. **Modes de jeu** — équipes, manche à 10 kills, chrono. Tout est déjà là :
   `Salle` compte les kills, il ne manque qu'une condition de fin.
5. **Quatrième compétence** — l'ulti (charge, gel, rayon), le flash et la
   zone de ralentissement sont chacun isolés dans `salle.js` ; en ajouter une
   autre revient à écrire une méthode `declencherXxx()` ou `avancerXxx()`, et
   un dessin.
6. **Surveiller l'écart de puissance.** Les paliers d'arme se cumulent sans
   plafond : dans une salle où quelqu'un reste très longtemps, l'écart avec un
   nouvel arrivant devient énorme. Deux garde-fous possibles le jour où ça se
   voit — plafonner à 5 paliers, ou faire repartir les paliers à zéro quand le
   salon se vide.

## Petites choses à savoir

- Sur contact entre deux joueurs, un léger tremblement est normal : le client
  ne prédit pas la poussée des autres, donc le serveur corrige. Se lisse en
  appliquant la correction progressivement plutôt que d'un coup.
- Le conteneur n'écrit rien sur le disque (`:ro`). Une sauvegarde des scores
  demanderait un volume dédié — pas de retirer le `:ro`.
- Ne mets jamais de logique de jeu importante uniquement dans le client : tout
  ce qui décide de quelque chose doit être vérifié par le serveur.
- Les scores sont **en mémoire, par salon**. Quand la dernière personne part,
  la salle disparaît et les compteurs avec elle. C'est voulu tant qu'il n'y a
  pas d'identité vérifiée : un classement fondé sur un pseudo librement
  choisi ne veut rien dire.
- Le son ne démarre qu'au clic sur « Entrer dans l'arène » : aucun navigateur
  n'autorise à jouer un son avant un geste de l'utilisateur. C'est aussi pour
  ça que le bouton fait `await sons.demarrer()` avant de se connecter.
- Un fichier de son ou une image de personnage manquants ne cassent rien : le
  jeu retombe sur un son synthétisé et sur un cercle de couleur. Un 404 y est
  volontairement silencieux — sinon la console crierait à chaque son absent.
