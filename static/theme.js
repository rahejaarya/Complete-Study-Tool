(() => {
    const storageKey = "studytool_color_theme_v1";
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
})();
