(() => {
    // Keep this document alive while showing other same-site pages in this tab.
    if (window.top !== window || window.studyToolAudioRouterInstalled) return;
    window.studyToolAudioRouterInstalled = true;

    const app = document.querySelector(".app");
    if (!app) return;

    let routeFrame;
    let routeLayer;
    let nowPlaying;
    let nowPlayingText;
    let stopButton;

    function isInternalUrl(rawUrl) {
        try {
            return new URL(rawUrl, location.href).origin === location.origin;
        } catch {
            return false;
        }
    }

    function updatePlayer(labels = window.studyToolGetAudioLabels?.() || []) {
        if (!nowPlaying) return;
        const playing = Boolean(window.studyToolHasActiveAudio?.());
        nowPlaying.hidden = !playing;
        nowPlaying.classList.toggle("is-playing", playing);
        nowPlayingText.textContent = labels.length
            ? `Now playing · ${labels.length > 2 ? `${labels.length} sounds` : labels.join(", ")}`
            : "Audio is playing";
        stopButton.hidden = !playing;
    }

    function createPlayer() {
        if (nowPlaying) return;
        nowPlaying = document.createElement("div");
        nowPlaying.className = "persistent-now-playing is-playing";
        nowPlaying.setAttribute("role", "status");
        nowPlaying.setAttribute("aria-live", "polite");
        nowPlayingText = document.createElement("span");
        nowPlayingText.className = "persistent-now-playing-text";
        const dot = document.createElement("span");
        dot.className = "now-playing-dot";
        dot.setAttribute("aria-hidden", "true");
        stopButton = document.createElement("button");
        stopButton.type = "button";
        stopButton.className = "persistent-now-playing-stop";
        stopButton.textContent = "Stop";
        stopButton.addEventListener("click", () => window.studyToolStopActiveAudio?.());
        nowPlaying.append(dot, nowPlayingText, stopButton);
        document.body.append(nowPlaying);
        updatePlayer();
    }

    function routeTo(url, addHistory = true) {
        if (!isInternalUrl(url)) return;
        if (!routeLayer) {
            routeLayer = document.createElement("div");
            routeLayer.className = "persistent-audio-route-layer";
            routeFrame = document.createElement("iframe");
            routeFrame.className = "persistent-audio-route-frame";
            routeFrame.title = "Study Tool page";
            routeFrame.addEventListener("load", handleFrameLoad);
            routeLayer.append(routeFrame);
            document.body.append(routeLayer);
            app.classList.add("audio-route-background");
            document.body.classList.add("audio-route-open");
            createPlayer();
        }
        if (addHistory) history.pushState({ studyToolAudioRoute: true }, "", url);
        routeFrame.src = url;
    }

    function handleFrameLoad() {
        let frameDocument;
        let frameUrl;
        try {
            frameDocument = routeFrame.contentDocument;
            frameUrl = routeFrame.contentWindow.location.href;
        } catch {
            return;
        }
        if (!frameDocument) return;
        if (history.state?.studyToolAudioRoute && frameUrl !== location.href) {
            history.replaceState({ studyToolAudioRoute: true }, "", frameUrl);
        }
        const title = frameDocument.querySelector("title")?.textContent;
        if (title) document.title = title;

        frameDocument.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const link = event.target.closest?.("a[href]");
            if (!link || link.hasAttribute("download") || !isInternalUrl(link.href)) return;
            event.preventDefault();
            routeTo(link.href);
        }, true);
    }

    document.addEventListener("click", (event) => {
        if (routeLayer || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.("a[href]");
        if (!link || link.hasAttribute("download") || !isInternalUrl(link.href)) return;
        if (!window.studyToolHasActiveAudio?.()) return;
        event.preventDefault();
        routeTo(link.href);
    }, true);

    window.addEventListener("studytool:now-playing", (event) => updatePlayer(event.detail?.labels));
    window.addEventListener("popstate", (event) => {
        if (event.state?.studyToolAudioRoute) {
            routeTo(location.href, false);
        } else if (routeLayer) {
            routeLayer.remove();
            routeLayer = null;
            routeFrame = null;
            app.classList.remove("audio-route-background");
            document.body.classList.remove("audio-route-open");
            nowPlaying?.remove();
            nowPlaying = null;
            document.title = document.querySelector("title")?.textContent || "Study Tool";
        }
    });
})();
