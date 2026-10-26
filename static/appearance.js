(() => {
    // Controls for previewing and saving the theme selected on the settings page.
    const storageKey = "studytool_color_theme_v1";
    const themeNames = {
        "light-lavender": "Cobalt",
        "light-blue": "Blue",
        "light-coral": "Coral",
        "light-cobalt": "Lavender",
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
    const applyRow = document.querySelector(".appearance-apply-row");
    let selectedTheme = document.documentElement.dataset.theme || "dark-neon";
    let appliedTheme = selectedTheme;
    let isSaving = false;

    // Keep the pressed state of each theme card synchronized with the selection.
    function updateSelection() {
        themeCards.forEach((card) => {
            card.setAttribute("aria-pressed", String(card.dataset.themeChoice === selectedTheme));
        });
    }

    function updateApplyRow() {
        const hasUnappliedTheme = selectedTheme !== appliedTheme;
        applyRow.dataset.theme = selectedTheme;
        applyRow.hidden = !hasUnappliedTheme;
    }

    // Preview a palette locally when its card is selected.
    themeCards.forEach((card) => {
        card.addEventListener("click", () => {
            selectedTheme = card.dataset.themeChoice;
            status.textContent = selectedTheme === appliedTheme
                ? `Previewing ${themeNames[selectedTheme]}. This is your current theme.`
                : `Previewing ${themeNames[selectedTheme]}. Double-click to set this theme.`;
            updateSelection();
            updateApplyRow();
        });

        card.addEventListener("dblclick", applySelectedTheme);
    });

    // Reflect a theme loaded asynchronously by the shared theme bootstrapper.
    window.addEventListener("studytool:theme-loaded", (event) => {
        selectedTheme = event.detail.theme;
        appliedTheme = selectedTheme;
        updateSelection();
        updateApplyRow();
    });

    // Persist the chosen theme to the user's account and report the save result.
    async function applySelectedTheme() {
        if (selectedTheme === appliedTheme || isSaving) return;

        const themeToApply = selectedTheme;
        isSaving = true;
        document.documentElement.dataset.theme = themeToApply;
        status.textContent = "Saving theme…";
        try {
            window.localStorage.setItem(storageKey, themeToApply);
        } catch (error) {
            console.warn("Color theme could not be cached in browser storage.", error);
        }
        try {
            const response = await fetch("/api/preferences/theme", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme: themeToApply })
            });
            if (!response.ok) {
                throw new Error(`Theme save failed with status ${response.status}.`);
            }
            appliedTheme = themeToApply;
            status.textContent = selectedTheme === appliedTheme
                ? ""
                : `Previewing ${themeNames[selectedTheme]}. Double-click to set this theme.`;
        } catch (error) {
            status.textContent = "Theme could not be saved. Please try again.";
            console.error("Color theme could not be saved to the account.", error);
        } finally {
            isSaving = false;
            updateApplyRow();
        }
    }

    updateSelection();
    updateApplyRow();
})();
