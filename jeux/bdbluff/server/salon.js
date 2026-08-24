// ============================================================================
//  server/salon.js — toutes les règles de BDBluff : LE fichier important,
//  exactement comme salle.js pour l'Arène.
//
//  Un Salon = un objet en mémoire, une partie entre 3 et 6 joueurs. Piloté
//  par évènements (pas de boucle 20 Hz comme l'Arène — rien n'a besoin
//  d'être poussé en continu, seulement à chaque changement de phase).
//
//  Règle de sécurité qui traverse tout ce fichier : pendant la phase DESSIN,
//  aucune case en cours n'est jamais renvoyée à un autre joueur que son
//  propriétaire — ni au client qui l'a dessinée pour "confirmation publique",
//  ni surtout à l'imposteur qui pourrait s'en servir comme indice. Le
//  serveur ne diffuse la planche qu'à la révélation.
// ============================================================================

import crypto from "node:crypto";
import { Connexion } from "./ws.js";
import {
  PHASES,
  JOUEURS_MIN,
  JOUEURS_MAX,
  CASES_DEFAUT,
  TEMPS_PAR_CASE_DEFAUT,
  MANCHES_DEFAUT,
  CATEGORIES_THEME,
  TEMPS_VOTE,
  DUREE_REVELATION,
  DUREE_DEVINETTE,
  DUREE_PAUSE_RESULTATS,
  bornerCases,
  bornerTempsParCase,
  bornerManches,
  repartirCases,
  casesDe,
  dureeDessinPhase,
  caseValide,
  caseVide,
  tirerImposteur,
  depouillerVote,
  pointsManche,
  devinetteCorrecte,
} from "../public/shared.js";
import { tirerTheme } from "../public/themes.js";

// Un salon oublié (tout le monde parti) attend 5 minutes avant de se fermer
// — le temps qu'un joueur qui a fermé son onglet par erreur revienne.
const DUREE_GRACE_VIDE_MS = 5 * 60 * 1000;

const CATEGORIES_VALIDES = new Set(Object.values(CATEGORIES_THEME));

export class Salon {
  constructor(nom, onVide) {
    this.nom = nom;
    this.onVide = onVide;

    /** @type {Map<string, object>} id -> joueur */
    this.joueurs = new Map();
    this._ordreSuivant = 0;

    this.reglages = {
      cases: CASES_DEFAUT,
      tempsParCase: TEMPS_PAR_CASE_DEFAUT,
      manches: MANCHES_DEFAUT,
      categories: [CATEGORIES_THEME.FAMILIAL],
    };

    this.phase = PHASES.LOBBY;
    this.mancheCourante = 0;
    this.scoreParJoueur = new Map();
    this.restantsImposteur = [];
    this.chatHistorique = [];

    this.idImposteur = null;
    this.theme = null;
    this.proprietaires = [];
    this.contenusCases = [];
    this.votes = new Map();
    this.finPhase = 0;
    this._enAttenteDevinette = false;
    this._dernierResultatManche = null;

    this._minuterie = null;
    this._minuterieVidage = null;
  }

  /* ======================================================================
     Arrivée / départ
     ====================================================================== */

  /**
   * @param {Connexion} co
   * @param {string} pseudoPropre déjà nettoyé par server/index.js
   * @param {string} jetonBrut vide si première connexion
   */
  arrivee(co, pseudoPropre, jetonBrut) {
    if (jetonBrut) {
      const existant = [...this.joueurs.values()].find((j) => j.jeton === jetonBrut);
      if (existant) {
        this._reattacher(existant, co);
        return existant;
      }
    }

    if (this.phase !== PHASES.LOBBY) {
      co.envoyer(JSON.stringify({ t: "erreur", message: "La partie a déjà commencé." }));
      co.fermer(1000);
      return null;
    }

    if (this.joueurs.size >= JOUEURS_MAX) {
      co.envoyer(JSON.stringify({ t: "erreur", message: "Ce salon est complet." }));
      co.fermer(1000);
      return null;
    }

    const joueur = {
      id: crypto.randomUUID(),
      pseudo: pseudoPropre,
      jeton: crypto.randomBytes(24).toString("hex"),
      co,
      connecte: true,
      ordre: this._ordreSuivant++,
    };

    this.joueurs.set(joueur.id, joueur);
    this.scoreParJoueur.set(joueur.id, 0);
    co.surMessage = (texte) => this._surMessage(joueur, texte);
    co.surFermeture = () => this._surDeconnexion(joueur);

    clearTimeout(this._minuterieVidage);
    this._envoyer(joueur, { t: "bienvenue", id: joueur.id, jeton: joueur.jeton, chat: this.chatHistorique });
    this._diffuserSalon();
    return joueur;
  }

