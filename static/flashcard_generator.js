(() => {
    const form = document.getElementById("flashcard-form");
    if (!form) return;

    const fileInput = document.getElementById("flashcard-file");
    const submitButton = document.getElementById("flashcard-submit");
    const errorMessage = document.getElementById("flashcard-error");
    const loading = document.getElementById("flashcard-loading");
    const review = document.getElementById("flashcard-review");
    const progress = document.getElementById("flashcard-progress");
    const question = document.getElementById("flashcard-question");
    const answerWrap = document.getElementById("flashcard-answer-wrap");
    const answer = document.getElementById("flashcard-answer");
    const revealButton = document.getElementById("flashcard-reveal");
    const previousButton = document.getElementById("flashcard-previous");
    const nextButton = document.getElementById("flashcard-next");

    let cards = [];
    let currentIndex = 0;

    function showError(message = "") {
        errorMessage.textContent = message;
        errorMessage.hidden = !message;
    }

    function renderCard() {
        const card = cards[currentIndex];
        if (!card) return;

        question.textContent = card.question;
        answer.textContent = card.answer;
        answerWrap.hidden = true;
        revealButton.textContent = "Show answer";
        progress.textContent = `Card ${currentIndex + 1} of ${cards.length}`;
        previousButton.disabled = currentIndex === 0;
        nextButton.disabled = currentIndex === cards.length - 1;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        showError("");

        const file = fileInput.files[0];
        if (!file) {
            showError("Choose a TXT, PDF, or DOCX file first.");
            return;
        }

        const extension = file.name.split(".").pop().toLowerCase();
        if (!["txt", "pdf", "docx"].includes(extension)) {
            showError("Use a TXT, PDF, or DOCX file.");
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showError("Files must be 10 MB or smaller.");
            return;
        }

        const body = new FormData(form);
        submitButton.disabled = true;
        loading.hidden = false;
        review.hidden = true;

        try {
            const response = await fetch("/api/flashcards/generate", {
                method: "POST",
                headers: { Accept: "application/json" },
                body,
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Flashcards could not be generated.");
            }
            if (!Array.isArray(data.flashcards) || data.flashcards.length === 0) {
                throw new Error("The generator did not return any flashcards. Try a different file.");
            }

            cards = data.flashcards;
            currentIndex = 0;
            renderCard();
            review.hidden = false;
            review.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
            showError(error.message || "Flashcards could not be generated. Please try again.");
        } finally {
            submitButton.disabled = false;
            loading.hidden = true;
        }
    });

    revealButton.addEventListener("click", () => {
        answerWrap.hidden = !answerWrap.hidden;
        revealButton.textContent = answerWrap.hidden ? "Show answer" : "Hide answer";
    });

    previousButton.addEventListener("click", () => {
        if (currentIndex === 0) return;
        currentIndex -= 1;
        renderCard();
    });

    nextButton.addEventListener("click", () => {
        if (currentIndex >= cards.length - 1) return;
        currentIndex += 1;
        renderCard();
    });
})();
