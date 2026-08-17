// ============================================================================
//  server/ws.js — un serveur WebSocket minimal, SANS dépendance.
//
//  Pourquoi ne pas prendre la bibliothèque `ws` ? Parce que ce dossier est
//  monté tel quel dans un conteneur `node:22-alpine` : pas de `npm install`,
//  pas de `node_modules` à déployer, pas de Dockerfile à reconstruire à
//  chaque mise à jour. `update-mgs.sh` copie les fichiers, redémarre le
//  conteneur, c'est fini.
//
//  On n'implémente que ce dont le jeu a besoin : le handshake, les trames
//  texte, ping/pong et la fermeture. Pas de compression (`permessage-deflate`),
//  pas de trames binaires. C'est très peu de code parce que le protocole
//  (RFC 6455) est très simple une fois qu'on retire les options.
// ============================================================================

import crypto from "node:crypto";

// Constante figée par la RFC : on la concatène à la clé du client, on hache,
// et le résultat prouve au navigateur qu'on parle bien WebSocket (et qu'on
// n'est pas un cache HTTP qui a répondu par hasard).
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Un message de jeu fait quelques centaines d'octets. Au-delà de 256 Ko,
// c'est qu'on nous envoie n'importe quoi : on coupe.
const TAILLE_MAX = 256 * 1024;

// Si un client ne lit plus (connexion saturée), le noyau met les snapshots
// en file dans notre mémoire. Au-delà de ce seuil on le déconnecte plutôt
// que de laisser le serveur gonfler.
const FILE_MAX = 1024 * 1024;

/**
 * Transforme une requête HTTP « Upgrade » en connexion WebSocket.
 *
 * @returns {Connexion|null} null si le handshake est refusé.
 */
export function accepter(requete, socket) {
  const cle = requete.headers["sec-websocket-key"];
  const version = requete.headers["sec-websocket-version"];

  if (!cle || version !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }

  const accept = crypto
    .createHash("sha1")
    .update(cle + GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  // Sans ça, Nagle regroupe nos petits paquets et ajoute jusqu'à 40 ms de
  // latence — exactement ce qu'on passe la journée à éviter.
  socket.setNoDelay(true);

  return new Connexion(socket);
}

export class Connexion {
  constructor(socket) {
    this.socket = socket;
    this.ouverte = true;

    this.surMessage = () => {};
    this.surFermeture = () => {};

    this._reste = Buffer.alloc(0);
    this._fragments = [];

    socket.on("data", (morceau) => this._lire(morceau));
    socket.on("error", () => this._fin());
    socket.on("close", () => this._fin());
  }

  // ------------------------------------------------------------- lecture
  _lire(morceau) {
    if (!this.ouverte) return;

    this._reste = this._reste.length
      ? Buffer.concat([this._reste, morceau])
      : morceau;

    // Un paquet TCP ne contient ni forcément une trame entière, ni forcément
    // une seule : on boucle tant qu'il reste une trame complète à extraire.
    for (;;) {
      const buf = this._reste;
      if (buf.length < 2) return;

      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masque = (buf[1] & 0x80) !== 0;

      let taille = buf[1] & 0x7f;
      let pos = 2;

      if (taille === 126) {
        if (buf.length < pos + 2) return;
        taille = buf.readUInt16BE(pos);
        pos += 2;
      } else if (taille === 127) {
        if (buf.length < pos + 8) return;
        const grand = buf.readBigUInt64BE(pos);
        if (grand > BigInt(TAILLE_MAX)) return this.fermer(1009);
        taille = Number(grand);
        pos += 8;
      }

      if (taille > TAILLE_MAX) return this.fermer(1009);

      // La RFC l'impose : une trame venant d'un client est TOUJOURS masquée.
      // Un client non masqué est soit cassé, soit hostile.
      if (!masque) return this.fermer(1002);

      if (buf.length < pos + 4 + taille) return;

      const cle = buf.subarray(pos, pos + 4);
      pos += 4;

      const charge = Buffer.from(buf.subarray(pos, pos + taille));
      for (let i = 0; i < charge.length; i++) charge[i] ^= cle[i & 3];
      pos += taille;

      this._reste = buf.subarray(pos);

      if (!this._traiter(fin, opcode, charge)) return;
    }
  }

  /** @returns {boolean} false si la connexion vient de se fermer. */
  _traiter(fin, opcode, charge) {
    switch (opcode) {
      case 0x0: // continuation
        this._fragments.push(charge);
        if (fin) {
          const texte = Buffer.concat(this._fragments).toString("utf8");
          this._fragments = [];
          this.surMessage(texte);
        }
        return true;

      case 0x1: // texte
        if (fin) {
          this.surMessage(charge.toString("utf8"));
        } else {
          this._fragments = [charge];
        }
        return true;

      case 0x2: // binaire — le jeu n'en envoie pas
        return true;

      case 0x8: // fermeture demandée par le client
        this.fermer(1000);
        return false;

      case 0x9: // ping -> pong, avec la même charge
        this._envoyerTrame(0xa, charge);
        return true;

      case 0xa: // pong
        return true;

      default:
        this.fermer(1002);
        return false;
    }
  }

  // ------------------------------------------------------------- écriture
  /** Fabrique la trame UNE fois pour la diffuser à N joueurs (cf. envoyerTrame). */
  static trameTexte(texte) {
    const charge = Buffer.from(texte, "utf8");
    let entete;

    if (charge.length < 126) {
      entete = Buffer.allocUnsafe(2);
      entete[1] = charge.length;
    } else if (charge.length < 65536) {
      entete = Buffer.allocUnsafe(4);
      entete[1] = 126;
      entete.writeUInt16BE(charge.length, 2);
    } else {
      entete = Buffer.allocUnsafe(10);
      entete[1] = 127;
      entete.writeBigUInt64BE(BigInt(charge.length), 2);
    }

    entete[0] = 0x81; // FIN + opcode texte
    return Buffer.concat([entete, charge]);
  }

  envoyer(texte) {
    this.envoyerTrame(Connexion.trameTexte(texte));
  }

  /** Écrit une trame déjà fabriquée. C'est ce qui rend la diffusion peu chère. */
  envoyerTrame(trame) {
    if (!this.ouverte) return;

    // Le client ne suit plus : on le lâche au lieu d'empiler en mémoire.
    if (this.socket.writableLength > FILE_MAX) {
      this.fermer(1008);
      return;
    }

    try {
      this.socket.write(trame);
    } catch {
      this._fin();
    }
  }

  _envoyerTrame(opcode, charge) {
    if (!this.ouverte || charge.length > 125) return;
    const trame = Buffer.allocUnsafe(2 + charge.length);
    trame[0] = 0x80 | opcode;
    trame[1] = charge.length;
    charge.copy(trame, 2);
    try {
      this.socket.write(trame);
    } catch {
      this._fin();
    }
  }

  fermer(code = 1000) {
    if (!this.ouverte) return;

    const charge = Buffer.allocUnsafe(2);
    charge.writeUInt16BE(code, 0);
    this._envoyerTrame(0x8, charge);

    this._fin();
    this.socket.end();
  }

  _fin() {
    if (!this.ouverte) return;
    this.ouverte = false;
    this._reste = Buffer.alloc(0);
    this._fragments = [];
    this.surFermeture();
  }
}
