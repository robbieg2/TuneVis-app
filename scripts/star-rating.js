// star-rating.js — a 1–5 star rating in half-star steps, used for album rankings.
//
// Click or tap the left half of a star for a half star, the right half for a whole
// one, or drag along the stars (finger or mouse) and let go on the rating you want. Keyboard: arrow keys move by half a star, Home/End jump to ½ / 5, Delete or
// Backspace clears. Exposed to screen readers as a slider.

export const MIN_RATING = 0.5;
export const MAX_RATING = 5;

const STAR_PATH = "M12 2.6l2.83 5.92 6.5.83-4.77 4.5 1.2 6.44L12 17.17l-5.76 3.12 1.2-6.44-4.77-4.5 6.5-.83z";

// A rating from a URL / database value, or null if it isn't a valid half-star rating.
export function parseRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < MIN_RATING || n > MAX_RATING) return null;
    return Math.round(n * 2) === n * 2 ? n : null;
}

// "4.5" / "4", for labels.
export function formatRating(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Text stars for plain-text exports and compact labels, e.g. "★★★★½".
export function starsText(value) {
    if (!value) return "";
    return "★".repeat(Math.floor(value)) + (value % 1 ? "½" : "");
}

// Static (read-only) stars as an HTML string, for lists.
export function starsHtml(value, { size = 14 } = {}) {
    const parts = [];
    for (let i = 0; i < 5; i++) {
        const fill = Math.max(0, Math.min(1, value - i)) * 100;
        parts.push(starMarkup(fill, size));
    }
    return `<span class="star-static" role="img" aria-label="${formatRating(value)} out of 5 stars">${parts.join("")}</span>`;
}

function starMarkup(fillPercent, size) {
    return `<span class="star" style="width:${size}px;height:${size}px">
        <svg class="star-empty" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>
        <span class="star-fill" style="width:${fillPercent}%"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:${size}px;height:${size}px"><path d="${STAR_PATH}"/></svg></span>
    </span>`;
}

// An interactive rating. onChange(value | null) fires when the user sets or clears it.
// Returns { el, setValue(value | null) }.
export function createStarRating({ value = null, onChange, label = "Your rating" } = {}) {
    let current = parseRating(value);
    let preview = null;

    const el = document.createElement("div");
    el.className = "star-rating";

    const stars = document.createElement("div");
    stars.className = "star-rating-stars";
    stars.tabIndex = 0;
    stars.setAttribute("role", "slider");
    stars.setAttribute("aria-label", label);
    stars.setAttribute("aria-valuemin", "0");
    stars.setAttribute("aria-valuemax", String(MAX_RATING));

    const valueEl = document.createElement("span");
    valueEl.className = "star-rating-value";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "star-rating-clear";
    clearBtn.textContent = "Clear";

    el.append(stars, valueEl, clearBtn);

    function render() {
        const shown = preview ?? current ?? 0;
        stars.innerHTML = Array.from({ length: 5 }, (_, i) =>
            starMarkup(Math.max(0, Math.min(1, shown - i)) * 100, 28)).join("");
        stars.classList.toggle("previewing", preview !== null);
        valueEl.textContent = current ? `${formatRating(current)} / 5` : "Not rated";
        valueEl.classList.toggle("unset", !current);
        // visibility, not display: the button keeps its space, so rating an album
        // doesn't shift the stars sideways under the pointer.
        clearBtn.style.visibility = current ? "visible" : "hidden";
        stars.setAttribute("aria-valuenow", String(current ?? 0));
        stars.setAttribute("aria-valuetext", current ? `${formatRating(current)} out of 5 stars` : "Not rated");
    }

    function set(value) {
        const next = value === null ? null : parseRating(value);
        if (next === current) return;
        current = next;
        render();
        onChange?.(current);
    }

    // Which rating a pointer position on the stars means.
    function ratingAt(clientX) {
        const starEls = [...stars.querySelectorAll(".star")];
        for (let i = 0; i < starEls.length; i++) {
            const r = starEls[i].getBoundingClientRect();
            const right = i < starEls.length - 1 ? starEls[i + 1].getBoundingClientRect().left : r.right;
            if (clientX < right || i === starEls.length - 1) {
                return clientX < r.left + r.width / 2 ? i + 0.5 : i + 1;
            }
        }
        return null;
    }

    // Press, slide and release: the stars follow the finger (or mouse) and the rating
    // is set where it's let go. Vertical swipes still scroll the page (touch-action:
    // pan-y in the CSS); if the browser takes over for a scroll, the drag is dropped.
    let dragId = null;
    let setByPointer = false;   // the pointerup already set the rating: skip its click

    stars.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        dragId = e.pointerId;
        setByPointer = false;
        try { stars.setPointerCapture(e.pointerId); } catch {}
        preview = ratingAt(e.clientX);
        render();
    });
    stars.addEventListener("pointermove", e => {
        if (dragId === e.pointerId) {
            const next = ratingAt(e.clientX);
            if (next !== preview) { preview = next; render(); }
            return;
        }
        if (e.pointerType !== "mouse") return;   // no hover preview on touch
        preview = ratingAt(e.clientX);
        render();
    });
    stars.addEventListener("pointerup", e => {
        if (dragId !== e.pointerId) return;
        dragId = null;
        const value = ratingAt(e.clientX);
        preview = e.pointerType === "mouse" ? value : null;
        setByPointer = true;
        if (value === current) render(); else set(value);
    });
    stars.addEventListener("pointercancel", () => {
        dragId = null;
        preview = null;
        render();
    });
    stars.addEventListener("pointerleave", () => {
        if (preview === null || dragId !== null) return;
        preview = null;
        render();
    });
    stars.addEventListener("click", e => {
        if (setByPointer) { setByPointer = false; return; }
        preview = null;
        set(ratingAt(e.clientX));
    });
    stars.addEventListener("keydown", e => {
        const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
        if (step) {
            e.preventDefault();
            const next = (current ?? 0) + step;
            set(next < MIN_RATING ? null : Math.min(MAX_RATING, next));
        } else if (e.key === "Home") { e.preventDefault(); set(MIN_RATING); }
        else if (e.key === "End") { e.preventDefault(); set(MAX_RATING); }
        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); set(null); }
    });
    clearBtn.addEventListener("click", () => { set(null); stars.focus(); });

    render();
    return {
        el,
        setValue(value) { current = value === null ? null : parseRating(value); preview = null; render(); },
    };
}
