<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/games-mgs-model.php';

/* ==================================================================
 *  php/views/game-card.php — la carte d'un jeu du groupe MGS.
 *
 *  Même découpage que friend-card.php : la page dispose les blocs,
 *  la vue rend une fiche. Le jour où le catalogue viendra de la base
 *  plutôt que du tableau écrit à la main, cette vue ne bouge pas.
 * ================================================================== */

/**
 * @param array<string, mixed> $game fiche déjà passée par mgs_game_normalise()
 * @param string               $base préfixe de chemin ('..' depuis un sous-dossier)
 */
function mgs_game_card(array $game, string $base = '..'): void
{
    $base        = rtrim($base, '/');
    $indisponible = $game['statut'] === 'bientot';

    $classes = 'game-card game-card--' . $game['type']
             . ($indisponible ? ' game-card--bientot' : '');

    // Un lien vers l'extérieur s'ouvre dans un onglet neuf ; rel="noopener"
    // empêche la page ouverte de reprendre la main sur la nôtre.
    $externe = str_starts_with($game['url'], 'http');
    $cible   = $externe ? ' target="_blank" rel="noopener noreferrer"' : '';

    $image = is_string($game['image']) && $game['image'] !== ''
        ? $base . htmlspecialchars($game['image'], ENT_QUOTES, 'UTF-8')
        : null;
    ?>
    <article class="<?= $classes ?>">

        <div class="game-card__cover">
            <?php if ($image !== null): ?>
                <img src="<?= $image ?>" alt=""
                     class="game-card__img" loading="lazy" width="320" height="180">
            <?php else: ?>
                <span class="game-card__initiales" aria-hidden="true">
                    <?= htmlspecialchars(mgs_game_initiales((string) $game['nom']), ENT_QUOTES, 'UTF-8') ?>
                </span>
            <?php endif; ?>

            <span class="game-badge game-badge--<?= $game['type'] ?>">
                <?= htmlspecialchars(mgs_game_type_label((string) $game['type']), ENT_QUOTES, 'UTF-8') ?>
            </span>

            <?php if ($indisponible): ?>
                <span class="game-badge game-badge--bientot">Bientôt</span>
            <?php endif; ?>
        </div>

        <div class="game-card__body">
            <h3 class="game-card__nom"><?= htmlspecialchars((string) $game['nom'], ENT_QUOTES, 'UTF-8') ?></h3>

            <?php if ($game['resume'] !== ''): ?>
                <p class="game-card__resume"><?= htmlspecialchars((string) $game['resume'], ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>

            <?php if ($game['description'] !== ''): ?>
                <p class="game-card__desc"><?= htmlspecialchars((string) $game['description'], ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>

            <?php
            $meta = array_filter([
                implode(' · ', (array) $game['plateformes']),
                (string) $game['joueurs'],
                (string) $game['version'],
                (string) $game['poids'],
            ], static fn (string $v): bool => $v !== '');
            ?>

            <?php if ($meta !== []): ?>
                <ul class="game-card__meta">
                    <?php foreach ($meta as $item): ?>
                        <li><?= htmlspecialchars($item, ENT_QUOTES, 'UTF-8') ?></li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </div>

        <div class="game-card__actions">
            <?php if ($indisponible): ?>
                <span class="button button--ghost is-disabled" aria-disabled="true">
                    <?= htmlspecialchars(mgs_game_action_label($game), ENT_QUOTES, 'UTF-8') ?>
                </span>
            <?php else: ?>
                <a class="button" href="<?= htmlspecialchars((string) $game['url'], ENT_QUOTES, 'UTF-8') ?>"<?= $cible ?>>
                    <?= htmlspecialchars(mgs_game_action_label($game), ENT_QUOTES, 'UTF-8') ?>
                </a>
            <?php endif; ?>

            <span class="game-card__auteur">par <?= htmlspecialchars((string) $game['auteur'], ENT_QUOTES, 'UTF-8') ?></span>
        </div>
    </article>
    <?php
}
