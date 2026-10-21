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
    let pauseButton;
    let stopButton;

    function isInternalUrl(rawUrl) {
        try {
            return new URL(rawUrl, location.href).origin === location.origin;
        } catch {
            return false;
        }
    }

    function updatePlayer(state = window.studyToolGetAudioState?.()) {
        if (!nowPlaying) return;
        state ||= { labels: [], hasAudio: false, paused: false };
        nowPlaying.hidden = !state.hasAudio;
        nowPlaying.classList.toggle("is-playing", state.hasAudio && !state.paused);
        nowPlaying.classList.toggle("is-paused", state.hasAudio && state.paused);
        nowPlayingText.textContent = state.labels?.length
            ? `${state.paused ? "Paused" : "Now playing"} · ${state.labels.join(", ")}`
            : "Audio is playing";
        pauseButton.hidden = !state.hasAudio;
        pauseButton.textContent = state.paused ? "Resume" : "Pause";
        pauseButton.setAttribute("aria-label", state.paused ? "Resume audio" : "Pause audio");
        stopButton.hidden = !state.hasAudio;
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
        pauseButton = document.createElement("button");
        pauseButton.type = "button";
        pauseButton.className = "persistent-now-playing-control";
        pauseButton.textContent = "Pause";
        pauseButton.addEventListener("click", () => void window.studyToolToggleAudioPause?.());
        stopButton = document.createElement("button");
        stopButton.type = "button";
        stopButton.className = "persistent-now-playing-stop";
        stopButton.textContent = "Stop";
        stopButton.addEventListener("click", () => window.studyToolStopActiveAudio?.());
        nowPlaying.append(dot, nowPlayingText, pauseButton, stopButton);
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
            routeFrame.title = "Meridian page";
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

    window.addEventListener("studytool:now-playing", (event) => updatePlayer(event.detail));
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
            document.title = document.querySelector("title")?.textContent || "Meridian";
        }
    });
})();
