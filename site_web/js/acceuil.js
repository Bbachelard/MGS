document.addEventListener("DOMContentLoaded", () => {
    const platformSelect = document.getElementById("platformSelect");
    const platformToggle = document.getElementById("platformToggle");
    const platformValue = document.getElementById("platformValue");
    const platformMenu = document.getElementById("platformMenu");
 
    // Ouvre / ferme le menu au clic sur le bouton
    platformToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        platformSelect.classList.toggle("open");
    });
 
    // Sélection d'une option
    platformMenu.querySelectorAll("li").forEach((item) => {
        item.addEventListener("click", () => {
            const choix = item.getAttribute("data-value");
            platformValue.innerHTML = choix + ' <span class="arrow">▾</span>';
            platformSelect.classList.remove("open");
        });
    });
 
    // Ferme le menu si on clique ailleurs sur la page
    document.addEventListener("click", () => {
        platformSelect.classList.remove("open");
    });
});