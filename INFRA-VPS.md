# Infrastructure du VPS My Gamers Stats

Ce document décrit **tout** ce qui tourne sur le VPS de production
(`vps122984`, utilisateur `louisDadmin`) : les couches réseau, les
conteneurs, les scripts de déploiement, et les pièges déjà rencontrés.
Objectif : pouvoir le recoller dans une nouvelle conversation et repartir
sans tout redécouvrir.

---

## Vue d'ensemble — les couches, dans l'ordre où passe une requête

```
Internet
  │
  ▼
Cloudflare (proxy/CDN, gère le domaine my-gamers-stats.com)
  │  HTTPS
  ▼
VPS, conteneur "nginx" (image nginx:alpine)
  │  config générée par ISPConfig, dans ~/nginx/conf.d et ~/nginx/certs
  │  termine le TLS, écoute 0.0.0.0:80 et 0.0.0.0:443 (seul conteneur
  │  qui publie des ports sur l'hôte — vérifié via `sudo ss -tlnp`)
  │  proxy_pass vers le conteneur "apache" PAR SON NOM (http://apache:80)
  ▼
VPS, conteneur "apache" (build local, PHP 8.3 + Apache 2.4)
  │  sert le site PHP (~/apache/site, monté depuis ~/apache/repo/site_web)
  │  ProxyPass /jeu/  → conteneur "arene"   (jeux/arene/,   port 8080)
  │  ProxyPass /bd/   → conteneur "bdbluff" (jeux/bdbluff/, port 8080)
  ▼
VPS, conteneurs "arene" / "bdbluff" (image node:22-alpine officielle,
  AUCUNE dépendance, le code est juste monté en volume :ro)
```

Il y a donc **deux reverse-proxies empilés** : `nginx` (géré par ISPConfig,
en dehors du dépôt Git) fait la terminaison TLS et parle à `apache` par son
nom de conteneur Docker ; `apache` fait lui-même du reverse-proxy vers les
jeux Node via `mod_proxy`/`mod_proxy_wstunnel`. Les deux sont sur le même
réseau Docker externe `web`.

**Point important** : `nginx` (ISPConfig) est un système à part, pas
documenté dans ce dépôt et pas modifiable depuis le code — seulement
depuis le VPS ou l'interface ISPConfig.

---

## Arborescence sur le VPS (`~louisDadmin/`)

```
~/apache/
├── docker-compose.yml     LA source de vérité de tous les conteneurs de jeu
├── Dockerfile              build de l'image "apache" (PHP + Apache)
├── config.php               config MySQL/API du site (PAS dans Git)
├── smtp-config.php          config SMTP (PAS dans Git)
├── mgs-arene.conf           ProxyPass /jeu/ → arene   (monté dans apache)
├── mgs-bdbluff.conf         ProxyPass /bd/  → bdbluff (monté dans apache)
├── update-mgs.sh            LE script de déploiement (voir plus bas)
├── repo/                    clone git de github.com/Bbachelard/MGS
├── site/                    copie servie par Apache (rsync depuis repo/site_web/)
├── arene/                   copie servie par le conteneur arene   (rsync depuis repo/jeux/arene/)
└── bdbluff/                 copie servie par le conteneur bdbluff (rsync depuis repo/jeux/bdbluff/)

~/nginx/
├── conf.d/                  vhosts nginx (générés par ISPConfig)
└── certs/                   certificats TLS
```

`repo/`, `site/`, `arene/` et `bdbluff/` **doivent appartenir à
`louisDadmin`**, pas à `root`. Si `update-mgs.sh` a un jour été lancé avec
`sudo bash update-mgs.sh`, tous les fichiers qu'il touche deviennent
root, et le `git pull`/`rsync` suivant échoue avec des erreurs de
permission. Fix :
```bash
sudo chown -R "$(whoami):$(whoami)" ~/apache/repo ~/apache/site ~/apache/arene ~/apache/bdbluff
```

---

## `docker-compose.yml` — les 3 services de jeu/site

- **`apache`** : build local (`Dockerfile` du dossier), sert `~/apache/site`
  (bind-mount, PAS `:ro` — Apache/PHP doit pouvoir écrire dans
  `site/cache/`), monte `mgs-arene.conf` et `mgs-bdbluff.conf` dans
  `conf-enabled/`. **N'a aucun `ports:`** — il n'est joignable que depuis
  le réseau Docker `web`, jamais directement depuis l'extérieur.
- **`arene`** / **`bdbluff`** : image `node:22-alpine` officielle, code
  monté en `:ro` depuis `~/apache/arene` / `~/apache/bdbluff`, `expose:
  8080` (jamais `ports:`, même raison que `apache`), `healthcheck` sur
  `/sante`.
