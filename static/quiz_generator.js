(() => {
    const sourceForm = document.getElementById("quiz-source-form");
    if (!sourceForm) return;
    const file = document.getElementById("quiz-file");
    const url = document.getElementById("quiz-url");
    const error = document.getElementById("quiz-error");
    const loading = document.getElementById("quiz-loading");
    const review = document.getElementById("quiz-review");
    const builder = document.getElementById("quiz-builder");
    const title = document.getElementById("quiz-title");
    const progress = document.getElementById("quiz-progress");
    const question = document.getElementById("quiz-question");
    const options = document.getElementById("quiz-options");
    const feedback = document.getElementById("quiz-feedback");
    const score = document.getElementById("quiz-score");
    const folderDialog = document.getElementById("quiz-folder-dialog");
    const folderSelect = document.getElementById("quiz-folder-select");
    const folderError = document.getElementById("quiz-folder-error");
    let questions = [];
    let answers = [];
    let index = 0;
    let quizId = null;

    file.addEventListener("change", () => {
        document.getElementById("quiz-file-name").textContent = file.files[0]?.name || "Choose a PDF, DOCX, or TXT";
    });

    function render() {
        const item = questions[index];
        question.textContent = item.question;
        progress.textContent = `Question ${index + 1} of ${questions.length}`;
        options.replaceChildren();
        item.options.forEach((option) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "quiz-option";
            button.textContent = option;
            if (answers[index]) {
                button.disabled = true;
                if (option === item.answer) button.classList.add("is-correct");
                if (option === answers[index] && option !== item.answer) button.classList.add("is-incorrect");
            }
            button.addEventListener("click", () => {
                answers[index] = option;
                feedback.textContent = option === item.answer ? "Correct!" : `Not quite. Correct answer: ${item.answer}`;
                render();
            });
            options.append(button);
        });
        feedback.textContent = answers[index] ? (answers[index] === item.answer ? "Correct!" : `Not quite. Correct answer: ${item.answer}`) : "Choose one answer.";
        document.getElementById("quiz-previous").disabled = index === 0;
        const next = document.getElementById("quiz-next");
        next.textContent = index === questions.length - 1 ? "Finish quiz" : "Next";
        score.textContent = answers.filter((answer, i) => answer === questions[i].answer).length
            ? `${answers.filter((answer, i) => answer === questions[i].answer).length} correct so far` : "";
    }

    sourceForm.addEventListener("submit", async (event) => {
        event.preventDefault(); error.hidden = true;
        if (!file.files.length && !url.value.trim()) { error.textContent = "Choose a file or enter a link."; error.hidden = false; return; }
        if (file.files.length && url.value.trim()) { error.textContent = "Use one source at a time: a file or a link."; error.hidden = false; return; }
        const submit = document.getElementById("quiz-generate"); submit.disabled = true; loading.hidden = false;
        try {
            const response = await fetch("/api/quizzes/generate", { method: "POST", body: new FormData(sourceForm), headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not create the quiz.");
            questions = data.questions; answers = Array(questions.length).fill(null); index = 0; title.textContent = data.title || "Study quiz";
            const saved = await fetch("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ title: title.textContent, questions }) });
            const savedData = await saved.json();
            if (!saved.ok) throw new Error(savedData.error || "Quiz generated but could not be saved.");
            quizId = savedData.id; builder.hidden = true; review.hidden = false; render();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
        finally { submit.disabled = false; loading.hidden = true; }
    });

    document.getElementById("quiz-previous").addEventListener("click", () => { if (index > 0) { index--; render(); } });
    document.getElementById("quiz-next").addEventListener("click", () => {
        if (index < questions.length - 1) { index++; render(); }
        else { score.textContent = `Quiz complete · ${answers.filter((answer, i) => answer === questions[i].answer).length} of ${questions.length} correct`; }
    });
    document.getElementById("quiz-add-folder").addEventListener("click", async () => {
        folderError.hidden = true;
        try {
            const response = await fetch("/api/saved-folders", { headers: { Accept: "application/json" } });
            const folders = await response.json();
            if (!response.ok || !Array.isArray(folders)) throw new Error("Could not load your folders.");
            if (!folders.length) throw new Error("Create a folder in Study Resources first.");
            folderSelect.replaceChildren(...folders.map((folder) => { const option = document.createElement("option"); option.value = folder.id; option.textContent = folder.name; return option; }));
            folderDialog.showModal();
        } catch (err) { folderError.textContent = err.message; folderError.hidden = false; }
    });
    document.getElementById("quiz-folder-confirm").addEventListener("click", async () => {
        try {
            const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/folders/${encodeURIComponent(folderSelect.value)}`, { method: "POST", headers: { Accept: "application/json" } });
            const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not add quiz to folder.");
            folderDialog.close(); score.textContent = `Added to ${data.folder}`;
        } catch (err) { folderError.textContent = err.message; folderError.hidden = false; }
    });

    const requested = new URLSearchParams(location.search).get("quiz");
    if (requested) fetch(`/api/quizzes/${encodeURIComponent(requested)}`, { headers: { Accept: "application/json" } })
        .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load quiz."); quizId = data.id; questions = data.questions; answers = Array(questions.length).fill(null); index = 0; title.textContent = data.title; builder.hidden = true; review.hidden = false; render(); })
        .catch((err) => { error.textContent = err.message; error.hidden = false; });
})();
