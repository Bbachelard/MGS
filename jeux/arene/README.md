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
│   └── sons/                   tes enregistrements (voir son README)
├── test/arene.test.js          60 contrôles, `npm test`
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
| Missile | **5 dégâts** — 4 touches pour éliminer |
| Cadence | **0,25 s** (4 tirs/s), munitions illimitées |
| Vitesse du missile | 480 px/s — assez lent pour être esquivé |
| Mort | réapparition **immédiate**, à un endroit **tiré au sort**, 1 s d'invulnérabilité |
| Zones de soin | **4**, rendent **toute** la vie, reviennent **15 s** après |
| Charge d'ulti | **+10 %** par missile touché — 10 touches pour une ulti |
| Ulti | **pause temporelle**, 2,4 s, projectile en spirale sur 1,5 tour |
| Dégâts de l'ulti | 20 — c'est-à-dire une élimination |

Tout se règle en un seul endroit : le bloc `COMBAT` de `public/shared.js`. Le
client reçoit ces valeurs dans le message `init` plutôt que de les redéclarer,
donc rééquilibrer le jeu ne demande pas de toucher au HUD.

### Le tir

Le client envoie deux choses en plus dans chaque commande : `a`, l'angle vers
la souris, et `f`, « je maintiens le tir ». **Il ne crée jamais de missile.**
C'est le serveur qui décide, et sa cadence ne descend qu'au rythme des ticks :
envoyer 100 ordres de tir dans le même tick ne produit qu'un seul missile.
C'est vérifié par les tests, parce que c'est très exactement ce qu'on essaiera
en premier depuis la console.

Le missile naît un peu devant le tireur (sinon il se cognerait à son propre
corps en marchant) et meurt au premier mur, au premier joueur, ou au bout de
2,2 s.

### La pause temporelle

À 100 %, <kbd>E</kbd> (ou le clic droit) fige **toute la salle** : plus
personne ne bouge, plus rien ne vole, les pastilles de soin ne rechargent
plus. Une aiguille part du lanceur et décrit **une spirale d'un tour et demi**
en 2,4 s, du rayon 40 au rayon 380. Le premier joueur qu'elle traverse est
éliminé. Si elle finit son tour et demi sans rien toucher, l'ulti est perdue.

Deux détails qui font toute la différence à l'usage :

- **Ni le bord du terrain ni les murs n'arrêtent l'aiguille.** Sinon l'ulti
  serait perdue d'avance partout sauf au centre exact de l'arène : le rayon
  monte à 380 px dans une arène qui fait 900 px de haut.
- **Un mur protège quand même** : on ne touche pas quelqu'un à travers. Le
  serveur trace une ligne de vue entre le lanceur et la cible avant de
  valider la touche.

Le vrai choix du joueur, c'est donc **le moment** : déclencher quand un
adversaire est à portée de spirale et à découvert.

### Ce que le client ne calcule jamais

Les dégâts, la mort, les scores, les soins et l'ulti sont **entièrement** côté
serveur. Le client reçoit un résultat (`pv`, `k`, `m`, `d`, `u` dans le
snapshot) et une liste d'événements (`ev`) dont il tire les sons et le fil des
éliminations. Il ne prédit que son propre déplacement — et même celui-là, il
s'en abstient pendant le gel, sinon on avancerait tout seul avant de se faire
rappeler en arrière au tick suivant.

---

## Tes personnages et tes sons

Deux dossiers sont faits pour être remplis à la main, et chacun a son README :

- **`public/perso/`** — un PNG par personnage, vu du dessus, **nez à droite**.
  Le jeu le fait pivoter vers la souris : un seul dessin suffit, pas huit.
  `gabarit.png` donne les repères (limite utile, rayon de collision, avant).
  Une ligne dans `persos.json` et il apparaît dans l'écran d'accueil.
- **`public/sons/`** — neuf sons (`tir`, `impact`, `touche`, `mort`, `kill`,
  `soin`, `ulti`, `ulti-touche`, `ulti-rate`). Chaque fichier trouvé remplace
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
npm test                    # 60 contrôles, ~8 s, aucune dépendance
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
seulement **ce qu'il appuie** :

```json
{ "t": "cmd", "seq": 412, "dt": 0.0333, "e": { "haut": true, "droite": true },
  "a": -1.204, "f": true }
```

`a` est l'angle vers la souris, `f` veut dire « je maintiens le tir ». Là
encore, ce sont des **intentions**, pas des faits : le client ne crée ni
missile ni dégât.

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
                 "a":-1.2, "s":412, "pv":15, "k":3, "m":1, "d":45, "u":30, "iv":0 } ],
  "pr": [ { "i":88, "x":640, "y":210, "a":0.8, "p":1 } ],
  "so": [ 0, 12.4, 0, 0 ],
  "ev": [ { "t":"tir", "x":830, "y":300 } ] }
```

Les noms de champs font une lettre : à 20 messages par seconde et par joueur,
chaque octet compte. `pr` ce sont les missiles, `so` la recharge des quatre
pastilles, `ev` ce qui vient de se passer (le client en tire les sons et le
fil des éliminations). Quand une ulti est en cours, un champ `g` décrit le gel
et la position de l'aiguille.

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
for (const c of enAttente) simuler(monPerso, c.e, c.dt);
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
| Cadence de tir | 0,25 s, imposée par les ticks, pas par le client |
| Identifiant de personnage | `[a-z0-9-]`, 24 caractères, filtré des deux côtés |
| Ulti | refusée en dessous de 100 %, une seule à la fois par salle |

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
5. **Deuxième compétence** — la charge d'ulti, le gel et la spirale sont
   isolés dans `salle.js` ; en ajouter une autre revient à écrire un
   `avancerXxx()` et un dessin.

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
