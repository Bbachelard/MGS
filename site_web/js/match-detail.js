/* ============================================================
   MY GAMERS STATS — match-detail.js

   Rendu enrichi de la carte joueur :
     - mgsHighlights(list)    encadrés du haut (rangs, V/D, temps...)
     - mgsSections(sections)  sections de la carte, dont l'historique
                              de parties dépliable

   Ce fichier ne dépend de rien et n'écrase rien. stats-display.js
   l'appelle s'il est présent, et retombe sur son ancien rendu sinon.
   À charger AVANT stats-display.js.
   ============================================================ */

(function (window, document) {
    'use strict';

    /* --------------------------------------------------------
       Réglages
       -------------------------------------------------------- */

    var CONFIG = {
        // Un seul détail ouvert à la fois (comportement OP.GG).
        accordion: true,

        // Clic sur une icône du détail = agrandissement dans la modale.
        zoom: true,

        // Noms des autres joueurs cliquables (relance une recherche).
        // Désactivé : chaque clic déclenche une résolution + un appel Riot.
        playerLinks: false,

        // Endpoint de pagination.
        endpoint: '/php/matches.php'
    };

    window.MGS_MATCHES_CONFIG = CONFIG;


    /* --------------------------------------------------------
       Utilitaires
       -------------------------------------------------------- */

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** N'autorise que http(s) et les chemins internes. */
    function url(value) {
        var v = String(value || '').trim();

        if (/^https?:\/\//i.test(v)) {
            return v;
        }

        return /^\/[^/\\]/.test(v) ? v : '';
    }

    /** Empêche l'injection de CSS par la valeur d'accent. */
    function color(value) {
        return /^#[0-9a-f]{3,8}$/i.test(String(value || '').trim())
            ? String(value).trim()
            : '';
    }

    function nb(value, decimals) {
        var n = Number(value);

        if (!isFinite(n)) {
            return '-';
        }

        return n.toLocaleString('fr-FR', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0
        });
    }

    /** 1908 -> "31:48" */
    function duree(secondes) {
        var s = Math.max(0, Number(secondes) || 0);
        var m = Math.floor(s / 60);

        return m + ':' + String(s % 60).padStart(2, '0');
    }

    /** Timestamp (secondes) -> "il y a 3 j" */
    function depuis(timestamp) {
        var t = Number(timestamp) || 0;

        if (t <= 0) {
            return '';
        }

        var ecart = Math.max(0, Math.floor(Date.now() / 1000 - t));

        if (ecart < 3600)   { return 'il y a ' + Math.max(1, Math.floor(ecart / 60)) + ' min'; }
        if (ecart < 86400)  { return 'il y a ' + Math.floor(ecart / 3600) + ' h'; }
        if (ecart < 2592000){ return 'il y a ' + Math.floor(ecart / 86400) + ' j'; }

        return 'il y a ' + Math.floor(ecart / 2592000) + ' mois';
    }

    var UID = 0;

    function uid() {
        UID += 1;
        return 'mgsm' + UID;
    }


    /* --------------------------------------------------------
       Icônes SVG

       Tracés uniquement : le <svg> englobant est ajouté par icon(),
       ce qui garantit une taille et une couleur homogènes partout.
       -------------------------------------------------------- */

    var ICONS = {
        level:    '<path d="m7 14 5-5 5 5"/><path d="m7 9 5-5 5 5"/>',
        rank:     '<path d="M12 3.5l7 2.8V12c0 4-3 6.6-7 8.5-4-1.9-7-4.5-7-8.5V6.3l7-2.8z"/>',
        lp:       '<path d="M12 20V4"/><path d="m6 10 6-6 6 6"/>',
        win:      '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.6 2.6 5-6"/>',
        loss:     '<circle cx="12" cy="12" r="8.5"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
        winrate:  '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
        form:     '<path d="M3 12h3.5l2.5 6 4-13 2.5 7H21"/>',
        time:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2"/>',
        games:    '<rect x="2.5" y="6.5" width="19" height="11" rx="4"/><path d="M7 12h3.5M8.75 10.25v3.5M16 11h.01M18 14h.01"/>',
        total:    '<path d="M12 3.5 20 8l-8 4.5L4 8l8-4.5z"/><path d="m4 13 8 4.5 8-4.5"/>',
        cs:       '<path d="M12 20.5V13"/><path d="M12 13c0-3.3 2.2-5.5 5.5-5.5C17.5 10.8 15.3 13 12 13z"/><path d="M12 13c0-3.3-2.2-5.5-5.5-5.5C6.5 10.8 8.7 13 12 13z"/>',
        gold:     '<circle cx="12" cy="12" r="8"/><path d="M12 7.5v9M9.5 10h5M9.5 13.5h5"/>',
        damage:   '<path d="M14.5 3.5H20v5.5L9.5 20 4 14.5 14.5 3.5z"/><path d="m8 12.5 3.5 3.5"/>',
        shield:   '<path d="M12 3.5l7 2.8V12c0 4-3 6.6-7 8.5-4-1.9-7-4.5-7-8.5V6.3l7-2.8z"/>',
        vision:   '<path d="M2.5 12S6.3 6 12 6s9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
        baron:    '<path d="M3.5 18.5h17l-2-9.5-4 4-2.5-6.5L9.5 13l-4-4-2 9.5z"/>',
        dragon:   '<path d="M12 3.5c3.2 4.2 5.2 6.2 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-3 2-5 5.2-9.2z"/>',
        tower:    '<path d="M7 20.5V9l5-5 5 5v11.5"/><path d="M7 13.5h10"/>',
        chevron:  '<path d="m6 9.5 6 6 6-6"/>'
    };

    function icon(name, extra) {
        if (!ICONS[name]) {
            return '';
        }

        return '<svg class="mgs-i' + (extra ? ' ' + extra + '' : '') + '"'
             + ' viewBox="0 0 24 24" fill="none" stroke="currentColor"'
             + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
             + ' aria-hidden="true" focusable="false">'
             + ICONS[name]
             + '</svg>';
    }


    /* --------------------------------------------------------
       Encadrés du haut de carte
       -------------------------------------------------------- */

    function highlight(box) {
        if (!box) {
            return '';
        }

        var tone   = ['win', 'loss', 'neutral'].indexOf(box.tone) >= 0 ? box.tone : '';
        var accent = color(box.accent);
        var image  = url(box.image);

        var media = image
            ? '<img class="info-emblem" src="' + esc(image) + '" alt="" loading="lazy"'
              + ' onerror="this.style.display=\'none\'">'
            : icon(box.icon);

        var bar = '';

        if (typeof box.bar === 'number' && isFinite(box.bar)) {
            var pct = Math.max(0, Math.min(100, box.bar));
            bar = '<span class="info-bar" role="presentation">'
                + '<i style="width:' + pct.toFixed(0) + '%"></i></span>';
        }

        var dots = '';

        if (Array.isArray(box.dots) && box.dots.length) {
            dots = '<span class="info-dots">' + box.dots.map(function (d) {
                var cls = d === 'V' ? 'is-win' : (d === 'D' ? 'is-loss' : 'is-draw');
                return '<i class="' + cls + '" title="' + esc(d === 'V' ? 'Victoire' : (d === 'D' ? 'Défaite' : 'Remake')) + '"></i>';
            }).join('') + '</span>';
        }

        return '<div class="info-box info-box--rich'
             + (tone ? ' info-box--' + tone : '')
             + (media ? '' : ' info-box--plain') + '"'
             + (accent ? ' style="--mgs-accent:' + accent + '"' : '') + '>'
             + '<span class="info-head">'
             +    (media ? '<span class="info-media">' + media + '</span>' : '')
             +    '<span class="info-label">' + esc(box.label) + '</span>'
             + '</span>'
             + '<span class="info-value">' + esc(box.value === null || box.value === undefined ? '-' : box.value) + '</span>'
             + (box.sub ? '<span class="info-sub">' + esc(box.sub) + '</span>' : '')
             + bar
             + dots
             + (box.hint ? '<span class="info-hint">' + esc(box.hint) + '</span>' : '')
             + '</div>';
    }

    function mgsHighlights(list) {
        return (list || []).map(highlight).join('');
    }


    /* --------------------------------------------------------
       Registre : les données brutes ne transitent pas par le DOM
       -------------------------------------------------------- */

    var STORE = {};

    function store(section) {
        var id = uid();

        STORE[id] = {
            assets:     section.assets || {},
            context:    section.context || {},
            pagination: section.pagination || {},
            matches:    (section.items || []).slice(),
            nextStart:  Number((section.pagination || {}).loaded || (section.items || []).length) || 0,
            hasMore:    !!(section.pagination || {}).hasMore,
            max:        Number((section.pagination || {}).max || 100),
            page:       Number((section.pagination || {}).page || 5),
            initial:    (section.items || []).length,
            chargement: false
        };

        return id;
    }


    /* --------------------------------------------------------
       Sections
       -------------------------------------------------------- */

    /**
     * Une ligne de liste. image / badge / bar sont optionnels : sans eux,
     * on retombe très exactement sur l'ancien rendu (Steam, Epic).
     */
    function ligneListe(item) {
        var image = url(item.image);
        var badge = item.badge || null;
        var bar   = Number(item.bar) || 0;

        if (!image && !badge && !bar) {
            return '<li>' + esc(item.name) + ' <span>' + esc(item.value || '') + '</span></li>';
        }

        var crest = badge
            ? '<img class="mgs-list-crest" src="' + esc(url(badge.image)) + '" alt=""'
              + ' title="' + esc(badge.title || '') + '" loading="lazy"'
              + ' onerror="this.classList.add(\'is-empty\')">'
              + '<em class="mgs-list-lvl" title="' + esc(badge.title || '') + '">'
              + esc(badge.text || '') + '</em>'
            : '';

        var media = '<span class="mgs-list-media">'
                  + (image
                        ? '<img class="mgs-list-icon" src="' + esc(image) + '" alt="" loading="lazy"'
                          + ' onerror="this.classList.add(\'is-broken\')">'
                        : '<span class="mgs-list-icon is-broken"></span>')
                  + crest
                  + '</span>';

        var jauge = bar > 0
            ? '<span class="mgs-list-bar"><i style="width:'
              + Math.max(0, Math.min(100, bar)).toFixed(1) + '%"></i></span>'
            : '';

        return '<li class="mgs-list-row">'
             + media
             + '<span class="mgs-list-text">'
             +   '<b class="mgs-list-name">' + esc(item.name) + '</b>'
             +   jauge
             + '</span>'
             + '<span class="mgs-list-value">' + esc(item.value || '') + '</span>'
             + '</li>';
    }

    function sectionListe(section) {
        var items = (section.items || []).map(function (item) {
            return ligneListe(item);
        }).join('');

        // Variante purement cosmétique, filtrée pour ne pas injecter de classe.
        var variante = /^[a-z-]+$/.test(String(section.variant || ''))
            ? ' recent-games-box--' + section.variant
            : '';

        return '<div class="recent-games-box' + variante + '">'
             + '<span class="info-label">' + esc(section.title) + '</span>'
             + '<ul class="recent-games-list">'
             + (items || '<li>' + esc(section.empty || 'Aucune donnée') + '</li>')
             + '</ul>'
             + '</div>';
    }

    function sectionParties(section) {
        var id  = store(section);
        var st  = STORE[id];
        var res = resume(st.matches);

        var lignes = st.matches.map(function (m, i) {
            return ligne(m, st.assets, i);
        }).join('');

        if (!lignes) {
            return '<div class="recent-games-box mgs-matches mgs-matches--empty">'
                 + '<span class="info-label">' + esc(section.title) + '</span>'
                 + '<p class="mgs-empty">' + esc(section.empty || 'Aucune partie récente') + '</p>'
                 + '</div>';
        }

        return '<div class="recent-games-box mgs-matches" data-mgs="' + id + '">'
             + '<div class="mgs-matches-head">'
             +   '<span class="info-label">' + esc(section.title) + '</span>'
             +   '<span class="mgs-matches-meta">' + res + '</span>'
             + '</div>'
             + '<div class="mgs-matches-list">' + lignes + '</div>'
             + actions(st)
             + '</div>';
    }

    function resume(matches) {
        if (!matches.length) {
            return '';
        }

        var v = 0;
        var d = 0;

        matches.forEach(function (m) {
            if (m.remake) { return; }
            if (m.win) { v += 1; } else { d += 1; }
        });

        var total = v + d;
        var wr    = total ? Math.round(v / total * 100) : 0;

        return matches.length + ' parties · '
             + '<b class="is-win">' + v + 'V</b> '
             + '<b class="is-loss">' + d + 'D</b> · '
             + wr + ' %';
    }

    /** Pied du bloc : « voir plus » et/ou « afficher moins », re-rendu à chaque fois. */
    function actions(st) {
        var html = '';

        if (st.hasMore && st.nextStart < st.max) {
            html += '<button type="button" class="mgs-more js-mgs-more">'
                  + 'Voir ' + st.page + ' parties de plus'
                  + '</button>';
        }

        var repliables = Math.min(st.page, st.matches.length - st.initial);

        if (repliables > 0) {
            html += '<button type="button" class="mgs-more mgs-more--less js-mgs-less">'
                  + 'Afficher ' + repliables + ' parties de moins'
                  + '</button>';
        }

        return '<div class="mgs-actions">' + html + '</div>';
    }

    /** Résumé + pied à resynchroniser après tout ajout ou repli. */
    function majBloc(ctx) {
        var meta = ctx.el.querySelector('.mgs-matches-meta');

        if (meta) {
            meta.innerHTML = resume(ctx.st.matches);
        }

        var pied = ctx.el.querySelector('.mgs-actions');

        if (pied) {
            pied.outerHTML = actions(ctx.st);
        }
    }

    function mgsSections(sections) {
        return (sections || []).map(function (section) {
            if (!section) {
                return '';
            }

            return section.type === 'matches'
                ? sectionParties(section)
                : sectionListe(section);
        }).join('');
    }


    /* --------------------------------------------------------
       Une partie : ligne de résumé
       -------------------------------------------------------- */

    function imgChampion(assets, participant, taille) {
        var src = url((assets.champion || '') + encodeURIComponent(participant.champion || 'None') + '.png');

        return '<img class="mgs-champ mgs-champ--' + (taille || 'md') + '"'
             + ' src="' + esc(src) + '"'
             + ' alt="' + esc(participant.champLabel || '') + '"'
             + ' title="' + esc(participant.champLabel || '') + '"'
             + ' loading="lazy" onerror="this.classList.add(\'is-broken\')">';
    }

    function imgSorts(assets, participant, zoomable) {
        return '<span class="mgs-spells">' + (participant.spells || []).map(function (s) {
            if (!s || !s.key) {
                return '<span class="mgs-mini is-empty"></span>';
            }

            return '<img class="mgs-mini' + (zoomable ? ' mgs-zoom' : '') + '"'
                 + ' src="' + esc(url((assets.spell || '') + encodeURIComponent(s.key) + '.png')) + '"'
                 + ' alt="" title="' + esc(s.name || '') + '" loading="lazy"'
                 + ' onerror="this.classList.add(\'is-empty\')">';
        }).join('') + '</span>';
    }

    function imgRunes(assets, participant, zoomable) {
        var p = participant.perks || {};

        var un = p.keystone
            ? '<img class="mgs-mini mgs-mini--rune' + (zoomable ? ' mgs-zoom' : '') + '"'
              + ' src="' + esc(url((assets.perk || '') + p.keystone)) + '"'
              + ' alt="" title="' + esc(p.name || '') + '" loading="lazy"'
              + ' onerror="this.classList.add(\'is-empty\')">'
            : '<span class="mgs-mini is-empty"></span>';

        var deux = p.style
            ? '<img class="mgs-mini mgs-mini--rune' + (zoomable ? ' mgs-zoom' : '') + '"'
              + ' src="' + esc(url((assets.perk || '') + p.style)) + '"'
              + ' alt="" loading="lazy" onerror="this.classList.add(\'is-empty\')">'
            : '<span class="mgs-mini is-empty"></span>';

        return '<span class="mgs-runes">' + un + deux + '</span>';
    }

    function imgItems(assets, participant, zoomable) {
        var items = participant.items || [];

        var cases = items.map(function (it, index) {
            var trinket = index === 6 ? ' mgs-item--trinket' : '';

            if (!it || !it.id) {
                return '<span class="mgs-item mgs-item--empty' + trinket + '"></span>';
            }

            return '<img class="mgs-item' + trinket + (zoomable ? ' mgs-zoom' : '') + '"'
                 + ' src="' + esc(url((assets.item || '') + encodeURIComponent(it.id) + '.png')) + '"'
                 + ' alt="" title="' + esc(it.name || '') + '" loading="lazy"'
                 + ' onerror="this.classList.add(\'mgs-item--empty\')">';
        }).join('');

        return '<span class="mgs-items">' + cases + '</span>';
    }

    function ligne(m, assets, index) {
        var me    = m.me || {};
        var etat  = m.remake ? 'draw' : (m.win ? 'win' : 'loss');

        var stats = '<span class="mgs-stat" title="Sbires tués">'
                  +   icon('cs') + nb(me.cs) + '<em>(' + esc(me.csMin || '0') + '/min)</em>'
                  + '</span>'
                  + '<span class="mgs-stat" title="Or gagné">' + icon('gold') + nb(me.gold) + '</span>'
                  + '<span class="mgs-stat" title="Dégâts aux champions">' + icon('damage') + nb(me.damage) + '</span>'
                  + '<span class="mgs-stat" title="Score de vision">' + icon('vision') + nb(me.vision) + '</span>';

        return '<article class="mgs-match mgs-match--' + etat + '" data-index="' + index + '">'
             + '<button type="button" class="mgs-match-head" aria-expanded="false"'
             +   ' aria-label="Détail de la partie ' + esc(me.champLabel || '') + '">'

             +   '<span class="mgs-col mgs-col--meta">'
             +     '<span class="mgs-queue">' + esc(m.queue || 'Partie') + '</span>'
             +     '<span class="mgs-ago">' + esc(depuis(m.endedAt)) + '</span>'
             +     '<span class="mgs-outcome">' + esc(m.outcome || '') + '</span>'
             +     '<span class="mgs-duration">' + esc(duree(m.duration)) + '</span>'
             +   '</span>'

             +   '<span class="mgs-col mgs-col--champ">'
             +     '<span class="mgs-portrait">'
             +       imgChampion(assets, me, 'md')
             +       '<span class="mgs-champ-level">' + esc(me.level || 0) + '</span>'
             +     '</span>'
             +     '<span class="mgs-loadout">'
             +       imgSorts(assets, me, false)
             +       imgRunes(assets, me, false)
             +     '</span>'
             +   '</span>'

             +   '<span class="mgs-col mgs-col--kda">'
             +     '<span class="mgs-kda">'
             +       '<b>' + esc(me.k) + '</b> / <b class="is-deaths">' + esc(me.d) + '</b> / <b>' + esc(me.a) + '</b>'
             +     '</span>'
             +     '<span class="mgs-kda-ratio">'
             +       (me.perfect ? 'KDA parfait' : esc(me.kda) + ' : 1 KDA')
             +     '</span>'
             +   '</span>'

             +   '<span class="mgs-col mgs-col--stats">' + stats + '</span>'
             +   '<span class="mgs-col mgs-col--items">' + imgItems(assets, me, false) + '</span>'
             +   '<span class="mgs-chevron">' + icon('chevron') + '</span>'

             + '</button>'
             + '<div class="mgs-match-detail" hidden></div>'
             + '</article>';
    }


    /* --------------------------------------------------------
       Une partie : tableau détaillé (construit au 1er dépliage)
       -------------------------------------------------------- */

    function objectifs(team) {
        var o = team.objectives || {};

        var lignes = [
            ['baron',  'Nashor',   o.baron],
            ['dragon', 'Dragons',  o.dragon],
            ['tower',  'Tourelles', o.tower]
        ];

        return '<span class="mgs-objectives">' + lignes.map(function (l) {
            return '<span class="mgs-objective" title="' + esc(l[1]) + '">'
                 + icon(l[0]) + (Number(l[2]) || 0)
                 + '</span>';
        }).join('') + '</span>';
    }

    function nomJoueur(p) {
        var nom = esc(p.name || '?');
        var tag = p.tag ? '<em>#' + esc(p.tag) + '</em>' : '';

        return '<span class="mgs-player-name' + (p.me ? ' is-me' : '') + '">' + nom + tag + '</span>';
    }

    function barre(valeur, max, variante) {
        var pct = max > 0 ? Math.max(0, Math.min(100, valeur / max * 100)) : 0;

        return '<span class="mgs-bar mgs-bar--' + variante + '">'
             + '<i style="width:' + pct.toFixed(1) + '%"></i>'
             + '<em>' + nb(valeur) + '</em>'
             + '</span>';
    }

    function rangJoueur(p, assets, maxDamage) {
        return '<tr class="mgs-row' + (p.me ? ' is-me' : '') + '">'

             + '<th scope="row" class="mgs-cell-player">'
             +   '<span class="mgs-player">'
             +     '<span class="mgs-portrait mgs-portrait--sm">'
             +       imgChampion(assets, p, 'sm')
             +       '<span class="mgs-champ-level">' + esc(p.level || 0) + '</span>'
             +     '</span>'
             +     imgSorts(assets, p, CONFIG.zoom)
             +     imgRunes(assets, p, CONFIG.zoom)
             +     '<span class="mgs-player-id">'
             +       nomJoueur(p)
             +       '<span class="mgs-player-role">' + esc(p.position || p.champLabel || '') + '</span>'
             +     '</span>'
             +   '</span>'
             + '</th>'

             + '<td class="mgs-cell-kda">'
             +   '<b>' + esc(p.k) + '/' + esc(p.d) + '/' + esc(p.a) + '</b>'
             +   '<em>' + (p.perfect ? 'parfait' : esc(p.kda)) + '</em>'
             + '</td>'

             + '<td class="mgs-cell-damage">'
             +   barre(p.damage, maxDamage, 'damage')
             +   barre(p.taken, maxDamage, 'taken')
             + '</td>'

             + '<td class="mgs-cell-cs">' + nb(p.cs) + '<em>' + esc(p.csMin || '') + '/min</em></td>'
             + '<td class="mgs-cell-vision">' + nb(p.vision) + '</td>'
             + '<td class="mgs-cell-gold">' + nb(p.gold) + '</td>'
             + '<td class="mgs-cell-items">' + imgItems(assets, p, CONFIG.zoom) + '</td>'
             + '</tr>';
    }

    function tableauEquipe(team, assets, maxDamage) {
        return '<table class="mgs-scoreboard mgs-scoreboard--'
             + (team.win ? 'win' : 'loss') + '">'

             + '<caption class="mgs-team-head">'
             +   '<span class="mgs-team-name">' + icon(team.win ? 'win' : 'loss')
             +     esc(team.label) + ' — ' + (team.win ? 'victoire' : 'défaite') + '</span>'
             +   '<span class="mgs-team-kda">' + esc(team.kills) + ' / ' + esc(team.deaths) + ' / ' + esc(team.assists) + '</span>'
             +   '<span class="mgs-team-gold">' + icon('gold') + nb(team.gold) + '</span>'
             +   objectifs(team)
             + '</caption>'

             + '<thead><tr>'
             +   '<th scope="col">Joueur</th>'
             +   '<th scope="col">K/D/A</th>'
             +   '<th scope="col">Dégâts · subis</th>'
             +   '<th scope="col">CS</th>'
             +   '<th scope="col">Vision</th>'
             +   '<th scope="col">Or</th>'
             +   '<th scope="col">Objets</th>'
             + '</tr></thead>'

             + '<tbody>'
             + (team.players || []).map(function (p) {
                   return rangJoueur(p, assets, maxDamage);
               }).join('')
             + '</tbody>'
             + '</table>';
    }

    function detail(m, assets) {
        if (!m.detailed || !(m.teams || []).length) {
            return '<p class="mgs-empty">'
                 + 'Le détail complet n\'est pas encore disponible pour ce mode de jeu ('
                 + esc(m.queue || 'mode inconnu') + ').'
                 + '</p>';
        }

        var max = Number(m.maxDamage) || 0;

        return '<div class="mgs-scroll">'
             + (m.teams || []).map(function (t) {
                   return tableauEquipe(t, assets, max);
               }).join('')
             + '</div>';
    }


    /* --------------------------------------------------------
       Interactions (déléguées : rien à rebrancher après un rendu)
       -------------------------------------------------------- */

    function bloc(el) {
        var conteneur = el.closest('.mgs-matches');

        if (!conteneur) {
            return null;
        }

        var st = STORE[conteneur.getAttribute('data-mgs')];

        return st ? { el: conteneur, st: st } : null;
    }

    function ouvrir(article) {
        var ctx = bloc(article);

        if (!ctx) {
            return;
        }

        var head  = article.querySelector('.mgs-match-head');
        var panel = article.querySelector('.mgs-match-detail');
        var ouvert = article.classList.contains('is-open');

        if (CONFIG.accordion) {
            ctx.el.querySelectorAll('.mgs-match.is-open').forEach(function (autre) {
                if (autre === article) {
                    return;
                }

                autre.classList.remove('is-open');
                autre.querySelector('.mgs-match-head').setAttribute('aria-expanded', 'false');
                autre.querySelector('.mgs-match-detail').hidden = true;
            });
        }

        if (ouvert) {
            article.classList.remove('is-open');
            head.setAttribute('aria-expanded', 'false');
            panel.hidden = true;
            return;
        }

        // Construction paresseuse : on ne dessine 10 joueurs que si on regarde.
        if (!panel.dataset.built) {
            var index = Number(article.getAttribute('data-index'));
            var match = ctx.st.matches[index];

            panel.innerHTML = match ? detail(match, ctx.st.assets) : '';
            panel.dataset.built = '1';
        }

        panel.hidden = false;
        article.classList.add('is-open');
        head.setAttribute('aria-expanded', 'true');
    }

    async function voirPlus(bouton) {
        var ctx = bloc(bouton);

        if (!ctx || ctx.st.chargement) {
            return;
        }

        var st = ctx.st;

        st.chargement = true;
        bouton.disabled = true;
        bouton.classList.add('is-loading');
        bouton.textContent = 'Chargement…';

        try {
            var params = new URLSearchParams({
                platform:  st.context.platform || 'riot',
                accountId: st.context.accountId || '',
                start:     String(st.nextStart),
                count:     String(st.page)
            });

            var reponse = await fetch(CONFIG.endpoint + '?' + params.toString());
            var data    = await reponse.json();

            if (!reponse.ok || data.error) {
                throw new Error(data.error || ('HTTP ' + reponse.status));
            }

            var nouvelles = data.matches || [];
            var liste     = ctx.el.querySelector('.mgs-matches-list');
            var assets    = data.assets || st.assets;

            st.assets = assets;

            var html = nouvelles.map(function (m) {
                var index = st.matches.push(m) - 1;
                return ligne(m, assets, index);
            }).join('');

            liste.insertAdjacentHTML('beforeend', html);

            st.nextStart += Number(data.count || nouvelles.length);
            st.hasMore    = !!data.hasMore && st.nextStart < st.max;

            majBloc(ctx);

        } catch (err) {
            console.error('Chargement des parties impossible :', err);

            bouton.textContent = 'Échec du chargement — réessayer';
            bouton.disabled = false;
            bouton.classList.add('is-error');

        } finally {
            st.chargement = false;
            bouton.classList.remove('is-loading');
        }
    }

    function voirMoins(bouton) {
        var ctx = bloc(bouton);

        if (!ctx || ctx.st.chargement) {
            return;
        }

        var st = ctx.st;
        var n  = Math.min(st.page, st.matches.length - st.initial);

        if (n <= 0) {
            return;
        }

        var liste = ctx.el.querySelector('.mgs-matches-list');

        for (var i = 0; i < n; i++) {
            st.matches.pop();

            if (liste.lastElementChild) {
                liste.removeChild(liste.lastElementChild);
            }
        }

        // On dépile par la fin : les data-index déjà posés restent valides.
        st.nextStart = Math.max(st.initial, st.nextStart - n);
        st.hasMore   = true;

        majBloc(ctx);

        var pied = ctx.el.querySelector('.mgs-actions');

        if (pied) {
            pied.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    document.addEventListener('click', function (e) {
        var zoom = CONFIG.zoom ? e.target.closest('.mgs-zoom') : null;

        if (zoom) {
            e.preventDefault();
            e.stopPropagation();

            if (typeof window.openImageModal === 'function') {
                window.openImageModal(zoom.src);
            }

            return;
        }

        var plus = e.target.closest('.js-mgs-more');

        if (plus) {
            e.preventDefault();
            voirPlus(plus);
            return;
        }
        var moins = e.target.closest('.js-mgs-less');

        if (moins) {
            e.preventDefault();
            voirMoins(moins);
            return;
        }

        var head = e.target.closest('.mgs-match-head');

        if (head) {
            e.preventDefault();
            ouvrir(head.closest('.mgs-match'));
        }
    });


    /* --------------------------------------------------------
       Exports
       -------------------------------------------------------- */

    window.mgsHighlights = mgsHighlights;
    window.mgsSections   = mgsSections;

}(window, document));