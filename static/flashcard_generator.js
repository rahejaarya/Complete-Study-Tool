(() => {
    const manualForm = document.getElementById("flashcard-form");
    if (!manualForm) return;

    const uploadForm = document.getElementById("flashcard-upload-form");
    const fileInput = document.getElementById("flashcard-file");
    const fileName = document.getElementById("flashcard-file-name");
    const loading = document.getElementById("flashcard-loading");
    const loadingText = loading.querySelector("span:last-child");
    const errorMessage = document.getElementById("flashcard-error");
    const builder = document.querySelector(".flashcard-builder");
    const review = document.getElementById("flashcard-review");
    const deckTitleInput = document.getElementById("flashcard-deck-title");
    const editor = document.getElementById("flashcard-card-editor");
    const cardCountBadge = document.getElementById("flashcard-card-count");
    const progress = document.getElementById("flashcard-progress");
    const subtitle = document.getElementById("flashcard-deck-subtitle");
    const cardButton = document.getElementById("flashcard-card");
    const cardInner = document.getElementById("flashcard-card-inner");
    const question = document.getElementById("flashcard-question");
    const answer = document.getElementById("flashcard-answer");
    const revealButton = document.getElementById("flashcard-reveal");
    const previousButton = document.getElementById("flashcard-previous");
    const nextButton = document.getElementById("flashcard-next");
    const shuffleButton = document.getElementById("flashcard-shuffle");
    const modeButtons = [...document.querySelectorAll(".flashcard-mode")];
    const sourceButtons = [...document.querySelectorAll(".flashcard-source-tab")];
    const filePanel = uploadForm;
    const learnHint = document.getElementById("flashcard-learn-hint");
    const practiceActions = document.getElementById("flashcard-practice-actions");
    const sessionScore = document.getElementById("flashcard-session-score");
    const saveButton = document.getElementById("flashcard-save-deck");
    const folderButton = document.getElementById("flashcard-save-folder");
    const saveStatus = document.getElementById("flashcard-save-status");
    const folderDialog = document.getElementById("flashcard-folder-dialog");
    const folderSelect = document.getElementById("flashcard-folder-select");
    const newFolderInput = document.getElementById("flashcard-new-folder");
    const existingFolderChoice = document.getElementById("flashcard-existing-folder-choice");
    const newFolderChoice = document.getElementById("flashcard-new-folder-choice");
    const folderChoiceInputs = [...document.querySelectorAll('input[name="flashcard-folder-choice"]')];
    const folderError = document.getElementById("flashcard-folder-error");

    let draft = [{ term: "", definition: "" }];
    let cards = [];
    let order = [];
    let currentIndex = 0;
    let mode = "random";
    let isFlipped = false;
    let knownCards = new Set();
    let currentDeckTitle = "";
    let currentDeckId = null;
    let editingDeckId = null;
    const pendingGenerationKey = "flashcard-generation-job";
    let activeGenerationJob = null;
    let progressSaveTimer = null;
    let progressSaveQueue = Promise.resolve();

    function showError(message = "") {
        errorMessage.textContent = message;
        errorMessage.hidden = !message;
    }

    function updateCountLabel() {
        const amount = draft.length;
        cardCountBadge.textContent = `${amount} ${amount === 1 ? "card" : "cards"}`;
    }

    function renderEditor() {
        editor.replaceChildren();
        draft.forEach((card, index) => {
            const row = document.createElement("article");
            row.className = "flashcard-editor-card";
            row.innerHTML = `
                <div class="flashcard-editor-card-top">
                    <span class="flashcard-editor-number">${String(index + 1).padStart(2, "0")}</span>
                    <span class="flashcard-editor-label">CARD ${index + 1}</span>
                    <button class="flashcard-remove-card" type="button" aria-label="Remove card ${index + 1}" ${draft.length === 1 ? "disabled" : ""}>Remove</button>
                </div>
                <div class="flashcard-editor-fields">
                    <label>Term <input class="flashcard-term-input" type="text" maxlength="240" placeholder="Enter a word, idea, or question" required></label>
                    <label>Definition <textarea class="flashcard-definition-input" rows="2" maxlength="1200" placeholder="Write the matching definition or answer" required></textarea></label>
                </div>`;
            const termInput = row.querySelector(".flashcard-term-input");
            const definitionInput = row.querySelector(".flashcard-definition-input");
            termInput.value = card.term;
            definitionInput.value = card.definition;
            termInput.addEventListener("input", () => { draft[index].term = termInput.value; showError(); });
            definitionInput.addEventListener("input", () => { draft[index].definition = definitionInput.value; showError(); });
            row.querySelector(".flashcard-remove-card").addEventListener("click", () => {
                if (draft.length <= 1) return;
                draft.splice(index, 1);
                updateCountLabel();
                renderEditor();
            });
            editor.append(row);
        });
        updateCountLabel();
    }

    function setFlipped(flipped) {
        isFlipped = flipped;
        cardInner.classList.toggle("is-flipped", flipped);
        cardButton.setAttribute("aria-label", flipped
            ? "Flashcard definition. Click or press Space to see the term."
            : "Flashcard term. Click or press Space to flip and reveal the definition.");
        revealButton.textContent = flipped ? "Show term" : "Show definition";
        practiceActions.hidden = mode !== "learn" || !flipped;
        queueProgressSave();
    }

    function shuffleOrder() {
        for (let index = order.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
        }
    }

    function startDeck(newCards, title, { persist = true, deckId = null, savedProgress = null } = {}) {
        cards = (Array.isArray(newCards) ? newCards : [])
            .filter((card) => card && (card.term || card.question) && (card.definition || card.answer))
            .map((card) => ({
                term: String(card.term ?? card.question).trim(),
                definition: String(card.definition ?? card.answer).trim(),
            }))
            .filter((card) => card.term && card.definition);
        if (!cards.length) {
            showError("No complete flashcards were created. Add a term and definition, then try again.");
            return;
        }
        const defaultOrder = cards.map((_, index) => index);
        const validSavedOrder = Array.isArray(savedProgress?.order)
            && savedProgress.order.length === cards.length
            && savedProgress.order.every((value) => Number.isInteger(value) && value >= 0 && value < cards.length)
            && new Set(savedProgress.order).size === cards.length;
        order = validSavedOrder ? [...savedProgress.order] : defaultOrder;
        mode = savedProgress?.mode === "learn" ? "learn" : "random";
        if (!validSavedOrder && mode === "random") shuffleOrder();
        currentIndex = Number.isInteger(savedProgress?.current_index)
            ? Math.max(0, Math.min(savedProgress.current_index, cards.length - 1))
            : 0;
        knownCards = new Set(Array.isArray(savedProgress?.known_cards)
            ? savedProgress.known_cards.filter((value) => Number.isInteger(value) && value >= 0 && value < cards.length)
            : []);
        currentDeckTitle = title || "";
        currentDeckId = deckId;
        saveStatus.textContent = "";
        saveButton.textContent = "Save deck";
        saveButton.hidden = false;
        sessionScore.textContent = knownCards.size
            ? `${knownCards.size} of ${cards.length} cards marked learned.`
            : "";
        subtitle.textContent = title || `${cards.length} ${cards.length === 1 ? "card" : "cards"} · Term and definition`;
        showError();
        builder.hidden = true;
        review.hidden = false;
        modeButtons.forEach((button) => {
            const active = button.dataset.mode === mode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        renderCard();
        if (savedProgress?.flipped) setFlipped(true);
        review.scrollIntoView({ behavior: "smooth", block: "start" });
        if (persist) {
            persistDeck()
                .then(() => saveProgressNow())
                .catch((error) => { saveStatus.textContent = error.message; });
        } else {
            queueProgressSave();
        }
        return true;
    }

    function progressSnapshot() {
        return {
            order,
            current_index: currentIndex,
            known_cards: [...knownCards],
            mode,
            flipped: isFlipped,
        };
    }

    function saveProgressNow() {
        if (!currentDeckId || !cards.length) return Promise.resolve();
        const snapshot = JSON.stringify(progressSnapshot());
        const deckId = currentDeckId;
        progressSaveQueue = progressSaveQueue
            .catch(() => {})
            .then(async () => {
                const response = await fetch(`/api/flashcards/${encodeURIComponent(deckId)}/progress`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: snapshot,
                    keepalive: true,
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Could not save study progress.");
            });
        return progressSaveQueue;
    }

    function queueProgressSave() {
        if (!currentDeckId) return;
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = window.setTimeout(() => {
            progressSaveTimer = null;
            saveProgressNow().catch(() => {
                saveStatus.textContent = "Could not save study progress. Check your connection.";
            });
        }, 250);
    }

    function flushProgressSave() {
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = null;
        saveProgressNow().catch(() => {});
    }

    function renderCard() {
        if (!cards.length) return;
        const card = cards[order[currentIndex]];
        question.textContent = card.term;
        answer.textContent = card.definition;
        progress.textContent = `${mode === "random" ? "Random · " : ""}Card ${currentIndex + 1} of ${cards.length}`;
        previousButton.disabled = currentIndex === 0;
        if (nextButton) nextButton.disabled = currentIndex === cards.length - 1;
        cardButton.hidden = false;
        revealButton.hidden = true;
        learnHint.hidden = mode !== "learn";
        practiceActions.hidden = mode !== "learn" || !isFlipped;
        setFlipped(false);
        queueProgressSave();
    }

    function advance() {
        if (currentIndex < cards.length - 1) {
            currentIndex += 1;
            renderCard();
        } else {
            const done = mode === "learn"
                ? `${knownCards.size} of ${cards.length} cards marked learned.`
                : "You’ve reached the end of this deck.";
            sessionScore.textContent = done;
        }
    }

    function openSource(source) {
        const manual = source === "manual";
        filePanel.hidden = manual;
        manualForm.hidden = !manual;
        sourceButtons.forEach((button) => {
            const active = button.dataset.source === source;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        showError();
    }

    sourceButtons.forEach((button) => button.addEventListener("click", () => openSource(button.dataset.source)));
    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileName.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "Drop a file here or browse your device";
        showError();
    });

    async function resumeGeneration(jobId) {
        activeGenerationJob = jobId;
        const submitButton = document.getElementById("flashcard-generate");
        submitButton.disabled = true;
        loading.hidden = false;
        loadingText.textContent = "Your flashcards are being generated and saved…";
        while (activeGenerationJob === jobId) {
            try {
                const response = await fetch(`/api/flashcards/generate/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Could not check flashcard generation status.");
                if (data.status === "completed" && data.deck) {
                    localStorage.removeItem(pendingGenerationKey);
                    activeGenerationJob = null;
                    startDeck(data.deck.cards, data.deck.title, { persist: false, deckId: data.deck.id, savedProgress: data.deck.progress });
                    saveButton.textContent = "Saved";
                    saveStatus.textContent = "Generated and saved to My flashcards";
                    return;
                }
                if (data.status === "failed") throw new Error(data.error || "Flashcards could not be generated. Please try again.");
                loadingText.textContent = data.status === "queued"
                    ? "Your flashcards are queued and will be saved automatically…"
                    : "Reading your material and building your cards…";
            } catch (error) {
                if (error.message !== "Failed to fetch" && !/network|fetch/i.test(error.message)) {
                    localStorage.removeItem(pendingGenerationKey);
                    activeGenerationJob = null;
                    showError(error.message);
                    loading.hidden = true;
                    submitButton.disabled = false;
                    return;
                }
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1800));
        }
    }

    uploadForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showError();
        const file = fileInput.files[0];
        if (!file) return showError("Choose a PDF, DOCX, or TXT file first.");
        const extension = file.name.split(".").pop().toLowerCase();
        if (!["pdf", "docx", "txt"].includes(extension)) return showError("Use a PDF, DOCX, or TXT file.");
        if (file.size > 10 * 1024 * 1024) return showError("Files must be 10 MB or smaller.");

        const submitButton = document.getElementById("flashcard-generate");
        submitButton.disabled = true;
        loading.hidden = false;
        loadingText.textContent = "Reading your material and building your cards…";
        try {
            const response = await fetch("/api/flashcards/generate", {
                method: "POST",
                headers: { Accept: "application/json" },
                body: new FormData(uploadForm),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Flashcards could not be generated.");
            if (!data.job_id) throw new Error("Flashcard generation could not be started.");
            localStorage.setItem(pendingGenerationKey, data.job_id);
            await resumeGeneration(data.job_id);
        } catch (error) {
            showError(error.message || "Flashcards could not be generated. Please try again.");
        } finally {
            if (!activeGenerationJob) {
                submitButton.disabled = false;
                loading.hidden = true;
            }
        }
    });

    document.getElementById("flashcard-add-card").addEventListener("click", () => {
        draft.push({ term: "", definition: "" });
        showError();
        renderEditor();
        editor.lastElementChild?.querySelector(".flashcard-term-input")?.focus();
    });

    manualForm.addEventListener("submit", (event) => {
        event.preventDefault();
        showError();
        if (!manualForm.reportValidity()) return;
        if (draft.some((card) => !card.term.trim() || !card.definition.trim())) {
            showError("Add both a term and a definition to every card.");
            return;
        }
        const deckId = editingDeckId;
        editingDeckId = null;
        startDeck(draft, deckTitleInput.value.trim(), { deckId });
    });

    cardButton.addEventListener("click", () => setFlipped(!isFlipped));
    revealButton.addEventListener("click", () => setFlipped(!isFlipped));
    previousButton.addEventListener("click", () => {
        if (currentIndex > 0) {
            currentIndex -= 1;
            renderCard();
        }
    });
    if (nextButton) nextButton.addEventListener("click", advance);
    document.getElementById("flashcard-known").addEventListener("click", () => {
        knownCards.add(order[currentIndex]);
        sessionScore.textContent = `${knownCards.size} of ${cards.length} cards marked learned.`;
        queueProgressSave();
        advance();
    });
    document.getElementById("flashcard-again").addEventListener("click", () => {
        const lastIndexAfterRemoval = order.length - 1;
        const [needsPractice] = order.splice(currentIndex, 1);
        order.push(needsPractice);
        if (currentIndex >= lastIndexAfterRemoval) currentIndex = 0;
        if (currentIndex >= order.length) currentIndex = 0;
        sessionScore.textContent = "Moved to the end of your study stack.";
        renderCard();
    });

    shuffleButton.addEventListener("click", () => {
        shuffleOrder();
        currentIndex = 0;
        knownCards = new Set();
        sessionScore.textContent = "Deck shuffled · no repeats";
        renderCard();
    });

    modeButtons.forEach((button) => button.addEventListener("click", () => {
        mode = button.dataset.mode;
        order = cards.map((_, index) => index);
        if (mode === "random") shuffleOrder();
        currentIndex = 0;
        sessionScore.textContent = mode === "random" ? "Shuffled order · no repeats" : "";
        modeButtons.forEach((modeButton) => {
            const active = modeButton === button;
            modeButton.classList.toggle("is-active", active);
            modeButton.setAttribute("aria-pressed", String(active));
        });
        renderCard();
    }));

    document.getElementById("flashcard-edit-deck").addEventListener("click", () => {
        editingDeckId = currentDeckId;
        draft = cards.map((card) => ({ term: card.term, definition: card.definition }));
        deckTitleInput.value = currentDeckTitle;
        renderEditor();
        review.hidden = true;
        builder.hidden = false;
        openSource("manual");
        builder.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    async function persistDeck() {
        saveStatus.textContent = "Saving…";
        saveButton.disabled = true;
        try {
            const response = await fetch(currentDeckId ? `/api/flashcards/${encodeURIComponent(currentDeckId)}` : "/api/flashcards", {
                method: currentDeckId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ title: currentDeckTitle, cards })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not save this deck.");
            currentDeckId = data.id;
            currentDeckTitle = data.title;
            saveButton.textContent = "Saved";
            saveStatus.textContent = "Saved to My flashcards";
            return data;
        } finally {
            saveButton.disabled = false;
        }
    }

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveStatus.textContent = "Saving…";
        try { await persistDeck(); }
        catch (error) { saveStatus.textContent = error.message; }
        finally { saveButton.disabled = false; }
    });

    folderButton.addEventListener("click", async () => {
        folderButton.disabled = true;
        folderError.hidden = true;
        try {
            if (!currentDeckId) await persistDeck();
            const response = await fetch("/api/saved-folders", { headers: { Accept: "application/json" } });
            const folders = await response.json();
            if (!response.ok || !Array.isArray(folders)) throw new Error("Could not load your folders.");
            folderSelect.replaceChildren(...folders.map((folder) => {
                const option = document.createElement("option");
                option.value = folder.id;
                option.textContent = folder.name;
                return option;
            }));
            const existingChoiceRadio = folderChoiceInputs.find((input) => input.value === "existing");
            const newChoiceRadio = folderChoiceInputs.find((input) => input.value === "new");
            existingChoiceRadio.disabled = folders.length === 0;
            existingChoiceRadio.checked = folders.length > 0;
            newChoiceRadio.checked = folders.length === 0;
            newFolderInput.value = "";
            toggleFolderChoice();
            folderDialog.showModal();
        } catch (error) { saveStatus.textContent = error.message; }
        finally { folderButton.disabled = false; }
    });

    function toggleFolderChoice() {
        const creatingNewFolder = folderChoiceInputs.find((input) => input.checked)?.value === "new";
        existingFolderChoice.hidden = creatingNewFolder;
        newFolderChoice.hidden = !creatingNewFolder;
    }
    folderChoiceInputs.forEach((input) => input.addEventListener("change", toggleFolderChoice));

    document.getElementById("flashcard-folder-confirm").addEventListener("click", async () => {
        try {
            const creatingNewFolder = folderChoiceInputs.find((input) => input.checked)?.value === "new";
            let folderId = folderSelect.value;
            if (creatingNewFolder) {
                const name = newFolderInput.value.trim();
                if (!name) throw new Error("Enter a name for the new folder.");
                const listResponse = await fetch("/api/saved-folders", { headers: { Accept: "application/json" } });
                const folders = await listResponse.json();
                if (!listResponse.ok || !Array.isArray(folders)) throw new Error("Could not load your folders.");
                folderId = crypto.randomUUID().replaceAll("-", "");
                folders.push({ id: folderId, name, items: [] });
                const createResponse = await fetch("/api/saved-folders", { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(folders) });
                const createData = await createResponse.json();
                if (!createResponse.ok) throw new Error(createData.error || "Could not create that folder.");
                const refreshedResponse = await fetch("/api/saved-folders", { headers: { Accept: "application/json" } });
                const refreshedFolders = await refreshedResponse.json();
                if (!refreshedResponse.ok || !Array.isArray(refreshedFolders)) throw new Error("Folder was created but could not be loaded.");
                const created = refreshedFolders.find((folder) => folder.id === folderId);
                if (!created) throw new Error("Folder was created but could not be selected.");
            }
            if (!folderId) throw new Error("Choose a folder first.");
            const response = await fetch(`/api/flashcards/${encodeURIComponent(currentDeckId)}/folders/${encodeURIComponent(folderId)}`, { method: "POST", headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not add this deck to the folder.");
            folderDialog.close();
            saveStatus.textContent = `Saved to ${data.folder}`;
        } catch (error) {
            folderError.textContent = error.message;
            folderError.hidden = false;
        }
    });

    const requestedDeckId = new URLSearchParams(window.location.search).get("deck");
    if (requestedDeckId) {
        fetch(`/api/flashcards/${encodeURIComponent(requestedDeckId)}`, { headers: { Accept: "application/json" } })
            .then(async (response) => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Could not load this deck.");
                if (!Array.isArray(data.cards) || !data.cards.length) throw new Error("This saved deck has no readable flashcards.");
                startDeck(data.cards, data.title, { persist: false, deckId: data.id, savedProgress: data.progress });
                saveButton.textContent = "Saved";
            })
            .catch((error) => showError(error.message));
    } else {
        const pendingJobId = localStorage.getItem(pendingGenerationKey);
        if (pendingJobId) resumeGeneration(pendingJobId);
    }

    document.addEventListener("keydown", (event) => {
        if (review.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        if ((event.code === "Space" || event.code === "Enter") && document.activeElement !== cardButton) {
            event.preventDefault();
            setFlipped(!isFlipped);
        } else if (event.code === "ArrowRight") advance();
        else if (event.code === "ArrowLeft" && currentIndex > 0) {
            currentIndex -= 1;
            renderCard();
        }
    });

    window.addEventListener("pagehide", flushProgressSave);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushProgressSave();
    });

    renderEditor();
})();
