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
│   ├── index.js                salles, boucle 20 Hz, fichiers statiques
│   └── ws.js                   WebSocket minimal (RFC 6455), sans bibliothèque
├── public/
│   ├── index.html              le client : canvas, clavier, réseau, rendu
│   └── shared.js               ⭐ la physique, partagée client ET serveur
├── test/arene.test.js          27 contrôles, `npm test`
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

## Lancer en local

```bash
cd jeux/arene
node server/index.js        # http://localhost:8080
```

Deux onglets sur cette adresse = deux joueurs qui se voient bouger.

```bash
npm test                    # 27 contrôles, ~5 s, aucune dépendance
```

Les tests démarrent le vrai serveur et s'y connectent avec le client WebSocket
intégré à Node 22 : mouvement, salons, anti-triche, déconnexion, pseudos
hostiles, traversée de dossier.

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
{ "t": "cmd", "seq": 412, "dt": 0.0333, "e": { "haut": true, "droite": true } }
```

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
chevauchent, diffuser un *snapshot*.

```json
{ "t": "etat", "tick": 1042, "joueurs": [ { "i":1, "n":"Ben", "x":812.4, "y":301.0, "s":412 } ] }
```

Les noms de champs font une lettre : à 20 messages par seconde et par joueur,
chaque octet compte. La trame WebSocket est fabriquée **une seule fois** par
tick puis écrite telle quelle sur chaque socket.

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

## La suite, dans l'ordre

1. **Un sprint** — touche Maj, `VITESSE * 1.8`, avec une jauge d'endurance.
   Bon exercice : il faut y penser des deux côtés dans `shared.js` pour que la
   prédiction reste juste.
2. **Viser à la souris** — envoyer l'angle dans la commande, dessiner un canon.
3. **Tirer** — projectiles simulés côté serveur uniquement, ajoutés au
   snapshot. C'est là que la triche commence.
4. **Points de vie et score** — dégâts au serveur, réapparition après 3 s.
5. **Rattacher au compte MGS** — jeton signé côté PHP, vérifié par Node, puis
   remontée du score dans la base.
6. **Optimisation réseau** — n'envoyer que ce qui a changé, passer en binaire,
   ne transmettre que les joueurs visibles.

## Petites choses à savoir

- Sur contact entre deux joueurs, un léger tremblement est normal : le client
  ne prédit pas la poussée des autres, donc le serveur corrige. Se lisse en
  appliquant la correction progressivement plutôt que d'un coup.
- Le conteneur n'écrit rien sur le disque (`:ro`). Une sauvegarde des scores
  demanderait un volume dédié — pas de retirer le `:ro`.
- Ne mets jamais de logique de jeu importante uniquement dans le client : tout
  ce qui décide de quelque chose doit être vérifié par le serveur.
