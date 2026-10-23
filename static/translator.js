    (() => {
    const form = document.getElementById("translator-form");
    if (!form) return;

    const source = document.getElementById("translator-source-language");
    const target = document.getElementById("translator-target-language");
    const input = document.getElementById("translator-input");
    const output = document.getElementById("translator-output");
    const count = document.getElementById("translator-character-count");
    const status = document.getElementById("translator-status");
    const error = document.getElementById("translator-error");
    const clear = document.getElementById("translator-clear");
    const swap = document.getElementById("translator-swap");
    const copy = document.getElementById("translator-copy");

    const API = "https://translate.argosopentech.com/translate";

    const languages = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    ar: "Arabic",
    hi: "Hindi",
    ru: "Russian"
    };

    const languagePatterns = [
        { code: "es", pattern: /[¿¡ñáéíóúü]/i },
        { code: "fr", pattern: /[àâçéèêëîïôùûüÿœæ]/i },
        { code: "de", pattern: /[äöüß]/i },
        { code: "pt", pattern: /[ãõáàâçéêíóôú]/i },
        { code: "it", pattern: /[àèéìíîòóù]/i },
        { code: "ru", pattern: /[\u0400-\u04FF]/ },
        { code: "ar", pattern: /[\u0600-\u06FF]/ },
        { code: "hi", pattern: /[\u0900-\u097F]/ },
        { code: "zh", pattern: /[\u4E00-\u9FFF]/ },
        { code: "ja", pattern: /[\u3040-\u30FF]/ },
        { code: "ko", pattern: /[\uAC00-\uD7AF]/ }
    ];

    function detectLanguage(text) {
        for (const language of languagePatterns) {
            if (language.pattern.test(text)) {
                return language.code;
            }
        }

        // Basic Latin text defaults to English.
        if (/[a-z]/i.test(text)) {
            return "en";
        }

        return null;
    }

    let timer = null;
    let controller = null;
    let requestNumber = 0;
    let detectedLanguage = null;

    function showError(message = "") {
    error.textContent = message;
    error.hidden = !message;
    }

    function cancelRequest() {
    clearTimeout(timer);

    if (controller) {
    controller.abort();
    controller = null;
    }

    requestNumber++;
    }

    async function translate() {
    const text = input.value.trim();
    const currentRequest = ++requestNumber;

    if (controller) controller.abort();

    controller = new AbortController();

    showError("");

    if (!text) {
    output.value = "";
    status.textContent = "";
    detectedLanguage = null;

    if (source.value === "auto") {
        // Keep automatic detection selected until text is entered.
    }

    return;
    }

    if (source.value !== "auto" && source.value === target.value) {
    output.value = text;
    status.textContent = "Both languages are the same.";
    return;
    }

    status.textContent = "Translating…";

    try {
    const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({
            text: text,
            source: source.value,
            target: target.value
        }),
        signal: controller.signal
    });

    if (!response.ok) {
        throw new Error(
            response.status === 429
                ? "Too many requests. Please wait and try again."
                : "The translation service is unavailable. Please try again later."
        );
    }

    const data = await response.json();

    if (currentRequest !== requestNumber) return;

    if (typeof data.translatedText !== "string") {
        throw new Error(data.error || "No translation was returned.");
    }

    output.value = data.translatedText;

    if (source.value === "auto" && data.detectedLanguage?.language) {
        let detected = data.detectedLanguage.language.toLowerCase();

        // Normalize language codes returned by the API.
        if (detected.includes("-")) {
            detected = detected.split("-")[0];
        }

        if (detected.startsWith("zh")) detected = "zh";
        if (detected.startsWith("pt")) detected = "pt";

        if (languages[detected]) {
            detectedLanguage = detected;

            // Actually select the detected language in the dropdown.
            source.value = detected;
        }
    } else if (source.value !== "auto") {
        detectedLanguage = source.value;
    }

    const from = detectedLanguage
        ? languages[detectedLanguage]
        : languages[source.value];

    status.textContent = source.value === "auto" && from
        ? `${from} → ${languages[target.value]}`
        : `Translated to ${languages[target.value]}.`;

    } catch (err) {
    if (err.name === "AbortError") return;
    if (currentRequest !== requestNumber) return;

    status.textContent = "";
    showError(err.message || "Translation failed.");
    }
    }

    function scheduleTranslation() {
    cancelRequest();

    count.textContent = `${input.value.length} / 5000`;
    showError("");

    if (!input.value.trim()) {
    output.value = "";
    status.textContent = "";
    detectedLanguage = null;
    source.options[0].textContent = "Detect language";
    return;
    }

    status.textContent = "Waiting…";
    timer = setTimeout(translate, 500);
    }

    input.addEventListener("input", () => {
        count.textContent = `${input.value.length} / 5000`;
        showError("");

        if (!input.value.trim()) {
            cancelRequest();
            output.value = "";
            status.textContent = "";
            detectedLanguage = null;

            // Restore Auto Detect as the selected option.
            source.value = "auto";
            return;
        }

        scheduleTranslation();
    });

    source.addEventListener("change", () => {
    detectedLanguage = null;
    source.options[0].textContent = "Detect language";
    scheduleTranslation();
    });

    target.addEventListener("change", scheduleTranslation);

    clear.addEventListener("click", () => {
    cancelRequest();

    input.value = "";
    output.value = "";
    count.textContent = "0 / 5000";
    status.textContent = "";
    detectedLanguage = null;
    source.options[0].textContent = "Detect language";

    showError("");
    input.focus();
    });

    swap.addEventListener("click", () => {
    const oldInput = input.value;
    const oldOutput = output.value;

    if (!oldOutput.trim()) {
    showError("Enter text and wait for the translation before swapping.");
    return;
    }

    const actualSource = source.value === "auto"
    ? detectedLanguage
    : source.value;

    if (!actualSource || !languages[actualSource]) {
    showError("Wait for language detection to finish before swapping.");
    return;
    }

    cancelRequest();

    input.value = oldOutput;
    output.value = oldInput;

    const oldTarget = target.value;
    source.value = oldTarget;
    target.value = actualSource;
    detectedLanguage = null;
    source.options[0].textContent = "Detect language";

    count.textContent = `${input.value.length} / 5000`;
    showError("");

    scheduleTranslation();
    });

    copy.addEventListener("click", async () => {
    if (!output.value) return;

    try {
    await navigator.clipboard.writeText(output.value);
    status.textContent = "Copied to clipboard.";
    } catch {
    output.focus();
    output.select();
    status.textContent = "Copy the selected text manually.";
    }
    });

    form.addEventListener("submit", event => {
    event.preventDefault();
    scheduleTranslation();
    });
    })();
