(() => {
    const storageKey = "studytool_color_theme_v1";
    const legacyThemes = {
        lavender: "light-lavender",
        ocean: "light-blue",
        forest: "light-green",
        sunset: "light-sunset",
        dark: "dark-purple"
    };
    const themes = [
        "light-lavender",
        "light-blue",
        "light-green",
        "light-sunset",
        "dark-purple",
        "dark-blue",
        "dark-green",
        "dark-sunset"
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
