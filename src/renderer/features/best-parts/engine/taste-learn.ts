// BolBeats: your idea of "the best part", learned from what you do. Pure, no imports, so tests load it.
// - A part BolBeats found that you trim or extend teaches how long your parts are and how early they start.
// - Thumbs down, or skipping a part before its halfway point more often than you hear it through, leaves it out of
//   what BolBeats plays for you; thumbs up brings it forward.
// Nothing is learned from fewer than 3 edits: one odd edit shouldn't change every song.

export type Edit = { chosen: [number, number]; found: [number, number] };
export type Learned = {
    edits: number;
    leadIn: null | number; // seconds you start before (+) or after (-) where BolBeats would start
    minPart: null | number; // seconds: the length new parts are made at least
};
export type TasteState = {
    edits: Edit[]; // newest last, at most KEEP
    heard: Record<string, number>; // part id -> times heard past its halfway point
    skips: Record<string, number>; // part id -> times skipped before its halfway point
    votes: Record<string, -1 | 1>; // part id -> thumbs
};

export const KEEP = 60;
const MIN_EDITS = 3;

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const learn = (t: Pick<TasteState, 'edits'>): Learned => {
    const edits = t.edits.slice(-KEEP);
    if (edits.length < MIN_EDITS) return { edits: edits.length, leadIn: null, minPart: null };
    const lengths = edits.map((e) => e.chosen[1] - e.chosen[0]);
    const leads = edits.map((e) => e.found[0] - e.chosen[0]);
    return {
        edits: edits.length,
        // a lead-in under a second is noise (the editor snaps to quiet moments)
        leadIn: Math.abs(median(leads)) < 1 ? 0 : clamp(Math.round(median(leads)), -10, 16),
        // the finder makes parts at least this long; a little under your usual length so it can end on a phrase
        minPart: clamp(Math.round(median(lengths) * 0.9), 15, 120),
    };
};

// Parts you'd rather not hear: thumbs down, or skipped more often than heard through (twice at least).
export const isDisliked = (t: Omit<TasteState, 'edits'>, id: string) =>
    t.votes[id] === -1 ||
    (t.votes[id] !== 1 && (t.skips[id] ?? 0) >= 2 && (t.skips[id] ?? 0) > (t.heard[id] ?? 0));

export const isLiked = (t: Pick<TasteState, 'votes'>, id: string) => t.votes[id] === 1;

// Start a found part earlier (or later) the way you do, never before `notBefore` (the part before it) and always
// leaving at least 8 s of it.
export const applyLeadIn = (
    [a, z]: [number, number],
    leadIn: null | number,
    notBefore: number,
): [number, number] => {
    if (!leadIn) return [a, z];
    return [clamp(a - leadIn, notBefore, z - 8), z];
};
