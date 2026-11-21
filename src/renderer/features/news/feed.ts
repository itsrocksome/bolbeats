// BolBeats: music news, pure helpers (no imports, so tests load them): merge releases from both sources, say what
// happened in plain words, and find reminders that are due.

export type FeedRelease = {
    artist: string;
    artworkUrl: null | string;
    date: string;
    kind?: string;
    source?: 'iTunes' | 'MusicBrainz';
    title: string;
    trackCount: null | number;
    url: string;
};

const DAY = 86_400_000;
const norm = (s: string) =>
    s
        .toLowerCase()
        .replace(/ - (single|ep)$/, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

export const kindOf = (r: FeedRelease) => {
    if (/ - ep$/i.test(r.title) || r.kind === 'EP') return 'EP';
    if (
        / - single$/i.test(r.title) ||
        r.kind === 'Single' ||
        (r.source === 'iTunes' && (r.trackCount ?? 9) <= 3)
    )
        return 'single';
    return 'album';
};

export const cleanTitle = (r: FeedRelease) => r.title.replace(/ - (single|ep)$/i, '');

export const isUpcoming = (r: FeedRelease, now: number) => Date.parse(r.date) > now;

// One entry per release: store links win over database links when both sources list it.
export const mergeReleases = (lists: FeedRelease[][]) => {
    const byKey = new Map<string, FeedRelease>();
    for (const r of lists.flat()) {
        const k = `${norm(r.artist).split(' ')[0]}|${norm(r.title)}`;
        const cur = byKey.get(k);
        if (!cur || (cur.source === 'MusicBrainz' && r.source === 'iTunes'))
            byKey.set(k, cur ? { ...r, date: r.date || cur.date } : r);
    }
    return [...byKey.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
};

const ago = (days: number) =>
    days <= 0
        ? 'today'
        : days === 1
          ? 'yesterday'
          : days < 14
            ? `${days} days ago`
            : days < 60
              ? `${Math.round(days / 7)} weeks ago`
              : `${Math.round(days / 30)} months ago`;

// What a post says, e.g. "dropped a new single", "yesterday" / "announced an album", "out 5 Dec, in 15 days".
export const describe = (r: FeedRelease, now: number) => {
    const k = kindOf(r);
    const a = k === 'album' || k === 'EP' ? `an ${k === 'EP' ? 'EP' : 'album'}` : 'a single';
    const days = Math.round((Date.parse(r.date) - now) / DAY);
    if (days > 0) {
        const on = new Date(r.date).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
        });
        return {
            verb: `announced ${a}`,
            when: `out ${on}, in ${days === 1 ? '1 day' : `${days} days`}`,
        };
    }
    return { verb: k === 'album' ? 'released an album' : `dropped a new ${k}`, when: ago(-days) };
};

export type Reminder = { artist: string; date: string; title: string; url: string };

// Reminders whose release day has come.
export const dueReminders = (reminders: Record<string, Reminder>, now: number) =>
    Object.values(reminders).filter((r) => Date.parse(r.date) <= now);