  _reattacher(joueur, co) {
    if (joueur.co && joueur.co.ouverte && joueur.co !== co) {
      joueur.co.fermer(1000); // un même joueur ne garde jamais deux connexions ouvertes
    }
    joueur.co = co;
    joueur.connecte = true;
    co.surMessage = (texte) => this._surMessage(joueur, texte);
    co.surFermeture = () => this._surDeconnexion(joueur);

    clearTimeout(this._minuterieVidage);
    this._envoyer(joueur, { t: "bienvenue", id: joueur.id, jeton: joueur.jeton, chat: this.chatHistorique });
    this._diffuserSalon();
    this._envoyerRattrapage(joueur);
  }

  _surDeconnexion(joueur) {
    joueur.connecte = false;
    this._diffuserSalon();

    if ([...this.joueurs.values()].every((j) => !j.connecte)) {
      clearTimeout(this._minuterieVidage);
      this._minuterieVidage = this._planifier(() => this.onVide(this), DUREE_GRACE_VIDE_MS / 1000);
    }

    // Ne pas laisser un vote bloqué en attente d'un fantôme.
    if (this.phase === PHASES.VOTE && !this._enAttenteDevinette) {
      const connectes = [...this.joueurs.values()].filter((j) => j.connecte).length;
      if (connectes > 0 && this.votes.size >= connectes) {
        clearTimeout(this._minuterie);
        this._resoudreVote();
      }
    }
  }

  /** Arrêt propre du salon (SIGTERM du serveur). */
  arreterBoucle() {
    clearTimeout(this._minuterie);
    clearTimeout(this._minuterieVidage);
  }

  /**
   * Seul point de passage pour un `setTimeout` de jeu — un test peut le
   * remplacer par une exécution immédiate pour vérifier une transition de
   * phase sans attendre le vrai délai (voir test/bdbluff.test.js).
   */
  _planifier(fn, secondes) {
    return setTimeout(fn, secondes * 1000);
  }

  /* ======================================================================
     Aides internes
     ====================================================================== */

  _idsOrdonnes() {
    return [...this.joueurs.values()].sort((a, b) => a.ordre - b.ordre).map((j) => j.id);
  }

  /** L'hôte est le joueur connecté depuis le plus longtemps — dynamique, pas figé. */
  hoteId() {
    const connectes = [...this.joueurs.values()].filter((j) => j.connecte).sort((a, b) => a.ordre - b.ordre);
    return connectes.length ? connectes[0].id : null;
  }

  _envoyer(joueur, objet) {
    if (joueur.co && joueur.co.ouverte) joueur.co.envoyer(JSON.stringify(objet));
  }

  /** Fabrique la trame une seule fois pour tout le monde — comme l'Arène. */
  _diffuserTous(objet) {
    const trame = Connexion.trameTexte(JSON.stringify(objet));
    for (const j of this.joueurs.values()) {
      if (j.co && j.co.ouverte) j.co.envoyerTrame(trame);
    }
  }

  _diffuserSalon() {
    const joueurs = this._idsOrdonnes().map((id) => {
      const j = this.joueurs.get(id);
      return { id: j.id, pseudo: j.pseudo, connecte: j.connecte, score: this.scoreParJoueur.get(id) ?? 0 };
    });
    this._diffuserTous({
      t: "salon",
      joueurs,
      hote: this.hoteId(),
      reglages: this.reglages,
      phase: this.phase,
      manche: this.mancheCourante,
      totalManches: this.reglages.manches,
    });
  }

  /** Renvoie à un joueur qui vient de se reconnecter l'état de la phase en cours. */
  _envoyerRattrapage(joueur) {
    if (this.phase === PHASES.DESSIN) {
      this._envoyer(joueur, {
        t: "debutManche",
        manche: this.mancheCourante,
        totalManches: this.reglages.manches,
        proprietaires: this.proprietaires,
        finPhase: this.finPhase,
        theme: joueur.id === this.idImposteur ? null : this.theme,
        casesDeMoi: casesDe(joueur.id, this.proprietaires),
        contenusExistants: casesDe(joueur.id, this.proprietaires).map((i) => ({ index: i, ...this.contenusCases[i] })),
      });
    } else if (this.phase === PHASES.REVELATION || this.phase === PHASES.VOTE) {
      this._envoyer(joueur, { t: "revelation", planche: this._planche() });
      if (this.phase === PHASES.VOTE) {
        this._envoyer(joueur, { t: "vote", finPhase: this.finPhase });
        if (this._enAttenteDevinette && joueur.id === this.idImposteur) {
          this._envoyer(joueur, { t: "demandeDevinette", finPhase: this.finPhase });
        }
      }
    } else if (this.phase === PHASES.RESULTATS_MANCHE && this._dernierResultatManche) {
      this._envoyer(joueur, this._dernierResultatManche);
    } else if (this.phase === PHASES.RESULTATS_PARTIE) {
      this._envoyer(joueur, { t: "resultatPartie", scores: Object.fromEntries(this.scoreParJoueur) });
    }
  }

