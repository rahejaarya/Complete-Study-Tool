(() => {
    const toggleButton = document.getElementById("toggle-add-song");
    const cancelButton = document.getElementById("cancel-add-song");
    const panel = document.getElementById("add-song-panel");
    const form = document.getElementById("add-song-form");
    const sourceSelect = document.getElementById("custom-song-source");
    const uploadField = document.getElementById("custom-song-upload-field");
    const uploadInput = document.getElementById("custom-song-file");
    const linkField = document.getElementById("custom-song-link-field");
    const linkInput = document.getElementById("custom-song-url");
    const songsList = document.getElementById("my-songs-list");
    const status = document.getElementById("my-songs-status");
    const saveButton = form.querySelector('[type="submit"]');

    function setPanelOpen(open) {
        panel.hidden = !open;
        toggleButton.setAttribute("aria-expanded", String(open));
        if (open) {
            document.getElementById("custom-song-title").focus();
        }
    }

    function updateSourceFields() {
        const uploading = sourceSelect.value === "upload";
        uploadField.hidden = !uploading;
        uploadInput.disabled = !uploading;
        uploadInput.required = uploading;
        linkField.hidden = uploading;
        linkInput.disabled = uploading;
        linkInput.required = !uploading;
    }

    function showEmptyState() {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "my-songs-empty";
        emptyMessage.textContent = "Your saved sounds will show up here.";
        songsList.replaceChildren(emptyMessage);
    }

    function renderSong(song) {
        const card = document.createElement("article");
        card.className = "my-song-card";

        const songHeading = document.createElement("div");
        songHeading.className = "my-song-heading";
        const title = document.createElement("h3");
        title.textContent = song.title;
        const source = document.createElement("span");
        source.className = "sound-type";
        source.textContent = song.source === "upload" ? "UPLOADED" : "LINK";
        songHeading.append(title, source);

        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = song.audio_url;
        audio.addEventListener("error", () => {
            status.textContent = `Could not play "${song.title}". Check that its audio file or link is still available.`;
        });

        const removeButton = document.createElement("button");
        removeButton.className = "my-song-remove";
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove ${song.title}`);
        removeButton.addEventListener("click", () => {
            void removeSong(song.id, removeButton);
        });

        card.append(songHeading, audio, removeButton);
        return card;
    }

    async function loadSongs() {
        status.textContent = "Loading your saved sounds…";
        try {
            const response = await fetch("/api/my-songs");
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Could not load your saved sounds.");
            }
            songsList.replaceChildren();
            if (data.songs.length === 0) {
                showEmptyState();
            } else {
                data.songs.forEach((song) => songsList.append(renderSong(song)));
            }
            status.textContent = "";
        } catch (error) {
            status.textContent = error.message || "Could not load your saved sounds.";
        }
    }

    async function removeSong(songId, button) {
        button.disabled = true;
        status.textContent = "Removing sound…";
        try {
            const response = await fetch(`/api/my-songs/${encodeURIComponent(songId)}`, {
                method: "DELETE"
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Could not remove this sound.");
            }
            await loadSongs();
        } catch (error) {
            button.disabled = false;
            status.textContent = error.message || "Could not remove this sound.";
        }
    }

    toggleButton.addEventListener("click", () => {
        setPanelOpen(panel.hidden);
    });
    cancelButton.addEventListener("click", () => {
        form.reset();
        updateSourceFields();
        setPanelOpen(false);
    });
    sourceSelect.addEventListener("change", updateSourceFields);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveButton.disabled = true;
        status.textContent = "Saving sound…";
        try {
            const response = await fetch("/api/my-songs", {
                method: "POST",
                body: new FormData(form)
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Could not save this sound.");
            }
            form.reset();
            updateSourceFields();
            setPanelOpen(false);
            await loadSongs();
        } catch (error) {
            status.textContent = error.message || "Could not save this sound.";
        } finally {
            saveButton.disabled = false;
        }
    });

    updateSourceFields();
    void loadSongs();
})();
