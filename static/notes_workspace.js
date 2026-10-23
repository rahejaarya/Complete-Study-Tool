(() => {
    const list = document.getElementById("workspace-file-list");
    const documentView = document.getElementById("workspace-document");
    const notePanel = document.getElementById("workspace-notes-panel");
    const boardPanel = document.getElementById("workspace-board-panel");
    const noteEditor = document.getElementById("workspace-note-content");
    const boardCanvas = document.getElementById("workspace-board");
    const boardContext = boardCanvas?.getContext("2d");
    const titleInput = document.getElementById("workspace-document-title");
    const themeToggle = document.getElementById("workspace-theme-toggle");
    const workspace = document.getElementById("notes-workspace");
    const library = document.getElementById("workspace-library");
    const libraryEmpty = document.getElementById("workspace-library-empty");
    const boardSize = document.getElementById("board-size");
    const boardSizeLabel = document.getElementById("board-size-label");
    const wordCount = document.getElementById("workspace-word-count");
    if (!list || !workspace || !noteEditor || !boardCanvas) return;

    const noteFonts = [
        ["Arial", "Arial, sans-serif"], ["Helvetica", "Helvetica, sans-serif"], ["Verdana", "Verdana, sans-serif"],
        ["Tahoma", "Tahoma, sans-serif"], ["Trebuchet MS", "'Trebuchet MS', sans-serif"], ["Segoe UI", "'Segoe UI', sans-serif"],
        ["Georgia", "Georgia, serif"], ["Times New Roman", "'Times New Roman', serif"], ["Garamond", "Garamond, serif"],
        ["Palatino Linotype", "'Palatino Linotype', serif"], ["Book Antiqua", "'Book Antiqua', serif"], ["Baskerville", "Baskerville, serif"],
        ["Bodoni 72", "'Bodoni 72', serif"], ["Didot", "Didot, serif"], ["Courier New", "'Courier New', monospace"],
        ["Lucida Console", "'Lucida Console', monospace"], ["Consolas", "Consolas, monospace"], ["Monaco", "Monaco, monospace"],
        ["Comic Sans MS", "'Comic Sans MS', cursive"], ["Chalkboard", "Chalkboard, cursive"], ["Marker Felt", "'Marker Felt', cursive"],
        ["Bradley Hand", "'Bradley Hand', cursive"], ["Segoe Script", "'Segoe Script', cursive"], ["Brush Script MT", "'Brush Script MT', cursive"],
        ["Papyrus", "Papyrus, fantasy"], ["Impact", "Impact, fantasy"], ["Copperplate", "Copperplate, fantasy"],
        ["Cursive", "cursive"], ["Fantasy", "fantasy"], ["System UI", "system-ui, sans-serif"]
    ];
    const fontPicker = document.querySelector("[data-font-picker]");
    const fontToggle = fontPicker?.querySelector("[data-font-picker-toggle]");
    const fontMenu = fontPicker?.querySelector("[data-font-picker-menu]");
    noteFonts.forEach(([name, family]) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "workspace-font-option";
        option.setAttribute("role", "option");
        option.dataset.fontName = name;
        option.style.fontFamily = family;
        option.textContent = name;
        fontMenu?.append(option);
    });
    fontToggle?.addEventListener("click", () => {
        const open = fontMenu.hidden;
        fontMenu.hidden = !open;
        fontToggle.setAttribute("aria-expanded", String(open));
    });

    let data;
    let activeKind = new URLSearchParams(window.location.search).get("kind") === "whiteboard" ? "whiteboard" : "notes";
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
        const allowedFonts = [...noteFonts.map(([name]) => name), "system-ui"];
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
                    if (allowedFonts.some((font) => font.toLowerCase() === style.fontFamily.toLowerCase())) node.style.fontFamily = style.fontFamily;
                    if (/^(?:[89]|[1-5]\d|6[0-4])px$|^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i.test(style.fontSize)) node.style.fontSize = style.fontSize;
                    if (/^(underline|line-through|overline)$/.test(style.textDecoration)) node.style.textDecoration = style.textDecoration;
                } else if (node.tagName === "FONT" && attrNameAllowed(node, attribute)) {
                    if (attribute.name === "face" && !allowedFonts.some((font) => font.toLowerCase() === attribute.value.toLowerCase())) node.removeAttribute(attribute.name);
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
        if (command === "fontSize") {
            document.execCommand(command, false, 7);
            const selection = window.getSelection();
            const focusNode = selection?.focusNode;
            const focusElement = focusNode?.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode?.parentElement;
            let target = focusElement?.closest('font[size="7"], span[style]');
            if (target && noteEditor.contains(target)) {
                if (target.tagName === "FONT") {
                    const span = document.createElement("span");
                    if (target.face) span.style.fontFamily = target.face;
                    if (target.color) span.style.color = target.color;
                    target.replaceWith(span);
                    span.append(...target.childNodes);
                    target = span;
                }
                target.style.fontSize = `${Number(value)}px`;
            }
        } else {
            document.execCommand(command, false, value);
        }
        rememberRange();
        noteEditor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function updateWordCount() {
        const text = noteEditor.innerText.trim();
        const count = text ? text.split(/\s+/).length : 0;
        wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
    }

    function makeFilePreview(file) {
        const page = document.createElement("div");
        const isDark = file.theme === "dark";
        page.className = `workspace-card-page${file.kind === "whiteboard" ? " is-whiteboard" : ""}${isDark ? " is-dark" : ""}`;
        if (file.kind === "whiteboard") {
            const canvas = document.createElement("canvas");
            canvas.className = "workspace-card-board-preview";
            canvas.width = 240;
            canvas.height = 310;
            const context = canvas.getContext("2d");
            context.fillStyle = isDark ? "#222733" : "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            (file.whiteboard?.strokes || []).forEach((stroke) => {
                if (stroke.type === "text") {
                    context.fillStyle = stroke.color || "#20242d";
                    context.font = `${Math.max(8, (Number(stroke.size) || 20) * .38)}px Arial`;
                    context.shadowColor = isDark ? "#f1f3f7" : "transparent";
                    context.shadowBlur = isDark ? 2 : 0;
                    context.fillText(String(stroke.text || "").slice(0, 45), stroke.x * canvas.width, stroke.y * canvas.height);
                    context.shadowBlur = 0;
                    return;
                }
                const points = Array.isArray(stroke.points) ? stroke.points : [];
                if (!points.length) return;
                context.beginPath();
                context.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
                points.slice(1).forEach((point) => context.lineTo(point.x * canvas.width, point.y * canvas.height));
                context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
                context.strokeStyle = stroke.color || "#20242d";
                context.lineWidth = Math.max(1, (Number(stroke.size) || 5) * .38 * (stroke.tool === "marker" ? 2.4 : 1));
                context.lineCap = "round";
                context.lineJoin = "round";
                context.globalAlpha = stroke.tool === "highlighter" ? .24 : 1;
                context.stroke();
                context.globalAlpha = 1;
                context.globalCompositeOperation = "source-over";
            });
            page.append(canvas);
        } else {
            const content = document.createElement("div");
            content.className = "workspace-card-page-text";
            content.innerHTML = cleanHtml(String(file.content || ""));
            page.append(content);
        }
        return page;
    }

    function renderFiles() {
        const files = data.notebooks.filter((file) => (file.kind || "notes") === activeKind);
        list.replaceChildren();
        files.forEach((file) => {
            const card = document.createElement("article");
            card.className = "workspace-file-card";
            card.setAttribute("role", "option");
            card.setAttribute("aria-selected", String(file.id === activeFileId));
            const open = document.createElement("button");
            open.type = "button";
            open.className = "workspace-file-open";
            open.setAttribute("aria-label", `Open ${file.name}`);
            open.append(makeFilePreview(file));
            const name = document.createElement("span");
            name.className = "workspace-card-name";
            name.textContent = file.name;
            const type = document.createElement("span");
            type.className = "workspace-card-type";
            type.textContent = file.kind === "notes" ? "NOTE" : "WHITEBOARD";
            open.append(name, type);
            open.addEventListener("click", () => openFile(file.id));

            const actions = document.createElement("div");
            actions.className = "workspace-card-actions";
            const rename = document.createElement("button");
            rename.type = "button";
            rename.className = "workspace-card-action";
            rename.textContent = "Rename";
            rename.setAttribute("aria-label", `Rename ${file.name}`);
            rename.addEventListener("click", async () => {
                const nextName = window.prompt("Rename file", file.name);
                if (nextName === null) return;
                const trimmed = nextName.trim().slice(0, 80);
                if (!trimmed) return;
                file.name = trimmed;
                renderFiles();
                if (currentFile()?.id === file.id) titleInput.value = trimmed;
                await saveData();
            });
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "workspace-card-action is-danger";
            remove.textContent = "";
            remove.title = "Move to bin";
            remove.setAttribute("aria-label", `Delete ${file.name}`);
            remove.addEventListener("click", async () => {
                if (!await requestDelete(file)) return;
                data.notebooks = data.notebooks.filter((candidate) => candidate.id !== file.id);
                if (!data.notebooks.some((candidate) => candidate.id === data.active_id)) data.active_id = data.notebooks[0]?.id || "";
                if (activeFileId === file.id) activeFileId = null;
                renderFiles();
                await saveData();
            });
            actions.append(rename, remove);
            card.append(open, actions);
            list.append(card);
        });
        libraryEmpty.hidden = files.length > 0;
        document.getElementById("workspace-empty-copy").textContent = `No ${activeKind === "notes" ? "notes" : "whiteboards"} yet. Create one to get started.`;
        document.getElementById("workspace-library-title").textContent = activeKind === "notes" ? "Your notes" : "Your whiteboards";
        document.getElementById("workspace-library-count").textContent = `${files.length} ${files.length === 1 ? "file" : "files"}`;
        document.getElementById("workspace-new-file").hidden = files.length === 0;
        document.getElementById("workspace-empty-create").setAttribute("aria-label", `Create a new ${activeKind === "notes" ? "note" : "whiteboard"}`);
    }

    function openFile(id) {
        activeFileId = id;
        data.active_id = id;
        const file = currentFile();
        if (!file) return;
        library.hidden = true;
        documentView.hidden = false;
        notePanel.hidden = file.kind !== "notes";
        boardPanel.hidden = file.kind !== "whiteboard";
        titleInput.value = file.name;
        applyFileTheme(file);
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
        renderFiles();
    }

    function showLibrary() {
        activeFileId = null;
        documentView.hidden = true;
        library.hidden = false;
        renderFiles();
    }

    function applyFileTheme(file) {
        const dark = file?.theme === "dark";
        documentView.classList.toggle("is-dark", dark);
        themeToggle.querySelector(".workspace-theme-label").textContent = dark ? "Dark mode" : "Light mode";
        themeToggle.setAttribute("aria-checked", String(dark));
        themeToggle.classList.toggle("is-dark", dark);
        if (file?.kind === "whiteboard") requestAnimationFrame(() => {
            if (!boardPanel.hidden) drawBoard();
        });
    }

    themeToggle.addEventListener("click", () => {
        const file = currentFile();
        if (!file) return;
        file.theme = file.theme === "dark" ? "light" : "dark";
        applyFileTheme(file);
        renderFiles();
        scheduleSave();
    });

    function selectKind(kind) {
        activeKind = kind;
        document.querySelectorAll("[data-workspace-kind]").forEach((button) => {
            button.setAttribute("aria-selected", String(button.dataset.workspaceKind === kind));
        });
        document.getElementById("workspace-new-file").innerHTML = `＋ <span>New ${kind === "notes" ? "note" : "whiteboard"}</span>`;
        showLibrary();
    }

    async function requestDelete(file) {
        const dialog = document.getElementById("workspace-delete-dialog");
        if (localStorage.getItem("notes-delete-skip-confirm") === "true") return true;
        document.getElementById("workspace-delete-message").textContent = `“${file.name}” will be deleted.`;
        document.getElementById("workspace-delete-remember").checked = false;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        const result = await new Promise((resolve) => {
            dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
        });
        if (result === "delete" && document.getElementById("workspace-delete-remember").checked) {
            localStorage.setItem("notes-delete-skip-confirm", "true");
        }
        return result === "delete";
    }

    async function saveData() {
        if (!data) return;
        saveQueue = saveQueue.then(async () => {
            const response = await fetch("/api/notebooks", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Save failed.");
        }).catch((error) => {
            console.error("Workspace file could not be saved.", error);
        });
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveData, 400);
    }

    function makeFile(kind) {
        const file = {
            id: crypto.randomUUID(),
            name: kind === "notes" ? "Untitled note" : "Untitled whiteboard",
            kind,
            content: "",
            whiteboard: { strokes: [] }
        };
        data.notebooks.push(file);
        data.active_id = file.id;
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
        boardContext.fillStyle = currentFile()?.theme === "dark" ? "#222733" : "#ffffff";
        boardContext.fillRect(0, 0, width, height);
        currentStrokes().forEach((stroke) => {
            if (stroke.type === "text") {
                boardContext.globalCompositeOperation = "source-over";
                boardContext.fillStyle = stroke.color || "#20242d";
                boardContext.font = `${stroke.size || 20}px Arial, sans-serif`;
                boardContext.shadowColor = currentFile()?.theme === "dark" ? "#f1f3f7" : "transparent";
                boardContext.shadowBlur = currentFile()?.theme === "dark" ? 3 : 0;
                boardContext.fillText(stroke.text || "", stroke.x * width, stroke.y * height);
                boardContext.shadowBlur = 0;
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
    document.getElementById("workspace-empty-create").addEventListener("click", () => makeFile(activeKind));
    document.getElementById("workspace-all-files").addEventListener("click", showLibrary);
    document.getElementById("workspace-delete-file").addEventListener("click", async () => {
        const file = currentFile();
        if (!file) return;
        if (!await requestDelete(file)) return;
        data.notebooks = data.notebooks.filter((candidate) => candidate.id !== file.id);
        if (!data.notebooks.some((candidate) => candidate.id === data.active_id)) {
            data.active_id = data.notebooks[0]?.id || "";
        }
        activeFileId = null;
        showLibrary();
        await saveData();
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
        const fontOption = event.target.closest("[data-font-name]");
        if (fontOption) {
            const fontName = fontOption.dataset.fontName;
            applyTextCommand("fontName", fontName === "System UI" ? "system-ui" : fontName);
            fontToggle.textContent = `${fontName} ▾`;
            fontToggle.style.fontFamily = noteFonts.find(([name]) => name === fontName)?.[1] || "Arial, sans-serif";
            fontMenu.hidden = true;
            fontToggle.setAttribute("aria-expanded", "false");
            return;
        }
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
                        whiteboard: file.whiteboard
                    });
                    file.whiteboard = { strokes: [] };
                    migrated = true;
                }
            });
            if (!data.notebooks.some((file) => file.id === data.active_id)) data.active_id = data.notebooks[0]?.id || "";
            workspace.querySelectorAll("button, input, select").forEach((control) => {
                control.disabled = false;
            });
            selectKind(activeKind);
            if (migrated) scheduleSave();
            if (!data.notebooks.some((file) => file.kind === activeKind)) renderFiles();
        } catch (error) {
            console.error("Workspace files could not be loaded.", error);
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
