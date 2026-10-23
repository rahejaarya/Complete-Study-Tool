(() => {
    // Keep this document alive while showing other same-site pages in this tab.
    if (window.top !== window || window.studyToolAudioRouterInstalled) return;
    window.studyToolAudioRouterInstalled = true;

    const app = document.querySelector(".app");
    if (!app) return;

    const originalUrl = new URL(location.href);
    const originalTitle = document.title;
    let routeFrame;
    let routeLayer;
    let nowPlaying;
    let nowPlayingText;
    let pauseButton;
    let stopButton;
    let timerHud;
    let timerReadout;
    let timerPauseButton;

    function isInternalUrl(rawUrl) {
        try {
            return new URL(rawUrl, location.href).origin === location.origin;
        } catch {
            return false;
        }
    }

    function isOriginalPage(rawUrl) {
        try {
            const target = new URL(rawUrl, location.href);
            return target.origin === originalUrl.origin && target.pathname === originalUrl.pathname;
        } catch {
            return false;
        }
    }

    function closeRouteLayer() {
        routeLayer?.remove();
        routeLayer = null;
        routeFrame = null;
        app.classList.remove("audio-route-background");
        document.body.classList.remove("audio-route-open");
        nowPlaying?.remove();
        nowPlaying = null;
        timerHud?.remove();
        timerHud = null;
        document.title = originalTitle;
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
        updateTimerHud();
    }

    function updateTimerHud(state = window.studyToolGetTimerState?.()) {
        if (!timerHud) return;
        state ||= { active: false, isRunning: false, phase: "Study", remaining: "00:00" };
        timerHud.hidden = !state.active;
        timerHud.classList.toggle("with-audio", Boolean(nowPlaying && !nowPlaying.hidden));
        timerReadout.textContent = `${state.phase} · ${state.remaining}`;
        timerPauseButton.textContent = state.isRunning ? "Pause" : "Resume";
        timerPauseButton.setAttribute("aria-label", state.isRunning ? "Pause study timer" : "Resume study timer");
    }

    function createTimerHud() {
        if (timerHud) return;
        timerHud = document.createElement("div");
        timerHud.className = "persistent-study-timer";
        timerHud.setAttribute("role", "timer");
        timerHud.setAttribute("aria-live", "off");
        timerReadout = document.createElement("span");
        timerReadout.className = "persistent-study-timer-readout";
        timerPauseButton = document.createElement("button");
        timerPauseButton.type = "button";
        timerPauseButton.className = "persistent-now-playing-control";
        timerPauseButton.addEventListener("click", () => window.studyToolToggleTimerPause?.());
        timerHud.append(timerReadout, timerPauseButton);
        document.body.append(timerHud);
        updateTimerHud();
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
        if (isOriginalPage(url)) {
            if (routeLayer) {
                if (addHistory) history.pushState({ studyToolAudioRoute: true }, "", url);
                closeRouteLayer();
            }
            return;
        }
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
            createTimerHud();
        }
        if (addHistory) history.pushState({ studyToolAudioRoute: true }, "", url);
        routeFrame.src = url;
    }

    function handleFrameLoad() {
        if (!routeFrame) return;
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
        if (!window.studyToolHasActiveAudio?.() && !window.studyToolHasActiveTimer?.()) return;
        event.preventDefault();
        routeTo(link.href);
    }, true);

    window.addEventListener("studytool:now-playing", (event) => updatePlayer(event.detail));
    window.addEventListener("studytool:timer-state", (event) => updateTimerHud(event.detail));
    window.addEventListener("popstate", (event) => {
        if (event.state?.studyToolAudioRoute) {
            routeTo(location.href, false);
        } else if (routeLayer) {
            closeRouteLayer();
        }
    });
})();
