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
    const soundLibrary = document.getElementById("sound-library");
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

    function renderSong(song) {
        const card = document.createElement("article");
        card.className = "sound-card my-song-card";

        const songTop = document.createElement("div");
        songTop.className = "sound-card-top";
        const title = document.createElement("h3");
        title.textContent = song.title;
        const source = document.createElement("span");
        source.className = "sound-type";
        source.textContent = `${song.source === "upload" ? "UPLOADED" : "LINK"} · ${song.media_type.toUpperCase()}`;
        songTop.append(title, source);

        let player;
        if (song.media_type === "youtube") {
            player = document.createElement("iframe");
            player.src = song.embed_url;
            player.title = `Play ${song.title} on YouTube`;
            player.loading = "lazy";
            player.referrerPolicy = "strict-origin-when-cross-origin";
            player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            player.allowFullscreen = true;
        } else {
            player = document.createElement(song.media_type === "video" ? "video" : "audio");
            player.controls = true;
            player.preload = "none";
            player.src = song.audio_url;
            player.addEventListener("error", () => {
                status.textContent = `Could not play "${song.title}". Check that its media file or link is still available.`;
            });
        }

        const removeButton = document.createElement("button");
        removeButton.className = "my-song-remove";
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove ${song.title}`);
        removeButton.addEventListener("click", () => {
            void removeSong(song.id, removeButton);
        });

        card.append(songTop, player, removeButton);
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
            soundLibrary.querySelectorAll(".my-song-card").forEach((card) => card.remove());
            data.songs.forEach((song) => soundLibrary.insertBefore(renderSong(song), toggleButton));
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
