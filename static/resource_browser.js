(() => {
    const form = document.getElementById("resource-browser-form");
    const input = document.getElementById("resource-browser-query");
    const submitButton = form.querySelector('button[type="submit"]');
    const loading = document.getElementById("resource-browser-loading");
    const results = document.getElementById("resource-browser-results");
    const error = document.getElementById("resource-browser-error");
    const topicHeading = document.getElementById("resource-browser-topic");
    const summary = document.getElementById("resource-browser-summary");
    const sourceNote = document.getElementById("resource-browser-source-note");
    const videosContainer = document.getElementById("resource-browser-videos");
    const webContainer = document.getElementById("resource-browser-web");
    let activeRequest;
    let activeSummaryRequest;

    function createResourceCard(resource, type) {
        const card = document.createElement("article");
        card.className = "resource-browser-result-card";
        const heading = document.createElement("h4");
        const link = document.createElement("a");
        link.textContent = resource.title;
        link.href = resource.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        heading.append(link);
        const metadata = document.createElement("p");
        metadata.className = "resource-browser-result-meta";
        const details = [type, resource.publisher, resource.duration, resource.views ? `${resource.views} views` : ""]
            .filter(Boolean);
        metadata.textContent = details.join(" · ");
        const description = document.createElement("p");
        description.className = "resource-browser-result-description";
        description.textContent = resource.description || "Open this link to explore the topic.";
        if (type === "Video" && /^[A-Za-z0-9_-]{11}$/.test(resource.video_id || "")) {
            const preview = document.createElement("a");
            preview.className = "resource-browser-video-preview";
            preview.href = resource.url;
            preview.target = "_blank";
            preview.rel = "noopener noreferrer";
            preview.setAttribute("aria-label", `Watch ${resource.title} on YouTube`);
            const image = document.createElement("img");
            image.src = `https://img.youtube.com/vi/${resource.video_id}/hqdefault.jpg`;
            image.alt = `YouTube preview for ${resource.title}`;
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => {
                if (!image.dataset.fallbackTried) {
                    image.dataset.fallbackTried = "true";
                    image.src = `https://img.youtube.com/vi/${resource.video_id}/mqdefault.jpg`;
                } else {
                    preview.hidden = true;
                }
            });
            const play = document.createElement("span");
            play.className = "resource-browser-video-play";
            play.setAttribute("aria-hidden", "true");
            play.textContent = "▶";
            preview.append(image, play);
            card.append(preview);
        }
        const actions = document.createElement("div");
        actions.className = "resource-browser-result-actions";
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "resource-browser-save-button";
        saveButton.textContent = "Add to folder";
        saveButton.addEventListener("click", () => {
            if (window.MeridianSavedFolderPicker) {
                void window.MeridianSavedFolderPicker.save(resource, type, saveButton);
            } else {
                console.error("Folder saving is unavailable on this page.");
                saveButton.textContent = "Saving unavailable";
            }
        });
        actions.append(saveButton);
        card.append(heading, metadata, description, actions);
        return card;
    }

    function renderList(container, resources, type, emptyText) {
        container.replaceChildren();
        if (!resources.length) {
            const empty = document.createElement("p");
            empty.className = "resource-browser-empty";
            empty.textContent = emptyText;
            container.append(empty);
            return;
        }
        resources.forEach((resource) => container.append(createResourceCard(resource, type)));
    }

    async function searchTopic(query) {
        activeRequest?.abort();
        activeSummaryRequest?.abort();
        activeRequest = new AbortController();
        loading.hidden = false;
        results.hidden = true;
        error.hidden = true;
        error.textContent = "";
        submitButton.disabled = true;
        submitButton.textContent = "Searching…";
        input.value = query;
        const url = new URL(window.location.href);
        url.searchParams.set("q", query);
        window.history.replaceState({}, "", url);

        try {
            const response = await fetch("/api/resource-browser/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({ query }),
                signal: activeRequest.signal
            });
            const data = await window.MeridianApi.read(
                response,
                "The search could not be completed."
            );

            const searchedTopic = data.query;
            topicHeading.textContent = searchedTopic;
            summary.textContent = "Preparing your overview…";
            sourceNote.textContent = data.search_note || "Descriptions are search-result summaries. Open a source to read its full content.";
            const videoResults = data.video_results || [];
            renderList(videosContainer, videoResults, "Video", "Explore related video lessons for this topic.");
            if (!videoResults.length) {
                const fallback = document.createElement("a");
                fallback.className = "resource-browser-fallback-link";
                fallback.href = data.video_search_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${searchedTopic} lesson explained`)}`;
                fallback.target = "_blank";
                fallback.rel = "noopener noreferrer";
                fallback.textContent = `Browse related lessons on YouTube`;
                videosContainer.append(fallback);
            }
            const webResults = data.web_results || [];
            renderList(webContainer, webResults, "Website or resource", "Explore more study resources for this topic.");
            if (!webResults.length) {
                const fallback = document.createElement("a");
                fallback.className = "resource-browser-fallback-link";
                fallback.href = data.web_search_url || `https://www.google.com/search?q=${encodeURIComponent(`${searchedTopic} learning resources`)}`;
                fallback.target = "_blank";
                fallback.rel = "noopener noreferrer";
                fallback.textContent = "See more learning resources on Google";
                webContainer.append(fallback);
            }
            results.hidden = false;
            results.scrollIntoView({ behavior: "smooth", block: "start" });

            activeSummaryRequest = new AbortController();
            fetch("/api/resource-browser/summary", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    query: searchedTopic,
                    web_results: data.web_results || [],
                    video_results: data.video_results || []
                }),
                signal: activeSummaryRequest.signal
            })
                .then(async (summaryResponse) => {
                    const summaryData = await window.MeridianApi.read(
                        summaryResponse,
                        "Overview unavailable."
                    );
                    if (topicHeading.textContent === searchedTopic) summary.textContent = summaryData.summary;
                })
                .catch((summaryError) => {
                    if (summaryError.name !== "AbortError" && topicHeading.textContent === searchedTopic) {
                        summary.textContent = summaryError.message || "Cypher could not prepare an overview right now.";
                    }
                });
        } catch (searchError) {
            if (searchError.name !== "AbortError") {
                error.textContent = searchError.message || "The search could not be completed. Try again in a moment.";
                error.hidden = false;
            }
        } finally {
            if (!activeRequest.signal.aborted) {
                loading.hidden = true;
                submitButton.disabled = false;
                submitButton.textContent = "Search";
            }
        }
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (query.length < 2) {
            input.focus();
            return;
        }
        void searchTopic(query);
    });

    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("q") || params.get("query");
    if (initialQuery) void searchTopic(initialQuery.slice(0, 180));
})();
