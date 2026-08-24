// ============================================================================
//  test/bdbluff.test.js — se lance avec `npm test`, sans rien installer.
//
//  Même esprit que test/arene.test.js : un harnais maison (pas de
//  `node --test`), des règles de jeu vérifiées SANS réseau en pilotant
//  directement server/salon.js (fausses connexions, méthodes de phase
//  appelées à la main — `_finDessin()`, `_debutVote()`, `_resoudreVote()`…
//  — jamais en attendant un vrai minuteur), puis quelques tests
//  bout-en-bout qui démarrent le vrai serveur.
// ============================================================================

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Salon } from "../server/salon.js";
import {
  PHASES,
  CASES_MIN,
  CASES_MAX,
  TEMPS_PAR_CASE_MAX,
  MANCHES_MAX,
  CATEGORIES_THEME,
  CASE_TRAITS_MAX,
  bornerCases,
  bornerTempsParCase,
  bornerManches,
  repartirCases,
  casesDe,
  dureeDessinPhase,
  caseValide,
  tirerImposteur,
  depouillerVote,
  pointsManche,
  devinetteCorrecte,
} from "../public/shared.js";
import { tirerTheme, THEMES } from "../public/themes.js";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;

let reussis = 0;
let echecs = 0;

function verifier(titre, condition, detail = "") {
  if (condition) {
    reussis++;
    console.log(`  ok   ${titre}${detail ? "  — " + detail : ""}`);
  } else {
    echecs++;
    console.log(`  ÉCHEC ${titre}${detail ? "  — " + detail : ""}`);
  }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
   Outillage « hors réseau »
   ========================================================================== */

/** Décode une trame WS texte fabriquée par Connexion.trameTexte (non masquée). */
function decoderTrame(trame) {
  const taille1 = trame[1] & 0x7f;
  let taille = taille1;
  let pos = 2;
  if (taille1 === 126) {
    taille = trame.readUInt16BE(2);
    pos = 4;
  } else if (taille1 === 127) {
    taille = Number(trame.readBigUInt64BE(2));
    pos = 10;
  }
  return trame.subarray(pos, pos + taille).toString("utf8");
}

/** Une connexion factice : le salon écrit dedans, le test relit `.envoye`. */
function fausseConnexion() {
  return {
    ouverte: true,
    envoye: [],
    surMessage: null,
    surFermeture: null,
    envoyer(texte) {
      this.envoye.push(JSON.parse(texte));
    },
    envoyerTrame(trame) {
      this.envoye.push(JSON.parse(decoderTrame(trame)));
    },
    fermer() {
      if (!this.ouverte) return;
      this.ouverte = false;
      this.surFermeture?.();
    },
  };
}

function dernierMessage(co, type) {
  const filtres = co.envoye.filter((m) => m.t === type);
  return filtres.length ? filtres[filtres.length - 1] : undefined;
}

/**
 * Un salon avec de VRAIS minuteurs (comme en production) : chaque test fait
 * avancer les phases à la main en appelant directement `_finDessin()`,
 * `_debutVote()`, `_resoudreVote()`… — jamais en attendant un minuteur. Les
 * minuteurs réels restent donc en sommeil pendant tout le test (ils ne
 * seront jamais laissés assez longtemps pour se déclencher), d'où l'appel à
 * `arreterBoucle()` en fin de bloc pour ne rien laisser traîner.
 */
function nouveauSalon(nom = "test") {
  return new Salon(nom, () => {});
}

function ajouterJoueurs(salon, noms) {
  return noms.map((nom) => salon.arrivee(fausseConnexion(), nom, ""));
}

/** Fait avancer tous les tours de mise en route à la main, jusqu'au dessin privé. */
function passerMiseEnRoute(salon) {
  while (salon.phase === PHASES.MISE_EN_ROUTE) salon._demarrerTourMiseEnRoute();
}

/* ==========================================================================
   1. Fonctions pures de shared.js
   ========================================================================== */

console.log("\nRépartition des cases (round-robin)");
{
  const proprietaires = repartirCases(["a", "b", "c"], 7);
  verifier("7 cases / 3 joueurs suit le motif a,b,c,a,b,c,a", proprietaires.join(",") === "a,b,c,a,b,c,a");

  const comptesParJoueur = (props, ids) => ids.map((id) => casesDe(id, props).length);
  const comptes = comptesParJoueur(repartirCases(["a", "b", "c", "d"], 6), ["a", "b", "c", "d"]);
  verifier("6 cases / 4 joueurs : écart d'au plus 1", Math.max(...comptes) - Math.min(...comptes) <= 1, comptes.join(","));

  let adjacentsIdentiques = false;
  const props2 = repartirCases(["a", "b", "c", "d", "e"], 8);
  for (let i = 1; i < props2.length; i++) if (props2[i] === props2[i - 1]) adjacentsIdentiques = true;
  verifier("deux cases adjacentes n'ont jamais le même propriétaire", !adjacentsIdentiques);

  verifier(
    "durée de la phase dessin = max(cases par joueur) × temps par case",
    dureeDessinPhase(repartirCases(["a", "b", "c", "d"], 6), 30) === 2 * 30
  );
}

console.log("\nBornage des réglages");
{
  verifier("cases hors bornes -> ramené dans [min,max]", bornerCases(999) === CASES_MAX && bornerCases(0) === CASES_MIN);
  verifier("valeur non numérique -> défaut", bornerCases("abc") === 6);
  verifier("temps par case plafonné", bornerTempsParCase(10000) === TEMPS_PAR_CASE_MAX);
  verifier("manches plafonnées", bornerManches(50) === MANCHES_MAX);
}

console.log("\nTirage de l'imposteur (sans répétition avant un tour complet)");
{
  const joueurs = ["a", "b", "c", "d"];
  let restants = [];
  const premierCycle = [];
  for (let i = 0; i < joueurs.length; i++) {
    const r = tirerImposteur(joueurs, restants);
    premierCycle.push(r.imposteur);
    restants = r.restants;
  }
  verifier(
    "un cycle complet couvre tout le monde sans doublon",
    new Set(premierCycle).size === joueurs.length,
    premierCycle.join(",")
  );

  const deuxiemeCycle = [];
  for (let i = 0; i < joueurs.length; i++) {
    const r = tirerImposteur(joueurs, restants);
    deuxiemeCycle.push(r.imposteur);
    restants = r.restants;
  }
  verifier("le cycle suivant recouvre à nouveau tout le monde", new Set(deuxiemeCycle).size === joueurs.length);

  const rUnique = tirerImposteur(["solo"], []);
  verifier("un seul joueur -> c'est forcément lui", rUnique.imposteur === "solo");
}

console.log("\nDépouillement du vote");
{
  const votesMajorite = new Map([["a", "x"], ["b", "x"], ["c", "y"]]);
  const rMajorite = depouillerVote(votesMajorite, "x");
  verifier("majorité claire sur l'imposteur -> démasqué", rMajorite.demasque === true && rMajorite.cible === "x");

  const votesInnocent = new Map([["a", "y"], ["b", "y"], ["c", "x"]]);
  const rInnocent = depouillerVote(votesInnocent, "x");
  verifier("majorité sur un innocent -> pas démasqué", rInnocent.demasque === false && rInnocent.cible === "y");

  const votesEgalite = new Map([["a", "x"], ["b", "y"]]);
  const rEgalite = depouillerVote(votesEgalite, "x");
  verifier("égalité -> pas démasqué, égalité signalée", rEgalite.demasque === false && rEgalite.egalite === true);

  const rVide = depouillerVote(new Map(), "x");
  verifier("aucun vote -> pas démasqué", rVide.demasque === false && rVide.cible === null);
}

console.log("\nBarème de score");
{
  const idsJoueurs = ["a", "b", "c"];
  const gagneInnocents = pointsManche(idsJoueurs, "b", false);
  verifier(
    "innocents gagnants : +1 chacun, imposteur +0",
    gagneInnocents.find((d) => d.id === "a").delta === 1 &&
      gagneInnocents.find((d) => d.id === "c").delta === 1 &&
      gagneInnocents.find((d) => d.id === "b").delta === 0
  );

  const gagneImposteur = pointsManche(idsJoueurs, "b", true);
  verifier(
    "imposteur gagnant : +3, innocents +0",
    gagneImposteur.find((d) => d.id === "b").delta === 3 &&
      gagneImposteur.find((d) => d.id === "a").delta === 0
  );
}

console.log("\nDevinette de l'imposteur démasqué");
{
  verifier("mots-clés retrouvés malgré accents/ordre", devinetteCorrecte("pluie pique-nique", "Un pique-nique interrompu par la pluie"));
  verifier("proposition sans rapport -> refusée", !devinetteCorrecte("un robot en cuisine", "La pire soirée Tinder de l'histoire"));
  verifier("proposition vide -> refusée", !devinetteCorrecte("", "Un dragon qui a peur du noir"));
}

console.log("\nValidation du contenu d'une case");
{
  const contenuOk = { traits: [{ couleur: "#1f1f1f", epaisseur: 4, points: [[10, 10], [20, 20]] }], stickers: [{ id: "coeur", x: 50, y: 50, echelle: 1, rotation: 0 }] };
  verifier("contenu raisonnable -> valide", caseValide(contenuOk));

  const tropDeTraits = { traits: Array.from({ length: CASE_TRAITS_MAX + 1 }, () => ({ couleur: "#1f1f1f", epaisseur: 4, points: [[1, 1]] })), stickers: [] };
  verifier("trop de traits -> invalide", !caseValide(tropDeTraits));

  const stickerInconnu = { traits: [], stickers: [{ id: "nexistepas", x: 10, y: 10, echelle: 1, rotation: 0 }] };
  verifier("sticker hors catalogue -> invalide", !caseValide(stickerInconnu));

  const coordHorsCadre = { traits: [{ couleur: "#1f1f1f", epaisseur: 4, points: [[1e9, 1e9]] }], stickers: [] };
  verifier("coordonnées aberrantes -> invalide", !caseValide(coordHorsCadre));

  const epaisseurBidon = { traits: [{ couleur: "#1f1f1f", epaisseur: 999, points: [[1, 1]] }], stickers: [] };
  verifier("épaisseur hors liste -> invalide", !caseValide(epaisseurBidon));
}

console.log("\nBanque de thèmes");
{
  const theme = tirerTheme([CATEGORIES_THEME.FAMILIAL]);
  verifier("thème tiré dans la bonne catégorie", THEMES[CATEGORIES_THEME.FAMILIAL].includes(theme));
  verifier("aucune catégorie active -> aucun thème", tirerTheme([]) === null);
}

/* ==========================================================================
   2. Salon — sans réseau
   ========================================================================== */

console.log("\nArrivée et hôte dynamique");
{
  const salon = nouveauSalon();
  const [ana, bo, cy] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  verifier("le premier arrivé est l'hôte", salon.hoteId() === ana.id);
  ana.co.fermer();
  salon._surDeconnexion(ana);
  verifier("l'hôte suit dynamiquement le prochain connecté", salon.hoteId() === bo.id);
}

console.log("\nRéglages (hôte uniquement)");
{
  const salon = nouveauSalon();
  const [hote, autre] = ajouterJoueurs(salon, ["Hote", "Autre"]);

  salon._surReglages(hote, { cases: 3, tempsParCase: 500, manches: 100, categories: [CATEGORIES_THEME.SOIREE] });
  verifier("les réglages hors bornes sont ramenés dans les bornes", salon.reglages.cases === CASES_MIN && salon.reglages.tempsParCase === TEMPS_PAR_CASE_MAX && salon.reglages.manches === MANCHES_MAX);
  verifier("catégorie valide acceptée", salon.reglages.categories.includes(CATEGORIES_THEME.SOIREE));

  const avant = { ...salon.reglages, categories: [...salon.reglages.categories] };
  salon._surReglages(autre, { cases: 8 });
  verifier("un non-hôte ne peut pas changer les réglages", salon.reglages.cases === avant.cases);

  salon._surReglages(hote, { categories: [] });
  verifier("vider les catégories est ignoré (au moins une doit rester active)", salon.reglages.categories.length > 0);
}

console.log("\nExclusion en lobby");
{
  const salon = nouveauSalon();
  const [hote, victime] = ajouterJoueurs(salon, ["Hote", "Victime"]);
  salon._surExclure(hote, { id: victime.id });
  verifier("le joueur exclu quitte le salon", !salon.joueurs.has(victime.id));
  verifier("sa connexion est fermée", victime.co.ouverte === false);
  verifier("il reçoit un message d'exclusion", dernierMessage(victime.co, "exclu") !== undefined);
}

console.log("\nLancement de la partie");
{
  const salonTropPetit = nouveauSalon();
  const [hote] = ajouterJoueurs(salonTropPetit, ["Hote", "Deuxieme"]);
  salonTropPetit._surLancer(hote);
  verifier("moins de 3 joueurs -> impossible de lancer", salonTropPetit.phase === PHASES.LOBBY);

  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur);

  verifier("3 joueurs -> la mise en route démarre (pas directement le dessin)", salon.phase === PHASES.MISE_EN_ROUTE);
  verifier("le bon nombre de cases est réparti", salon.proprietaires.length === salon.reglages.cases);

  const imposteur = joueurs.find((j) => j.id === salon.idImposteur);
  const innocent = joueurs.find((j) => j.id !== salon.idImposteur);
  const msgImposteur = dernierMessage(imposteur.co, "debutManche");
  const msgInnocent = dernierMessage(innocent.co, "debutManche");
  verifier("l'imposteur ne reçoit aucun thème", msgImposteur.theme === null);
  verifier("un innocent reçoit le vrai thème", typeof msgInnocent.theme === "string" && msgInnocent.theme.length > 0);

  passerMiseEnRoute(salon);
  verifier("après la mise en route, la phase de dessin démarre", salon.phase === PHASES.DESSIN);
  const debutDessin = dernierMessage(imposteur.co, "debutDessin");
  verifier(
    "chacun connaît la liste de ses propres cases (message debutDessin)",
    debutDessin.casesDeMoi.every((i) => salon.proprietaires[i] === imposteur.id)
  );
}

