// Build the saved-chat dropdown only on pages that include its required controls.
const chatsToggle = document.getElementById("ai-chats-toggle");
const chatsDropdown = document.getElementById("ai-chat-dropdown");
const chatsList = chatsDropdown?.querySelector(".chat-list");

if (chatsToggle && chatsDropdown && chatsList) {
    chatsToggle.addEventListener("click", () => {
        const open = chatsDropdown.classList.toggle("open");
        chatsToggle.setAttribute("aria-expanded", String(open));
        chatsToggle.setAttribute(
            "aria-label",
            open ? "Hide saved chats" : "Show saved chats"
        );
        chatsToggle.textContent = open ? "▴" : "▾";
        chatsToggle.title = open ? "Hide chats" : "Show chats";
        if (open) {
            chatsDropdown.querySelector(".chat-item")?.focus();
        }
    });

    // Hide one chat action menu and reset its trigger's accessible state.
    function closeMenu(menu, trigger) {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    }

    // Close every open row menu before opening another or leaving the list.
    function closeAllMenus() {
        chatsList.querySelectorAll(".chat-actions-menu:not([hidden])").forEach(
            (menu) => {
                const trigger = menu.closest(".chat-list-item")
                    ?.querySelector(".chat-actions-trigger");
                if (trigger) {
                    closeMenu(menu, trigger);
                }
            }
        );
    }

    // Present a modal rename/delete form and submit the matching chat API request.
    function showDialog(chat, action) {
        const dialog = document.createElement("dialog");
        dialog.className = "chat-dialog";
        dialog.setAttribute("aria-labelledby", "chat-action-title");

        const form = document.createElement("form");
        const title = document.createElement("h2");
        title.id = "chat-action-title";
        const description = document.createElement("p");
        const error = document.createElement("p");
        error.className = "chat-dialog-error";
        error.setAttribute("role", "alert");
        const actions = document.createElement("div");
        actions.className = "chat-dialog-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        const confirm = document.createElement("button");
        confirm.type = "submit";
        const isRename = action === "rename";
        let nameInput;

        title.textContent = isRename ? "Rename conversation" : "Delete conversation?";
        description.textContent = isRename
            ? "Choose a name for this conversation."
            : `“${chat.title}” will be permanently deleted. This cannot be undone.`;

        if (isRename) {
            const label = document.createElement("label");
            label.textContent = "Conversation name";
            nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.name = "title";
            nameInput.value = chat.title;
            nameInput.maxLength = 80;
            nameInput.required = true;
            label.appendChild(nameInput);
            form.appendChild(label);
        }

        confirm.textContent = isRename ? "Save name" : "Delete";
        confirm.classList.toggle("danger", !isRename);
        cancel.addEventListener("click", () => dialog.close());
        actions.append(cancel, confirm);
        form.prepend(title, description);
        form.append(error, actions);
        dialog.appendChild(form);
        document.body.appendChild(dialog);

        dialog.addEventListener("close", () => dialog.remove(), {once: true});
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) {
                dialog.close();
            }
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            confirm.disabled = true;
            cancel.disabled = true;
            try {
                const response = await fetch(
                    isRename
                        ? `/api/ai/chats/${encodeURIComponent(chat.id)}/rename`
                        : `/api/ai/chats/${encodeURIComponent(chat.id)}`,
                    {
                        method: isRename ? "POST" : "DELETE",
                        ...(isRename ? {
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({title: nameInput.value.trim()})
                        } : {})
                    }
                );
                if (!response.ok) {
                    error.textContent = isRename
                        ? "Could not rename this conversation."
                        : "Could not delete this conversation.";
                    return;
                }
                dialog.close();
                await loadChats();
            } catch (requestError) {
                console.error(requestError);
                error.textContent = "Could not complete this action.";
            } finally {
                confirm.disabled = false;
                cancel.disabled = false;
            }
        });

        dialog.showModal();
        if (isRename) {
            nameInput.focus();
            nameInput.select();
        } else {
            cancel.focus();
        }
    }

    // Create a safe DOM row with a link and accessible rename/delete actions.
    function createChatRow(chat) {
        const row = document.createElement("div");
        row.className = "chat-list-item";

        const link = document.createElement("a");
        link.className = "chat-item";
        link.href = `/ai?chat_id=${encodeURIComponent(chat.id)}`;
        link.title = chat.title;
        const icon = document.createElement("span");
        icon.className = "chat-item-icon";
        icon.textContent = "▸";
        const title = document.createElement("span");
        title.className = "chat-item-title";
        title.textContent = chat.title;
        link.append(icon, title);

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "chat-actions-trigger";
        trigger.textContent = "⋯";
        trigger.title = `Options for ${chat.title}`;
        trigger.setAttribute("aria-label", `Options for ${chat.title}`);
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");

        const menu = document.createElement("div");
        menu.className = "chat-actions-menu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        for (const action of ["Rename", "Delete"]) {
            const item = document.createElement("button");
            item.type = "button";
            item.textContent = action;
            item.setAttribute("role", "menuitem");
            item.addEventListener("click", () => {
                closeMenu(menu, trigger);
                showDialog(chat, action.toLowerCase());
            });
            menu.appendChild(item);
        }

        trigger.addEventListener("click", () => {
            const open = menu.hidden;
            closeAllMenus();
            menu.hidden = !open;
            trigger.setAttribute("aria-expanded", String(open));
            if (open) {
                menu.querySelector('[role="menuitem"]')?.focus();
            }
        });
        row.append(link, trigger, menu);
        return row;
    }

    // Fetch saved conversations and render either rows or the empty-list message.
    async function loadChats() {
        const response = await fetch("/api/ai/chats");
        if (!response.ok) {
            throw new Error("Could not load saved conversations.");
        }
        const {chats} = await response.json();
        chatsList.replaceChildren();
        for (const chat of chats) {
            chatsList.appendChild(createChatRow(chat));
        }
        if (!chats.length) {
            const empty = document.createElement("span");
            empty.className = "chat-list-empty";
            empty.textContent = "No saved chats yet";
            chatsList.appendChild(empty);
        }
    }

    // Dismiss row menus when a click occurs outside the chat list.
    document.addEventListener("click", (event) => {
        if (!chatsList.contains(event.target)) {
            closeAllMenus();
        }
    });
    // Support Escape dismissal and arrow-key movement through action menus.
    document.addEventListener("keydown", (event) => {
        const openMenu = chatsList.querySelector(".chat-actions-menu:not([hidden])");
        if (event.key === "Escape" && openMenu) {
            const trigger = openMenu.closest(".chat-list-item")
                ?.querySelector(".chat-actions-trigger");
            closeMenu(openMenu, trigger);
            trigger?.focus();
        } else if (
            openMenu
            && (event.key === "ArrowDown" || event.key === "ArrowUp")
        ) {
            const items = [...openMenu.querySelectorAll('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(index + step + items.length) % items.length]?.focus();
        } else if (
            event.key === "Escape"
            && chatsDropdown.classList.contains("open")
        ) {
            chatsDropdown.classList.remove("open");
            chatsToggle.setAttribute("aria-expanded", "false");
            chatsToggle.setAttribute("aria-label", "Show saved chats");
            chatsToggle.textContent = "▾";
            chatsToggle.focus();
        }
    });

    // Populate the dropdown on page load and show a recoverable error on failure.
    loadChats().catch((error) => {
        console.error(error);
        const message = document.createElement("span");
        message.className = "chat-list-empty";
        message.textContent = "Could not load chats";
        chatsList.replaceChildren(message);
    });
}
