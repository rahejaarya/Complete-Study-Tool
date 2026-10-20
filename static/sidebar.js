(() => {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.querySelector(".sidebar-toggle");
    if (!sidebar || !toggle) return;

    let pinnedOpen = true;
    let hoverOpen = false;
    let focusOpen = false;
    let suppressHover = false;

    function updateState() {
        const collapsed = !pinnedOpen;
        const temporarilyOpen = collapsed && (hoverOpen || focusOpen);
        document.body.classList.toggle("sidebar-collapsed", collapsed);
        document.body.classList.toggle("sidebar-hover-expanded", temporarilyOpen);
        toggle.setAttribute("aria-expanded", String(pinnedOpen || temporarilyOpen));

        const buttonLabel = pinnedOpen
            ? "Collapse navigation"
            : temporarilyOpen
                ? "Keep navigation open"
                : "Expand navigation";
        toggle.setAttribute("aria-label", buttonLabel);
        toggle.title = buttonLabel;
        toggle.textContent = pinnedOpen ? "‹" : "›";

        sidebar.querySelectorAll(".nav-link").forEach((link) => {
            if (!collapsed) {
                link.removeAttribute("aria-label");
                link.removeAttribute("title");
                return;
            }
            const label = link.cloneNode(true);
            label.querySelectorAll(".nav-icon").forEach((icon) => icon.remove());
            const name = label.textContent.replace(/\s+/g, " ").trim();
            link.setAttribute("aria-label", name);
            link.title = name;
        });
    }

    toggle.addEventListener("click", () => {
        if (pinnedOpen) {
            pinnedOpen = false;
            hoverOpen = false;
            focusOpen = false;
            suppressHover = true;
        } else {
            pinnedOpen = true;
            hoverOpen = false;
            focusOpen = false;
            suppressHover = false;
        }
        updateState();
    });

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        sidebar.addEventListener("mouseenter", () => {
            if (!pinnedOpen && !suppressHover) {
                hoverOpen = true;
                updateState();
            }
        });

        sidebar.addEventListener("mouseleave", () => {
            if (!pinnedOpen) {
                hoverOpen = false;
                suppressHover = false;
                updateState();
            }
        });
    }

    sidebar.addEventListener("focusin", () => {
        if (!pinnedOpen) {
            focusOpen = true;
            updateState();
        }
    });

    sidebar.addEventListener("focusout", (event) => {
        if (!pinnedOpen && !sidebar.contains(event.relatedTarget)) {
            focusOpen = false;
            updateState();
        }
    });

    updateState();
})();
