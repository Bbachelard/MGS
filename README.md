# My Gamers Stats

Site de statistiques de jeu : un joueur retrouve au même endroit ses comptes
**Steam**, **Riot Games** et **Epic Games**, avec ses stats, sa bibliothèque et
l'historique de ses parties. Il peut lier plusieurs comptes, ajouter des amis
et consulter leur profil.

En production : <https://my-gamers-stats.com>

---

## Sommaire

- [Pile technique](#pile-technique)
- [Arborescence](#arborescence)
- [Installation](#installation)
- [Configuration](#configuration)
- [Base de données](#base-de-données)
- [Comment ça marche](#comment-ça-marche)
- [Ajouter une plateforme](#ajouter-une-plateforme)
- [Cache](#cache)
- [Déploiement](#déploiement)

---

## Pile technique

| Élément      | Choix                                                     |
|--------------|-----------------------------------------------------------|
| Serveur      | PHP **8.3+**, sans framework                              |
| Base         | MySQL / MariaDB via **mysqli** (requêtes préparées)       |
| Extensions   | `curl`, `mysqli`, `mbstring`                              |
| Dépendances  | `xpaw/steam-openid` (connexion Steam), `phpmailer` (SMTP) |
| Front        | HTML + CSS + JavaScript natif, **aucune** étape de build  |

Il n'y a rien à compiler : le contenu de `site_web/` est servi tel quel.

---

## Arborescence

```
site_web/
├── index.html              Accueil : recherche publique d'un joueur
├── composer.json/.lock     Dépendances PHP
├── vendor/                 Dépendances installées (versionnées)
│
├── connexion/              Connexion, mot de passe oublié, réinitialisation
├── signup/                 Inscription
├── logged/                 Espace connecté : profil, amis, profil d'un ami
├── legal/                  Mentions et politique de confidentialité
│
├── php/
│   ├── core/               Briques communes à tous les points d'entrée
│   │   ├── bootstrap.php       config + erreurs + registre  (1 seul require)
│   │   ├── http.php            mgs_json() / mgs_fail() / mgs_redirect()
│   │   ├── auth.php            contrôle de session, connexion, déconnexion
│   │   ├── cache.php           cache disque des réponses d'API externes
│   │   └── account-resolver.php  « accountId direct, sinon pseudo »
│   │
│   ├── views/              Fragments de page réutilisés
│   │   ├── head.php            <head> + version des assets
│   │   ├── navbar.php          barre de navigation + bannières
│   │   └── friend-card.php     carte d'un utilisateur
│   │
│   ├── providers/          Un dossier ou un fichier par plateforme
│   │   ├── steam.php
│   │   ├── epic.php
│   │   ├── riot.php            chargeur
│   │   └── riot/               config, http, ranks, assets, stats,
│   │                           matches, valorant, verify
│   │
│   ├── platforms.php       Registre central des plateformes + helpers HTTP
│   ├── links-model.php     Comptes liés (platform_links)
│   ├── friends-model.php   Amitiés, recherche d'utilisateurs
│   ├── suggest-model.php   Index d'autocomplétion de pseudos
│   │
│   └── *.php               Points d'entrée (api, games, matches, link,
│                           unlink, verify, suggest, session-status…)
│
├── js/
│   ├── core/mgs-core.js    Socle partagé — À CHARGER EN PREMIER
│   └── *.js                Un fichier par écran
│
└── content/
    ├── css/                stylesheet, styleLogin, styleAceuil,
    │   └── modules/        ajouts-stats : 4 assemblages de @import
    ├── image/
    └── sound/
```

### Deux conventions à connaître

**Les 4 feuilles CSS racines ne contiennent aucune règle.** Ce sont des
assemblages de `@import` vers `content/css/modules/`. Une nouvelle règle va
dans un module, pas dans la feuille racine. L'ordre des `@import` compte
(cascade CSS) : générique d'abord, spécifique ensuite.

**`js/core/mgs-core.js` se charge avant tous les autres scripts.** Il expose
`window.MGS` (échappement HTML, registre des plateformes, formatage) dont les
autres fichiers dépendent.

---

## Installation

```bash
git clone https://github.com/Bbachelard/MGS.git
cd MGS/site_web

# vendor/ est versionné : cette étape n'est utile que pour mettre à jour
composer install

cp config.example.php config.php          # puis remplir
cp smtp-config.example.php smtp-config.php # puis remplir

mkdir -p cache && chmod 775 cache

php -S localhost:8000 -t .
```

> `config.php` et `smtp-config.php` sont dans `.gitignore` et contiennent des
> secrets (mot de passe MySQL, clés d'API, identifiants SMTP). Ils ne doivent
> **jamais** être commités.

---

## Configuration

`site_web/config.php` renvoie le tableau de configuration **et** définit `$conn` :

```php
<?php
$conn = new mysqli('localhost', 'utilisateur', 'motdepasse', 'mgs');
$conn->set_charset('utf8mb4');

return [
    'SITE_URL'  => 'https://my-gamers-stats.com',
    'PLATFORMS' => [
        'steam' => ['api_key' => '…'],   // steamcommunity.com/dev/apikey
        'riot'  => [
            'api_key'          => '…',   // developer.riotgames.com
            'valorant_api_key' => '…',   // HenrikDev — voir « Valorant » plus bas
        ],
        'epic'  => ['client_id' => '…', 'client_secret' => '…'],
    ],
];
```

`site_web/smtp-config.php` définit les variables SMTP utilisées par
`php/mailer.php` : `$smtp_host`, `$smtp_port`, `$smtp_username`,
`$smtp_password`, `$smtp_encryption`, `$smtp_from_email`, `$smtp_from_name`.

### Variables d'environnement

| Variable          | Effet                                                        |
|-------------------|--------------------------------------------------------------|
| `MGS_DEBUG=1`     | Affiche les erreurs PHP. **Jamais en production.**           |
| `MGS_SMTP_DEBUG=1`| Journalise le dialogue SMTP. Diagnostic ponctuel uniquement. |

Par défaut les erreurs sont journalisées, pas affichées.

---

## Base de données

Quatre tables : `users`, `platform_links`, `friendships`, `password_resets`.

`platform_links` porte deux index uniques aux rôles distincts :

- `uq_platform_account (platform, platform_user_id)` — un compte de plateforme
  n'appartient qu'à un seul compte MGS ;
- un index `uq_user_platform (user_id, platform)` **ne doit plus exister** : il
  interdirait le multi-comptes. `mgs_add_link()` détecte sa présence et renvoie
  un message explicite si la migration n'a pas été jouée.

Colonnes `display_name` / `display_name_at` : pseudo public mémorisé pour
l'autocomplétion, rafraîchi au plus une fois par semaine.

---

## Comment ça marche

### Le registre des plateformes

`php/platforms.php` décrit chaque plateforme par ses capacités :

| Drapeau       | Signification                                          |
|---------------|--------------------------------------------------------|
| `enabled`     | un provider existe et fonctionne                       |
| `linkable`    | on sait lier le compte par OAuth / OpenID              |
| `verifiable`  | liaison par preuve de propriété (changement d'icône)   |
| `searchable`  | on sait chercher un joueur par pseudo                  |
| `max_accounts`| nombre de comptes autorisés par utilisateur            |

Les points d'entrée n'écrivent jamais « si steam… sinon si riot… » : ils lisent
ces drapeaux et appellent `mgs_provider_call($slug, 'fetch_stats', …)`, qui
route vers `steam_fetch_stats()`, `riot_fetch_stats()`, etc.

### Les providers

Un provider implémente tout ou partie de ce contrat, en préfixant ses fonctions
par son slug :

| Fonction               | Rôle                                          |
|------------------------|-----------------------------------------------|
| `resolve_account_id()` | pseudo → identifiant de compte                |
| `fetch_stats()`        | carte de statistiques normalisée              |
| `fetch_games()`        | bibliothèque de jeux                          |
| `fetch_matches()`      | historique de parties paginé                  |
| `begin_link()` / `complete_link()` / `should_complete_link()` | OAuth / OpenID |
| `verification_icons()` / `profile_icon()` / `display_name()` | liaison par icône |

`mgs_provider_supports()` teste la présence d'une fonction : une capacité
absente donne un 501 propre, pas une erreur fatale.

### Les jeux d'une plateforme sans bibliothèque

Riot et Epic n'exposent aucune API de bibliothèque : `games.php` répond 501 et
`games-table.js` reconstruit les lignes à partir des stats déjà chargées.

Un provider peut déclarer ses jeux de deux façons dans `metrics` :

| Clé            | Pour qui             | Effet                                    |
|----------------|----------------------|------------------------------------------|
| `virtualGames` | Riot (LoL, Valorant) | une ligne par jeu, avec ses heures propres |
| `topGame`      | Epic (Fortnite)      | repli à une seule ligne, heures = total de la plateforme |

`topGame` reste servi dans les deux cas : c'est lui qui alimente la carte
« Jeu principal » du hub. Quand `virtualGames` est présent, `topGame` en est
simplement l'entrée la plus jouée.

### Sécurité des identifiants de compte

Deux chemins bien distincts, à ne surtout pas confondre :

- **Public** (accueil) — `mgs_resolve_public_account()` accepte un `accountId`
  ou un pseudo fourni par le client.
- **Authentifié** (profil, amis) — `mgs_resolve_owned_account()` recoupe
  **toujours** l'`accountId` avec `platform_links`. Sans ce contrôle, n'importe
  qui ferait scanner la bibliothèque d'un tiers avec notre clé d'API.

### Valorant : pourquoi une API tierce

Riot n'ouvre pas ses endpoints Valorant aux clés de développement — le portail
est explicite : *« Personal Key Applications are currently not supported »*.
Les routes `val-match-v1` et `val-ranked-v1` demandent une clé **Production**,
accordée sur dossier et refusée en pratique à un site personnel.

Les stats Valorant passent donc par **HenrikDev** (`api.henrikdev.xyz`), la
référence communautaire — exactement le principe déjà retenu pour Fortnite,
qui passe par `fortnite-api.com`.

**Obtenir la clé** — rejoindre le [Discord HenrikDev](https://discord.com/invite/X3GaVkX2YN),
faire la demande dans le salon prévu (pseudo Riot + usage du site). C'est
gratuit, la clé arrive sous la forme `HDEV-…` et se pose dans `config.php` :

```php
'riot' => [
    'api_key'          => 'RGAPI-…',
    'valorant_api_key' => 'HDEV-…',
],
```

**Sans clé, rien ne casse** : `riot_valorant_fetch()` renvoie `['state' => 'nokey']`,
et la carte Riot reste très exactement celle d'avant — pas de message d'erreur,
pas de section vide.

Le code appelle deux routes, en parallèle :

| Route                                              | Sert à                       |
|----------------------------------------------------|------------------------------|
| `/valorant/v3/by-puuid/mmr/{région}/pc/{puuid}`     | rang, RR, pic, saisons       |
| `/valorant/v1/by-puuid/stored-matches/{région}/{puuid}` | parties, agents, K/D    |

Le compte est le **même** que pour League of Legends : un PUUID Riot déjà
vérifié affiche automatiquement ses stats Valorant, il n'y a rien de plus à
lier.

Tout ce qui dépend du fournisseur est confiné entre les bornes
`## DÉBUT / FIN FOURNISSEUR VALORANT ##` de `php/providers/riot/valorant.php`.
Pour changer de source, il suffit de réécrire `riot_valorant_fetch()` en
respectant son format de sortie — le reste du fichier (percentiles, emblèmes,
encadrés, sections) ne connaît aucun tiers. Les URL elles-mêmes sont deux
constantes, `RIOT_VAL_URL_MMR` et `RIOT_VAL_URL_MATCHES`.

> Le temps de jeu Valorant est une **estimation** : le fournisseur ne donne pas
> la durée des parties. On multiplie le nombre de parties classées par
> `RIOT_VAL_MINUTES_PAR_PARTIE` (35 min). Toute valeur qui en découle porte
> `estimated => true`, et le hub l'affiche préfixée d'un « ≈ », comme les
> heures LoL déduites des points de maîtrise.

### Liaison par preuve de propriété (Riot)

RSO exige une clé de production approuvée, et `third-party-code` a été supprimé
en 2022. On demande donc au joueur de poser une icône de profil tirée au sort,
puis on relit son profil : seul le propriétaire du compte peut le faire.
Le tout vit dans `php/verify.php` + `php/providers/riot/verify.php`.

---

## Ajouter une plateforme

1. Ajouter l'entrée dans `mgs_platforms()` (`php/platforms.php`), avec les
   drapeaux qui décrivent honnêtement ce qu'on sait faire.
2. Créer `php/providers/<slug>.php` et y implémenter les fonctions
   `<slug>_*` du contrat ci-dessus.
3. Ajouter la plateforme au registre client, dans `js/core/mgs-core.js`
   (`PLATFORMS`) — libellé, icône, couleur.
4. Déposer l'icône dans `content/image/`.

Aucun point d'entrée n'est à modifier.

---

## Cache

Tout est sur disque, sous `site_web/cache/` (non versionné, à créer et rendre
inscriptible) :

| Dossier / fichier        | Contenu                       | Durée   |
|--------------------------|-------------------------------|---------|
| `cache/api/`             | cartes de stats               | 10 min  |
| `cache/matches/`         | pages d'historique            | 15 min  |
| `cache/riot-matches/`    | parties détaillées            | 60 j    |
| `cache/snapshots/`       | repère annuel Steam           | 1 an    |
| `cache/steam-prices.json`| prix du Store (valeur de la bibliothèque) | 30 j |
| `cache/epic/`            | pseudos Epic                  | —       |

`?refresh=1` sur `api.php` ou `matches.php` force le rafraîchissement.
Vider le cache : `rm -rf site_web/cache/*`.

---

## Déploiement

`vendor/` est versionné : un `git pull` suffit, `composer install` n'est utile
que pour mettre à jour une dépendance.

Après un déploiement touchant le CSS ou le JS, incrémenter
`MGS_ASSET_VERSION` dans `php/views/head.php` (et le `?v=` d'`index.html`)
pour invalider le cache navigateur.

À vérifier côté serveur :

- la racine web pointe sur `site_web/` ;
- `site_web/cache/` est inscriptible par PHP ;
- `config.php` et `smtp-config.php` sont présents et hors du dépôt ;
- `display_errors` est à `Off` (c'est déjà le défaut du code) ;
- `robots.txt` interdit `/logged/`, `/php/` et `/vendor/`.
