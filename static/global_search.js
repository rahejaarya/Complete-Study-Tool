(() => {
    // Read page routes from the template and prepare the searchable feature index.
    const overlay = document.getElementById("global-search-overlay");
    const trigger = document.getElementById("global-search-open");
    const input = document.getElementById("global-search-input");
    const closeButton = document.getElementById("global-search-close");
    const results = document.getElementById("global-search-results");
    const routeData = document.getElementById("global-search-routes");
    if (!overlay || !trigger || !input || !closeButton || !results || !routeData) return;

    const routes = JSON.parse(routeData.textContent)
        .filter((route) => !["/appearance", "/schedule"].includes(route.path));
    const pageIndex = [];
    let indexedFeatures;
    let indexPromise;
    let activeResult = -1;
    let renderedResults = [];

    // Add a normalized index entry once, avoiding duplicate page features.
    function addItem(item) {
        const key = `${item.category}|${item.url}|${item.title}`;
        if (!pageIndex.some((existing) => existing.key === key)) {
            pageIndex.push({ ...item, key, searchText: `${item.title} ${item.keywords || ""}`.toLowerCase() });
        }
    }

    // Group routes into the categories shown in the search results dialog.
    function routeCategory(path) {
        if (path === "/time-management" || path === "/schedule") return "Timers";
        if (path === "/settings" || path === "/appearance") return "Settings";
        return "Pages";
    }

    // Normalize rendered element text before using it as a search label.
    function readableText(element) {
        return (element?.textContent || "").replace(/\s+/g, " ").trim();
    }

    // Fetch app pages once and index their headings, links, and key controls.
    async function buildIndex() {
        if (indexPromise) return indexPromise;
        indexPromise = (async () => {
            const failures = [];
            const pages = await Promise.all(routes.map(async (route) => {
                try {
                    const response = await fetch(route.path, { credentials: "same-origin" });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const html = await response.text();
                    return { ...route, document: new DOMParser().parseFromString(html, "text/html") };
                } catch (error) {
                    failures.push({ path: route.path, error });
                    console.warn(`Global search could not index ${route.path}.`, error);
                    return null;
                }
            }));

            for (const page of pages.filter(Boolean)) {
                const { path, endpoint, document } = page;
                const pageTitle = readableText(document.querySelector("h1")) || document.title || endpoint;
                addItem({
                    type: "page",
                    title: pageTitle,
                    category: routeCategory(path),
                    description: `${endpoint.replaceAll("_", " ")} page`,
                    url: path,
                    keywords: `${document.title} ${path} ${endpoint}`
                });

                document.querySelectorAll("h1, h2, h3").forEach((heading) => {
                    const title = readableText(heading);
                    if (title.length < 2 || heading.closest("[data-sound], .preset-button, [data-theme-choice]")) return;
                    const target = heading.id ? heading : heading.closest("section[id], details[id], article[id]");
                    const anchor = target?.id ? `#${encodeURIComponent(target.id)}` : "";
                    addItem({
                        title,
                        category: routeCategory(path),
                        description: pageTitle,
                        url: `${path}${anchor}`,
                        keywords: readableText(heading.nextElementSibling)
                    });
                });

                document.querySelectorAll("a[href]").forEach((link) => {
                    const title = readableText(link);
                    if (title.length < 2) return;
                    const href = link.getAttribute("href");
                    if (!href || href.startsWith("javascript:")) return;
                    addItem({
                        title,
                        category: "Pages",
                        description: pageTitle,
                        url: new URL(href, window.location.origin).href,
                        keywords: `${href} ${link.getAttribute("aria-label") || ""}`
                    });
                });

                if (path === "/noise-songs") {
                    document.querySelectorAll("[data-sound]").forEach((card) => {
                        const soundId = card.dataset.sound;
                        const title = readableText(card.querySelector("h3")) || soundId;
                        addItem({
                            title,
                            category: "Focus Sounds",
                            description: readableText(card),
                            url: `${path}#sound-${encodeURIComponent(soundId)}`,
                            keywords: `${card.dataset.sound} ${card.querySelector(".sound-type")?.textContent || ""}`
                        });
                    });
                }

                if (path === "/focus") {
                    document.querySelectorAll("#white-noise-toggle, #tone-toggle").forEach((control) => {
                        const card = control.closest(".feature-card");
                        addItem({
                            title: readableText(card?.querySelector("h3")) || readableText(control),
                            category: "Focus Sounds",
                            description: readableText(card?.querySelector(".feature-content p")),
                            url: `${path}#${encodeURIComponent(control.id)}`,
                            keywords: `${control.id} ${readableText(control)}`
                        });
                    });
                }

                if (path === "/time-management") {
                    document.querySelectorAll(".preset-button[data-name]").forEach((preset) => {
                        const title = preset.dataset.name;
                        addItem({
                            title,
                            category: "Timers",
                            description: readableText(preset),
                            url: `${path}#${encodeURIComponent(preset.id || "study-timer")}`,
                            keywords: `${preset.dataset.work} minute study ${preset.dataset.break} minute break timer preset`
                        });
                    });
                    document.querySelectorAll("#timer-start, #timer-pause, #timer-reset, #custom-preset-form, #study-ratios-heading").forEach((control) => {
                        const title = control.matches("form")
                            ? "Create a custom study timer"
                            : readableText(control) || control.getAttribute("aria-label");
                        if (!title) return;
                        addItem({
                            title,
                            category: "Timers",
                            description: "Study Timer",
                            url: `${path}#${encodeURIComponent(control.id)}`,
                            keywords: `${control.id} timer study focus`
                        });
                    });
                }

                if (path === "/settings" || path === "/appearance") {
                    document.querySelectorAll("[data-theme-choice]").forEach((choice) => {
                        const themeId = choice.dataset.themeChoice;
                        const title = readableText(choice.querySelector(".theme-card-name")) || themeId;
                        addItem({
                            title: `${title} theme`,
                            category: "Settings",
                            description: `${themeId.startsWith("dark-") ? "Dark" : "Light"} appearance theme`,
                            url: `/settings#theme-choice-${encodeURIComponent(themeId)}`,
                            keywords: `${themeId.replaceAll("-", " ")} appearance color theme settings`
                        });
                    });
                }

                document.querySelectorAll("label[for]").forEach((label) => {
                    const target = document.getElementById(label.htmlFor);
                    const soundCard = label.closest("[data-sound]");
                    const title = readableText(label);
                    if (!target || title.length < 2 || soundCard) return;
                    addItem({
                        title,
                        category: routeCategory(path),
                        description: pageTitle,
                        url: `${path}#${encodeURIComponent(target.id)}`,
                        keywords: `${target.id} ${target.getAttribute("name") || ""}`
                    });
                });

                document.querySelectorAll("button[id]").forEach((button) => {
                    const title = readableText(button) || button.getAttribute("aria-label") || button.title;
                    if (title.length < 2 || button.id.startsWith("global-search")) return;
                    if (button.matches(".preset-button, [data-theme-choice]")) return;
                    if (path === "/focus" && ["white-noise-toggle", "tone-toggle"].includes(button.id)) return;
                    addItem({
                        title,
                        category: routeCategory(path),
                        description: pageTitle,
                        url: `${path}#${encodeURIComponent(button.id)}`,
                        keywords: `${button.id} ${button.getAttribute("aria-label") || ""} ${button.title || ""}`
                    });
                });
            }

            if (failures.length === routes.length) {
                throw new Error("No pages could be loaded for the global search index.");
            }
            indexedFeatures = pageIndex;
            return indexedFeatures;
        })();
        return indexPromise;
    }

    // Hide the dialog, clear its query, and return keyboard focus to the trigger.
    function closeSearch() {
        overlay.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        input.value = "";
        trigger.focus();
    }

    // Show the dialog, focus its input, and lazily build or refresh the index.
    function openSearch() {
        overlay.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        input.value = "";
        renderResults("");
        input.focus();
        buildIndex().then(() => renderResults(input.value)).catch((error) => {
            console.error("Global search index could not be built.", error);
            results.replaceChildren();
            const message = document.createElement("p");
            message.className = "global-search-hint";
            message.textContent = "Search is unavailable right now. Please try again.";
            results.append(message);
        });
    }

    // Rank matching index entries and render them as keyboard-selectable results.
    function renderResults(query) {
        results.replaceChildren();
        activeResult = -1;
        renderedResults = [];
        if (!indexedFeatures) {
            const hint = document.createElement("p");
            hint.className = "global-search-hint";
            hint.textContent = "Loading pages and features...";
            results.append(hint);
            return;
        }

        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            const hint = document.createElement("p");
            hint.className = "global-search-hint";
            hint.textContent = "Type to search pages, focus sounds, timers, and settings.";
            results.append(hint);
            return;
        }

        const terms = normalizedQuery.split(/\s+/);
        const rankedMatches = indexedFeatures
            .map((item) => {
                const termScores = terms.map((term) => {
                    if (item.title.toLowerCase().includes(term)) return 5;
                    if (item.searchText.includes(term)) return 1;
                    return 0;
                });
                return { item, score: termScores.reduce((total, score) => total + score, 0), matchesAllTerms: termScores.every((score) => score > 0) };
            })
            .filter((match) => match.matchesAllTerms)
            .sort((first, second) => second.score - first.score || first.item.title.localeCompare(second.item.title));

        const directPagePaths = new Set(rankedMatches
            .filter(({ item }) => item.type === "page" && terms.every((term) => item.title.toLowerCase().includes(term)))
            .map(({ item }) => new URL(item.url, window.location.origin).pathname));
        const matches = rankedMatches
            .filter(({ item }) => !directPagePaths.has(new URL(item.url, window.location.origin).pathname) || item.type === "page")
            .slice(0, 60);

        if (matches.length === 0) {
            const empty = document.createElement("p");
            empty.className = "global-search-hint";
            empty.textContent = "No matching pages or features found.";
            results.append(empty);
            return;
        }

        const categories = ["Pages", "Focus Sounds", "Timers", "Settings"]
            .sort((first, second) => {
                const firstScore = Math.max(...matches.filter((match) => match.item.category === first).map((match) => match.score), 0);
                const secondScore = Math.max(...matches.filter((match) => match.item.category === second).map((match) => match.score), 0);
                return secondScore - firstScore;
            });
        for (const category of categories) {
            const categoryMatches = matches.filter((match) => match.item.category === category);
            if (!categoryMatches.length) continue;
            const heading = document.createElement("h3");
            heading.className = "global-search-category";
            heading.textContent = category;
            results.append(heading);
            for (const match of categoryMatches) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "global-search-result";
                button.setAttribute("role", "option");
                button.setAttribute("aria-selected", "false");
                button.dataset.url = match.item.url;
                button.dataset.category = match.item.category;
                button.dataset.resultIndex = String(renderedResults.length);
                const copy = document.createElement("span");
                copy.className = "global-search-result-copy";
                const title = document.createElement("strong");
                title.textContent = match.item.title;
                const description = document.createElement("small");
                description.textContent = match.item.description || category;
                copy.append(title, description);
                const arrow = document.createElement("span");
                arrow.className = "global-search-result-arrow";
                arrow.textContent = "↗";
                button.append(copy, arrow);
                button.addEventListener("click", () => { window.location.href = match.item.url; });
                results.append(button);
                renderedResults.push(button);
            }
        }
    }

    // Move the active result with wraparound and scroll it into view.
    function moveSelection(direction) {
        if (!renderedResults.length) return;
        activeResult = (activeResult + direction + renderedResults.length) % renderedResults.length;
        renderedResults.forEach((result, index) => {
            const selected = index === activeResult;
            result.setAttribute("aria-selected", String(selected));
            if (selected) result.scrollIntoView({ block: "nearest" });
        });
    }

    // Wire dialog controls, keyboard shortcuts, result navigation, and focus trap.
    trigger.addEventListener("click", openSearch);
    closeButton.addEventListener("click", closeSearch);
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeSearch();
    });
    input.addEventListener("input", () => renderResults(input.value));
    input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
        } else if (event.key === "Enter" && renderedResults.length) {
            event.preventDefault();
            renderedResults[activeResult >= 0 ? activeResult : 0].click();
        }
    });
    document.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (overlay.hidden) openSearch();
            else input.focus();
        } else if (event.key === "Escape" && !overlay.hidden) {
            event.preventDefault();
            closeSearch();
        } else if (event.key === "Tab" && !overlay.hidden) {
            const focusable = [input, closeButton, ...renderedResults];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
})();
