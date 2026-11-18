// folder-dialog.js — the pop-ups for ranking folders: naming a folder (new / rename,
// on rankings.html) and ticking which folders a saved ranking is in (on the ranking's
// own page). Folders belong to one section, so an album ranking only offers album
// folders and an artist's albums ranking only artist-album folders.
import { esc } from "./auth.js";
import {
    loadFolders, createFolder, addToFolder, removeFromFolder, sectionOf, foldersForSection,
    folderNameProblem, FOLDER_NAME_MAX, FOLDER_LIMIT,
} from "./saved-rankings.js";

export function openModal(innerHtml) {
    document.getElementById("library-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "library-modal";
    modal.className = "site-info-modal open";
    modal.innerHTML = `<div class="site-info-card library-modal-card" role="dialog" aria-modal="true">
        <button class="site-info-close" type="button" aria-label="Close">X</button>${innerHtml}</div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    modal.querySelector(".site-info-close").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.addEventListener("keydown", onKey);
    return { modal, close };
}

// Name a new folder or rename one. existing: the folders the name must not clash with.
// onSave(name) → { error } | anything else on success.
export function openNameModal({ title, value = "", button, existing = [], onSave, ignoreId = null }) {
    const { modal, close } = openModal(`
        <h2>${esc(title)}</h2>
        <form class="auth-form folder-name-form" novalidate>
            <label class="auth-field">
                <span>Folder name</span>
                <input type="text" name="name" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="e.g. Favourites, 2026 Releases">
            </label>
            <p class="username-status error" aria-live="polite"></p>
            <button type="submit">${esc(button)}</button>
        </form>`);
    const form = modal.querySelector("form");
    const input = form.elements.name;
    const errorEl = form.querySelector(".username-status");
    input.value = value;
    input.focus();
    input.select();
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const problem = folderNameProblem(input.value, existing, ignoreId);
        if (problem) { errorEl.textContent = problem; return; }
        form.querySelector("button").disabled = true;
        const result = await onSave(input.value.trim());
        form.querySelector("button").disabled = false;
        if (result?.error) { errorEl.textContent = result.error; return; }
        close();
    });
}

// Tick the folders a saved ranking belongs in ({ id, title, kind }). Changes save as
// soon as a box is ticked; a new folder can be made (and the ranking put in it) here.
export async function openFoldersDialog(ranking) {
    const section = sectionOf(ranking.kind);
    const { modal } = openModal(`
        <h2>Add to folder</h2>
        <p class="library-modal-sub">${esc(ranking.title)}</p>
        <div class="folder-checklist"><p class="library-modal-empty">Loading your folders…</p></div>
        <form class="folder-quick-add" novalidate hidden>
            <input type="text" name="name" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="New folder name" aria-label="New folder name">
            <button type="submit" class="secondary-btn">Add</button>
        </form>
        <p class="username-status error" aria-live="polite"></p>`);
    const listBox = modal.querySelector(".folder-checklist");
    const errorEl = modal.querySelector(".username-status");
    const quick = modal.querySelector(".folder-quick-add");

    let library;
    try {
        library = await loadFolders();
    } catch (err) {
        console.error(err);
        listBox.innerHTML = `<p class="library-modal-empty">Your folders couldn't be loaded just now.</p>`;
        return;
    }
    if (!library.available) {
        listBox.innerHTML = `<p class="library-modal-empty">Folders aren't available just now.</p>`;
        return;
    }
    let { folders, items } = library;
    const mine = () => foldersForSection(folders, section);
    quick.hidden = false;

    function drawChecklist() {
        if (!mine().length) {
            listBox.innerHTML = `<p class="library-modal-empty">No folders here yet. Create one below.</p>`;
            return;
        }
        listBox.innerHTML = mine().map(f => {
            const inIt = items.some(i => i.folder_id === f.id && i.ranking_id === ranking.id);
            return `<label class="folder-check"><input type="checkbox" value="${esc(f.id)}"${inIt ? " checked" : ""}><span>${esc(f.name)}</span></label>`;
        }).join("");
    }

    listBox.addEventListener("change", async e => {
        const box = e.target;
        if (box.type !== "checkbox") return;
        errorEl.textContent = "";
        box.disabled = true;
        try {
            if (box.checked) {
                await addToFolder(box.value, ranking.id);
                items.push({ folder_id: box.value, ranking_id: ranking.id });
            } else {
                await removeFromFolder(box.value, ranking.id);
                items = items.filter(i => !(i.folder_id === box.value && i.ranking_id === ranking.id));
            }
        } catch (err) {
            console.error(err);
            box.checked = !box.checked;
            errorEl.textContent = "That change couldn't be saved just now. Please try again.";
        } finally {
            box.disabled = false;
        }
    });

    quick.addEventListener("submit", async e => {
        e.preventDefault();
        const name = quick.elements.name.value;
        const problem = folderNameProblem(name, mine());
        if (problem) { errorEl.textContent = problem; return; }
        if (folders.length >= FOLDER_LIMIT) { errorEl.textContent = `You can have up to ${FOLDER_LIMIT} folders.`; return; }
        errorEl.textContent = "";
        const created = await createFolder(name, section);
        if (created.error) { errorEl.textContent = created.error; return; }
        folders.push(created.folder);
        try {
            await addToFolder(created.folder.id, ranking.id);
            items.push({ folder_id: created.folder.id, ranking_id: ranking.id });
        } catch (err) { console.error(err); }
        quick.reset();
        drawChecklist();
    });

    drawChecklist();
}
