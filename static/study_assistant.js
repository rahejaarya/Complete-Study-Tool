(() => {
    const form = document.getElementById("study-assistant-form");
    if (!form) return;

    const question = document.getElementById("study-assistant-question");
    const submit = document.getElementById("study-assistant-submit");
    const messages = document.getElementById("study-assistant-messages");
    const status = document.getElementById("study-assistant-status");
    const clearButton = document.getElementById("study-assistant-clear");
    const saveButton = document.getElementById("study-assistant-save");
    const materialSelect = document.getElementById("study-assistant-materials");
    const libraryMode = document.body.classList.contains("library-mode");
    let activeFolderId = null;
    let lastAnswer = "";

    function addMessage(text, role) {
        messages.querySelector(".study-assistant-empty")?.remove();
        const message = document.createElement("article");
        message.className = `study-assistant-message ${role}`;
        const label = document.createElement("strong");
        label.textContent = role === "user" ? "You" : "Cypher";
        const body = document.createElement("div");
        body.textContent = text;
        message.append(label, body);
        messages.append(message);
        messages.scrollTop = messages.scrollHeight;
        return body;
    }

    function streamResponse(response) {
        if (!response.body) throw new Error("The AI response could not be read.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantBody = null;
        let assistantText = "";

        return new Promise((resolve, reject) => {
            async function read() {
                try {
                    const result = await reader.read();
                    if (result.done) return resolve();
                    buffer += decoder.decode(result.value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const data = JSON.parse(line);
                        if (data.type === "token") {
                            if (!assistantBody) assistantBody = addMessage("", "assistant");
                            assistantText += data.content;
                            assistantBody.textContent = assistantText;
                            messages.scrollTop = messages.scrollHeight;
                        } else if (data.type === "error") {
                            throw new Error(data.message);
                        } else if (data.type === "done") {
                            resolve();
                            return;
                        }
                    }
                    void read();
                } catch (error) {
                    reject(error);
                }
            }
            void read();
        }).then(() => {
            lastAnswer = assistantText.trim();
            saveButton.hidden = !libraryMode || !lastAnswer;
        });
    }

    async function submitQuestion(event) {
        event.preventEventDefault?.();
        event.preventDefault();
        const text = question.value.trim();
        if (!text || submit.disabled) return;
        addMessage(text, "user");
        question.value = "";
        submit.disabled = true;
        question.disabled = true;
        status.textContent = "Cypher is thinking…";
        saveButton.hidden = true;

        const selectedItems = materialSelect
            ? Array.from(materialSelect.selectedOptions, option => option.value)
            : [];
        const topic = libraryMode ? "" : document.getElementById("resource-browser-topic")?.textContent?.trim() || "";
        try {
            const response = await fetch("/api/study-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" },
                credentials: "same-origin",
                body: JSON.stringify({
                    question: text,
                    folder_id: activeFolderId,
                    item_ids: selectedItems,
                    topic
                })
            });
            if (!response.ok) {
                const data = await window.MeridianApi.read(response, "Cypher could not answer this question.");
                throw new Error(data.error || "Cypher could not answer this question.");
            }
            await streamResponse(response);
            status.textContent = "";
        } catch (error) {
            status.textContent = error.message || "Cypher could not answer this question.";
        } finally {
            submit.disabled = false;
            question.disabled = false;
            question.focus();
        }
    }

    async function saveAnswer() {
        if (!libraryMode || !activeFolderId || !lastAnswer) return;
        saveButton.disabled = true;
        saveButton.textContent = "Creating note…";
        try {
            const response = await fetch(`/api/saved-folders/${encodeURIComponent(activeFolderId)}/notes`, {
                method: "POST",
                headers: { "Accept": "application/json" },
                credentials: "same-origin"
            });
            const data = await window.MeridianApi.read(response, "Could not create a note.");
            const notebookId = data.notebook.id;
            const notebooksResponse = await fetch("/api/notebooks", { credentials: "same-origin" });
            const notebooksData = await window.MeridianApi.read(notebooksResponse, "Could not load notebooks.");
            const notebooks = notebooksData.notebooks;
            const notebook = notebooks.find(item => item.id === notebookId);
            if (!notebook) throw new Error("The new note could not be found.");
            notebook.name = "Cypher study notes";
            notebook.content = `<p>${lastAnswer.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "</p><p>")}</p>`;
            const saveResponse = await fetch("/api/notebooks", {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ notebooks, active_id: notebookId })
            });
            await window.MeridianApi.read(saveResponse, "Could not save the study note.");
            status.textContent = "Saved as a note in this folder.";
            saveButton.textContent = "Saved as note";
        } catch (error) {
            status.textContent = error.message || "Could not save this answer as a note.";
        } finally {
            saveButton.disabled = false;
        }
    }

    form.addEventListener("submit", submitQuestion);
    clearButton?.addEventListener("click", () => {
        messages.replaceChildren();
        lastAnswer = "";
        saveButton.hidden = true;
        status.textContent = "";
    });
    saveButton?.addEventListener("click", saveAnswer);

    document.addEventListener("meridian:folder-opened", event => {
        activeFolderId = event.detail?.folderId || null;
        if (!materialSelect) return;
        materialSelect.replaceChildren();
        const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
        items.forEach(item => {
            const option = document.createElement("option");
            option.value = item.storage_id || item.file_id || item.notebook_id;
            option.textContent = item.custom_title || item.title || item.original_filename || "Saved material";
            if (option.value) materialSelect.append(option);
        });
    });

    window.MeridianStudyAssistant = {
        setFolder(folderId, items) {
            activeFolderId = folderId || null;
            document.dispatchEvent(new CustomEvent("meridian:folder-opened", {
                detail: { folderId, items }
            }));
        }
    };
})();
