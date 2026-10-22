(() => {
    const list = document.getElementById("workspace-file-list");
    const emptyState = document.getElementById("workspace-empty");
    const documentView = document.getElementById("workspace-document");
    const notePanel = document.getElementById("workspace-notes-panel");
    const boardPanel = document.getElementById("workspace-board-panel");
    const noteEditor = document.getElementById("workspace-note-content");
    const boardCanvas = document.getElementById("workspace-board");
    const boardContext = boardCanvas?.getContext("2d");
    const titleInput = document.getElementById("workspace-document-title");
    const saveStatus = document.getElementById("workspace-save-status");
    const globalStatus = document.getElementById("workspace-global-status");
    const workspace = document.getElementById("notes-workspace");
    const fileSidebar = document.getElementById("workspace-file-sidebar");
    const sidebarExpand = document.getElementById("workspace-sidebar-expand");
    const boardSize = document.getElementById("board-size");
    const boardSizeLabel = document.getElementById("board-size-label");
    const wordCount = document.getElementById("workspace-word-count");
    if (!list || !workspace || !noteEditor || !boardCanvas) return;

    let data;
    let activeKind = "notes";
    let activeFileId = null;
    let saveTimer;
    let saveQueue = Promise.resolve();
    let savedRange = null;
    let activeColor = "#20242d";
    let activeTool = "pen";
    let drawingStroke = null;
    let pixelRatio = window.devicePixelRatio || 1;
    let undoHistory = [];
    let redoHistory = [];

    workspace.querySelectorAll("button, input, select").forEach((control) => {
        control.disabled = true;
    });

    const currentFile = () => data?.notebooks.find((file) => file.id === activeFileId);
    const currentStrokes = () => {
        const file = currentFile();
        if (!file) return [];
        if (!file.whiteboard || !Array.isArray(file.whiteboard.strokes)) file.whiteboard = { strokes: [] };
        return file.whiteboard.strokes;
    };

    function cleanHtml(value) {
        const parsed = new DOMParser().parseFromString(String(value || ""), "text/html");
        const allowed = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "P", "BR", "SPAN", "FONT"]);
        parsed.body.querySelectorAll("*").forEach((node) => {
            if (!allowed.has(node.tagName)) {
                node.replaceWith(...node.childNodes);
                return;
            }
            [...node.attributes].forEach((attribute) => {
                if (node.tagName === "SPAN" && attribute.name === "style") {
                    const style = {
                        color: node.style.color,
                        backgroundColor: node.style.backgroundColor,
                        fontFamily: node.style.fontFamily.replace(/["']/g, ""),
                        fontSize: node.style.fontSize,
                        textDecoration: node.style.textDecoration
                    };
                    node.removeAttribute("style");
                    if (/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(style.color)) node.style.color = style.color;
                    if (/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(style.backgroundColor)) node.style.backgroundColor = style.backgroundColor;
                    if (/^(Arial|Georgia|Times New Roman|Verdana)$/i.test(style.fontFamily)) node.style.fontFamily = style.fontFamily;
                    if (/^(?:[89]|[1-5]\d|6[0-4])px$|^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i.test(style.fontSize)) node.style.fontSize = style.fontSize;
                    if (/^(underline|line-through|overline)$/.test(style.textDecoration)) node.style.textDecoration = style.textDecoration;
                } else if (node.tagName === "FONT" && attrNameAllowed(node, attribute)) {
                    if (attribute.name === "face" && !/^(Arial|Georgia|Times New Roman|Verdana)$/i.test(attribute.value)) node.removeAttribute(attribute.name);
                    if (attribute.name === "size" && !/^[1-7]$/.test(attribute.value)) node.removeAttribute(attribute.name);
                    if (attribute.name === "color" && !/^#[\da-f]{3,8}$/i.test(attribute.value)) node.removeAttribute(attribute.name);
                } else node.removeAttribute(attribute.name);
            });
        });
        return parsed.body.innerHTML;
    }

    function attrNameAllowed(node, attribute) {
        return node.tagName === "FONT" && ["face", "size", "color"].includes(attribute.name);
    }

    function rememberRange() {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (noteEditor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
    }

    function restoreRange() {
        noteEditor.focus({ preventScroll: true });
        if (!savedRange || !noteEditor.contains(savedRange.commonAncestorContainer)) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    function applyTextCommand(command, value = null) {
        restoreRange();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(command, false, value);
        rememberRange();
        noteEditor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function updateWordCount() {
        const text = noteEditor.innerText.trim();
        const count = text ? text.split(/\s+/).length : 0;
        wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
    }

    function renderFiles() {
        const files = data.notebooks.filter((file) => (file.kind || "notes") === activeKind);
        list.replaceChildren();
        files.forEach((file) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "workspace-file-item";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", String(file.id === activeFileId));
            button.innerHTML = `<span class="workspace-file-icon" aria-hidden="true">${activeKind === "notes" ? "▤" : "▧"}</span><span class="workspace-file-name"></span><span class="workspace-file-arrow" aria-hidden="true">›</span>`;
            button.querySelector(".workspace-file-name").textContent = file.name;
            button.addEventListener("click", () => openFile(file.id));
            list.append(button);
        });
        const empty = document.createElement("p");
        empty.className = "workspace-library-empty";
        empty.textContent = files.length ? "" : `No ${activeKind === "notes" ? "notes" : "whiteboards"} yet`;
        empty.hidden = files.length > 0;
        list.append(empty);
        document.getElementById("workspace-file-heading").textContent = activeKind === "notes" ? "My notes" : "My whiteboards";
    }

    function openFile(id) {
        activeFileId = id;
        const file = currentFile();
        if (!file) return;
        emptyState.hidden = true;
        documentView.hidden = false;
        notePanel.hidden = file.kind !== "notes";
        boardPanel.hidden = file.kind !== "whiteboard";
        document.getElementById("workspace-document-kind").textContent = file.kind === "notes" ? "NOTE" : "WHITEBOARD";
        titleInput.value = file.name;
        titleInput.placeholder = file.kind === "notes" ? "Untitled note" : "Untitled whiteboard";
        if (file.kind === "notes") {
            const content = String(file.content || "");
            if (/<\/?(?:b|strong|i|em|u|ul|ol|li|p|br|span|font)\b/i.test(content)) noteEditor.innerHTML = cleanHtml(content);
            else noteEditor.textContent = content;
            updateWordCount();
        } else {
            undoHistory = [];
            redoHistory = [];
            requestAnimationFrame(resizeCanvas);
            updateHistoryButtons();
        }
        saveStatus.textContent = "Saved";
        renderFiles();
    }

    function showLibrary() {
        activeFileId = null;
        documentView.hidden = true;
        emptyState.hidden = false;
        const notesMode = activeKind === "notes";
        document.getElementById("workspace-empty-title").textContent = notesMode ? "A clear space to think." : "Sketch it out.";
        document.getElementById("workspace-empty-copy").textContent = notesMode
            ? "Choose a note from the library or create one to get started."
            : "Open a saved whiteboard or create a fresh canvas.";
        renderFiles();
    }

    function selectKind(kind) {
        activeKind = kind;
        document.querySelectorAll("[data-workspace-kind]").forEach((button) => {
            button.setAttribute("aria-selected", String(button.dataset.workspaceKind === kind));
        });
        const label = kind === "notes" ? "Notes" : "Whiteboards";
        document.getElementById("workspace-mode-label").textContent = label;
        document.getElementById("workspace-new-file").innerHTML = `＋ <span>New ${kind === "notes" ? "note" : "whiteboard"}</span>`;
        document.getElementById("workspace-sidebar-new").textContent = `＋ New ${kind === "notes" ? "note" : "whiteboard"}`;
        showLibrary();
    }

    function updateSaveStatus(message = "Unsaved changes") {
        if (saveStatus && !documentView.hidden) saveStatus.textContent = message;
    }

    async function saveData() {
        if (!data) return;
        updateSaveStatus("Saving…");
        saveQueue = saveQueue.then(async () => {
            const response = await fetch("/api/notebooks", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Save failed.");
            if (!documentView.hidden) updateSaveStatus("Saved");
        }).catch((error) => {
            console.error("Workspace file could not be saved.", error);
            updateSaveStatus("Could not save");
            globalStatus.textContent = "A file could not be saved. Please try again.";
        });
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);
        updateSaveStatus();
        saveTimer = window.setTimeout(saveData, 400);
    }

    function makeFile(kind) {
        const file = {
            id: crypto.randomUUID(),
            name: kind === "notes" ? "Untitled note" : "Untitled whiteboard",
            kind,
            content: "",
            quick_note: "",
            whiteboard: { strokes: [] },
            is_quick_notes: false
        };
        data.notebooks.push(file);
        activeKind = kind;
        selectKind(kind);
        openFile(file.id);
        titleInput.focus();
        titleInput.select();
        scheduleSave();
    }

    function boardPoint(event) {
        const rect = boardCanvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
        };
    }

    function resizeCanvas() {
        if (boardPanel.hidden) return;
        const rect = boardCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        pixelRatio = window.devicePixelRatio || 1;
        boardCanvas.width = Math.round(rect.width * pixelRatio);
        boardCanvas.height = Math.round(rect.height * pixelRatio);
        drawBoard();
    }

    function drawBoard() {
        const width = boardCanvas.clientWidth;
        const height = boardCanvas.clientHeight;
        boardContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        boardContext.fillStyle = "#ffffff";
        boardContext.fillRect(0, 0, width, height);
        currentStrokes().forEach((stroke) => {
            if (stroke.type === "text") {
                boardContext.globalCompositeOperation = "source-over";
                boardContext.fillStyle = stroke.color || "#20242d";
                boardContext.font = `${stroke.size || 20}px Arial, sans-serif`;
                boardContext.fillText(stroke.text || "", stroke.x * width, stroke.y * height);
                return;
            }
            const points = Array.isArray(stroke.points) ? stroke.points : [];
            if (!points.length) return;
            const tool = stroke.tool || (stroke.erase ? "eraser" : "pen");
            boardContext.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
            boardContext.strokeStyle = stroke.color || "#20242d";
            boardContext.lineWidth = Math.max(1, Number(stroke.size) || 5);
            boardContext.lineCap = "round";
            boardContext.lineJoin = "round";
            boardContext.globalAlpha = tool === "highlighter" ? 0.24 : tool === "pencil" ? 0.72 : tool === "marker" ? 0.82 : 1;
            if (tool === "marker") boardContext.lineWidth *= 2.4;
            if (tool === "highlighter") boardContext.lineWidth *= 3.5;
            if (tool === "eraser") boardContext.lineWidth *= 3.2;
            boardContext.beginPath();
            boardContext.moveTo(points[0].x * width, points[0].y * height);
            if (points.length === 1) {
                boardContext.lineTo(points[0].x * width + 0.1, points[0].y * height + 0.1);
            } else {
                for (let index = 1; index < points.length - 1; index += 1) {
                    const middleX = (points[index].x + points[index + 1].x) * width / 2;
                    const middleY = (points[index].y + points[index + 1].y) * height / 2;
                    boardContext.quadraticCurveTo(points[index].x * width, points[index].y * height, middleX, middleY);
                }
                const last = points[points.length - 1];
                boardContext.lineTo(last.x * width, last.y * height);
            }
            boardContext.stroke();
            boardContext.globalAlpha = 1;
        });
        boardContext.globalAlpha = 1;
        boardContext.globalCompositeOperation = "source-over";
    }

    function pushHistory() {
        undoHistory.push(JSON.stringify(currentStrokes()));
        if (undoHistory.length > 40) undoHistory.shift();
        redoHistory = [];
        updateHistoryButtons();
    }

    function updateHistoryButtons() {
        document.getElementById("board-undo").disabled = !undoHistory.length;
        document.getElementById("board-redo").disabled = !redoHistory.length;
    }

    function saveBoardChange() {
        const file = currentFile();
        if (!file) return;
        file.whiteboard = { strokes: currentStrokes() };
        drawBoard();
        scheduleSave();
        updateHistoryButtons();
    }

    document.querySelectorAll("[data-workspace-kind]").forEach((button) => {
        button.addEventListener("click", () => selectKind(button.dataset.workspaceKind));
    });
    document.getElementById("workspace-new-file").addEventListener("click", () => makeFile(activeKind));
    document.getElementById("workspace-sidebar-new").addEventListener("click", () => makeFile(activeKind));
    document.querySelectorAll("[data-create-kind]").forEach((button) => {
        button.addEventListener("click", () => makeFile(button.dataset.createKind));
    });
    document.getElementById("workspace-sidebar-collapse").addEventListener("click", () => {
        workspace.classList.add("files-collapsed");
        sidebarExpand.hidden = false;
    });
    sidebarExpand.addEventListener("click", () => {
        workspace.classList.remove("files-collapsed");
        sidebarExpand.hidden = true;
    });

    titleInput.addEventListener("input", () => {
        const file = currentFile();
        if (!file) return;
        file.name = titleInput.value.trim();
        renderFiles();
        scheduleSave();
    });
    titleInput.addEventListener("blur", () => {
        const file = currentFile();
        if (!file) return;
        if (!file.name) file.name = file.kind === "notes" ? "Untitled note" : "Untitled whiteboard";
        titleInput.value = file.name;
        renderFiles();
        scheduleSave();
    });
    titleInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            titleInput.blur();
        }
    });

    noteEditor.addEventListener("input", () => {
        const file = currentFile();
        if (!file) return;
        file.content = cleanHtml(noteEditor.innerHTML);
        updateWordCount();
        scheduleSave();
    });
    document.addEventListener("selectionchange", rememberRange);
    document.querySelector(".workspace-text-toolbar").addEventListener("mousedown", (event) => {
        rememberRange();
        if (event.target.closest("button")) event.preventDefault();
    });
    document.querySelector(".workspace-text-toolbar").addEventListener("click", (event) => {
        const color = event.target.closest("[data-note-color]");
        if (color) {
            applyTextCommand("foreColor", color.dataset.noteColor);
            return;
        }
        const highlight = event.target.closest("[data-note-highlight]");
        if (highlight) {
            applyTextCommand("hiliteColor", highlight.dataset.noteHighlight);
            return;
        }
        const button = event.target.closest("[data-note-command]");
        if (button) applyTextCommand(button.dataset.noteCommand);
    });
    document.querySelector(".workspace-text-toolbar").addEventListener("change", (event) => {
        const select = event.target.closest("[data-note-format]");
        if (select) applyTextCommand(select.dataset.noteFormat, select.value);
    });

    document.querySelectorAll("[data-board-tool]").forEach((button) => {
        button.addEventListener("click", () => {
            activeTool = button.dataset.boardTool;
            document.querySelectorAll("[data-board-tool]").forEach((toolButton) => {
                toolButton.setAttribute("aria-pressed", String(toolButton === button));
            });
            boardSizeLabel.textContent = activeTool === "eraser" ? "Eraser size" : "Pen size";
        });
    });
    document.querySelectorAll("[data-board-color]").forEach((button) => {
        button.addEventListener("click", () => {
            activeColor = button.dataset.boardColor;
            document.querySelectorAll("[data-board-color]").forEach((colorButton) => {
                colorButton.setAttribute("aria-pressed", String(colorButton === button));
            });
            if (activeTool === "eraser") {
                activeTool = "pen";
                document.querySelector('[data-board-tool="pen"]').click();
            }
        });
    });
    boardSize.addEventListener("input", () => {
        boardSizeLabel.textContent = `${activeTool === "eraser" ? "Eraser" : "Pen"} size ${boardSize.value}`;
    });

    boardCanvas.addEventListener("pointerdown", (event) => {
        if (!currentFile()) return;
        if (activeTool === "text") {
            const text = window.prompt("Text to add to the board:");
            if (text) {
                pushHistory();
                const point = boardPoint(event);
                currentStrokes().push({ type: "text", text: text.slice(0, 500), x: point.x, y: point.y, color: activeColor, size: 24 });
                saveBoardChange();
            }
            return;
        }
        boardCanvas.setPointerCapture(event.pointerId);
        pushHistory();
        drawingStroke = {
            tool: activeTool,
            color: activeColor,
            size: Number(boardSize.value),
            points: [boardPoint(event)]
        };
        currentStrokes().push(drawingStroke);
        drawBoard();
    });
    boardCanvas.addEventListener("pointermove", (event) => {
        if (!drawingStroke) return;
        drawingStroke.points.push(boardPoint(event));
        drawBoard();
    });
    const endStroke = () => {
        if (!drawingStroke) return;
        drawingStroke = null;
        saveBoardChange();
    };
    boardCanvas.addEventListener("pointerup", endStroke);
    boardCanvas.addEventListener("pointercancel", endStroke);

    document.getElementById("board-undo").addEventListener("click", () => {
        if (!undoHistory.length) return;
        redoHistory.push(JSON.stringify(currentStrokes()));
        currentFile().whiteboard.strokes = JSON.parse(undoHistory.pop());
        saveBoardChange();
    });
    document.getElementById("board-redo").addEventListener("click", () => {
        if (!redoHistory.length) return;
        undoHistory.push(JSON.stringify(currentStrokes()));
        currentFile().whiteboard.strokes = JSON.parse(redoHistory.pop());
        saveBoardChange();
    });
    document.getElementById("board-clear").addEventListener("click", () => {
        if (!currentStrokes().length) return;
        pushHistory();
        currentFile().whiteboard.strokes = [];
        saveBoardChange();
    });

    window.addEventListener("resize", () => {
        if (currentFile()?.kind === "whiteboard") resizeCanvas();
    });

    async function load() {
        try {
            const response = await fetch("/api/notebooks");
            const result = await response.json();
            if (!response.ok || !Array.isArray(result.notebooks)) throw new Error(result.error || "Could not load your files.");
            data = result;
            let migrated = false;
            data.notebooks.forEach((file) => {
                file.kind = file.kind || "notes";
                if (file.kind === "notes" && file.whiteboard?.strokes?.length) {
                    data.notebooks.push({
                        id: crypto.randomUUID(),
                        name: `${file.name} board`.slice(0, 80),
                        kind: "whiteboard",
                        content: "",
                        quick_note: "",
                        whiteboard: file.whiteboard,
                        is_quick_notes: false
                    });
                    file.whiteboard = { strokes: [] };
                    migrated = true;
                }
            });
            const quickNotes = data.notebooks.find((file) => file.is_quick_notes || file.name.trim().toLowerCase() === "quick notes");
            if (quickNotes) quickNotes.is_quick_notes = true;
            workspace.querySelectorAll("button, input, select").forEach((control) => {
                control.disabled = false;
            });
            showLibrary();
            if (migrated) scheduleSave();
            if (!data.notebooks.some((file) => file.kind === activeKind)) {
                globalStatus.textContent = "Create a note or a whiteboard to begin.";
            }
        } catch (error) {
            console.error("Workspace files could not be loaded.", error);
            globalStatus.textContent = "Could not load your files. Refresh to try again.";
        }
    }

    document.querySelectorAll("[data-board-color]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.boardColor === activeColor));
    });
    new ResizeObserver(() => {
        if (currentFile()?.kind === "whiteboard") resizeCanvas();
    }).observe(boardCanvas);
    load();
})();
