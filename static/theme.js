(() => {
    // Theme identifiers and the local cache key shared by the app.
    const storageKey = "studytool_color_theme_v1";
    const themes = [
        "light-lavender",
        "light-blue",
        "light-coral",
        "light-cobalt",
        "light-emerald",
        "light-orchid",
        "light-citrus",
        "light-slate",
        "dark-purple",
        "dark-blue",
        "dark-green",
        "dark-citrus",
        "dark-neon",
        "dark-ember",
        "dark-jade",
        "dark-mocha"
    ];
    let selectedTheme = "dark-neon";

    document.documentElement.dataset.theme = selectedTheme;

    // Apply a theme, cache it locally, and notify page-specific appearance controls.
    function rememberTheme(theme) {
        document.documentElement.dataset.theme = theme;
        selectedTheme = theme;
        try {
            window.localStorage.setItem(storageKey, theme);
        } catch (error) {
            console.warn("Color theme could not be cached in browser storage.", error);
        }
        window.dispatchEvent(new CustomEvent("studytool:theme-loaded", {
            detail: { theme }
        }));
    }

    // Load the account preference, using Neon Dark for accounts without one.
    async function loadAccountTheme() {
        try {
            const response = await fetch("/api/preferences/theme");
            if (!response.ok) {
                throw new Error(`Theme request failed with status ${response.status}.`);
            }
            const data = await response.json();
            if (themes.includes(data.theme)) {
                rememberTheme(data.theme);
                return;
            }

            const saveResponse = await fetch("/api/preferences/theme", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme: "dark-neon" })
            });
            if (!saveResponse.ok) {
                throw new Error(`Theme save failed with status ${saveResponse.status}.`);
            }
            rememberTheme("dark-neon");
        } catch (error) {
            console.error("Account color theme could not be loaded or saved.", error);
        }
    }

    // Apply the saved account theme as soon as this script initializes.
    void loadAccountTheme();
})();