console.log("\nMise en route (premier trait, à tour de rôle, sous les yeux de tous)");
{
  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur);

  verifier("le tour commence à la case 0", salon._tourMiseEnRouteIndex === 0);
  const proprietaireCase0 = salon.proprietaires[0];
  const tourInitial = dernierMessage(joueurs[0].co, "tourMiseEnRoute");
  verifier("tout le monde est informé de qui a la main", tourInitial.index === 0 && tourInitial.proprietaire === proprietaireCase0);

  const acteur = joueurs.find((j) => j.id === proprietaireCase0);
  const spectateur = joueurs.find((j) => j.id !== proprietaireCase0);
  const traitValide = { couleur: "#1f1f1f", epaisseur: 4, points: [[5, 5], [15, 15]] };

  salon._surCases(spectateur, { contenus: [{ index: 0, traits: [traitValide], stickers: [] }] });
  verifier("un spectateur ne peut pas dessiner sur la case active", salon.contenusCases[0].traits.length === 0);

  salon._surCases(acteur, { contenus: [{ index: 0, traits: [traitValide], stickers: [] }] });
  verifier("l'acteur du tour peut dessiner sur SA case active", salon.contenusCases[0].traits.length === 1);
  verifier(
    "sa mise à jour est diffusée en direct à tout le monde",
    dernierMessage(spectateur.co, "miseEnRouteMaj")?.index === 0
  );

  // Même l'imposteur a son tour, comme convenu — jamais de tour "sauté".
  const idsOrdonnes = salon._idsOrdonnes();
  const tousLesProprietaires = new Set(salon.proprietaires);
  verifier("l'imposteur possède au moins une case (donc aura son tour)", tousLesProprietaires.has(salon.idImposteur));

  // Avancer jusqu'à la fin du tour de mise en route.
  for (let i = 0; i < salon.proprietaires.length; i++) salon._demarrerTourMiseEnRoute();
  verifier("après la dernière case, on passe au dessin privé", salon.phase === PHASES.DESSIN);
  verifier(
    "le premier trait posé en mise en route est conservé pour le dessin",
    salon.contenusCases[0].traits.length === 1
  );
}