  _planche() {
    return this.proprietaires.map((proprietaire, index) => ({
      index,
      proprietaire,
      contenu: this.contenusCases[index],
    }));
  }

  /* ======================================================================
     Messages entrants
     ====================================================================== */

  _surMessage(joueur, texte) {
    let msg;
    try {
      msg = JSON.parse(texte);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== "string") return;

    switch (msg.t) {
      case "reglages":
        this._surReglages(joueur, msg);
        break;
      case "exclure":
        this._surExclure(joueur, msg);
        break;
      case "lancer":
        this._surLancer(joueur);
        break;
      case "cases":
        this._surCases(joueur, msg);
        break;
      case "chat":
        this._surChat(joueur, msg);
        break;
      case "vote":
        this._surVote(joueur, msg);
        break;
      case "devinette":
        this._surDevinette(joueur, msg);
        break;
      case "rejouer":
        this._surRejouer(joueur);
        break;
      default:
        break;
    }
  }

  _surReglages(joueur, msg) {
    if (joueur.id !== this.hoteId() || this.phase !== PHASES.LOBBY) return;

    if (msg.cases !== undefined) this.reglages.cases = bornerCases(msg.cases);
    if (msg.tempsParCase !== undefined) this.reglages.tempsParCase = bornerTempsParCase(msg.tempsParCase);
    if (msg.manches !== undefined) this.reglages.manches = bornerManches(msg.manches);

    if (Array.isArray(msg.categories)) {
      const valides = [...new Set(msg.categories.filter((c) => CATEGORIES_VALIDES.has(c)))];
      if (valides.length > 0) this.reglages.categories = valides; // jamais vide : sinon plus de thème tirable
    }

    this._diffuserSalon();
  }

  _surExclure(joueur, msg) {
    if (joueur.id !== this.hoteId() || this.phase !== PHASES.LOBBY) return;
    const cible = this.joueurs.get(msg.id);
    if (!cible || cible.id === joueur.id) return;

    this.joueurs.delete(cible.id);
    this.scoreParJoueur.delete(cible.id);
    if (cible.co && cible.co.ouverte) {
      cible.co.envoyer(JSON.stringify({ t: "exclu" }));
      cible.co.fermer(1000);
    }
    this._diffuserSalon();
  }

  _surLancer(joueur) {
    if (joueur.id !== this.hoteId() || this.phase !== PHASES.LOBBY) return;
    if (this.joueurs.size < JOUEURS_MIN) return;

    this.mancheCourante = 0;
    this.restantsImposteur = [];
    for (const id of this.joueurs.keys()) this.scoreParJoueur.set(id, 0);
    this._demarrerManche();
  }

