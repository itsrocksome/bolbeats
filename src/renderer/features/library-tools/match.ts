// BolBeats: pure helpers to read song names out of file names and match them to lookup results or a library.
// No imports, so Node tests can run it directly.

export type NameGuess = { album: null | string; parts: string[]; term: string };

const VERSION =
    /\b(karaoke|instrumental|cover|tribute|originally performed|backing track|lullaby|8[- ]bit|piano version|made famous|lo-?fi|slowed|reverb|sped up|remix|flip)\b/i;
const ALBUM_HINT = /[([]\s*from\s+([^)\]]+)[)\]]/i;

// "Blood In Your Eyes (from GTAVI The Album) - Tove Lo" → parts ["Blood In Your Eyes", "Tove Lo"], album "GTAVI The Album".
export function guessFromName(name: string): NameGuess {
    const base = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ');
    const album = base.match(ALBUM_HINT)?.[1]?.trim() ?? null;
    let parts = base
        .replace(ALBUM_HINT, '')
        .split(/\s+[-–-]\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
    // "Justice - Pusher - Justice": the repeated side is the artist
    if (parts.length === 3 && norm(parts[0]) === norm(parts[2])) parts = [parts[1], parts[0]];
    const term = parts
        .map((p) => p.replace(/\((feat|ft)\.?[^)]*\)|\b(feat|ft)\.?\s.*$/gi, ''))
        .join(' ');
    return { album, parts, term: term.replace(/\s+/g, ' ').trim() };
}

export const norm = (s: string) =>
    s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\((feat|ft)\.?[^)]*\)|\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

// How well a {title, artist} pair matches the name parts (in either order) and duration.
export function matchScore(
    parts: string[],
    cand: { artist: string; durationSec?: null | number; title: string },
    durationSec?: number,
) {
    const [p0 = '', p1 = ''] = parts;
    const orderA = 0.6 * similarity(p0, cand.title) + 0.4 * similarity(p1, cand.artist);
    const orderB = 0.6 * similarity(p1, cand.title) + 0.4 * similarity(p0, cand.artist);
    let names =
        parts.length < 2
            ? similarity(p0, `${cand.title} ${cand.artist}`)
            : Math.max(orderA, orderB);
    // A right title by the wrong artist is a different recording (often a cover).
    if (
        parts.length >= 2 &&
        Math.max(similarity(p0, cand.artist), similarity(p1, cand.artist)) === 0
    )
        names = Math.min(names, 0.5);
    // Karaoke, covers and instrumentals only count when the file name asked for one.
    if (VERSION.test(`${cand.title} ${cand.artist}`) && !VERSION.test(parts.join(' ')))
        names -= 0.35;
    if (!durationSec || !cand.durationSec) return names;
    const dur = Math.max(0, 1 - Math.abs(durationSec - cand.durationSec) / 15);
    return 0.85 * names + 0.15 * dur;
}

// Reads a playlist export into {title, artist} lines: Apple Music .txt (tab-separated), Exportify .csv, .m3u,
// or plain "Artist - Title" / "Title - Artist" lines.
export function parsePlaylistText(text: string): { artist: string; title: string }[] {
    const lines = text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((l) => l.trim());
    if (!lines.length) return [];
    const head = lines[0];
    if (head.includes('\t') && /^name\t/i.test(head)) {
        const cols = head.split('\t').map((c) => c.toLowerCase());
        const ti = cols.indexOf('name');
        const ai = cols.indexOf('artist');
        return lines
            .slice(1)
            .map((l) => l.split('\t'))
            .map((c) => ({ artist: c[ai] ?? '', title: c[ti] ?? '' }));
    }
    if (/track name/i.test(head) && head.includes(',')) {
        const cols = csvRow(head).map((c) => c.toLowerCase());
        const ti = cols.findIndex((c) => c === 'track name');
        const ai = cols.findIndex((c) => c.startsWith('artist name'));
        return lines
            .slice(1)
            .map(csvRow)
            .map((c) => ({ artist: (c[ai] ?? '').split(/[,;]/)[0], title: c[ti] ?? '' }));
    }
    return lines
        .filter((l) => !l.startsWith('#') || l.startsWith('#EXTINF'))
        .map((l) => l.replace(/^#EXTINF:[^,]*,/, '').replace(/^\d+[.)]\s+/, ''))
        .filter((l) => !/^(https?:|\/|[a-z]:\\)/i.test(l))
        .map((l) => {
            const [a, ...rest] = l.split(/\s+[-–-]\s+/);
            return rest.length
                ? { artist: a.trim(), title: rest.join(' - ').trim() }
                : { artist: '', title: a.trim() };
        });
}

// Token overlap (Dice coefficient) between two names, 0..1.
export function similarity(a: string, b: string) {
    const A = new Set(norm(a).split(' ').filter(Boolean));
    const B = new Set(norm(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let both = 0;
    for (const t of A) if (B.has(t)) both++;
    return (2 * both) / (A.size + B.size);
}

function csvRow(line: string) {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q && ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
        } else if (ch === '"') q = !q;
        else if (ch === ',' && !q) {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    out.push(cur);
    return out;
}

// BolBeats: sure enough to write into a file without asking: a strong top match that no other, different song comes
// close to (the same song listed twice, e.g. single and album, doesn't count against it).
export const SURE = 0.82;
export const isSure = (cands: { artist: string; score: number; title: string }[]) => {
    const [a, b] = cands;
    if (!a || a.score < SURE) return false;
    return (
        !b ||
        b.score < a.score - 0.08 ||
        (b.title.toLowerCase() === a.title.toLowerCase() &&
            b.artist.toLowerCase() === a.artist.toLowerCase())
    );
};
