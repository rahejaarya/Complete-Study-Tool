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
    const applyButton = document.getElementById("apply-theme");
    const applyRow = applyButton.closest(".appearance-apply-row");
    let selectedTheme = document.documentElement.dataset.theme || "light-lavender";
    let appliedTheme = selectedTheme;

    // Keep the pressed state of each theme card synchronized with the selection.
    function updateSelection() {
        themeCards.forEach((card) => {
            card.setAttribute("aria-pressed", String(card.dataset.themeChoice === selectedTheme));
        });
    }

    function updateApplyButton() {
        const hasUnappliedTheme = selectedTheme !== appliedTheme;
        applyRow.hidden = !hasUnappliedTheme;
        applyButton.disabled = !hasUnappliedTheme;
    }

    // Preview a palette locally when its card is selected.
    themeCards.forEach((card) => {
        card.addEventListener("click", () => {
            selectedTheme = card.dataset.themeChoice;
            status.textContent = selectedTheme === appliedTheme
                ? `Previewing ${themeNames[selectedTheme]}. This is your current theme.`
                : `Previewing ${themeNames[selectedTheme]}. Double-click or apply to set this theme.`;
            updateSelection();
            updateApplyButton();
        });

        card.addEventListener("dblclick", applySelectedTheme);
    });

    // Reflect a theme loaded asynchronously by the shared theme bootstrapper.
    window.addEventListener("studytool:theme-loaded", (event) => {
        selectedTheme = event.detail.theme;
        appliedTheme = selectedTheme;
        updateSelection();
        updateApplyButton();
    });

    // Persist the chosen theme to the user's account and report the save result.
    async function applySelectedTheme() {
        if (selectedTheme === appliedTheme || applyButton.disabled) return;

        const themeToApply = selectedTheme;
        document.documentElement.dataset.theme = themeToApply;
        applyButton.disabled = true;
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
                : `Previewing ${themeNames[selectedTheme]}. Double-click or apply to set this theme.`;
        } catch (error) {
            status.textContent = "Theme could not be saved. Please try again.";
            console.error("Color theme could not be saved to the account.", error);
        } finally {
            updateApplyButton();
        }
    }

    applyButton.addEventListener("click", applySelectedTheme);

    updateSelection();
    updateApplyButton();
})();
