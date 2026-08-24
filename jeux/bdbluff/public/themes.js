// ============================================================================
//  public/themes.js — la banque de thèmes de BDBluff.
//
//  Importé des deux côtés comme shared.js, mais avec une règle stricte :
//  SEUL le serveur (server/salon.js) lit ce fichier pour tirer le thème
//  réel d'une manche. Le client s'en sert seulement pour l'écran de
//  réglages du salon (afficher les catégories à cocher), jamais pour
//  connaître un thème à l'avance.
//
//  Deux catégories, activables indépendamment par l'hôte à la création du
//  salon (CATEGORIES_THEME dans shared.js) :
//    - familial : tout public
//    - soiree   : humour noir, ambiance adulte entre amis — rien
//                 d'explicite, juste plus grinçant
//
//  Pour en ajouter : un thème est une simple phrase courte, assez concrète
//  pour se dessiner en une case, assez ouverte pour laisser deviner sans
//  être trop évidente. Pas de doublon d'un id à l'autre nécessaire, ce sont
//  de simples chaînes.
// ============================================================================

import { CATEGORIES_THEME } from "./shared.js";

export const THEMES = Object.freeze({
  [CATEGORIES_THEME.FAMILIAL]: Object.freeze([
    "Un pique-nique interrompu par la pluie",
    "Le premier jour à la nouvelle école",
    "Un chat qui se prend pour un chien",
    "La chasse aux œufs de Pâques qui dérape",
    "Un robot qui apprend à cuisiner",
    "La visite au zoo la plus chaotique",
    "Un dragon qui a peur du noir",
    "Le jour où le pingouin a voulu voler",
    "Une licorne qui perd sa corne",
    "Le marché aux poissons un lundi matin",
    "Un fantôme qui cherche un nouveau logis",
    "La course de brouettes du village",
    "Un magicien dont les tours tournent mal",
    "Le jardin secret derrière l'école",
    "Un ours polaire en vacances au désert",
    "La fête d'anniversaire surprise ratée",
    "Un astronaute qui a oublié sa combinaison",
    "Le concours du plus gros potiron",
    "Une sirène perdue dans une piscine municipale",
    "Le jour où les nuages sont tombés",
    "Un épouvantail qui prend vie",
    "La bibliothèque hantée par des livres bavards",
    "Un poisson rouge qui rêve de la mer",
    "Le camping sous la tempête",
    "Un vampire végétarien",
    "La course-poursuite entre un escargot et un lièvre",
    "Un bonhomme de neige qui fond au mauvais moment",
    "Le clown qui a perdu son sens de l'humour",
    "Une sorcière qui rate toutes ses potions",
    "Le jour où les animaux de la ferme ont parlé",
  ]),

  [CATEGORIES_THEME.SOIREE]: Object.freeze([
    "La pire soirée Tinder de l'histoire",
    "Un enterrement qui tourne à la fête",
    "Le crime parfait raté à cause d'un chat",
    "Une résurrection ratée au cimetière",
    "L'ex qu'on croise au pire moment possible",
    "Un braquage de banque organisé par des amateurs",
    "La gueule de bois la plus catastrophique",
    "Un mariage où l'ex débarque sans prévenir",
    "Le tueur en série qui a peur du sang",
    "Une secte qui recrute au supermarché",
    "L'arnaque pyramidale qui s'effondre en direct",
    "Un exorcisme qui vire à la dispute de couple",
    "La dernière volonté la plus absurde d'un testament",
    "Un rendez-vous chez le psy qui dégénère",
    "L'alibi qui s'effondre en pleine interrogation",
    "Une overdose de fromage lors d'une raclette",
    "Le divorce le plus théâtral du quartier",
    "Un pacte avec le diable mal négocié",
    "La cure de désintox qui tourne à la fête",
    "Un vampire qui doit payer ses impôts",
    "L'accident de voiture qui devient une scène de crime",
    "Une résolution de nouvel an oubliée en 5 minutes",
    "Le patron qui débarque à l'after-work",
    "Une soirée jeux de société qui finit en bagarre",
    "Un médium qui invoque le mauvais esprit",
  ]),

  // Encore plus trash que "soiree" — humour glauque, gore, tabou. Verrouillée
  // par mot de passe côté hôte (voir CATEGORIES_THEME.HARD dans shared.js et
  // le README) : volontairement plus corsée, mais jamais de contenu sexuel
  // explicite ni de sous-entendu zoophile — la ligne rouge reste la même
  // quel que soit le verrou d'accès.
  [CATEGORIES_THEME.HARD]: Object.freeze([
    "Un enterrement de vie de garçon qui finit aux urgences",
    "Un chirurgien qui a un trou de mémoire en pleine opération",
    "Une secte qui recrute pendant un enterrement",
    "Le pire trip sous champignons de l'histoire du camping",
    "Un cadavre qu'il faut cacher avant l'arrivée des beaux-parents",
    "Une overdose de tequila qui finit en mariage à Vegas",
    "Un exorcisme qui tourne à la crise cardiaque",
    "Le pire bad trip d'un stagiaire à son premier festival",
    "Une autopsie interrompue par une envie pressante",
    "Un braquage de pharmacie qui dérape en overdose collective",
    "Le croque-mort qui perd le corps avant la cérémonie",
    "Une greffe qui tourne mal à cause d'un stagiaire distrait",
    "Le pire retour de soirée à trois heures du matin",
    "Un enterrement qui se transforme en règlement de comptes familial",
    "Une overdose de médicaments périmés trouvés chez mamie",
    "Le tatouage raté qui finit à l'hôpital",
    "Une intoxication alimentaire en plein mariage",
    "Le pire cauchemar d'un dealer pris en flagrant délit",
    "Une résurrection ratée qui tourne au film de zombies",
    "Le corps retrouvé dans le coffre le lendemain d'une fête",
    "Une overdose de laxatifs glissés dans le gâteau d'anniversaire",
    "Le pire lendemain de veille après un enterrement de vie de jeune fille",
    "Une crise de manque en pleine réunion de famille",
    "Le cadavre qui refuse de rentrer dans le sac mortuaire",
    "Une overdose collective pendant un rave clandestin",
    "Le pire malaise pendant une autopsie filmée en direct",
    "Une girafe qui prend de la drogue et se retrouve sur Mars",
    "Le pire coma éthylique de l'histoire du camping",
    "Une secte qui organise un sacrifice raté",
    "Le pire souvenir de garde à vue un lendemain de fête",
  ]),
});

/**
 * Tire un thème au hasard parmi les catégories actives.
 * @param {string[]} categoriesActives sous-ensemble de CATEGORIES_THEME
 * @param {() => number} rng injectable pour les tests
 * @returns {string|null} null si aucune catégorie active (ne devrait pas
 *   arriver : le salon impose au moins une catégorie cochée)
 */
export function tirerTheme(categoriesActives, rng = Math.random) {
  const pool = [];
  for (const cat of categoriesActives) {
    const themes = THEMES[cat];
    if (themes) pool.push(...themes);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}
