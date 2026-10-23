(() => {
    async function readResponse(response, fallbackMessage) {
        if (window.MeridianApi?.read) {
            return window.MeridianApi.read(response, fallbackMessage);
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || fallbackMessage);
        }
        return data;
    }

    async function createFolder(name, folders) {
        const folder = {
            id: crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            items: []
        };
        const response = await fetch("/api/saved-folders", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify([...folders, folder])
        });
        await readResponse(response, "Could not create the folder.");
        return folder;
    }

    function chooseFolder(folders, title) {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "folder-dialog-overlay";

            const dialog = document.createElement("section");
            dialog.className = "folder-dialog folder-save-dialog";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", "save-resource-dialog-title");

            const heading = document.createElement("h2");
            heading.className = "folder-dialog-title";
            heading.id = "save-resource-dialog-title";
            heading.textContent = "Save to a folder";

            const description = document.createElement("p");
            description.className = "folder-dialog-message";
            description.textContent = `Choose where to save “${title}”.`;

            const label = document.createElement("label");
            label.className = "folder-save-dialog-label";
            label.htmlFor = "save-resource-folder";
            label.textContent = "Folder";

            const select = document.createElement("select");
            select.className = "folder-dialog-input";
            select.id = "save-resource-folder";
            const newFolderOption = document.createElement("option");
            newFolderOption.value = "";
            newFolderOption.textContent = "Create a new folder";
            select.append(newFolderOption);
            folders.forEach(folder => {
                const option = document.createElement("option");
                option.value = folder.id;
                option.textContent = folder.name;
                select.append(option);
            });
            if (folders.length) select.value = folders[0].id;

            const newFolderName = document.createElement("input");
            newFolderName.className = "folder-dialog-input";
            newFolderName.type = "text";
            newFolderName.maxLength = 100;
            newFolderName.placeholder = "New folder name";
            newFolderName.setAttribute("aria-label", "New folder name");
            newFolderName.hidden = folders.length > 0;

            const status = document.createElement("p");
            status.className = "folder-save-dialog-status";
            status.setAttribute("role", "alert");

            const actions = document.createElement("div");
            actions.className = "folder-dialog-actions";
            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "folder-dialog-button";
            cancelButton.textContent = "Cancel";
            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.className = "folder-dialog-button primary";
            saveButton.textContent = "Save";
            actions.append(cancelButton, saveButton);

            dialog.append(
                heading,
                description,
                label,
                select,
                newFolderName,
                status,
                actions
            );
            overlay.append(dialog);
            document.body.append(overlay);

            function finish(folder) {
                overlay.remove();
                resolve(folder);
            }

            cancelButton.addEventListener("click", () => finish(null));
            overlay.addEventListener("click", event => {
                if (event.target === overlay) finish(null);
            });
            select.addEventListener("change", () => {
                newFolderName.hidden = Boolean(select.value);
                if (!newFolderName.hidden) newFolderName.focus();
            });
            saveButton.addEventListener("click", () => {
                const folder = folders.find(item => item.id === select.value);
                if (select.value && folder) {
                    finish(folder);
                    return;
                }
                const name = newFolderName.value.trim();
                if (!name || name.length > 100) {
                    status.textContent = "Enter a folder name up to 100 characters.";
                    newFolderName.focus();
                    return;
                }
                finish({ name, isNew: true });
            });
            dialog.addEventListener("keydown", event => {
                if (event.key === "Escape") finish(null);
            });
            (newFolderName.hidden ? select : newFolderName).focus();
        });
    }

    async function save(resource, type, button) {
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "Saving…";
        try {
            const foldersResponse = await fetch("/api/saved-folders", {
                headers: { "Accept": "application/json" },
                credentials: "same-origin"
            });
            const folders = await readResponse(
                foldersResponse,
                "Could not load your folders."
            );
            if (!Array.isArray(folders)) {
                throw new Error("The saved folder list is invalid.");
            }
            const selectedFolder = await chooseFolder(folders, resource.title);
            if (!selectedFolder) {
                button.disabled = false;
                button.textContent = originalLabel;
                return;
            }
            const folder = selectedFolder.isNew
                ? await createFolder(selectedFolder.name, folders)
                : selectedFolder;
            const response = await fetch(
                `/api/saved-folders/${encodeURIComponent(folder.id)}/web-resources`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    credentials: "same-origin",
                    body: JSON.stringify({
                        title: resource.title,
                        url: resource.url,
                        file_type: type === "Video" ? "video link" : "web link"
                    })
                }
            );
            await readResponse(response, "Could not save this resource.");
            button.textContent = "Saved";
            button.title = `Saved to ${folder.name}`;
        } catch (error) {
            console.error("Could not save search result to a folder:", error);
            button.textContent = error.message || "Could not save";
            window.setTimeout(() => {
                button.textContent = originalLabel;
                button.disabled = false;
            }, 2500);
            return;
        }
    }

    window.MeridianSavedFolderPicker = { save };
})();