- Les **trois** doivent être sur `networks: [web]` (réseau externe,
  déclaré `external: true` en bas du fichier) — c'est ce réseau que
  `nginx` et `apache` partagent, et qui permet la résolution par nom
  (`http://apache:80`, `http://arene:8080`, `http://bdbluff:8080`).
  **Oublier `networks: [web]` sur un service = Apache/nginx ne résout
  jamais son nom = 503/502 permanent.**

---

## `update-mgs.sh` — le déploiement de routine

```bash
#!/bin/bash
set -euo pipefail

RACINE="/home/louisDadmin/apache"

cd "$RACINE/repo"
git pull

rsync -a --delete --exclude='vendor/' \
  "$RACINE/repo/site_web/" "$RACINE/site/"

rsync -a --delete --exclude='test/' --exclude='apache/' --exclude='docker/' \
  "$RACINE/repo/jeux/arene/" "$RACINE/arene/"

rsync -a --delete --exclude='test/' --exclude='apache/' --exclude='docker/' \
  "$RACINE/repo/jeux/bdbluff/" "$RACINE/bdbluff/"

cd "$RACINE"
sudo docker compose restart apache arene bdbluff

echo "Mise à jour de My Gamer Stats terminée."
```

S'exécute avec `bash update-mgs.sh` (**pas** `sudo bash ...` — seule la
dernière ligne a besoin de `sudo`, elle l'a déjà en interne).

**`restart`, jamais `up -d --force-recreate`, en routine.** `restart`
relance le même conteneur (même IP interne Docker, le code re-rsynché est
relu). `--force-recreate` détruit et recrée le conteneur, qui reçoit une
**nouvelle IP interne** — cassant `nginx`, qui a résolu et mis en cache
l'ancienne IP au démarrage (voir l'incident plus bas). `up -d
--force-recreate` ne sert qu'à appliquer un changement de structure du
`docker-compose.yml` lui-même (nouveau service, nouveau volume) — dans ce
cas, penser à `sudo docker restart nginx` juste après.

---

## Ajouter un nouveau jeu (mêmes étapes qu'a suivies BDBluff)

1. Le code du jeu vit dans `jeux/<nom>/` à la racine du dépôt : un serveur
   Node/WebSocket sans dépendance (`server/`), un client (`public/`),
   tourne dans `node:22-alpine` monté en volume `:ro`. Voir
   `jeux/bdbluff/README.md` pour le détail (protocole, tests, etc.).
2. `jeux/<nom>/apache/mgs-<nom>.conf` : `ProxyPass /<prefixe>/` et
   `/<prefixe>/ws` vers `<nom>:8080`.
2bis. **Ajouter aussi un bloc `location /<prefixe>/ws { ... }` dans
   `~/nginx/conf.d/*.conf`** (hors dépôt Git, à faire à la main sur le
   VPS) — sans lui, le WebSocket échoue même avec une config Apache
   correcte. Voir l'incident 5 et le fichier complet plus bas.
3. `jeux/<nom>/docker/service-<nom>.yml` : bloc à coller dans
   `docker-compose.yml`, avec `networks: [web]`.
4. `site_web/game/<nom>/index.php` : page d'accueil du jeu, iframe vers
   `/<prefixe>/`. **Le chemin passé au client doit être RELATIF à la page
   courante, jamais supposé être la racine du domaine** — un jeu servi en
   `/<prefixe>/` doit calculer ses propres URL (WebSocket compris) à partir
   de `location.pathname`, pas d'un `/ws` en dur (bug réel rencontré avec
   BDBluff, corrigé dans `public/client.js`).
5. Entrée dans `site_web/php/games-mgs-model.php` (`mgs_group_games()`).
6. Déploiement, une seule fois (voir ci-dessous), puis `update-mgs.sh`
   suffit pour toutes les mises à jour suivantes.

### Première mise en ligne d'un nouveau jeu

```bash
cd ~/apache
# 1. coller le bloc service dans docker-compose.yml (networks: [web] inclus)
# 2. ajouter le montage de sa conf Apache dans les volumes du service apache
# 3. s'assurer que ~/apache/repo est sur la bonne branche/à jour
bash update-mgs.sh                 # rsync le code, MAIS ne crée pas encore le nouveau conteneur
sudo docker compose up -d apache <nom-du-jeu>   # crée le conteneur, recharge Apache
sudo docker restart nginx           # ⚠️ apache a été recréé → nouvelle IP → nginx doit la reprendre
```

---

## Diagnostic — dans l'ordre, du plus proche de l'utilisateur au plus loin

