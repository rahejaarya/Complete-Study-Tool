(() => {
    const grid = document.getElementById("quiz-library-grid");
    const count = document.getElementById("quiz-library-count");
    const empty = document.getElementById("quiz-library-empty");
    const error = document.getElementById("quiz-library-error");
    async function load() {
        try {
            const response = await fetch("/api/quizzes", { headers: { Accept: "application/json" } });
            const quizzes = await response.json();
            if (!response.ok || !Array.isArray(quizzes)) throw new Error(quizzes.error || "Could not load quizzes.");
            count.textContent = `${quizzes.length} ${quizzes.length === 1 ? "quiz" : "quizzes"}`;
            empty.hidden = quizzes.length > 0; grid.replaceChildren();
            quizzes.forEach((quiz) => {
                const card = document.createElement("article"); card.className = "flashcard-library-card";
                const heading = document.createElement("h3"); heading.textContent = quiz.title;
                const meta = document.createElement("p"); meta.textContent = `${quiz.questions.length} multiple-choice questions`;
                const actions = document.createElement("div"); actions.className = "flashcard-library-actions";
                const open = document.createElement("a"); open.className = "flashcard-action flashcard-library-study"; open.href = `/quiz-generator?quiz=${encodeURIComponent(quiz.id)}`; open.textContent = "Take quiz";
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
})();
