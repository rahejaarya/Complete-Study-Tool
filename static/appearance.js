(() => {
    const storageKey = "studytool_color_theme_v1";
    const themeNames = {
        lavender: "Lavender",
        ocean: "Ocean",
        forest: "Forest",
        sunset: "Sunset",
        dark: "Dark"
    };
    const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));
    const previewFrame = document.getElementById("dashboard-preview");
    const previewLabel = document.getElementById("preview-theme-label");
    const status = document.getElementById("appearance-status");
    const applyButton = document.getElementById("apply-theme");
    let selectedTheme = document.documentElement.dataset.theme || "lavender";

    function updatePreview() {
        previewLabel.textContent = themeNames[selectedTheme];
        themeButtons.forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.themeChoice === selectedTheme));
        });

        try {
            const previewDocument = previewFrame.contentDocument;
            if (previewDocument) {
                previewDocument.documentElement.dataset.theme = selectedTheme;
            }
        } catch (error) {
            status.textContent = "The dashboard preview could not be updated.";
            console.warn("Dashboard appearance preview could not be updated.", error);
        }
    }

    themeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            selectedTheme = button.dataset.themeChoice;
            status.textContent = `Previewing ${themeNames[selectedTheme]}.`;
            updatePreview();
        });
    });

    previewFrame.addEventListener("load", updatePreview);

    applyButton.addEventListener("click", () => {
        document.documentElement.dataset.theme = selectedTheme;
        try {
            window.localStorage.setItem(storageKey, selectedTheme);
            status.textContent = `${themeNames[selectedTheme]} is now your app theme.`;
        } catch (error) {
            status.textContent = "The theme is previewed but could not be saved in this browser.";
            console.warn("Color theme could not be saved to browser storage.", error);
        }
        updatePreview();
    });

    updatePreview();
})();
