(() => {
    const storageKey = "studytool_color_theme_v1";
    const themeNames = {
        "light-lavender": "Lavender",
        "light-blue": "Blue",
        "light-coral": "Coral",
        "light-cobalt": "Cobalt",
        "light-emerald": "Emerald",
        "light-orchid": "Orchid",
        "light-citrus": "Citrus",
        "light-slate": "Slate",
        "dark-purple": "Purple",
        "dark-blue": "Blue",
        "dark-green": "Green",
        "dark-citrus": "Citrus",
        "dark-neon": "Neon",
        "dark-ember": "Ember",
        "dark-jade": "Jade",
        "dark-mocha": "Mocha"
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

    window.addEventListener("studytool:theme-loaded", (event) => {
        selectedTheme = event.detail.theme;
        updateSelection();
    });

    applyButton.addEventListener("click", async () => {
        document.documentElement.dataset.theme = selectedTheme;
        applyButton.disabled = true;
        status.textContent = "Saving your theme to your account...";
        try {
            window.localStorage.setItem(storageKey, selectedTheme);
        } catch (error) {
            console.warn("Color theme could not be cached in browser storage.", error);
        }
        try {
            const response = await fetch("/api/preferences/theme", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme: selectedTheme })
            });
            if (!response.ok) {
                throw new Error(`Theme save failed with status ${response.status}.`);
            }
            status.textContent = `${themeNames[selectedTheme]} is now saved to your account.`;
        } catch (error) {
            status.textContent = "The theme is previewed but could not be saved to your account. Please try again.";
            console.error("Color theme could not be saved to the account.", error);
        } finally {
            applyButton.disabled = false;
        }
    });

    updateSelection();
})();
