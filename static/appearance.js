(() => {
    const storageKey = "studytool_color_theme_v1";
    const themeNames = {
        "light-lavender": "Light Lavender",
        "light-blue": "Light Blue",
        "light-green": "Light Green",
        "light-sunset": "Light Sunset",
        "light-coral": "Light Coral",
        "light-cobalt": "Light Cobalt",
        "light-emerald": "Light Emerald",
        "light-orchid": "Light Orchid",
        "light-citrus": "Light Citrus",
        "light-slate": "Light Slate",
        "dark-purple": "Dark Purple",
        "dark-blue": "Dark Blue",
        "dark-green": "Dark Green",
        "dark-sunset": "Dark Sunset",
        "dark-neon": "Dark Neon",
        "dark-arctic": "Dark Arctic",
        "dark-fuchsia": "Dark Fuchsia",
        "dark-ember": "Dark Ember",
        "dark-jade": "Dark Jade",
        "dark-mocha": "Dark Mocha"
    };
    const themeCards = Array.from(document.querySelectorAll("[data-theme-choice]"));
    const status = document.getElementById("appearance-status");
    const applyButton = document.getElementById("apply-theme");
    let selectedTheme = document.documentElement.dataset.theme || "light-lavender";

    function updateSelection() {
        themeCards.forEach((card) => {
            card.setAttribute("aria-pressed", String(card.dataset.themeChoice === selectedTheme));
        });
    }

    themeCards.forEach((card) => {
        card.addEventListener("click", () => {
            selectedTheme = card.dataset.themeChoice;
            status.textContent = `Previewing ${themeNames[selectedTheme]}. Select another preview or apply this theme.`;
            updateSelection();
        });
    });

    applyButton.addEventListener("click", () => {
        document.documentElement.dataset.theme = selectedTheme;
        try {
            window.localStorage.setItem(storageKey, selectedTheme);
            status.textContent = `${themeNames[selectedTheme]} is now your app theme.`;
        } catch (error) {
            status.textContent = "The theme is selected but could not be saved in this browser.";
            console.warn("Color theme could not be saved to browser storage.", error);
        }
    });

    updateSelection();
})();
