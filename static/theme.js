(() => {
    const storageKey = "studytool_color_theme_v1";
    const migrationKey = "studytool_color_theme_account_migrated_v1";
    const legacyThemes = {
        lavender: "light-lavender",
        ocean: "light-blue",
        dark: "dark-purple"
    };
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
    let selectedTheme = "light-lavender";

    try {
        const savedTheme = window.localStorage.getItem(storageKey);
        if (savedTheme) {
            selectedTheme = themes.includes(savedTheme) ? savedTheme : legacyThemes[savedTheme] || selectedTheme;
        }
    } catch (error) {
        console.warn("Saved color theme could not be loaded from browser storage.", error);
    }

    document.documentElement.dataset.theme = selectedTheme;

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

    function markMigrationComplete() {
        try {
            window.localStorage.setItem(migrationKey, "complete");
        } catch (error) {
            console.warn("Theme migration state could not be saved.", error);
        }
    }

    async function loadAccountTheme() {
        try {
            const response = await fetch("/api/preferences/theme");
            if (!response.ok) {
                throw new Error(`Theme request failed with status ${response.status}.`);
            }
            const data = await response.json();
            if (themes.includes(data.theme)) {
                rememberTheme(data.theme);
                markMigrationComplete();
                return;
            }

            let migrationComplete = true;
            try {
                migrationComplete = window.localStorage.getItem(migrationKey) === "complete";
            } catch (error) {
                console.warn("Theme migration state could not be read.", error);
            }
            const theme = migrationComplete ? "light-lavender" : selectedTheme;
            const saveResponse = await fetch("/api/preferences/theme", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme })
            });
            if (!saveResponse.ok) {
                throw new Error(`Theme save failed with status ${saveResponse.status}.`);
            }
            rememberTheme(theme);
            markMigrationComplete();
        } catch (error) {
            console.error("Account color theme could not be loaded or saved.", error);
        }
    }

    void loadAccountTheme();
})();
