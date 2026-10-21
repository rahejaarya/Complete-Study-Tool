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
    const customMedia = new Map();
    let masterVolume = Number(document.getElementById("master-volume")?.value || 35) / 100;
    let youtubeApiPromise;

    function notifyMediaState() {
        window.dispatchEvent(new CustomEvent("studytool:custom-media-state"));
    }

    function loadYoutubeApi() {
        if (window.YT?.Player) return Promise.resolve(window.YT);
        if (!youtubeApiPromise) {
            youtubeApiPromise = new Promise((resolve, reject) => {
                const previousReady = window.onYouTubeIframeAPIReady;
                window.onYouTubeIframeAPIReady = () => {
                    previousReady?.();
                    resolve(window.YT);
                };
                let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
                if (!script) {
                    script = document.createElement("script");
                    script.src = "https://www.youtube.com/iframe_api";
                    script.onerror = () => reject(new Error("YouTube player could not be loaded."));
                    document.head.append(script);
                }
            });
        }
        return youtubeApiPromise;
    }

    function clearCustomMedia() {
        customMedia.forEach((entry) => {
            if (entry.media) {
                entry.media.pause();
                entry.media.removeAttribute("src");
                entry.media.load();
            }
            entry.youtube?.destroy?.();
        });
        customMedia.clear();
        notifyMediaState();
    }

    window.studyToolSetCustomMediaVolume = (volume) => {
        masterVolume = Math.max(0, Math.min(1, Number(volume)));
        customMedia.forEach((entry) => {
            if (entry.media) entry.media.volume = masterVolume;
            entry.youtube?.setVolume?.(Math.round(masterVolume * 100));
        });
    };
    window.studyToolGetCustomMediaState = () => Array.from(customMedia.values(), (entry) => ({
        title: entry.title,
        playing: entry.playing,
        paused: entry.pausedByMaster || entry.state === "paused",
        active: entry.playing || entry.pausedByMaster || entry.state === "paused"
    }));
    window.studyToolPauseCustomMedia = () => {
        customMedia.forEach((entry) => {
            if (entry.media && !entry.media.paused) {
                entry.pausedByMaster = true;
                entry.media.pause();
            } else if (entry.youtube && entry.playing) {
                entry.pausedByMaster = true;
                entry.youtube.pauseVideo();
            }
        });
        notifyMediaState();
    };
    window.studyToolResumeCustomMedia = () => {
        customMedia.forEach((entry) => {
            if (!entry.pausedByMaster && entry.state !== "paused") return;
            entry.pausedByMaster = false;
            if (entry.media) void entry.media.play().catch(() => {});
            else entry.youtube?.playVideo?.();
        });
        notifyMediaState();
    };
    window.studyToolStopCustomMedia = () => {
        customMedia.forEach((entry) => {
            entry.pausedByMaster = false;
            entry.state = "idle";
            if (entry.media) {
                entry.media.pause();
                entry.media.currentTime = 0;
            }
            entry.youtube?.stopVideo?.();
        });
        notifyMediaState();
    };

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
        const mediaEntry = { title: song.title, playing: false, state: "idle", pausedByMaster: false, media: null, youtube: null };
        customMedia.set(String(song.id), mediaEntry);
        if (song.media_type === "youtube") {
            player = document.createElement("iframe");
            const embedUrl = new URL(song.embed_url, window.location.href);
            embedUrl.searchParams.set("enablejsapi", "1");
            embedUrl.searchParams.set("origin", window.location.origin);
            player.src = embedUrl.href;
            player.title = `Play ${song.title} on YouTube`;
            player.loading = "lazy";
            player.referrerPolicy = "strict-origin-when-cross-origin";
            player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            player.allowFullscreen = true;
            void loadYoutubeApi().then((YT) => {
                if (!player.isConnected) return;
                mediaEntry.youtube = new YT.Player(player, {
                    events: {
                        onReady: (event) => event.target.setVolume(Math.round(masterVolume * 100)),
                        onStateChange: (event) => {
                            mediaEntry.playing = event.data === YT.PlayerState.PLAYING;
                            if (event.data === YT.PlayerState.PLAYING) {
                                mediaEntry.state = "playing";
                                mediaEntry.pausedByMaster = false;
                            } else if (event.data === YT.PlayerState.PAUSED) {
                                mediaEntry.state = "paused";
                            } else if (event.data === YT.PlayerState.ENDED || event.data === YT.PlayerState.UNSTARTED) {
                                mediaEntry.state = "idle";
                                mediaEntry.pausedByMaster = false;
                            }
                            notifyMediaState();
                        }
                    }
                });
            }).catch(() => {
                status.textContent = `Could not connect to YouTube for "${song.title}".`;
            });
        } else {
            player = document.createElement(song.media_type === "video" ? "video" : "audio");
            mediaEntry.media = player;
            player.dataset.songTitle = song.title;
            player.controls = true;
            player.preload = "none";
            player.volume = masterVolume;
            player.src = song.audio_url;
            player.addEventListener("play", () => {
                mediaEntry.playing = true;
                mediaEntry.state = "playing";
                mediaEntry.pausedByMaster = false;
                notifyMediaState();
            });
            player.addEventListener("pause", () => {
                mediaEntry.playing = false;
                mediaEntry.state = player.ended ? "idle" : "paused";
                notifyMediaState();
            });
            player.addEventListener("ended", () => {
                mediaEntry.playing = false;
                mediaEntry.state = "idle";
                mediaEntry.pausedByMaster = false;
                notifyMediaState();
            });
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
            clearCustomMedia();
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
