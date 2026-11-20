// album-editions.js — telling when two Spotify albums are editions of the same record
// ("Pretty On The Internet" and "Pretty On The Internet (Deluxe Edition)" have
// different ids), so an artist's Albums & EPs list, your album rankings, friends'
// rankings and comparisons line up whichever edition each was made from.
import { albumArtists } from "./artist-ratings.js";

// Words that mark an edition rather than a different record. Not "live" (a live album
// is its own record, e.g. "W.L. (Live from Stirling Castle)") or "version"
// (re-recordings like "(Taylor's Version)" are separate albums).
export const EDITION_WORDS = "deluxe|edition|remaster|remastered|expanded|anniversary|bonus|international";

// "W.L. (Deluxe)", "Millennials (Deluxe Edition)", "Album - 2011 Remaster" all share
// the key of the standard edition ("w.l.", "millennials", "album"). Also used for
// track names, so "Song - 2011 Remaster" matches "Song".
export function albumKey(name) {
    return String(name ?? "").toLowerCase()
        .replace(new RegExp(`\\s*[([][^)\\]]*\\b(${EDITION_WORDS})\\b[^)\\]]*[)\\]]`, "g"), "")
        .replace(new RegExp(`\\s+-\\s+[^-]*\\b(${EDITION_WORDS})\\b.*$`), "")
        .replace(/\s+/g, " ")
        .trim();
}

// Whether two saved rankings rank the same thing: same kind and the same album /
// artist, or (albums) two editions of one record by the same artist.
export async function sameSubject(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if ((a.source_id ?? null) === (b.source_id ?? null)) return true;
    if (a.kind !== "album" || !a.source_name || !b.source_name) return false;
    if (albumKey(a.source_name) !== albumKey(b.source_name)) return false;
    // Same title: make sure it's the same artist too ("Greatest Hits" isn't one record).
    const credits = await albumArtists([a.source_id, b.source_id]).catch(() => ({}));
    const aa = credits[a.source_id] || [], bb = credits[b.source_id] || [];
    return aa.some(id => bb.includes(id));
}
