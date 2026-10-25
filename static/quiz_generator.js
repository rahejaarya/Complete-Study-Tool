(() => {
    const sourceForm = document.getElementById("quiz-source-form");
    if (!sourceForm) return;

    const fileInput = document.getElementById("quiz-file");
    const fileName = document.getElementById("quiz-file-name");
    const urlInput = document.getElementById("quiz-url");
    const error = document.getElementById("quiz-error");
    const loading = document.getElementById("quiz-loading");
    const submitButton = document.getElementById("quiz-generate");
    const builder = document.getElementById("quiz-builder");
    const review = document.getElementById("quiz-review");
    const title = document.getElementById("quiz-title");
    const progress = document.getElementById("quiz-progress");
    const progressTrack = document.querySelector(".quiz-progress-track");
    const progressBar = document.getElementById("quiz-progress-bar");
    const questionNumber = document.getElementById("quiz-question-number");
    const question = document.getElementById("quiz-question");
    const options = document.getElementById("quiz-options");
    const feedback = document.getElementById("quiz-feedback");
    const score = document.getElementById("quiz-score");
    const questionCard = document.querySelector(".quiz-question-card");
    const results = document.getElementById("quiz-results");
    const resultsScore = document.getElementById("quiz-results-score");
    const resultsDetail = document.getElementById("quiz-results-detail");
    const countInput = document.getElementById("quiz-count");
    const timeEstimate = document.getElementById("quiz-time-estimate");
    const nextButton = document.getElementById("quiz-next");
    const previousButton = document.getElementById("quiz-previous");
    const restartButton = document.getElementById("quiz-restart");
    const saveRetryButton = document.getElementById("quiz-save-retry");
    const saveStatus = document.getElementById("quiz-save-status");
    const folderButton = document.getElementById("quiz-add-folder");
    const folderDialog = document.getElementById("quiz-folder-dialog");
    const folderSelect = document.getElementById("quiz-folder-select");
    const folderError = document.getElementById("quiz-folder-error");
    const sourceTabs = [...document.querySelectorAll(".quiz-source-tab")];
    const filePanel = document.getElementById("quiz-file-panel");
    const urlPanel = document.getElementById("quiz-url-panel");

    let questions = [];
    let answers = [];
    let index = 0;
    let quizId = null;
    let isComplete = false;
    let selectedSource = "file";
    const pendingGenerationKey = "pendingQuizGenerationJob";
    let activeGenerationJob = null;
    let progressSaveTimer = null;
    let progressSaveQueue = Promise.resolve();

    function updateTimeEstimate() {
        const count = Math.max(1, Math.min(50, Number(countInput.value) || 10));
        const minutes = Math.max(1, Math.round(count * 0.5));
        timeEstimate.textContent = `Estimated time: about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    countInput.addEventListener("input", updateTimeEstimate);
    updateTimeEstimate();

    async function readResponse(response, fallbackMessage) {
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error(fallbackMessage);
        }
        if (!response.ok) throw new Error(data.error || fallbackMessage);
        return data;
    }

    function showError(message = "") {
        error.textContent = message;
        error.hidden = !message;
    }

    function selectSource(source) {
        selectedSource = source;
        const usingFile = source === "file";
        filePanel.hidden = !usingFile;
        urlPanel.hidden = usingFile;
        fileInput.disabled = !usingFile;
        urlInput.disabled = usingFile;
        urlInput.required = !usingFile;
        sourceTabs.forEach((button) => {
            const active = button.dataset.source === source;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        showError();
    }

    sourceTabs.forEach((button) => {
        button.addEventListener("click", () => selectSource(button.dataset.source));
    });

    fileInput.addEventListener("change", () => {
        const selectedFile = fileInput.files[0];
        fileName.textContent = selectedFile
            ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
            : "Drop a file here or browse your device";
        showError();
    });

    function normalizeQuestions(input) {
        if (!Array.isArray(input) || !input.length) {
            throw new Error("No questions were created from that source. Try another source.");
        }

        return input.map((item, itemIndex) => {
            if (!item || typeof item !== "object" || Array.isArray(item)
                || typeof item.question !== "string"
                || !Array.isArray(item.options)
                || item.options.length !== 4
                || !item.options.every((option) => typeof option === "string" && option.trim())
                || typeof item.answer !== "string") {
                throw new Error(`Question ${itemIndex + 1} came back incomplete. Please try generating the quiz again.`);
            }

            const cleanedOptions = item.options.map((option) => option.trim());
            const cleanQuestion = item.question.trim();
            const cleanAnswer = item.answer.trim();
            if (!cleanQuestion || new Set(cleanedOptions).size !== 4 || !cleanedOptions.includes(cleanAnswer)) {
                throw new Error(`Question ${itemIndex + 1} has invalid answer choices. Please try again.`);
            }
            return {
                question: cleanQuestion,
                options: cleanedOptions,
                answer: cleanAnswer,
            };
        });
    }

    function correctAnswerCount() {
        return answers.reduce(
            (total, answer, answerIndex) => total + (answer === questions[answerIndex]?.answer ? 1 : 0),
            0,
        );
    }

    function answeredCount() {
        return answers.filter((answer) => answer !== null).length;
    }

    function saveProgressNow() {
        if (!quizId || !questions.length) return Promise.resolve();
        const payload = JSON.stringify({ answers, index, complete: isComplete });
        const currentQuizId = quizId;
        progressSaveQueue = progressSaveQueue
            .catch(() => {})
            .then(async () => {
                const response = await fetch(`/api/quizzes/${encodeURIComponent(currentQuizId)}/progress`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: payload,
                    keepalive: true,
                });
                if (response.status === 404) {
                    const missingQuizError = new Error("This quiz is no longer in your saved quizzes.");
                    missingQuizError.quizMissing = true;
                    throw missingQuizError;
                }
                return readResponse(response, "Could not save quiz progress.");
            });
        return progressSaveQueue;
    }

    function showProgressSaveError(saveError) {
        if (saveError.quizMissing) {
            quizId = null;
            folderButton.disabled = true;
            saveStatus.textContent = "This quiz is missing from My quizzes, so progress cannot sync.";
            return;
        }
        saveStatus.textContent = "Could not save quiz progress. Check your connection.";
    }

    function queueProgressSave() {
        if (!quizId) return;
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = window.setTimeout(() => {
            progressSaveTimer = null;
            saveProgressNow().catch(showProgressSaveError);
        }, 250);
    }

    function flushProgressSave() {
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = null;
        saveProgressNow().catch(showProgressSaveError);
    }

    function render() {
        if (!questions.length) return;
        questionCard.hidden = isComplete;
        results.hidden = !isComplete;
        if (isComplete) {
            resultsScore.textContent = `${correctAnswerCount()} / ${questions.length}`;
            const unanswered = questions.length - answeredCount();
            resultsDetail.textContent = unanswered
                ? `${answeredCount()} answered · ${unanswered} unanswered`
                : `You answered all ${questions.length} questions.`;
            progress.textContent = `Quiz complete · ${questions.length} questions`;
            progressTrack.setAttribute("aria-valuenow", "100");
            progressBar.style.width = "100%";
            previousButton.hidden = true;
            nextButton.hidden = true;
            score.textContent = "";
            restartButton.hidden = false;
            queueProgressSave();
            return;
        }
        previousButton.hidden = false;
        nextButton.hidden = false;
        restartButton.hidden = true;
        const item = questions[index];
        const selectedAnswer = answers[index];
        const percentage = Math.round(((index + 1) / questions.length) * 100);

        question.textContent = item.question;
        questionNumber.textContent = `QUESTION ${String(index + 1).padStart(2, "0")}`;
        progress.textContent = `Question ${index + 1} of ${questions.length}`;
        progressTrack.setAttribute("aria-valuenow", String(percentage));
        progressBar.style.width = `${percentage}%`;
        options.replaceChildren();

        item.options.forEach((option, optionIndex) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "quiz-option";
            button.setAttribute("aria-pressed", String(option === selectedAnswer));

            const marker = document.createElement("span");
            marker.className = "quiz-option-marker";
            marker.setAttribute("aria-hidden", "true");
            marker.textContent = String.fromCharCode(65 + optionIndex);
            const label = document.createElement("span");
            label.textContent = option;
            button.append(marker, label);

            if (selectedAnswer !== null) {
                button.disabled = true;
                if (option === item.answer) button.classList.add("is-correct");
                if (option === selectedAnswer && option !== item.answer) {
                    button.classList.add("is-incorrect");
                }
            }
            if (isComplete) button.disabled = true;

            button.addEventListener("click", () => {
                if (answers[index] !== null || isComplete) return;
                answers[index] = option;
                render();
            });
            options.append(button);
        });

        feedback.classList.toggle("is-correct", selectedAnswer === item.answer);
        feedback.classList.toggle("is-incorrect", selectedAnswer !== null && selectedAnswer !== item.answer);
        feedback.textContent = selectedAnswer === null
            ? ""
            : selectedAnswer === item.answer
                ? "Correct! Nice work."
                : "Incorrect.";
        previousButton.disabled = index === 0;
        nextButton.disabled = isComplete;
        nextButton.textContent = index === questions.length - 1 ? "Finish quiz" : "Next question →";
        score.textContent = isComplete
            ? `Quiz complete · ${correctAnswerCount()} of ${questions.length} correct · ${questions.length - answeredCount()} unanswered`
            : `${answeredCount()} of ${questions.length} answered · ${correctAnswerCount()} correct`;
        queueProgressSave();
    }

    function finishQuiz() {
        isComplete = true;
        render();
    }

    async function saveQuiz(quizTitle, quizQuestions) {
        saveRetryButton.disabled = true;
        saveRetryButton.hidden = true;
        saveStatus.textContent = "Saving your quiz…";
        const response = await fetch("/api/quizzes", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ title: quizTitle, questions: quizQuestions }),
        });
        const data = await readResponse(response, "The quiz was created, but could not be saved.");
        if (typeof data.id !== "string" || !data.id) {
            throw new Error("The quiz was created, but the save response was invalid.");
        }
        quizId = data.id;
        folderButton.disabled = false;
        saveStatus.textContent = "Quiz saved to My quizzes.";
        saveRetryButton.hidden = true;
    }

    function showGeneratedQuiz(quiz, requestedCount, savedProgress = null) {
        const generatedQuestions = normalizeQuestions(quiz.questions);
        questions = generatedQuestions;
        const savedAnswers = Array.isArray(savedProgress?.answers) && savedProgress.answers.length === questions.length
            ? savedProgress.answers
            : [];
        answers = questions.map((item, itemIndex) => {
            const answer = savedAnswers[itemIndex];
            return answer === null || item.options.includes(answer) ? answer : null;
        });
        index = Number.isInteger(savedProgress?.index)
            ? Math.max(0, Math.min(savedProgress.index, questions.length - 1))
            : 0;
        quizId = quiz.id || null;
        isComplete = savedProgress?.complete === true;
        title.textContent = quiz.title || "Study quiz";
        builder.hidden = true;
        review.hidden = false;
        nextButton.hidden = false;
        restartButton.hidden = true;
        folderButton.disabled = !quizId;
        const partialResult = Number.isInteger(requestedCount) && questions.length < requestedCount;
        saveStatus.textContent = quizId
            ? partialResult
                ? `Quiz saved with ${questions.length} questions; the source supported fewer than the ${requestedCount} requested.`
                : "Quiz saved to My quizzes."
            : "";
        render();
        if (isComplete) {
            nextButton.hidden = true;
            restartButton.hidden = false;
        }
        review.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function resumeGeneration(jobId) {
        activeGenerationJob = jobId;
        submitButton.disabled = true;
        loading.hidden = false;
        loading.querySelector(".flashcard-loading-message").textContent = "Your quiz is being created…";
        while (activeGenerationJob === jobId) {
            try {
                const response = await fetch(`/api/quizzes/generate/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
                const data = await readResponse(response, "Could not check quiz generation status.");
                if (data.status === "completed" && data.quiz) {
                    localStorage.removeItem(pendingGenerationKey);
                    activeGenerationJob = null;
                    showGeneratedQuiz(data.quiz, data.requested_count, data.quiz.progress);
                    return;
                }
                if (data.status === "failed") throw new Error(data.error || "The quiz could not be generated. Please try again.");
                loading.querySelector(".flashcard-loading-message").textContent = data.status === "queued"
                    ? "Your quiz is queued and will be saved automatically…"
                    : "Reading your source and creating questions…";
            } catch (pollError) {
                if (pollError.message !== "Failed to fetch" && !/network|fetch/i.test(pollError.message)) {
                    localStorage.removeItem(pendingGenerationKey);
                    activeGenerationJob = null;
                    showError(pollError.message);
                    return;
                }
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
    }

    sourceForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showError();

        if (!sourceForm.reportValidity()) return;
        if (selectedSource === "file") {
            const selectedFile = fileInput.files[0];
            if (!selectedFile) return showError("Choose a PDF, DOCX, or TXT file first.");
            const extension = selectedFile.name.split(".").pop()?.toLowerCase();
            if (!["pdf", "docx", "txt"].includes(extension)) {
                return showError("Use a PDF, DOCX, or TXT file.");
            }
            if (selectedFile.size > 10 * 1024 * 1024) {
                return showError("Files must be 10 MB or smaller.");
            }
        } else if (!urlInput.value.trim()) {
            return showError("Enter a website or YouTube link.");
        }

        submitButton.disabled = true;
        loading.hidden = false;
        loading.querySelector(".flashcard-loading-message").textContent = "Reading your source and creating questions…";

        try {
            const response = await fetch("/api/quizzes/generate", {
                method: "POST",
                body: new FormData(sourceForm),
                headers: { Accept: "application/json" },
            });
            const data = await readResponse(response, "Could not create the quiz.");
            if (!data.job_id) throw new Error("Quiz generation could not be started.");
            localStorage.setItem(pendingGenerationKey, data.job_id);
            await resumeGeneration(data.job_id);
        } catch (requestError) {
            showError(requestError.message || "Could not create the quiz. Please try again.");
        } finally {
            if (!activeGenerationJob) {
                submitButton.disabled = false;
                loading.hidden = true;
            }
        }
    });

    const requestedQuizId = new URLSearchParams(window.location.search).get("quiz");
    if (!requestedQuizId) {
        const pendingJobId = localStorage.getItem(pendingGenerationKey);
        if (pendingJobId) resumeGeneration(pendingJobId);
    }

    previousButton.addEventListener("click", () => {
        if (index > 0) {
            index -= 1;
            render();
        }
    });

    nextButton.addEventListener("click", () => {
        if (index < questions.length - 1) {
            index += 1;
            render();
        } else {
            finishQuiz();
        }
    });

    restartButton.addEventListener("click", () => {
        answers = Array(questions.length).fill(null);
        index = 0;
        isComplete = false;
        nextButton.hidden = false;
        restartButton.hidden = true;
        render();
    });

    saveRetryButton.addEventListener("click", async () => {
        if (!questions.length || quizId) return;
        saveRetryButton.disabled = true;
        try {
            await saveQuiz(title.textContent, questions);
        } catch (saveError) {
            saveStatus.textContent = saveError.message;
            saveRetryButton.hidden = false;
        } finally {
            saveRetryButton.disabled = false;
        }
    });

    folderButton.addEventListener("click", async () => {
        folderButton.disabled = true;
        folderError.hidden = true;
        try {
            const response = await fetch("/api/saved-folders", {
                headers: { Accept: "application/json" },
            });
            const folders = await readResponse(response, "Could not load your folders.");
            if (!Array.isArray(folders)) throw new Error("Could not load your folders.");
            if (!folders.length) throw new Error("Create a folder in Study Resources first.");
            folderSelect.replaceChildren(...folders.map((folder) => {
                const option = document.createElement("option");
                option.value = folder.id;
                option.textContent = folder.name;
                return option;
            }));
            folderDialog.showModal();
        } catch (folderLoadError) {
            folderError.textContent = folderLoadError.message;
            folderError.hidden = false;
        } finally {
            folderButton.disabled = !quizId;
        }
    });

    document.getElementById("quiz-folder-confirm").addEventListener("click", async () => {
        folderError.hidden = true;
        try {
            if (!quizId || !folderSelect.value) throw new Error("Choose a folder first.");
            const response = await fetch(
                `/api/quizzes/${encodeURIComponent(quizId)}/folders/${encodeURIComponent(folderSelect.value)}`,
                { method: "POST", headers: { Accept: "application/json" } },
            );
            const data = await readResponse(response, "Could not add quiz to folder.");
            folderDialog.close();
            saveStatus.textContent = `Added to ${data.folder}.`;
        } catch (folderSaveError) {
            folderError.textContent = folderSaveError.message;
            folderError.hidden = false;
        }
    });

    if (requestedQuizId) {
        fetch(`/api/quizzes/${encodeURIComponent(requestedQuizId)}`, {
            headers: { Accept: "application/json" },
        })
            .then((response) => readResponse(response, "Could not load quiz."))
            .then((data) => {
                if (!Array.isArray(data.questions) || !data.questions.length) throw new Error("This saved quiz has no readable questions.");
                showGeneratedQuiz(data, null, data.progress);
            })
            .catch((loadError) => showError(loadError.message));
    }

    window.addEventListener("pagehide", flushProgressSave);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushProgressSave();
    });
})();