console.log("\nSoumission des cases pendant le dessin");
{
  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur);
  passerMiseEnRoute(salon);

  const auteur = joueurs.find((j) => casesDe(j.id, salon.proprietaires).length > 0);
  const monIndex = casesDe(auteur.id, salon.proprietaires)[0];
  const autreIndex = salon.proprietaires.findIndex((id) => id !== auteur.id);

  const traitValide = { couleur: "#1f1f1f", epaisseur: 4, points: [[5, 5], [15, 15]] };
  salon._surCases(auteur, { contenus: [{ index: autreIndex, traits: [traitValide], stickers: [] }] });
  verifier("impossible d'écrire sur la case d'un autre joueur", salon.contenusCases[autreIndex].traits.length === 0);

  salon._surCases(auteur, { contenus: [{ index: monIndex, traits: [traitValide], stickers: [] }] });
  verifier("écrire sur sa propre case fonctionne", salon.contenusCases[monIndex].traits.length === 1);

  const contenuInvalide = { index: monIndex, traits: Array.from({ length: CASE_TRAITS_MAX + 1 }, () => traitValide), stickers: [] };
  salon._surCases(auteur, { contenus: [contenuInvalide] });
  verifier("un contenu invalide est rejeté sans écraser le précédent", salon.contenusCases[monIndex].traits.length === 1);
}

