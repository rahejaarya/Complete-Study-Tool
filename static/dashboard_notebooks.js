(() => {
    const card = document.getElementById("notes-card");
    const toggle = document.getElementById("notebook-toggle");
    const expanded = document.getElementById("notebook-expanded");
    const list = document.getElementById("notebook-list");
    const addButton = document.getElementById("notebook-add");
    const nameInput = document.getElementById("notebook-name");
    const contentInput = document.getElementById("notebook-content");
    const quickNoteInput = document.getElementById("notebook-quick-note");
    const status = document.getElementById("notebook-save-status");
    let notebookData;
    let saveTimer;
    let saveQueue = Promise.resolve();

    function activeNotebook() {
        return notebookData.notebooks.find(
            (notebook) => notebook.id === notebookData.active_id
        );
    }

    function setExpanded(isExpanded) {
        expanded.hidden = !isExpanded;
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute(
            "aria-label",
            isExpanded ? "Minimize notebooks" : "Open notebooks"
        );
        card.classList.toggle("is-expanded", isExpanded);
    }

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

    function render() {
        const notebook = activeNotebook();
        if (!notebook) {
            throw new Error("The selected notebook could not be found.");
        }
        nameInput.value = notebook.name;
        contentInput.value = notebook.content;
        quickNoteInput.value = notebook.quick_note;
        renderList();
    }

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
                status.textContent = "Saved to your account";
            })
            .catch((error) => {
                status.textContent = "Could not save notebooks. Please try again.";
                console.error("Notebook changes could not be saved.", error);
            });
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(save, 350);
    }

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
            render();
            card.querySelectorAll("textarea, input, button").forEach((control) => {
                control.disabled = false;
            });
            status.textContent = "Saved to your account";
        } catch (error) {
            status.textContent = "Could not load notebooks. Refresh to try again.";
            console.error("Notebooks could not be loaded.", error);
        }
    }

    toggle.addEventListener("click", () => {
        setExpanded(expanded.hidden);
    });

    quickNoteInput.addEventListener("input", () => {
        setExpanded(true);
        activeNotebook().quick_note = quickNoteInput.value;
        scheduleSave();
    });

    contentInput.addEventListener("input", () => {
        setExpanded(true);
        activeNotebook().content = contentInput.value;
        scheduleSave();
    });

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

    nameInput.addEventListener("blur", () => {
        const notebook = activeNotebook();
        if (!notebook.name) {
            notebook.name = "Untitled notebook";
            nameInput.value = notebook.name;
            renderList();
            scheduleSave();
        }
    });

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

    loadNotebooks();
})();
