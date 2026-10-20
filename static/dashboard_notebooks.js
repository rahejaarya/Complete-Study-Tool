(() => {
    // Notebook editor controls and save state for the dashboard and notes page.
    const card = document.getElementById("notes-card");
    const toggle = document.getElementById("notebook-toggle");
    const expanded = document.getElementById("notebook-expanded");
    const list = document.getElementById("notebook-list");
    const addButton = document.getElementById("notebook-add");
    const nameInput = document.getElementById("notebook-name");
    const contentInput = document.getElementById("notebook-content");
    const quickNoteInput = document.getElementById("notebook-quick-note");
    const status = document.getElementById("notebook-save-status");
    if (!card || !toggle || !expanded || !list || !addButton || !nameInput || !contentInput || !status) {
        return;
    }

    let notebookData;
    let saveTimer;
    let saveQueue = Promise.resolve();

    // Return the notebook currently selected in the saved notebook collection.
    function activeNotebook() {
        return notebookData.notebooks.find(
            (notebook) => notebook.id === notebookData.active_id
        );
    }

    // Synchronize the expanded editor panel with its accessible toggle state.
    function setExpanded(isExpanded) {
        expanded.hidden = !isExpanded;
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute(
            "aria-label",
            isExpanded ? "Minimize notebooks" : "Open notebooks"
        );
        card.classList.toggle("is-expanded", isExpanded);
    }

    // Preserve the dedicated Quick Notes notebook expected by the dashboard field.
    function ensureQuickNotesNotebook() {
        const quickNotesNotebook = notebookData.notebooks.find(
            (notebook) => notebook.name.trim().toLowerCase() === "quick notes"
        );
        if (quickNotesNotebook) {
            if (!notebookData.active_id) {
                notebookData.active_id = quickNotesNotebook.id;
            }
            return;
        }

        const notebook = {
            id: crypto.randomUUID(),
            name: "Quick Notes",
            content: "",
            quick_note: ""
        };
        notebookData.notebooks.unshift(notebook);
        notebookData.active_id = notebook.id;
    }

    // Rebuild the notebook selector and mark the active entry.
    function renderList() {
        list.replaceChildren();
        notebookData.notebooks.forEach((notebook) => {
            const item = document.createElement("button");
            item.className = "notebook-list-item";
            item.type = "button";
            item.textContent = notebook.name;
            item.setAttribute(
                "aria-current",
                String(notebook.id === notebookData.active_id)
            );
            item.addEventListener("click", () => {
                notebookData.active_id = notebook.id;
                render();
                scheduleSave();
            });
            list.append(item);
        });
    }

    // Populate editor fields and list items from the active notebook data.
    function render() {
        const notebook = activeNotebook();
        if (!notebook) {
            throw new Error("The selected notebook could not be found.");
        }
        nameInput.value = notebook.name;
        contentInput.value = notebook.content;
        const quickNotesNotebook = notebookData.notebooks.find(
            (candidate) => candidate.name.trim().toLowerCase() === "quick notes"
        );
        if (quickNoteInput) {
            quickNoteInput.value = quickNotesNotebook?.content ?? "";
        }
        renderList();
    }

    // Serialize writes through one promise queue to prevent stale saves winning.
    function save() {
        status.textContent = "Saving notebooks…";
        saveQueue = saveQueue
            .then(async () => {
                const response = await fetch("/api/notebooks", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(notebookData)
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || `Save failed (${response.status}).`);
                }
                status.textContent = "";
            })
            .catch((error) => {
                status.textContent = "Could not save notebooks. Please try again.";
                console.error("Notebook changes could not be saved.", error);
            });
    }

    // Debounce edits so frequent keystrokes produce a single API save.
    function scheduleSave() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(save, 350);
    }

    // Load the account's notebooks, initialize controls, and report failures.
    async function loadNotebooks() {
        try {
            const response = await fetch("/api/notebooks");
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || `Load failed (${response.status}).`);
            }
            if (!Array.isArray(payload.notebooks) || !payload.notebooks.length) {
                throw new Error("The saved notebooks response is invalid.");
            }
            notebookData = payload;
            ensureQuickNotesNotebook();
            render();
            card.querySelectorAll("textarea, input, button").forEach((control) => {
                control.disabled = false;
            });
            status.textContent = "";
        } catch (error) {
            status.textContent = "Could not load notebooks. Refresh to try again.";
            console.error("Notebooks could not be loaded.", error);
        }
    }

    // Open the standalone notes page from the dashboard or toggle its editor.
    toggle.addEventListener("click", (event) => {
        if (window.location.pathname !== "/notes") {
            event.preventDefault();
            window.location.href = "/notes";
            return;
        }
        setExpanded(expanded.hidden);
    });

    // Keep the dashboard's quick-note field linked to the Quick Notes notebook.
    if (quickNoteInput) {
        quickNoteInput.addEventListener("input", () => {
        if (window.location.pathname === "/notes") {
            setExpanded(true);
        }
        const quickNotesNotebook = notebookData.notebooks.find(
            (candidate) => candidate.name.trim().toLowerCase() === "quick notes"
        );
        if (!quickNotesNotebook) {
            return;
        }
        quickNotesNotebook.content = quickNoteInput.value;
        if (activeNotebook().id === quickNotesNotebook.id) {
            contentInput.value = quickNoteInput.value;
        }
        scheduleSave();
        });
    }

    // Persist editor changes and mirror them into Quick Notes when applicable.
    contentInput.addEventListener("input", () => {
        setExpanded(true);
        activeNotebook().content = contentInput.value;
        if (quickNoteInput && activeNotebook().name.trim().toLowerCase() === "quick notes") {
            quickNoteInput.value = contentInput.value;
        }
        scheduleSave();
    });

    // Save valid notebook names while warning about a temporarily blank name.
    nameInput.addEventListener("input", () => {
        const notebook = activeNotebook();
        notebook.name = nameInput.value.trim();
        renderList();
        if (notebook.name) {
            scheduleSave();
        } else {
            status.textContent = "Notebook names cannot be empty.";
        }
    });

    // Restore a usable name if the user leaves the name field empty.
    nameInput.addEventListener("blur", () => {
        const notebook = activeNotebook();
        if (!notebook.name) {
            notebook.name = "Untitled notebook";
            nameInput.value = notebook.name;
            renderList();
            scheduleSave();
        }
    });

    // Create a new notebook, select it, and focus its name for immediate editing.
    addButton.addEventListener("click", () => {
        const notebook = {
            id: crypto.randomUUID(),
            name: "New notebook",
            content: "",
            quick_note: ""
        };
        notebookData.notebooks.push(notebook);
        notebookData.active_id = notebook.id;
        setExpanded(true);
        render();
        nameInput.focus();
        nameInput.select();
        scheduleSave();
    });

    setExpanded(window.location.pathname === "/notes");
    loadNotebooks();
})();
