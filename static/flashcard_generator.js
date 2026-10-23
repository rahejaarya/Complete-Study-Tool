(() => {
    const form = document.getElementById("flashcard-form");
    if (!form) return;

    const fileInput = document.getElementById("flashcard-file");
    const submitButton = document.getElementById("flashcard-submit");
    const errorMessage = document.getElementById("flashcard-error");
    const loading = document.getElementById("flashcard-loading");
    const review = document.getElementById("flashcard-review");
    const progress = document.getElementById("flashcard-progress");
    const cardButton = document.getElementById("flashcard-card");
    const cardInner = document.getElementById("flashcard-card-inner");
    const question = document.getElementById("flashcard-question");
    const answer = document.getElementById("flashcard-answer");
    const revealButton = document.getElementById("flashcard-reveal");
    const previousButton = document.getElementById("flashcard-previous");
    const nextButton = document.getElementById("flashcard-next");
    const shuffleButton = document.getElementById("flashcard-shuffle");
    const modeButtons = [...document.querySelectorAll(".flashcard-mode")];
    const practiceActions = document.getElementById("flashcard-practice-actions");
    const quizPanel = document.getElementById("flashcard-quiz");
    const quizQuestion = document.getElementById("flashcard-quiz-question");
    const quizOptions = document.getElementById("flashcard-quiz-options");
    const quizFeedback = document.getElementById("flashcard-quiz-feedback");
    const sessionScore = document.getElementById("flashcard-session-score");

    let cards = [];
    let currentIndex = 0;
    let mode = "practice";
    let isFlipped = false;
    let quizAnswered = false;
    let quizCorrect = 0;
    let quizTotal = 0;

    function showError(message = "") {
        errorMessage.textContent = message;
        errorMessage.hidden = !message;
    }

    function setFlipped(flipped) {
        isFlipped = flipped;
        cardInner.classList.toggle("is-flipped", flipped);
        cardButton.setAttribute("aria-label", flipped
            ? "Flashcard answer. Click or press Space to see the question."
            : "Flashcard question. Click or press Space to flip and reveal the answer.");
        revealButton.textContent = flipped ? "Show question" : "Show answer";
        practiceActions.hidden = mode !== "practice" || !flipped;
    }

    function buildQuiz() {
        quizOptions.replaceChildren();
        quizQuestion.textContent = cards[currentIndex].question;
        quizFeedback.textContent = "";
        quizFeedback.className = "flashcard-quiz-feedback";
        quizAnswered = false;
        const correct = cards[currentIndex].answer;
        const distractors = [...new Set(cards
            .filter((_, index) => index !== currentIndex)
            .map((item) => item.answer)
            .filter((item) => item && item !== correct))];
        for (let index = distractors.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [distractors[index], distractors[swapIndex]] = [distractors[swapIndex], distractors[index]];
        }
        const options = [correct, ...distractors.slice(0, 3)];
        for (let index = options.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
        }
        options.forEach((option) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "flashcard-quiz-option";
            button.textContent = option;
            button.addEventListener("click", () => {
                if (quizAnswered) return;
                quizAnswered = true;
                quizTotal += 1;
                const isCorrect = option === correct;
                if (isCorrect) quizCorrect += 1;
                button.classList.add(isCorrect ? "is-correct" : "is-wrong");
                [...quizOptions.children].forEach((choice) => {
                    choice.disabled = true;
                    if (choice.textContent === correct) choice.classList.add("is-correct");
                });
                quizFeedback.textContent = isCorrect ? "Correct! Nice work." : `Not quite. ${correct}`;
                quizFeedback.classList.add(isCorrect ? "is-correct" : "is-wrong");
                sessionScore.textContent = `Quiz score: ${quizCorrect} of ${quizTotal}`;
                nextButton.disabled = false;
            });
            quizOptions.append(button);
        });
    }

    function renderCard() {
        if (!cards.length) return;
        const card = cards[currentIndex];
        question.textContent = card.question;
        answer.textContent = card.answer;
        progress.textContent = `Card ${currentIndex + 1} of ${cards.length}`;
        previousButton.disabled = currentIndex === 0;
        nextButton.disabled = mode === "quiz" ? !quizAnswered : currentIndex === cards.length - 1;
        quizPanel.hidden = mode !== "quiz";
        cardButton.hidden = mode === "quiz";
        revealButton.hidden = mode === "quiz";
        practiceActions.hidden = mode !== "practice" || !isFlipped;
        if (mode === "quiz") {
            setFlipped(false);
            buildQuiz();
            nextButton.disabled = true;
        } else {
            setFlipped(false);
        }
    }

    function advance() {
        if (currentIndex < cards.length - 1) {
            currentIndex += 1;
            renderCard();
        } else if (mode === "quiz") {
            sessionScore.textContent = `Quiz complete · ${quizCorrect} of ${quizTotal} correct`;
            nextButton.disabled = true;
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        showError("");
        const file = fileInput.files[0];
        if (!file) return showError("Choose a TXT, PDF, or DOCX file first.");
        const extension = file.name.split(".").pop().toLowerCase();
        if (!["txt", "pdf", "docx"].includes(extension)) return showError("Use a TXT, PDF, or DOCX file.");
        if (file.size > 10 * 1024 * 1024) return showError("Files must be 10 MB or smaller.");

        submitButton.disabled = true;
        loading.hidden = false;
        review.hidden = true;
        try {
            const response = await fetch("/api/flashcards/generate", {
                method: "POST",
                headers: { Accept: "application/json" },
                body: new FormData(form),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Flashcards could not be generated.");
            if (!Array.isArray(data.flashcards) || !data.flashcards.length) {
                throw new Error("The generator did not return any flashcards. Try a different file.");
            }
            cards = data.flashcards;
            currentIndex = 0;
            quizCorrect = 0;
            quizTotal = 0;
            sessionScore.textContent = "";
            review.hidden = false;
            renderCard();
            review.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
            showError(error.message || "Flashcards could not be generated. Please try again.");
        } finally {
            submitButton.disabled = false;
            loading.hidden = true;
        }
    });

    cardButton.addEventListener("click", () => setFlipped(!isFlipped));
    revealButton.addEventListener("click", () => setFlipped(!isFlipped));
    previousButton.addEventListener("click", () => {
        if (currentIndex > 0) {
            currentIndex -= 1;
            renderCard();
        }
    });
    nextButton.addEventListener("click", advance);
    document.getElementById("flashcard-known").addEventListener("click", advance);
    document.getElementById("flashcard-again").addEventListener("click", () => setFlipped(false));
    shuffleButton.addEventListener("click", () => {
        for (let index = cards.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
        }
        currentIndex = 0;
        renderCard();
    });
    modeButtons.forEach((button) => button.addEventListener("click", () => {
        mode = button.dataset.mode;
        modeButtons.forEach((modeButton) => {
            const active = modeButton === button;
            modeButton.classList.toggle("is-active", active);
            modeButton.setAttribute("aria-pressed", String(active));
        });
        quizCorrect = 0;
        quizTotal = 0;
        sessionScore.textContent = "";
        renderCard();
    }));
    document.addEventListener("keydown", (event) => {
        if (review.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        if (event.code === "Space" && mode === "practice") {
            event.preventDefault();
            setFlipped(!isFlipped);
        } else if (event.code === "ArrowRight" && mode === "practice") advance();
        else if (event.code === "ArrowLeft" && mode === "practice" && currentIndex > 0) {
            currentIndex -= 1;
            renderCard();
        }
    });
})();
