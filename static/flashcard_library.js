(() => {
    const grid = document.getElementById("flashcard-library-grid");
    const count = document.getElementById("flashcard-library-count");
    const empty = document.getElementById("flashcard-library-empty");
    const error = document.getElementById("flashcard-library-error");

    async function loadDecks() {
        try {
            const response = await fetch("/api/flashcards", { headers: { Accept: "application/json" } });
            const decks = await response.json();
            if (!response.ok || !Array.isArray(decks)) throw new Error(decks.error || "Could not load saved flashcards.");
            count.textContent = `${decks.length} ${decks.length === 1 ? "deck" : "decks"}`;
            empty.hidden = decks.length > 0;
            grid.replaceChildren();
            decks.forEach((deck) => {
                const card = document.createElement("article");
                card.className = "flashcard-library-card";
                const icon = document.createElement("span");
                icon.className = "flashcard-library-icon";
                icon.textContent = "CARDS";
                const title = document.createElement("h3");
                title.textContent = deck.title || "Untitled flashcards";
                const meta = document.createElement("p");
                meta.textContent = `${deck.cards.length} ${deck.cards.length === 1 ? "card" : "cards"} · Term and definition`;
                const date = document.createElement("time");
                date.className = "flashcard-library-date";
                const created = new Date(deck.created_at);
                date.textContent = Number.isNaN(created.getTime()) ? "Saved deck" : `Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(created)}`;
                const actions = document.createElement("div");
                actions.className = "flashcard-library-actions";
                const open = document.createElement("a");
                open.className = "flashcard-action";
                open.href = `/flashcard-generator?deck=${encodeURIComponent(deck.id)}`;
                open.textContent = "Study deck";
                const remove = document.createElement("button");
                remove.className = "flashcard-action secondary";
                remove.type = "button";
                remove.textContent = "Delete";
                remove.addEventListener("click", async () => {
                    if (!window.confirm(`Delete “${deck.title}”? This also removes it from any folders.`)) return;
                    remove.disabled = true;
                    try {
                        const result = await fetch(`/api/flashcards/${encodeURIComponent(deck.id)}`, { method: "DELETE", headers: { Accept: "application/json" } });
                        const data = await result.json();
                        if (!result.ok) throw new Error(data.error || "Could not delete this deck.");
                        await loadDecks();
                    } catch (deleteError) {
                        error.textContent = deleteError.message;
                        error.hidden = false;
                        remove.disabled = false;
                    }
                });
                actions.append(open, remove);
                card.append(icon, title, meta, date, actions);
                grid.append(card);
            });
        } catch (loadError) {
            count.textContent = "Unavailable";
            error.textContent = loadError.message;
            error.hidden = false;
        }
    }
    loadDecks();
})();
