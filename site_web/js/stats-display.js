function afficherResultat(data, resultBox) {
    const dateCreation = data.timecreated
        ? new Date(data.timecreated * 1000).toLocaleDateString('fr-FR')
        : 'Inconnue';

    const derniereConnexion = data.lastlogoff
        ? new Date(data.lastlogoff * 1000).toLocaleString('fr-FR')
        : 'Inconnue';

    const jeuxRecents = (data.recentGames || []).slice(0, 5).map(g =>
        `<li>${g.name} <span>${(g.playtime_2weeks / 60).toFixed(1)}h</span></li>`
    ).join('') || '<li>Aucun jeu récent</li>';

    resultBox.innerHTML = `
        <div class="player-card">
            <div class="player-header">
                <div class="avatar-frame">
                    <img src="${data.avatar}" alt="avatar" onclick="openImageModal(this.src)" style="cursor: pointer;">
                </div>
                <div class="player-identity">
                    <h3>${data.pseudo}</h3>
                    ${data.realname ? `<p class="realname">${data.realname}</p>` : ''}
                    <span class="status-badge ${data.statut === 'En ligne' ? 'online' : ''}">${data.statut}</span>
                    ${data.gameextrainfo ? `<p class="in-game">🎮 ${data.gameextrainfo}</p>` : ''}
                </div>
            </div>

            <div class="info-grid">
                <div class="info-box">
                    <span class="info-label">Plateforme</span>
                    <span class="info-value">${data.platform}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Profil</span>
                    <span class="info-value">${data.communityvisibilitystate}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Niveau Steam</span>
                    <span class="info-value">${data.steamLevel ?? '-'}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">XP</span>
                    <span class="info-value">${data.xp ?? '-'}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Pays</span>
                    <span class="info-value">${data.loccountrycode || '-'}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Membre depuis</span>
                    <span class="info-value">${dateCreation}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Dernière connexion</span>
                    <span class="info-value">${derniereConnexion}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Jeux possédés</span>
                    <span class="info-value">${data.ownedGamesCount ?? 0}</span>
                </div>
            </div>

            <div class="recent-games-box">
                <span class="info-label">Récemment joués</span>
                <ul class="recent-games-list">${jeuxRecents}</ul>
            </div>

            <a href="${data.profileUrl}" target="_blank" class="profile-link">Voir le profil Steam</a>
        </div>
    `;

    resultBox.scrollIntoView({ behavior: "smooth", block: "center" });
}



function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('imageModalContent');
    modal.style.display = 'flex';
    modalImg.src = src;
}

function closeImageModal() {
    document.getElementById('imageModal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function () {
    document.querySelector('.image-modal-close').addEventListener('click', closeImageModal);

    // Fermer en cliquant en dehors de l'image
    document.getElementById('imageModal').addEventListener('click', function (e) {
        if (e.target === this) closeImageModal();
    });

    // Fermer avec la touche Echap
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeImageModal();
    });
});