console.log("\nRévélation");
{
  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur);
  passerMiseEnRoute(salon);
  salon._finDessin();

  verifier("la phase passe à révélation", salon.phase === PHASES.REVELATION);
  const planche = dernierMessage(joueurs[0].co, "revelation").planche;
  verifier("la planche complète est diffusée à tous", planche.length === salon.reglages.cases);
}

console.log("\nVote");
{
  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur);
  passerMiseEnRoute(salon);
  salon._finDessin();
  salon._debutVote();

  const [ana, bo, cy] = joueurs;
  salon._surVote(ana, { cible: bo.id });
  verifier("un vote valide est enregistré", salon.votes.get(ana.id) === bo.id);
  verifier("le vote est diffusé (sans révéler la cible)", dernierMessage(bo.co, "voteMaj").votants.includes(ana.id));

  salon._surVote(bo, { cible: bo.id });
  verifier("impossible de voter pour soi-même", !salon.votes.has(bo.id));

  salon._surVote(cy, { cible: "id-inconnu" });
  verifier("impossible de voter pour un id inconnu", !salon.votes.has(cy.id));
}

console.log("\nRésolution : imposteur démasqué, devinette correcte");
{
  const salon = nouveauSalon();
  const [ana, bo, cy] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  salon.idImposteur = bo.id;
  salon.theme = "Un pique-nique interrompu par la pluie";
  salon.phase = PHASES.VOTE;
  salon.votes = new Map([[ana.id, bo.id], [cy.id, bo.id]]);

  salon._resoudreVote();
  verifier("l'imposteur démasqué obtient une dernière chance", salon._enAttenteDevinette === true);
  verifier("seul l'imposteur reçoit la demande de devinette", dernierMessage(bo.co, "demandeDevinette") !== undefined && dernierMessage(ana.co, "demandeDevinette") === undefined);

  salon._surDevinette(bo, { texte: "pique nique sous la pluie" });
  verifier("phase résultats après la devinette", salon.phase === PHASES.RESULTATS_MANCHE);
  verifier("bonne devinette -> l'imposteur gagne quand même", dernierMessage(bo.co, "resultatManche").imposteurGagne === true);
  verifier("score imposteur +3", salon.scoreParJoueur.get(bo.id) === 3);
  verifier("innocents à 0", salon.scoreParJoueur.get(ana.id) === 0);
}

