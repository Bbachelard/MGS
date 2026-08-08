/**
 * runner-bg.js
 * Petit personnage "plateforming" qui court et saute en boucle
 * dans une bande fixe au bas de l'écran, en arrière-plan du site.
 *
 * Aucune image nécessaire : tout est dessiné en Canvas 2D.
 * Il suffit d'inclure ce script, il crée son propre <canvas>.
 */

(function () {
    "use strict";

    // ---------- Configuration ----------
    const ACCENT = "#7c5cff";      // couleur principale (thème du site)
    const ACCENT_DARK = "#5b3fd9"; // ombre / contour
    const GROUND_COLOR = "rgba(124, 92, 255, 0.25)";
    const STRIP_HEIGHT = 170;      // hauteur de la bande en bas de l'écran
    const CHAR_REACH = 55;         // hauteur max du perso au-dessus de son point de pied (tête + visière + marge)
    const SPEED = 2.4;             // vitesse de déplacement horizontal (px/frame)
    const GRAVITY = 1;
    const JUMP_VELOCITY = -12;
    const MIN_JUMP_DELAY = 1500;   // ms
    const MAX_JUMP_DELAY = 4000;   // ms

    // ---------- Création du canvas ----------
    const canvas = document.createElement("canvas");
    canvas.id = "runner-bg-canvas";
    Object.assign(canvas.style, {
        position: "fixed",
        left: "0",
        bottom: "0",
        width: "100%",
        height: STRIP_HEIGHT + "px",
        zIndex: "-1",
        pointerEvents: "none",
    });
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    let dpr = window.devicePixelRatio || 1;

    function resize() {
        dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = STRIP_HEIGHT * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // ---------- État du personnage ----------
    const groundY = STRIP_HEIGHT - 34; // ligne de sol (pieds du perso)
    const MAX_JUMP_HEIGHT = groundY - CHAR_REACH; // garde-fou : hauteur max avant de sortir du haut du canvas
    let x = -60;
    let vy = 0;
    let onGround = true;
    let phase = 0; // cycle de course
    let nextJumpAt = performance.now() + randomRange(MIN_JUMP_DELAY, MAX_JUMP_DELAY);
    let squash = 1; // effet d'écrasement à l'atterrissage

    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    // ---------- Dessin ----------
    function drawGround(width) {
        ctx.strokeStyle = GROUND_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, groundY + 2);
        ctx.lineTo(width, groundY + 2);
        ctx.stroke();
    }

    function drawShadow(px, py, jumpHeight) {
        const shrink = Math.max(0.3, 1 - jumpHeight / 90);
        ctx.save();
        ctx.translate(px, groundY + 3);
        ctx.scale(shrink, 1);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawCharacter(px, py, running, legSwing, armSwing, squashFactor) {
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1, squashFactor);

        // --- Jambes ---
        ctx.strokeStyle = ACCENT_DARK;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(-legSwing * 9, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(legSwing * 9, 0);
        ctx.stroke();

        // --- Bras ---
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, -34);
        ctx.lineTo(-armSwing * 8, -20);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -34);
        ctx.lineTo(armSwing * 8, -20);
        ctx.stroke();

        // --- Torse ---
        ctx.fillStyle = ACCENT;
        roundRect(ctx, -8, -36, 16, 20, 5);
        ctx.fill();

        // --- Tête ---
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, -44, 9, 0, Math.PI * 2);
        ctx.fill();

        // petite "visière" façon casque de gamer
        ctx.fillStyle = ACCENT_DARK;
        roundRect(ctx, -9, -47, 18, 5, 2.5);
        ctx.fill();

        ctx.restore();
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    // ---------- Boucle d'animation ----------
    let lastTime = performance.now();
    let currentY = 0; // décalage vertical par rapport au sol (négatif = en l'air, 0 = au sol)

    function tick(now) {
        const dt = Math.min(now - lastTime, 50); // clamp pour éviter les sauts si l'onglet était en pause
        lastTime = now;
        const step = dt / 16.6; // normalise par rapport à 60fps

        const width = window.innerWidth;
        ctx.clearRect(0, 0, width, STRIP_HEIGHT);

        // --- Déclenchement du saut ---
        if (onGround && now >= nextJumpAt) {
            vy = JUMP_VELOCITY;
            onGround = false;
        }

        // --- Physique verticale (intégration simple gravité/vélocité) ---
        if (!onGround) {
            vy += GRAVITY * step;
            currentY += vy * step;

            // Garde-fou : on ne laisse jamais le perso sortir du haut du canvas
            if (currentY < -MAX_JUMP_HEIGHT) {
                currentY = -MAX_JUMP_HEIGHT;
                if (vy < 0) vy = 0; // amorce la retombée si on tapait encore le "plafond"
            }

            if (currentY >= 0) {
                // Atterrissage
                currentY = 0;
                vy = 0;
                onGround = true;
                squash = 0.75; // petit écrasement à l'atterrissage
                nextJumpAt = now + randomRange(MIN_JUMP_DELAY, MAX_JUMP_DELAY);
            }
        }

        // Retour progressif à la taille normale après l'écrasement
        squash += (1 - squash) * 0.2;

        // --- Déplacement horizontal + cycle de course ---
        x += SPEED * step;
        if (x > width + 60) {
            x = -60;
        }
        if (onGround) {
            phase += 0.22 * step;
        }

        const legSwing = onGround ? Math.sin(phase) : 0.6;
        const armSwing = onGround ? Math.sin(phase + Math.PI) : -0.6;
        const py = groundY + currentY;

        drawGround(width);
        drawShadow(x, py, -currentY);
        drawCharacter(x, py, onGround, legSwing, armSwing, squash);

        requestAnimationFrame(tick);
    }

    // Pause quand l'onglet n'est pas visible (économie de ressources)
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            lastTime = performance.now();
        }
    });

    requestAnimationFrame(tick);
})();