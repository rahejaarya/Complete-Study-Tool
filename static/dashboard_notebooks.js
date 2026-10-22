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
    const toolbar = card.querySelector(".notebook-toolbar");
    if (!card || !toggle || !expanded || !list || !addButton || !nameInput || !contentInput || !status) {
        return;
    }

    let notebookData;
    let saveTimer;
    let saveQueue = Promise.resolve();
    let savedSelection = null;
    let activeHighlight = null;

    // Retain only editor-generated formatting when restoring saved notebook HTML.
    function safeNotebookHtml(value) {
        const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
        const allowed = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "P", "BR", "SPAN", "FONT"]);
        doc.body.querySelectorAll("*").forEach((node) => {
            if (!allowed.has(node.tagName)) {
                node.replaceWith(...node.childNodes);
                return;
            }
            [...node.attributes].forEach((attr) => {
                if (node.tagName === "SPAN" && attr.name === "style") {
                    const color = node.style.color;
                    const background = node.style.backgroundColor;
                    const fontFamily = node.style.fontFamily.replace(/["']/g, "");
                    const fontSize = node.style.fontSize;
                    const textDecoration = node.style.textDecoration;
                    node.removeAttribute("style");
                    if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) node.style.color = color;
                    if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(background)) node.style.backgroundColor = background;
                    if (/^(Arial|Georgia|Times New Roman|Verdana)$/i.test(fontFamily)) node.style.fontFamily = fontFamily;
                    if (/^(?:[89]|[1-5]\d|6[0-4])px$|^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(fontSize)) node.style.fontSize = fontSize;
                    if (/^(underline|line-through|overline)(?:\s+(underline|line-through|overline))*$/.test(textDecoration)) node.style.textDecoration = textDecoration;
                } else if (node.tagName === "FONT" && attr.name === "face") {
                    if (!/^(Arial|Georgia|Times New Roman|Verdana)$/i.test(attr.value)) node.removeAttribute(attr.name);
                } else if (node.tagName === "FONT" && attr.name === "size") {
                    if (!/^[1-7]$/.test(attr.value)) node.removeAttribute(attr.name);
                } else node.removeAttribute(attr.name);
            });
        });
        return doc.body.innerHTML;
    }

    function editorPlainText() {
        return contentInput.innerText.replace(/\u00a0/g, " ").trimEnd();
    }

    function colorInputValue(color) {
        const channels = color.match(/[\d.]+/g);
        if (!channels || channels.length < 3) return "#29273a";
        return `#${channels.slice(0, 3).map((part) => Math.round(Number(part)).toString(16).padStart(2, "0")).join("")}`;
    }

    function rememberEditorSelection() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (contentInput.contains(range.commonAncestorContainer)) {
            savedSelection = range.cloneRange();
        }
    }

    function restoreEditorSelection() {
        contentInput.focus({ preventScroll: true });
        if (!savedSelection || !contentInput.contains(savedSelection.commonAncestorContainer)) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
    }

    function applyFormat(command, value = null) {
        restoreEditorSelection();
        document.execCommand("styleWithCSS", false, true);
        const applied = document.execCommand(command, false, value);
        if (command === "hiliteColor" && !applied) {
            document.execCommand("backColor", false, value);
        }
        rememberEditorSelection();
        contentInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

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
        const savedContent = String(notebook.content || "");
        if (/<\/?(?:b|strong|i|em|u|ul|ol|li|p|br|span|font)\b/i.test(savedContent)) {
            contentInput.innerHTML = safeNotebookHtml(savedContent);
        } else {
            contentInput.textContent = savedContent;
        }
        const quickNotesNotebook = notebookData.notebooks.find(
            (candidate) => candidate.name.trim().toLowerCase() === "quick notes"
        );
        if (quickNoteInput) {
            quickNoteInput.value = (quickNotesNotebook?.content ?? "").replace(/<[^>]*>/g, "");
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
            card.querySelectorAll("textarea, input, button, select").forEach((control) => {
                control.disabled = false;
            });
            contentInput.contentEditable = "true";
            const inkPicker = toolbar?.querySelector('[data-command="foreColor"]');
            if (inkPicker) inkPicker.value = colorInputValue(getComputedStyle(contentInput).color);
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
                contentInput.textContent = quickNoteInput.value;
        }
        scheduleSave();
        });
    }

    // Persist editor changes and mirror them into Quick Notes when applicable.
    contentInput.addEventListener("input", () => {
        setExpanded(true);
        activeNotebook().content = safeNotebookHtml(contentInput.innerHTML);
        if (quickNoteInput && activeNotebook().name.trim().toLowerCase() === "quick notes") {
            quickNoteInput.value = editorPlainText();
        }
        scheduleSave();
    });
    document.addEventListener("selectionchange", rememberEditorSelection);

    if (toolbar) {
        toolbar.addEventListener("mousedown", (event) => {
            rememberEditorSelection();
            if (event.target.closest("button")) event.preventDefault();
        });
        toolbar.addEventListener("click", (event) => {
            const highlight = event.target.closest("[data-highlight-light]");
            if (highlight) {
                const isDark = document.documentElement.dataset.theme?.startsWith("dark");
                const color = isDark ? highlight.dataset.highlightDark : highlight.dataset.highlightLight;
                const togglingOff = activeHighlight === color;
                toolbar.querySelectorAll("[data-highlight-light]").forEach((swatch) => {
                    swatch.setAttribute("aria-pressed", String(!togglingOff && swatch === highlight));
                });
                activeHighlight = togglingOff ? null : color;
                if (!togglingOff) {
                    applyFormat("hiliteColor", color);
                } else if (savedSelection?.collapsed) {
                    // Clear the browser's pending highlight at the caret without changing selected text.
                    applyFormat("hiliteColor", "transparent");
                }
                return;
            }
            const button = event.target.closest("[data-command]");
            if (!button || button.disabled || button.matches("input[type=color]")) return;
            applyFormat(button.dataset.command);
        });
        toolbar.addEventListener("change", (event) => {
            const color = event.target.closest('input[type="color"][data-command]');
            if (color) {
                applyFormat(color.dataset.command, color.value);
                return;
            }
            const select = event.target.closest("[data-format]");
            if (!select) return;
            applyFormat(select.dataset.format, select.value);
        });
    }

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