  _surCases(joueur, msg) {
    if (this.phase !== PHASES.DESSIN) return;
    if (!Array.isArray(msg.contenus)) return;

    for (const item of msg.contenus) {
      const idx = item?.index;
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.proprietaires.length) continue;
      if (this.proprietaires[idx] !== joueur.id) continue; // jamais la case d'un autre

      const contenu = { traits: item.traits, stickers: item.stickers };
      if (!caseValide(contenu)) continue;
      this.contenusCases[idx] = contenu;
    }
    // Volontairement pas de rediffusion : personne ne voit une case avant REVELATION.
  }

  _surChat(joueur, msg) {
    const texte = String(msg.texte ?? "")
      .replace(/[<>&"'\r\n\t]/g, "")
      .trim()
      .slice(0, 240);
    if (!texte) return;

    const entree = { id: joueur.id, pseudo: joueur.pseudo, texte, ts: Date.now() };
    this.chatHistorique.push(entree);
    if (this.chatHistorique.length > 50) this.chatHistorique.shift();
    this._diffuserTous({ t: "chat", ...entree });
  }

  _surVote(joueur, msg) {
    if (this.phase !== PHASES.VOTE || this._enAttenteDevinette) return;
    if (!joueur.connecte) return;

    const cible = msg.cible;
    if (typeof cible !== "string" || cible === joueur.id || !this.joueurs.has(cible)) return;

    this.votes.set(joueur.id, cible);
    this._diffuserTous({ t: "voteMaj", votants: [...this.votes.keys()] });

    const connectes = [...this.joueurs.values()].filter((j) => j.connecte).length;
    if (this.votes.size >= connectes) {
      clearTimeout(this._minuterie);
      this._resoudreVote();
    }
  }

  _surDevinette(joueur, msg) {
    if (!this._enAttenteDevinette || joueur.id !== this.idImposteur) return;
    clearTimeout(this._minuterie);
    const juste = devinetteCorrecte(String(msg.texte ?? ""), this.theme);
    this._finManche(juste);
  }

  _surRejouer(joueur) {
    if (joueur.id !== this.hoteId() || this.phase !== PHASES.RESULTATS_PARTIE) return;
    this.phase = PHASES.LOBBY;
    this.mancheCourante = 0;
    this._diffuserSalon();
  }

  /* ======================================================================
     Machine à états d'une manche
     ====================================================================== */

  _demarrerManche() {
    this.mancheCourante++;
    const idsJoueurs = this._idsOrdonnes();

    const { imposteur, restants } = tirerImposteur(idsJoueurs, this.restantsImposteur);
    this.idImposteur = imposteur;
    this.restantsImposteur = restants;

    this.theme = tirerTheme(this.reglages.categories);
    this.proprietaires = repartirCases(idsJoueurs, this.reglages.cases);
    this.contenusCases = this.proprietaires.map(() => caseVide());
    this.votes = new Map();
    this._enAttenteDevinette = false;
    this._dernierResultatManche = null;

    this.phase = PHASES.DESSIN;
    const duree = dureeDessinPhase(this.proprietaires, this.reglages.tempsParCase);
    this.finPhase = Date.now() + duree * 1000;

    for (const j of this.joueurs.values()) {
      this._envoyer(j, {
        t: "debutManche",
        manche: this.mancheCourante,
        totalManches: this.reglages.manches,
        proprietaires: this.proprietaires,
        finPhase: this.finPhase,
        theme: j.id === this.idImposteur ? null : this.theme,
        casesDeMoi: casesDe(j.id, this.proprietaires),
      });
    }

    this._minuterie = this._planifier(() => this._finDessin(), duree);
  }

  _finDessin() {
    this.phase = PHASES.REVELATION;
    this._diffuserTous({ t: "revelation", planche: this._planche() });
    this._minuterie = this._planifier(() => this._debutVote(), DUREE_REVELATION);
  }

  _debutVote() {
    this.phase = PHASES.VOTE;
    this.votes = new Map();
    this.finPhase = Date.now() + TEMPS_VOTE * 1000;
    this._diffuserTous({ t: "vote", finPhase: this.finPhase });
    this._minuterie = this._planifier(() => this._resoudreVote(), TEMPS_VOTE);
  }

  _resoudreVote() {
    const votesConnectes = new Map([...this.votes].filter(([id]) => this.joueurs.get(id)?.connecte));
    const resultat = depouillerVote(votesConnectes, this.idImposteur);
    this._diffuserTous({ t: "resultatVote", ...resultat });

    if (resultat.demasque) {
      this._enAttenteDevinette = true;
      this.finPhase = Date.now() + DUREE_DEVINETTE * 1000;
      const imposteur = this.joueurs.get(this.idImposteur);
      if (imposteur) this._envoyer(imposteur, { t: "demandeDevinette", finPhase: this.finPhase });
      this._minuterie = this._planifier(() => this._finManche(false), DUREE_DEVINETTE);
    } else {
      this._finManche(true); // pas démasqué (égalité ou vote sur un innocent) : l'imposteur gagne direct
    }
  }

  _finManche(imposteurGagne) {
    this._enAttenteDevinette = false;
    const idsJoueurs = this._idsOrdonnes();
    const deltas = pointsManche(idsJoueurs, this.idImposteur, imposteurGagne);
    for (const { id, delta } of deltas) {
      this.scoreParJoueur.set(id, (this.scoreParJoueur.get(id) ?? 0) + delta);
    }

    this.phase = PHASES.RESULTATS_MANCHE;
    const resultat = {
      t: "resultatManche",
      imposteur: this.idImposteur,
      theme: this.theme,
      imposteurGagne,
      scores: Object.fromEntries(this.scoreParJoueur),
    };
    this._dernierResultatManche = resultat;
    this._diffuserTous(resultat);

    const derniere = this.mancheCourante >= this.reglages.manches;
    this._minuterie = this._planifier(() => {
      if (derniere) this._finPartie();
      else this._demarrerManche();
    }, DUREE_PAUSE_RESULTATS);
  }

  _finPartie() {
    this.phase = PHASES.RESULTATS_PARTIE;
    this._diffuserTous({ t: "resultatPartie", scores: Object.fromEntries(this.scoreParJoueur) });
  }
}
