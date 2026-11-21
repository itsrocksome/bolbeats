// BolBeats: a best-parts playlist as a small file you can send (.bolbeats). It holds no audio: each part names its song
// (title, artist, album, length) and where the part starts and ends, plus the joins you chose. Whoever opens it gets
// the same playlist built from their own copies of the songs. Pure (no imports) so tests load it; the file comes from
// someone else, so `readSharedMix` checks every field before anything uses it.

export const SHARE_EXT = 'bolbeats';

export type SharedMix = {
    app: 'BolBeats';
    cover?: string; // the playlist's own cover, a small image as a data URL
    joins: Record<string, string>; // "3>4" (part positions) -> transition
    kind: 'best-parts-playlist';
    name: string;
    parts: SharedPart[];
    version: 1;
};
export type SharedPart = {
    album: null | string;
    artist: string;
    end: number; // seconds into the song
    seconds: number; // the song's length, to tell versions apart
    start: number;
    title: string;
};

type PartLike = SharedPart & { id: string };

const TRANSITIONS = new Set(['bass', 'blend', 'breath', 'cut', 'echo', 'handoff', 'jump', 'sweep']);
const MAX_PARTS = 500;
const MAX_COVER = 400_000;
const COVER = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const toSharedMix = (
    name: string,
    parts: PartLike[],
    picks: Record<string, string>, // "partId>partId" -> transition
    cover?: string,
): SharedMix => {
    const joins: Record<string, string> = {};
    parts.forEach((p, i) => {
        const pick = parts[i + 1] && picks[`${p.id}>${parts[i + 1].id}`];
        if (pick) joins[`${i}>${i + 1}`] = pick;
    });
    return {
        app: 'BolBeats',
        ...(cover && cover.length <= MAX_COVER && COVER.test(cover) ? { cover } : {}),
        joins,
        kind: 'best-parts-playlist',
        name,
        parts: parts.map(({ album, artist, end, seconds, start, title }) => ({
            album,
            artist,
            end: Math.round(end * 1000) / 1000,
            seconds: Math.round(seconds * 10) / 10,
            start: Math.round(start * 1000) / 1000,
            title,
        })),
        version: 1,
    };
};

const text = (v: unknown, max = 300) =>
    typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// null when the file isn't a BolBeats playlist (or is damaged); bad parts and joins are dropped, not trusted.
export const readSharedMix = (raw: string): null | SharedMix => {
    let j: any;
    try {
        j = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!j || j.app !== 'BolBeats' || j.kind !== 'best-parts-playlist' || j.version !== 1)
        return null;
    if (!Array.isArray(j.parts)) return null;
    const parts: SharedPart[] = [];
    for (const p of j.parts.slice(0, MAX_PARTS)) {
        const title = text(p?.title);
        const artist = text(p?.artist) ?? '';
        const [start, end, seconds] = [num(p?.start), num(p?.end), num(p?.seconds)];
        if (!title || start === null || end === null || seconds === null || end <= start) continue;
        if (end - start > 3600) continue;
        parts.push({ album: text(p?.album), artist, end, seconds, start, title });
    }
    if (!parts.length) return null;
    const joins: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.joins && typeof j.joins === 'object' ? j.joins : {})) {
        const m = /^(\d+)>(\d+)$/.exec(k);
        if (m && +m[2] === +m[1] + 1 && +m[2] < parts.length && TRANSITIONS.has(v as string))
            joins[k] = v as string;
    }
    const cover =
        typeof j.cover === 'string' && j.cover.length <= MAX_COVER && COVER.test(j.cover)
            ? j.cover
            : undefined;
    return {
        app: 'BolBeats',
        ...(cover ? { cover } : {}),
        joins,
        kind: 'best-parts-playlist',
        name: text(j.name, 120) ?? 'Shared best parts',
        parts,
        version: 1,
    };
};

// A file name for the playlist (no characters macOS or Windows refuse).
export const shareFileName = (name: string) =>
    `${
        name
            .replace(/[\\/:*?"<>|\n\r\t]/g, '-')
            .slice(0, 80)
            .trim() || 'Best parts'
    }.${SHARE_EXT}`;
