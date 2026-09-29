(() => {
    const storageKey = "studytool_color_theme_v1";
    const themes = ["lavender", "ocean", "forest", "sunset", "dark"];
    let selectedTheme = "lavender";

    try {
        const savedTheme = window.localStorage.getItem(storageKey);
        if (savedTheme && themes.includes(savedTheme)) {
            selectedTheme = savedTheme;
        }
    } catch (error) {
        console.warn("Saved color theme could not be loaded from browser storage.", error);
    }

    document.documentElement.dataset.theme = selectedTheme;

    function initializeThemePicker() {
        document.querySelectorAll(".theme-select").forEach((select) => {
            select.value = selectedTheme;
            select.addEventListener("change", () => {
                if (!themes.includes(select.value)) {
                    return;
                }

                selectedTheme = select.value;
                document.documentElement.dataset.theme = selectedTheme;
                document.querySelectorAll(".theme-select").forEach((picker) => {
                    picker.value = selectedTheme;
                });

                try {
                    window.localStorage.setItem(storageKey, selectedTheme);
                } catch (error) {
                    console.warn("Color theme could not be saved to browser storage.", error);
                }
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeThemePicker, { once: true });
    } else {
        initializeThemePicker();
    }
})();