```bash
# 1. Les conteneurs tournent-ils ?
sudo docker compose ps
sudo docker compose logs --tail=100 <service>

# 2. Apache répond-il, en local, en HTTP (donc en contournant nginx/TLS) ?
curl -sI http://127.0.0.1/
#  → si ça répond directement "apache" (pas nginx), c'est qu'Apache
#    publie un port — ce n'est normalement PAS le cas ici, tout passe par nginx.

# 3. nginx répond-il correctement, en HTTPS local (contourne Cloudflare) ?
curl -sk https://127.0.0.1/ -H "Host: my-gamers-stats.com" -o /dev/null -w "%{http_code}\n"
curl -sk https://127.0.0.1/bd/sante -H "Host: my-gamers-stats.com"

# 4. Si 502 à l'étape 3 : regarder QUI nginx n'arrive pas à joindre
sudo docker logs --tail 50 nginx | grep "connect() failed"
#  → montre l'IP/le nom que nginx essayait de joindre. Si c'est une IP et
#    que "docker inspect apache" montre une IP DIFFÉRENTE maintenant :
#    c'est le piège du cache DNS de nginx après un --force-recreate.
sudo docker restart nginx

# 5. Sonde de santé de chaque jeu (par le réseau Docker interne, ou
#    directement si vous êtes DANS le conteneur du site) :
curl -s http://127.0.0.1/bd/sante   # via Apache, en HTTP local
sudo docker exec bdbluff wget -qO- http://127.0.0.1:8080/sante   # direct
```

---

## Incidents déjà rencontrés (pour ne pas les redécouvrir)

1. **`git pull`/`rsync` → "Operation not permitted" / "droits
   insuffisants"** : `repo/`, `site/` ou `arene/` appartenaient à `root`
   (un `sudo bash update-mgs.sh` antérieur). Fix : `chown -R` vers
   `louisDadmin` (voir plus haut). Cause racine : ne **jamais** lancer
   `update-mgs.sh` avec `sudo` devant `bash`.

2. **503 permanent sur un jeu tout juste ajouté** : le service Docker du
   jeu n'a pas `networks: [web]` → Apache ne résout pas son nom.

3. **502 Cloudflare sur TOUT le site après un déploiement** : `nginx` a
   mis en cache l'ancienne IP d'`apache` avant que celui-ci soit recréé
   (`--force-recreate` en routine). Fix immédiat : `sudo docker restart
   nginx`. Fix définitif : ne jamais recréer `apache` en routine (voir
   `update-mgs.sh` ci-dessus).

4. **WebSocket qui échoue en prod alors qu'il marchait en local** : le
   client construisait l'URL du WebSocket à la racine du domaine (`/ws`)
   au lieu d'un chemin relatif à la page (`/bd/ws`) — cassant tout jeu
   servi en sous-chemin plutôt qu'à la racine d'un sous-domaine dédié.
   Toujours dériver ces URL de `location.pathname`.

5. **WebSocket qui échoue même avec la bonne URL (`/bd/ws` correct,
   toujours refusé)** : `~/nginx/conf.d/*.conf` (ISPConfig, voir
   ci-dessous) a un bloc `location /jeu/ws { ... }` **dédié**, avec
   `proxy_http_version 1.1;` et `proxy_set_header Upgrade
   $http_upgrade;` / `proxy_set_header Connection "upgrade";` — sans ces
   en-têtes réinjectés explicitement, nginx ne fait PAS passer l'upgrade
   WebSocket, même si le `location /` générique proxifie très bien le
   reste du trafic HTTP normal. **Chaque nouveau jeu avec un WebSocket a
   besoin de son propre bloc `location /<prefixe>/ws { ... }`**, copié
   sur celui de l'Arène/BDBluff ci-dessous, avec juste le chemin changé.
   Après édition : `docker exec nginx nginx -t` (valider la syntaxe) puis
   `docker exec nginx nginx -s reload` (recharge à chaud, pas de coupure
   contrairement à un `docker restart`).

---

## Ce que je (Claude) n'ai jamais vu directement

- `config.php` / `smtp-config.php` (secrets, volontairement hors Git).
- La configuration Cloudflare (DNS, règles de cache, etc.).

Si un problème vient de l'une de ces deux zones, il faudra en coller le
contenu (ou la partie pertinente) dans la conversation.

## `~/nginx/conf.d/*.conf` (ISPConfig) — pas dans ce dépôt Git

Fichier géré à la main sur le VPS (ISPConfig peut le régénérer/écraser à
l'occasion — si un jour un jeu WebSocket redevient injoignable sans raison
apparente après une manip dans l'interface ISPConfig, revérifier ce
fichier en premier). Structure actuelle, pour référence :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name my-gamers-stats.com www.my-gamers-stats.com;
    return 301 https://my-gamers-stats.com$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name my-gamers-stats.com www.my-gamers-stats.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Un bloc par jeu WebSocket — voir l'incident 5 ci-dessus.
    location /jeu/ws { proxy_pass http://apache:80; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s; proxy_send_timeout 3600s; }

    location /bd/ws { proxy_pass http://apache:80; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s; proxy_send_timeout 3600s; }

    # Tout le reste (le site PHP, et le trafic HTTP normal des jeux —
    # seul le handshake WebSocket a besoin d'un bloc à part).
    location / {
        proxy_pass http://apache:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}
```
