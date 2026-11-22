// BolBeats: bring a best-parts playlist up to date after its songs' parts changed (found again, made longer, a new part
// added), keeping the playlist, its name, cover, quick key and your order. Pure, no imports, so tests load it.
// - a part that a newer part of the same song overlaps gives way to it (the newest one), except that a part you made
//   (auto: false) never gives way to one BolBeats found;
// - a part of one of the playlist's songs that none of its parts overlap joins, right after that song's last part;
// - parts that no longer exist drop out. Songs outside the playlist are never added.

type P = {
    auto?: boolean;
    created: number;
    end: number;
    id: string;
    songId: string;
    start: number;
};

const overlaps = (a: P, b: P) => a.start < b.end && b.start < a.end;

// since: when the playlist last changed; only parts newer than that are added (one you took out stays out)
export const refreshPlan = (partIds: string[], parts: Record<string, P>, since = 0) => {
    const inMix = partIds.map((id) => parts[id]).filter(Boolean);
    const bySong = new Map<string, P[]>();
    for (const p of Object.values(parts))
        bySong.set(p.songId, [...(bySong.get(p.songId) ?? []), p]);
    const out: string[] = [];
    const used = new Set<string>();
    for (const p of inMix) {
        const newer = (bySong.get(p.songId) ?? [])
            .filter(
                (q) =>
                    q.id !== p.id &&
                    q.created > p.created &&
                    overlaps(p, q) &&
                    !(p.auto === false && q.auto === true),
            )
            .sort((a, b) => b.created - a.created)[0];
        const pick = newer ?? p;
        if (!used.has(pick.id)) {
            out.push(pick.id);
            used.add(pick.id);
        }
    }
    // new parts of songs already here, after that song's last part (in song order)
    for (const songId of new Set(inMix.map((p) => p.songId))) {
        const placed = out.map((id) => parts[id]).filter((p) => p.songId === songId);
        const extra = (bySong.get(songId) ?? [])
            .filter(
                (q) => q.created > since && !used.has(q.id) && !placed.some((p) => overlaps(p, q)),
            )
            .filter((q, i, all) => !all.slice(0, i).some((r) => overlaps(r, q))) // overlapping extras: the first
            .sort((a, b) => a.start - b.start);
        if (!extra.length) continue;
        const after = out.lastIndexOf(placed.at(-1)!.id);
        out.splice(after + 1, 0, ...extra.map((q) => q.id));
        extra.forEach((q) => used.add(q.id));
    }
    const changed = out.length !== partIds.length || out.some((id, i) => id !== partIds[i]);
    return { changed, partIds: out };
};