console.log("\nRésolution : imposteur démasqué, mauvaise devinette");
{
  const salon = nouveauSalon();
  const [ana, bo, cy] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  salon.idImposteur = bo.id;
  salon.theme = "Un pique-nique interrompu par la pluie";
  salon.phase = PHASES.VOTE;
  salon.votes = new Map([[ana.id, bo.id], [cy.id, bo.id]]);
  salon._resoudreVote();

  salon._surDevinette(bo, { texte: "un tout autre sujet" });
  verifier("mauvaise devinette -> les innocents gagnent", dernierMessage(bo.co, "resultatManche").imposteurGagne === false);
  verifier("innocents +1 chacun", salon.scoreParJoueur.get(ana.id) === 1 && salon.scoreParJoueur.get(cy.id) === 1);
  verifier("imposteur à 0", salon.scoreParJoueur.get(bo.id) === 0);
}

console.log("\nRésolution : égalité au vote");
{
  const salon = nouveauSalon();
  const [ana, bo, cy] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  salon.idImposteur = bo.id;
  salon.theme = "Un thème quelconque";
  salon.phase = PHASES.VOTE;
  // Cycle complet : chacun vote pour un autre différent -> 1 voix chacun, égalité à 3.
  salon.votes = new Map([[ana.id, bo.id], [bo.id, cy.id], [cy.id, ana.id]]);
  salon._resoudreVote();

  verifier("égalité -> pas de devinette demandée", salon._enAttenteDevinette === false);
  verifier("égalité -> l'imposteur gagne directement", dernierMessage(bo.co, "resultatManche").imposteurGagne === true);
}

