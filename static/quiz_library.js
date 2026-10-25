(() => {
    const grid = document.getElementById("quiz-library-grid");
    const count = document.getElementById("quiz-library-count");
    const empty = document.getElementById("quiz-library-empty");
    const error = document.getElementById("quiz-library-error");
    const generationStatus = document.getElementById("quiz-generation-status");
    const pendingGenerationKey = "pendingQuizGenerationJob";
    async function load() {
        try {
            const response = await fetch("/api/quizzes", { headers: { Accept: "application/json" } });
            const quizzes = await response.json();
            if (!response.ok || !Array.isArray(quizzes)) throw new Error(quizzes.error || "Could not load quizzes.");
            count.textContent = `${quizzes.length} ${quizzes.length === 1 ? "quiz" : "quizzes"}`;
            empty.hidden = quizzes.length > 0; grid.replaceChildren();
            quizzes.forEach((quiz) => {
                const card = document.createElement("article"); card.className = "flashcard-library-card";
                const heading = document.createElement("h3");
                const openHref = `/quiz-generator?quiz=${encodeURIComponent(quiz.id)}`;
                const titleLink = document.createElement("a"); titleLink.href = openHref; titleLink.textContent = quiz.title || "Untitled quiz";
                heading.append(titleLink);
                card.addEventListener("click", (event) => {
                    if (event.target.closest("a, button")) return;
                    window.location.assign(openHref);
                });
                const quizQuestions = Array.isArray(quiz.questions) ? quiz.questions : [];
                const meta = document.createElement("p"); meta.textContent = `${quizQuestions.length} multiple-choice questions`;
                const actions = document.createElement("div"); actions.className = "flashcard-library-actions";
                const open = document.createElement("a"); open.className = "flashcard-action flashcard-library-study"; open.href = openHref; open.textContent = "Take quiz";
                const remove = document.createElement("button"); remove.type = "button"; remove.className = "flashcard-action secondary flashcard-library-delete"; remove.textContent = "Delete";
                remove.addEventListener("click", async () => {
                    if (!confirm(`Delete “${quiz.title}”? This also removes it from any folders.`)) return;
                    remove.disabled = true;
                    try { const result = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}`, { method: "DELETE", headers: { Accept: "application/json" } }); const data = await result.json(); if (!result.ok) throw new Error(data.error || "Could not delete quiz."); await load(); }
                    catch (err) { error.textContent = err.message; error.hidden = false; remove.disabled = false; }
                });
                actions.append(open, remove); card.append(heading, meta, actions); grid.append(card);
            });
        } catch (err) { count.textContent = "Unavailable"; error.textContent = err.message; error.hidden = false; }
    }
    load();

    async function followPendingGeneration(jobId) {
        generationStatus.hidden = false;
        generationStatus.textContent = "Your quiz is being created in the background. It will appear here when ready.";
        while (localStorage.getItem(pendingGenerationKey) === jobId) {
            try {
                const response = await fetch(`/api/quizzes/generate/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
                if (response.status === 404) {
                    localStorage.removeItem(pendingGenerationKey);
                    generationStatus.textContent = "That quiz generation job is no longer available.";
                    return;
                }
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Could not check quiz generation status.");
                if (data.status === "completed") {
                    localStorage.removeItem(pendingGenerationKey);
                    generationStatus.textContent = "Your quiz is ready and saved.";
                    await load();
                    return;
                }
                if (data.status === "failed") {
                    localStorage.removeItem(pendingGenerationKey);
                    generationStatus.textContent = data.error || "The quiz could not be generated.";
                    return;
                }
            } catch (statusError) {
                generationStatus.textContent = "Quiz generation is continuing in the background. Checking again…";
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1800));
        }
    }

    const pendingJobId = localStorage.getItem(pendingGenerationKey);
    if (pendingJobId) followPendingGeneration(pendingJobId);
})();
