// loop-carousel.js — horizontal rows that never end (like Netflix's): scrolling or
// pressing an arrow past the last card carries straight on to the first, and back past
// the first comes round to the last. Used by every carousel on the site: Discover's
// search results, Trending and Recently Viewed (home.js), the song page's
// recommendations (features.js) and Recommended for you (recommended-rankings.js).
//
// How: the row holds the real cards with a screen's worth of copies on each side
// (copies of the last cards before the first, of the first cards after the last).
// When scrolling settles inside the copies, the row jumps by exactly one set's width
// to the matching real card, which looks identical, so it never reaches an end. The
// copies are built by the same build() as the real cards, so they work when tapped.
// Rows that fit on screen don't loop and hide their arrows.
//
//   loopCarousel(rowEl, { items, build: item => Element, leftBtn, rightBtn })
// Call it again with new items to re-fill the row.

const SETTLE_MS = 140;

export function loopCarousel(carousel, { items = [], build, leftBtn = null, rightBtn = null }) {
    const state = carousel._loop || (carousel._loop = {});
    Object.assign(state, { items, build, leftBtn, rightBtn, looping: false, start: 0, setWidth: 0 });
    carousel.innerHTML = "";
    items.forEach(item => carousel.appendChild(build(item)));
    wireOnce(carousel);
    wireButtons(carousel);
    layout(carousel, 0);
}

// Arrow buttons: wired on the first call that passes them (a row can be filled once
// without buttons while it loads), each button only once.
function wireButtons(carousel) {
    const state = carousel._loop;
    const step = dir => () => {
        settle(carousel);   // a quick second press starts from the real set again
        carousel.scrollBy({ left: dir * Math.max(240, Math.floor(carousel.clientWidth * 0.85)), behavior: "smooth" });
    };
    if (state.leftBtn && !state.leftBtn.dataset.loopWired) {
        state.leftBtn.dataset.loopWired = "1";
        state.leftBtn.addEventListener("click", step(-1));
    }
    if (state.rightBtn && !state.rightBtn.dataset.loopWired) {
        state.rightBtn.dataset.loopWired = "1";
        state.rightBtn.addEventListener("click", step(1));
    }
}

function showButtons(state, on) {
    for (const btn of [state.leftBtn, state.rightBtn]) if (btn) btn.style.display = on ? "block" : "none";
}

// Adds the copies and works out where the real set starts and how wide it is.
// keep: how far through the set to sit afterwards (0–1), so a resize stays in place.
function layout(carousel, keep = 0) {
    const state = carousel._loop;
    carousel.querySelectorAll("[data-loop-copy]").forEach(n => n.remove());
    state.looping = false;
    const originals = [...carousel.children];
    // Nothing to loop, or the page has since put something else in the row (a "No
    // results" message): leave it alone.
    if (!state.items.length || originals.length !== state.items.length) { showButtons(state, false); return; }
    // Hidden (e.g. a tab that isn't open): the ResizeObserver lays it out once shown.
    if (!carousel.clientWidth) { showButtons(state, false); return; }
    if (carousel.scrollWidth <= carousel.clientWidth + 1) {
        showButtons(state, false);
        jump(carousel, 0);
        return;
    }

    const gap = parseFloat(getComputedStyle(carousel).columnGap) || 0;
    const cardWidth = originals[0].getBoundingClientRect().width + gap;
    const n = originals.length;
    const k = Math.min(n, Math.ceil(carousel.clientWidth / Math.max(cardWidth, 1)) + 1);
    const copy = i => {
        const el = state.build(state.items[i]);
        el.dataset.loopCopy = "1";
        el.setAttribute("aria-hidden", "true");
        return el;
    };
    for (let i = n - k; i < n; i++) carousel.insertBefore(copy(i), originals[0]);
    const after = [];
    for (let i = 0; i < k; i++) { const el = copy(i); carousel.appendChild(el); after.push(el); }

    const box = carousel.getBoundingClientRect();
    const pos = el => el.getBoundingClientRect().left - box.left + carousel.scrollLeft;
    const padLeft = parseFloat(getComputedStyle(carousel).paddingLeft) || 0;
    state.start = pos(originals[0]) - padLeft;
    state.setWidth = pos(after[0]) - pos(originals[0]);
    state.looping = state.setWidth > 0;
    jump(carousel, state.start + keep * state.setWidth);
    showButtons(state, state.looping);
}

// Moves instantly (no smooth scrolling or snapping animation).
function jump(carousel, x) {
    const { scrollBehavior, scrollSnapType } = carousel.style;
    carousel.style.scrollBehavior = "auto";
    carousel.style.scrollSnapType = "none";
    carousel.scrollLeft = x;
    requestAnimationFrame(() => {
        carousel.style.scrollBehavior = scrollBehavior;
        carousel.style.scrollSnapType = scrollSnapType;
    });
}

// Inside the copies: move to the same place in the real set.
function settle(carousel) {
    const state = carousel._loop;
    if (!state?.looping) return;
    const x = carousel.scrollLeft;
    if (x < state.start - 1) jump(carousel, x + state.setWidth);
    else if (x >= state.start + state.setWidth - 1) jump(carousel, x - state.setWidth);
}

function wireOnce(carousel) {
    if (carousel.dataset.loopWired) return;
    carousel.dataset.loopWired = "1";

    // Settle once scrolling stops, never while a finger is still on the row.
    let touching = false;
    let timer = null;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (!touching) settle(carousel); }, SETTLE_MS);
    };
    carousel.addEventListener("scroll", schedule, { passive: true });
    carousel.addEventListener("touchstart", () => { touching = true; }, { passive: true });
    carousel.addEventListener("touchend", () => { touching = false; schedule(); }, { passive: true });
    carousel.addEventListener("touchcancel", () => { touching = false; schedule(); }, { passive: true });

    // Width changes (window resize, a hidden tab being opened): lay out again, keeping
    // the same place in the set.
    let lastWidth = carousel.clientWidth;
    new ResizeObserver(() => {
        const width = carousel.clientWidth;
        if (width === lastWidth) return;
        lastWidth = width;
        const s = carousel._loop;
        const keep = s.looping && s.setWidth
            ? (((carousel.scrollLeft - s.start) % s.setWidth) + s.setWidth) % s.setWidth / s.setWidth
            : 0;
        layout(carousel, keep);
    }).observe(carousel);
}