console.log("\nRésolution : vote sur un innocent");
{
  const salon = nouveauSalon();
  const [ana, bo, cy] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  salon.idImposteur = cy.id; // Cy est l'imposteur, mais personne ne vote pour lui
  salon.theme = "Un thème quelconque";
  salon.phase = PHASES.VOTE;
  salon.votes = new Map([[ana.id, bo.id], [cy.id, bo.id]]); // 2 voix sur Bo, un innocent

  salon._resoudreVote();
  verifier(
    "l'imposteur non accusé gagne directement, sans devinette",
    salon._enAttenteDevinette === false && dernierMessage(cy.co, "resultatManche").imposteurGagne === true
  );
}

console.log("\nEnchaînement des manches et fin de partie");
{
  const salon = nouveauSalon();
  const joueurs = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  salon.reglages.manches = 6;
  const hoteJoueur = joueurs.find((j) => j.id === salon.hoteId());
  salon._surLancer(hoteJoueur); // manche 1

  const tirage = [salon.idImposteur];
  for (let i = 0; i < 5; i++) {
    salon._demarrerManche();
    tirage.push(salon.idImposteur);
  }
  const premierLot = new Set(tirage.slice(0, 3));
  const secondLot = new Set(tirage.slice(3, 6));
  verifier("les 3 premières manches couvrent les 3 joueurs sans doublon", premierLot.size === 3, tirage.slice(0, 3).join(","));
  verifier("le second lot de 3 manches couvre à nouveau tout le monde", secondLot.size === 3, tirage.slice(3, 6).join(","));

  const salonCourt = nouveauSalon();
  const joueursCourt = ajouterJoueurs(salonCourt, ["Ana", "Bo", "Cy"]);
  salonCourt.reglages.manches = 1;
  const hoteCourt = joueursCourt.find((j) => j.id === salonCourt.hoteId());
  salonCourt._surLancer(hoteCourt);
  // _finManche() ne fait que PROGRAMMER la suite (DUREE_PAUSE_RESULTATS) : pour
  // vérifier la décision sans attendre 12 vraies secondes, on fait exécuter
  // CE SEUL appel programmé immédiatement, sans toucher au reste du salon.
  salonCourt._planifier = (fn) => {
    fn();
    return null;
  };
  salonCourt._finManche(false); // seule manche -> doit enchaîner directement sur la fin de partie
  verifier("après la dernière manche, la partie se termine", salonCourt.phase === PHASES.RESULTATS_PARTIE);
  salonCourt.arreterBoucle();

  salon.arreterBoucle();
}

console.log("\nReconnexion");
{
  const salon = nouveauSalon();
  const [ana] = ajouterJoueurs(salon, ["Ana", "Bo", "Cy"]);
  const jeton = ana.jeton;
  const idOrigine = ana.id;

  salon._surDeconnexion(ana);
  verifier("le joueur déconnecté est marqué comme tel", salon.joueurs.get(idOrigine).connecte === false);

  const nouvelleCo = fausseConnexion();
  const reconnecte = salon.arrivee(nouvelleCo, "", jeton);
  verifier("le même jeton réattache le même siège", reconnecte.id === idOrigine);
  verifier("le joueur redevient connecté", salon.joueurs.get(idOrigine).connecte === true);
  verifier("le nombre de joueurs n'a pas changé", salon.joueurs.size === 3);

  const jetonBidon = "0".repeat(48);
  const salonPlein = nouveauSalon();
  ajouterJoueurs(salonPlein, ["A", "B", "C", "D", "E", "F"]);
  const refuse = salonPlein.arrivee(fausseConnexion(), "Septieme", jetonBidon);
  verifier("un salon plein refuse une nouvelle arrivée (jeton inconnu)", refuse === null);
}

