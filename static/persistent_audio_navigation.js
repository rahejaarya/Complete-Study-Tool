(() => {
    // Keep this document alive while showing other same-site pages in this tab.
    if (window.top !== window || window.studyToolAudioRouterInstalled) return;
    window.studyToolAudioRouterInstalled = true;

    const app = document.querySelector(".app");
    if (!app) return;

    const originalUrl = new URL(location.href);
    const originalTitle = document.title;
    let routeFrame;
    let audioFrame;
    let timerFrame;
    let routeLayer;
    let nowPlaying;
    let nowPlayingText;
    let pauseButton;
    let stopButton;
    let persistentHud;
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
        audioFrame = null;
        timerFrame = null;
        app.classList.remove("audio-route-background");
        document.body.classList.remove("audio-route-open");
        persistentHud?.remove();
        persistentHud = null;
        nowPlaying = null;
        timerHud?.remove();
        timerHud = null;
        document.title = originalTitle;
    }

    function positionPopup(element, left, top) {
        const margin = 16;
        const rect = element.getBoundingClientRect();
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
        element.style.position = "fixed";
        element.style.left = `${Math.min(Math.max(left, margin), maxLeft)}px`;
        element.style.top = `${Math.min(Math.max(top, margin), maxTop)}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
    }

    function popupHasSavedPosition(element, storageKey) {
        if (element.dataset.userPositioned === "true" || element.classList.contains("is-dragging")) return true;
        try {
            const savedPosition = JSON.parse(localStorage.getItem(storageKey));
            return Number.isFinite(savedPosition?.left) && Number.isFinite(savedPosition?.top);
        } catch {
            return false;
        }
    }

    function getDashboardSearchRect() {
        for (const frame of [routeFrame, timerFrame, audioFrame]) {
            try {
                const search = frame?.contentDocument?.querySelector(".dashboard-topbar .global-search-trigger");
                if (search?.getClientRects().length) return search.getBoundingClientRect();
            } catch {
                continue;
            }
        }
        return document.querySelector(".dashboard-topbar .global-search-trigger")?.getBoundingClientRect() || null;
    }

    function positionPopupsNearSearch() {
        const searchRect = getDashboardSearchRect();
        if (!searchRect) return;

        const margin = 16;
        const gap = 10;
        const audioVisible = nowPlaying && !nowPlaying.hidden;
        const timerVisible = timerHud && !timerHud.hidden;
        if (!audioVisible && !timerVisible) return;

        const audioRect = audioVisible ? nowPlaying.getBoundingClientRect() : null;
        const timerRect = timerVisible ? timerHud.getBoundingClientRect() : null;
        const audioPositioned = audioVisible && popupHasSavedPosition(nowPlaying, "studytool-now-playing-position");
        const timerPositioned = timerVisible && popupHasSavedPosition(timerHud, "studytool-timer-position");

        if (audioVisible && timerVisible && !audioPositioned && !timerPositioned) {
            const rowWidth = audioRect.width + gap + timerRect.width;
            const left = searchRect.right + gap;
            const rowTop = searchRect.top + (searchRect.height - Math.max(audioRect.height, timerRect.height)) / 2;
            if (left + rowWidth <= window.innerWidth - margin) {
                positionPopup(nowPlaying, left, rowTop);
                positionPopup(timerHud, left + audioRect.width + gap, rowTop);
            } else {
                const stackLeft = Math.min(Math.max(searchRect.left, margin), window.innerWidth - Math.max(audioRect.width, timerRect.width) - margin);
                const stackTop = searchRect.bottom + gap;
                positionPopup(nowPlaying, stackLeft, stackTop);
                positionPopup(timerHud, stackLeft, stackTop + audioRect.height + gap);
            }
            return;
        }

        if (audioVisible && timerVisible && audioPositioned !== timerPositioned) {
            const fixedRect = audioPositioned ? audioRect : timerRect;
            const movingPopup = audioPositioned ? timerHud : nowPlaying;
            const movingSize = audioPositioned ? timerRect : audioRect;
            let left = audioPositioned ? fixedRect.right + gap : fixedRect.left - movingSize.width - gap;
            let top = fixedRect.top;
            if (left < margin || left + movingSize.width > window.innerWidth - margin) {
                left = searchRect.left;
                top = fixedRect.bottom + gap;
            }
            positionPopup(movingPopup, left, top);
            return;
        }

        const popup = audioVisible && !audioPositioned ? nowPlaying : timerVisible && !timerPositioned ? timerHud : null;
        if (!popup) return;
        const rect = popup.getBoundingClientRect();
        let left = searchRect.right + gap;
        let top = searchRect.top + (searchRect.height - rect.height) / 2;
        if (left + rect.width > window.innerWidth - margin) {
            left = searchRect.left;
            top = searchRect.bottom + gap;
        }
        positionPopup(popup, left, top);
    }

    function makePopupDraggable(element, storageKey) {
        if (element.dataset.draggable === "true" || element.hidden) return;
        element.dataset.draggable = "true";

        let savedPosition;
        try {
            savedPosition = JSON.parse(localStorage.getItem(storageKey));
        } catch {
            savedPosition = null;
        }
        const initialRect = element.getBoundingClientRect();
        const hasSavedPosition = Number.isFinite(savedPosition?.left) && Number.isFinite(savedPosition?.top);
        let left = hasSavedPosition ? savedPosition.left : window.innerWidth - initialRect.width - 16;
        let top = hasSavedPosition ? savedPosition.top : 16;
        const otherPopup = element === nowPlaying ? timerHud : nowPlaying;
        if (!hasSavedPosition && otherPopup && !otherPopup.hidden) {
            const otherRect = otherPopup.getBoundingClientRect();
            const overlaps = left < otherRect.right
                && left + initialRect.width > otherRect.left
                && top < otherRect.bottom
                && top + initialRect.height > otherRect.top;
            if (overlaps) {
                const belowTop = otherRect.bottom + 8;
                const aboveTop = otherRect.top - initialRect.height - 8;
                top = belowTop + initialRect.height <= window.innerHeight - 8
                    ? belowTop
                    : Math.max(8, aboveTop);
            }
        }
        positionPopup(
            element,
            left,
            top
        );

        let drag;
        element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.isPrimary === false) return;
            const rect = element.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                pointerX: event.clientX,
                pointerY: event.clientY,
                left: rect.left,
                top: rect.top,
                moved: false
            };
        });
        window.addEventListener("pointermove", (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - drag.pointerX;
            const deltaY = event.clientY - drag.pointerY;
            if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
            drag.moved = true;
            element.classList.add("is-dragging");
            event.preventDefault();
            positionPopup(element, drag.left + deltaX, drag.top + deltaY);
        });

        function finishDrag(event) {
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (drag.moved) {
                const rect = element.getBoundingClientRect();
                element.dataset.userPositioned = "true";
                try {
                    localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
                } catch {
                    // Keep dragging usable when browser storage is unavailable.
                }
                element.dataset.suppressClick = "true";
                window.setTimeout(() => delete element.dataset.suppressClick, 0);
            }
            drag = null;
            element.classList.remove("is-dragging");
        }

        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", finishDrag);
        element.addEventListener("click", (event) => {
            if (element.dataset.suppressClick !== "true") return;
            delete element.dataset.suppressClick;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        window.addEventListener("resize", () => {
            if (element.hidden) return;
            const rect = element.getBoundingClientRect();
            positionPopup(element, rect.left, rect.top);
        });
    }

    function isNoiseSongsPage(rawUrl) {
        try {
            const target = new URL(rawUrl, location.href);
            return target.origin === location.origin && target.pathname === "/noise-songs";
        } catch {
            return false;
        }
    }

    function isTimeManagementPage(rawUrl) {
        try {
            const target = new URL(rawUrl, location.href);
            return target.origin === location.origin && target.pathname === "/time-management";
        } catch {
            return false;
        }
    }

    function parkFrame(frame, className) {
        frame.classList.add(className);
        frame.setAttribute("aria-hidden", "true");
        frame.tabIndex = -1;
    }

    function restoreFrame(frame, className) {
        frame.classList.remove(className);
        frame.removeAttribute("aria-hidden");
        frame.removeAttribute("tabindex");
    }

    function returnToOriginalPage(url, addHistory) {
        const hasAudio = Boolean(getAudioWindow().studyToolHasActiveAudio?.());
        const hasTimer = Boolean(getTimerWindow().studyToolHasActiveTimer?.());
        if (!hasAudio && !hasTimer) {
            closeRouteLayer();
            if (addHistory) history.pushState({}, "", url);
            return;
        }

        let parkedCurrentFrame = false;
        try {
            const currentUrl = routeFrame.contentWindow.location.href;
            if (!audioFrame && isNoiseSongsPage(currentUrl) && routeFrame.contentWindow.studyToolHasActiveAudio?.()) {
                audioFrame = routeFrame;
                parkFrame(audioFrame, "persistent-audio-source-frame");
                parkedCurrentFrame = true;
            }
            if (!timerFrame && isTimeManagementPage(currentUrl) && routeFrame.contentWindow.studyToolHasActiveTimer?.()) {
                timerFrame = routeFrame;
                parkFrame(timerFrame, "persistent-timer-source-frame");
                parkedCurrentFrame = true;
            }
        } catch {
            // Keep any already-preserved media frames if the current route is not ready.
        }

        if (!parkedCurrentFrame) routeFrame.remove();
        routeFrame = createRouteFrame();
        parkFrame(routeFrame, "persistent-audio-source-frame");
        routeLayer.classList.add("persistent-audio-background-only");
        app.classList.remove("audio-route-background");
        document.body.classList.remove("audio-route-open");
        persistentHud?.classList.remove("is-noise-songs");
        document.title = originalTitle;
        if (addHistory) history.pushState({}, "", url);
    }

    function createRouteFrame() {
        const frame = document.createElement("iframe");
        frame.className = "persistent-audio-route-frame";
        frame.title = "Meridian page";
        frame.addEventListener("load", handleFrameLoad);
        routeLayer.append(frame);
        return frame;
    }

    function createPersistentHud() {
        if (persistentHud) return;
        persistentHud = document.createElement("div");
        persistentHud.className = "persistent-media-hud";
        persistentHud.setAttribute("aria-label", "Active media and study timer");
        document.body.append(persistentHud);
    }

    function getAudioWindow() {
        const frame = audioFrame || routeFrame;
        try {
            return frame?.contentWindow?.studyToolGetAudioState ? frame.contentWindow : window;
        } catch {
            return window;
        }
    }

    function getTimerWindow() {
        for (const frame of [timerFrame, routeFrame, audioFrame]) {
            try {
                if (frame?.contentWindow?.studyToolGetTimerState) return frame.contentWindow;
            } catch {
                continue;
            }
        }
        return window;
    }

    function updatePlayer(state) {
        if (!nowPlaying) return;
        state ||= getAudioWindow().studyToolGetAudioState?.() || { labels: [], hasAudio: false, paused: false };
        nowPlaying.hidden = !state.hasAudio;
        nowPlaying.classList.toggle("is-playing", state.hasAudio && !state.paused);
        nowPlaying.classList.toggle("is-paused", state.hasAudio && state.paused);
        nowPlayingText.textContent = state.labels?.length
            ? `${state.paused ? "Paused" : "Now playing"} · ${state.labels.join(", ")}`
            : "Audio is playing";
        if (state.hasAudio) {
            makePopupDraggable(nowPlaying, "studytool-now-playing-position");
            const rect = nowPlaying.getBoundingClientRect();
            positionPopup(nowPlaying, rect.left, rect.top);
        }
        pauseButton.hidden = !state.hasAudio;
        pauseButton.textContent = state.paused ? "Resume" : "Pause";
        pauseButton.setAttribute("aria-label", state.paused ? "Resume audio" : "Pause audio");
        stopButton.hidden = !state.hasAudio;
        updateTimerHud();
        positionPopupsNearSearch();
    }

    function updateTimerHud(state) {
        if (!timerHud) return;
        state ||= getTimerWindow().studyToolGetTimerState?.() || { active: false, isRunning: false, phase: "Study", remaining: "00:00" };
        timerHud.hidden = !state.active;
        routeFrame?.contentDocument?.body?.classList.toggle("persistent-study-timer-active", state.active);
        timerFrame?.contentDocument?.body?.classList.toggle("persistent-study-timer-active", state.active);
        timerReadout.textContent = `${state.phase} · ${state.remaining}`;
        timerReadout.setAttribute("aria-label", `Open Time Management. ${state.phase}, ${state.remaining} remaining.`);
        timerPauseButton.textContent = state.isRunning ? "Pause" : "Resume";
        timerPauseButton.setAttribute("aria-label", state.isRunning ? "Pause study timer" : "Resume study timer");
        if (state.active) {
            makePopupDraggable(timerHud, "studytool-timer-position");
            const rect = timerHud.getBoundingClientRect();
            positionPopup(timerHud, rect.left, rect.top);
        }
        positionPopupsNearSearch();
    }

    function createTimerHud() {
        if (timerHud) return;
        timerHud = document.createElement("div");
        timerHud.className = "persistent-study-timer";
        timerHud.setAttribute("role", "group");
        timerHud.setAttribute("aria-label", "Study timer controls");
        timerReadout = document.createElement("button");
        timerReadout.type = "button";
        timerReadout.className = "persistent-study-timer-readout";
        timerReadout.title = "Open Time Management";
        timerReadout.addEventListener("click", () => {
            const timerUrl = new URL("/time-management", location.href).href;
            routeTo(isOriginalPage(timerUrl) ? originalUrl.href : timerUrl);
        });
        timerPauseButton = document.createElement("button");
        timerPauseButton.type = "button";
        timerPauseButton.className = "persistent-now-playing-control";
        timerPauseButton.addEventListener("click", () => getTimerWindow().studyToolToggleTimerPause?.());
        timerHud.append(timerReadout, timerPauseButton);
        createPersistentHud();
        persistentHud.append(timerHud);
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
        pauseButton.addEventListener("click", () => void getAudioWindow().studyToolToggleAudioPause?.());
        stopButton = document.createElement("button");
        stopButton.type = "button";
        stopButton.className = "persistent-now-playing-stop";
        stopButton.textContent = "Stop";
        stopButton.addEventListener("click", () => getAudioWindow().studyToolStopActiveAudio?.());
        nowPlaying.append(dot, nowPlayingText, pauseButton, stopButton);
        createPersistentHud();
        persistentHud.append(nowPlaying);
        updatePlayer();
    }

    function routeTo(url, addHistory = true) {
        if (!isInternalUrl(url)) return;
        const targetUrl = new URL(url, location.href).href;
        if (isOriginalPage(url)) {
            if (routeLayer) {
                returnToOriginalPage(url, addHistory);
            }
            return;
        }
        if (!routeLayer) {
            routeLayer = document.createElement("div");
            routeLayer.className = "persistent-audio-route-layer";
            routeFrame = createRouteFrame();
            document.body.append(routeLayer);
            app.classList.add("audio-route-background");
            document.body.classList.add("audio-route-open");
            createPlayer();
            createTimerHud();
        } else {
            if (routeLayer.classList.contains("persistent-audio-background-only")) {
                routeLayer.classList.remove("persistent-audio-background-only");
                restoreFrame(routeFrame, "persistent-audio-source-frame");
                app.classList.add("audio-route-background");
                document.body.classList.add("audio-route-open");
            }
            const targetIsNoiseSongs = isNoiseSongsPage(url);
            const targetIsTimeManagement = isTimeManagementPage(url);
            let parkedCurrentFrame = false;

            try {
                const currentUrl = routeFrame.contentWindow.location.href;
                if (
                    !targetIsNoiseSongs
                    && !audioFrame
                    && isNoiseSongsPage(currentUrl)
                    && routeFrame.contentWindow.studyToolHasActiveAudio?.()
                ) {
                    audioFrame = routeFrame;
                    parkFrame(audioFrame, "persistent-audio-source-frame");
                    parkedCurrentFrame = true;
                }
                if (
                    !targetIsTimeManagement
                    && !timerFrame
                    && isTimeManagementPage(currentUrl)
                ) {
                    timerFrame = routeFrame;
                    parkFrame(timerFrame, "persistent-timer-source-frame");
                    parkedCurrentFrame = true;
                }
            } catch {
                // A not-yet-loaded route has no active page to preserve.
            }

            if (parkedCurrentFrame) routeFrame = createRouteFrame();

            const savedFrame = targetIsNoiseSongs ? audioFrame : targetIsTimeManagement ? timerFrame : null;
            if (savedFrame) {
                routeFrame.remove();
                routeFrame = savedFrame;
                if (savedFrame === audioFrame) {
                    audioFrame = null;
                    restoreFrame(routeFrame, "persistent-audio-source-frame");
                } else {
                    timerFrame = null;
                    restoreFrame(routeFrame, "persistent-timer-source-frame");
                }
            }
        }
        if (addHistory) history.pushState({ studyToolAudioRoute: true }, "", url);
        if (routeFrame.contentWindow.location.href !== targetUrl) routeFrame.src = url;
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
        routeFrame.contentWindow.addEventListener("studytool:now-playing", (event) => updatePlayer(event.detail));
        routeFrame.contentWindow.addEventListener("studytool:custom-media-state", () => updatePlayer());
        routeFrame.contentWindow.addEventListener("studytool:timer-state", (event) => updateTimerHud(event.detail));
        const isNoiseSongs = new URL(frameUrl).pathname === "/noise-songs";
        persistentHud?.classList.toggle("is-noise-songs", isNoiseSongs);
        frameDocument.body?.classList.toggle("persistent-audio-routed", isNoiseSongs);
        frameDocument.body?.classList.toggle("persistent-study-timer-active", Boolean(getTimerWindow().studyToolGetTimerState?.().active));
        if (history.state?.studyToolAudioRoute && frameUrl !== location.href) {
            history.replaceState({ studyToolAudioRoute: true }, "", frameUrl);
        }
        const title = frameDocument.querySelector("title")?.textContent;
        if (title) document.title = title;
        updatePlayer(routeFrame.contentWindow.studyToolGetAudioState?.());

        frameDocument.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const link = event.target.closest?.("a[href]");
            if (!link || link.hasAttribute("download") || !isInternalUrl(link.href)) return;
            event.preventDefault();
            routeTo(link.href);
        }, true);
    }

    document.addEventListener("click", (event) => {
        if ((routeLayer && !routeLayer.classList.contains("persistent-audio-background-only")) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.("a[href]");
        if (!link || link.hasAttribute("download") || !isInternalUrl(link.href)) return;
        if (!getAudioWindow().studyToolHasActiveAudio?.() && !getTimerWindow().studyToolHasActiveTimer?.()) return;
        event.preventDefault();
        routeTo(link.href);
    }, true);

    window.addEventListener("studytool:now-playing", (event) => updatePlayer(event.detail));
    window.addEventListener("studytool:timer-state", (event) => updateTimerHud(event.detail));
    window.addEventListener("popstate", (event) => {
        if (event.state?.studyToolAudioRoute || (routeLayer && isOriginalPage(location.href))) {
            routeTo(location.href, false);
        } else if (routeLayer) {
            closeRouteLayer();
        }
    });
})();
