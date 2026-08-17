# Arène MGS — prototype multijoueur temps réel

Une arène 2D où plusieurs joueurs se déplacent en même temps, se voient bouger
et se bousculent. Tout tourne sur Cloudflare, gratuitement.

Le jeu s'ouvre depuis le site : **`/game/arene/`**, elle-même listée dans le
catalogue `/game/`.

---

## Pourquoi ce dossier n'est pas dans `site_web/`

`site_web/` part sur l'hébergement PHP (par FTP). Ce dossier-ci n'y a rien à
faire : il ne contient pas une ligne de PHP et il se déploie ailleurs.

Cloudflare n'exécute pas de PHP. Ses Workers exécutent du **JavaScript** (ou du
WebAssembly) : pas d'Apache, pas d'`index.php`, pas de `mysqli_connect()`.

Ce n'est pas une perte, et surtout pas pour un jeu :

| | PHP mutualisé (l'hébergement MGS) | Cloudflare Workers |
|---|---|---|
| Mémoire entre 2 requêtes | aucune (tout meurt à la fin du script) | **Durable Objects** : un objet qui reste vivant |
| WebSocket | quasi impossible en mutualisé | natif |
| Comment savoir qui bouge | le client redemande toutes les 200 ms (*polling*) | le serveur pousse 20 fois/s |
| Ressenti | mou, saccadé | fluide |

Un jeu temps réel a besoin d'un serveur **qui se souvient** de l'état de la
partie entre deux messages. Le reste du site (comptes, MySQL, stats Steam et
Riot) reste exactement où il est : les deux cohabitent très bien, le site PHP
se contentant d'afficher le jeu dans une iframe.

---

## Les fichiers

```
jeux/arene/
├── wrangler.toml        configuration Cloudflare
├── package.json
├── src/
│   └── server.js        le Worker (routage) + ArenaRoom (le serveur de jeu)
└── public/
    ├── index.html       tout le client : canvas, clavier, réseau, rendu
    └── shared.js        ⭐ la physique, partagée par le client ET le serveur
```

Côté site, deux fichiers seulement :

```
site_web/game/arene/index.php               le cadre (navbar MGS + iframe)
site_web/content/css/modules/arene-embed.css son style
```

`shared.js` est le fichier le plus important. Il contient la fonction
`simuler()`, utilisée **des deux côtés**. C'est la règle numéro un du
multijoueur : si le client et le serveur ne calculent pas le mouvement de façon
identique, le personnage tressaute en permanence.

---

## Lancer le projet en local

```bash
cd jeux/arene
npm install
npx wrangler dev          # http://localhost:8787
```

Ouvre l'adresse dans **deux onglets** (ou deux navigateurs) : tu verras les
deux joueurs bouger en même temps.

## Mettre en ligne

```bash
cd jeux/arene
npx wrangler login
npx wrangler deploy       # → https://mgs-arene.<ton-compte>.workers.dev
```

Wrangler affiche l'adresse obtenue. **Report-la dans `MGS_ARENE_URL`**, en tête
de `site_web/game/arene/index.php`, puis renvoie ce fichier sur l'hébergement.
Tant que la constante est vide, la page affiche « pas encore en ligne » au lieu
d'une iframe cassée.

Les Durable Objects avec stockage SQLite (`new_sqlite_classes` dans
`wrangler.toml`) sont disponibles sur le **plan gratuit**.

### Plus tard : une adresse en `my-gamers-stats.com`

Si le domaine passe un jour chez Cloudflare, un enregistrement
`arene.my-gamers-stats.com` pointé sur le Worker remplace l'adresse en
`workers.dev` — seule `MGS_ARENE_URL` change. Rien d'autre à toucher.

---

## Comment ça marche

### 1. Le serveur fait autorité

Le client n'a pas le droit de dire « je suis en (500, 300) ». Il envoie
seulement **ce qu'il appuie** :

```json
{ "t": "cmd", "seq": 412, "dt": 0.0333, "e": { "haut": true, "droite": true } }
```

C'est le serveur qui calcule la position et qui la renvoie à tout le monde.
Sinon, n'importe qui ouvrirait la console et se téléporterait où il veut.
Le serveur borne d'ailleurs `dt` et le nombre de commandes traitées par tick :
sans ça, envoyer 1000 commandes d'un coup rendrait 1000 fois plus rapide.

### 2. Le Durable Object, c'est la salle

Un Worker classique n'a pas de mémoire : il démarre, répond, meurt. Impossible
d'y stocker la liste des joueurs. Le Durable Object, lui, est une instance
unique et persistante, identifiée par un nom :

```js
const id = env.ARENA.idFromName("mgs");   // toujours le même objet
return env.ARENA.get(id).fetch(requete);
```

Deux joueurs qui demandent le salon `mgs` tombent forcément sur la **même
instance**, sur la même machine. C'est ce qui permet de créer des salons :
`/game/arene/?salon=copains` ouvre une deuxième arène complètement séparée.

Le nom du salon est filtré des deux côtés (lettres, chiffres, tiret, 24
caractères) : il sert d'identifiant d'objet, on ne laisse pas un visiteur en
faire créer une infinité.

### 3. La boucle 20 Hz

Toutes les 50 ms, le serveur applique les commandes reçues, sépare les joueurs
qui se chevauchent, et diffuse un *snapshot* :

```json
{ "t": "etat", "tick": 1042, "joueurs": [ { "i":1, "n":"Alice", "x":812.4, "y":301.0, "s":412 } ] }
```

Les noms de champs sont volontairement d'une lettre : à 20 messages par seconde
et par joueur, chaque octet compte.

### 4. Les trois techniques qui font que ça ne rame pas

C'est le cœur du sujet. Avec 60 ms de latence, attendre la réponse du serveur
avant de bouger donnerait un jeu injouable. Donc :

**Prédiction** — le client applique `simuler()` chez lui immédiatement. Le
personnage répond au clavier dans la milliseconde.

**Réconciliation** — quand le snapshot arrive, il contient `s`, le numéro de la
dernière commande que le serveur a traitée. Le client repart de la position
officielle, jette les commandes déjà prises en compte, et **rejoue** celles qui
sont encore en vol :

```js
monPerso.x = officiel.x;
monPerso.y = officiel.y;
enAttente = enAttente.filter(c => c.seq > officiel.s);
for (const c of enAttente) simuler(monPerso, c.e, c.dt);
```

Si la prédiction était juste, on retombe exactement au même endroit : rien ne
bouge à l'écran. Si le serveur n'était pas d'accord (un mur, un autre joueur),
la correction s'applique.

**Interpolation** — les autres joueurs ne sont pas prédits (on ne sait pas ce
qu'ils vont appuyer). On les affiche **100 ms dans le passé**, entre les deux
derniers snapshots reçus. On perd 100 ms de fraîcheur, on gagne un mouvement
parfaitement lisse même si un paquet se perd.

Ces trois idées viennent de Quake III et de Source (Valve) ; elles n'ont pas
changé depuis 25 ans, et c'est encore ce qui tourne dans les jeux d'aujourd'hui.

### 5. Le pas de temps fixe

Le client simule par pas de 1/30 s exactement, jamais avec le `dt` de l'écran.
Sinon un écran 144 Hz et un écran 60 Hz ne calculeraient pas la même chose, et
la réconciliation corrigerait sans arrêt. L'affichage, lui, interpole entre le
pas précédent et le pas courant — d'où un rendu fluide malgré 30 pas/seconde.

---

## Le lien avec le compte MGS

La page `/game/arene/` passe le pseudo du visiteur connecté dans l'URL de
l'iframe (`?nom=…`). Le jeu **pré-remplit** le champ, il ne se connecte pas tout
seul : le joueur doit pouvoir corriger son nom, et une iframe qui ouvrirait une
connexion sans clic n'aurait de toute façon pas le clavier.

Ce pseudo n'est **pas une preuve d'identité** : quelqu'un peut ouvrir l'adresse
du Worker à la main et se déclarer comme il veut. Tant que le jeu n'a ni score
ni classement, ça n'a aucune conséquence. Le jour où un classement arrive, il
faudra un vrai jeton signé par le site et vérifié par le Worker — c'est le
point à ne pas oublier.

Le serveur nettoie quand même le pseudo (balises, sauts de ligne, 16
caractères) : il est réaffiché à tous les autres joueurs.

## Ce que le prototype fait déjà

- connexion WebSocket, pseudo, plusieurs salons (`?salon=copains`)
- déplacement ZQSD / WASD / flèches, diagonales normalisées
- collisions avec les murs, avec glissement le long des surfaces
- collisions entre joueurs (on se pousse)
- caméra qui suit le joueur, bloquée aux bords du monde
- affichage ping / nombre de joueurs / tick
- garde-fous anti-triche de base, salle plafonnée à 32 joueurs

## La suite, dans l'ordre

Chaque étape est petite et se construit sur la précédente.

1. **Un sprint** — touche Maj, `VITESSE * 1.8`, avec une jauge d'endurance dans
   l'état du joueur. Bon exercice : il faut y penser des deux côtés dans
   `shared.js` pour que la prédiction reste juste.
2. **Viser à la souris** — envoyer l'angle dans la commande, dessiner un canon.
3. **Tirer** — les projectiles sont simulés par le serveur uniquement et ajoutés
   au snapshot. Attention : c'est là que la triche commence.
4. **Points de vie et score** — dégâts au serveur, réapparition après 3 s.
5. **Persistance** — le Durable Object a un stockage intégré
   (`this.ctx.storage`) : garder le meilleur score du salon.
6. **Rattacher au compte MGS** — jeton signé côté PHP, vérifié par le Worker,
   puis remontée du score dans la base MGS.
7. **Optimisation réseau** — n'envoyer que ce qui a changé, passer en binaire,
   ne transmettre que les joueurs visibles à l'écran.

## Petites choses à savoir

- Sur contact entre deux joueurs, un léger tremblement est normal : le client
  ne prédit pas la poussée des autres, donc le serveur corrige. Se lisse en
  appliquant la correction progressivement plutôt que d'un coup.
- La boucle utilise `setInterval`, qui tourne tant qu'un WebSocket est ouvert
  et s'arrête quand la salle se vide. Pour un jeu qui doit continuer sans
  joueur connecté, il faudrait utiliser les *Alarms* des Durable Objects.
- Ne mets jamais de logique de jeu importante uniquement dans le client : tout
  ce qui décide de quelque chose doit être vérifié par le serveur.