console.log("\nSalon vidé — minuterie de grâce");
{
  const salon = new Salon("test-vidage", () => {});
  const [ana, bo] = ajouterJoueurs(salon, ["Ana", "Bo"]);
  salon._surDeconnexion(ana);
  verifier("un seul déconnecté -> pas de minuterie de vidage", salon._minuterieVidage == null);
  salon._surDeconnexion(bo);
  verifier("tout le monde déconnecté -> une minuterie de vidage est armée", salon._minuterieVidage != null);
  salon.arreterBoucle(); // nettoie la vraie minuterie avant de continuer les tests
}

/* ==========================================================================
   3. Bout-en-bout : le vrai serveur, de vrais WebSocket
   ========================================================================== */

console.log("\nServeur réel");

const serveur = spawn(process.execPath, ["server/index.js"], {
  cwd: RACINE,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => serveur.kill());
await new Promise((r) => serveur.stdout.once("data", r));

function client(nom, salon, jeton) {
  const url =
    `ws://127.0.0.1:${PORT}/ws?nom=${encodeURIComponent(nom)}&salon=${encodeURIComponent(salon)}` +
    (jeton ? `&jeton=${encodeURIComponent(jeton)}` : "");
  const ws = new WebSocket(url);
  const etat = { ws, messages: [], id: null, jeton: null };
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    etat.messages.push(msg);
    if (msg.t === "bienvenue") {
      etat.id = msg.id;
      etat.jeton = msg.jeton;
    }
  });
  etat.pret = new Promise((r) => ws.addEventListener("open", r));
  etat.dernier = (type) => {
    const f = etat.messages.filter((m) => m.t === type);
    return f.length ? f[f.length - 1] : undefined;
  };
  return etat;
}

try {
  console.log("\nFichiers statiques");

  const page = await fetch(`${BASE}/`);
  verifier("GET / sert index.html", page.status === 200 && page.headers.get("content-type").startsWith("text/html"));

  const regles = await fetch(`${BASE}/shared.js`);
  verifier("GET /shared.js sert du JavaScript", regles.status === 200 && regles.headers.get("content-type").includes("javascript"));

  const sticker = await fetch(`${BASE}/stickers/coeur.svg`);
  verifier("un sticker SVG est servi", sticker.status === 200 && sticker.headers.get("content-type").includes("svg"));

  const sante = await (await fetch(`${BASE}/sante`)).json();
  verifier("GET /sante répond ok", sante.ok === true);

  console.log("\nNettoyage des entrées");

  const salonBrut = "  Copains !! 42  ";
  const a = client("<b>Ana</b>", salonBrut);
  const b = client("Bo", salonBrut);
  await Promise.all([a.pret, b.pret]);
  await attendre(200);

  verifier("le pseudo est nettoyé des balises", a.dernier("salon")?.joueurs.some((j) => j.pseudo === "bAna/b"));
  verifier("les deux clients atterrissent dans le même salon nettoyé", a.dernier("salon")?.joueurs.length === 2);

  console.log("\nChemin WebSocket inconnu");

  const mauvais = new WebSocket(`ws://127.0.0.1:${PORT}/autre`);
  const refuseChemin = await new Promise((r) => {
    mauvais.addEventListener("error", () => r(true));
    mauvais.addEventListener("open", () => r(false));
  });
  verifier("/autre est refusé (seul /ws est un WebSocket)", refuseChemin);

  console.log("\nSalon complet");

  const salonPlein = "salon-plein-" + Date.now();
  const membres = [];
  for (let i = 0; i < 6; i++) {
    const m = client(`J${i}`, salonPlein);
    await m.pret;
    membres.push(m);
  }
  await attendre(200);
  const septieme = client("Septieme", salonPlein);
  const refuseSalon = await new Promise((r) => {
    // Un salon déjà plein est refusé AVANT la poignée de main WebSocket
    // (réponse HTTP 503 brute, cf. server/index.js) : le client ne voit
    // jamais "open", seulement "error" — "close" n'arrive pas forcément.
    septieme.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "erreur") r(true);
    });
    septieme.ws.addEventListener("error", () => r(true));
    septieme.ws.addEventListener("close", () => r(true));
    setTimeout(() => r(false), 1000);
  });
  verifier("un salon plein refuse un nouveau joueur", refuseSalon);

  a.ws.close();
  b.ws.close();
  for (const m of membres) m.ws.close();
  septieme.ws.close();
} finally {
  serveur.kill();
}

console.log(`\n${reussis} réussis, ${echecs} échecs\n`);
process.exit(echecs === 0 ? 0 : 1);
