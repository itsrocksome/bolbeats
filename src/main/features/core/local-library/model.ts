// BolBeats: the on-device music library's data model (it replaced the bundled Navidrome server). The app's library
// code still speaks Navidrome's API, so songs, albums, artists and playlists are shaped exactly like Navidrome's JSON.
// Pure: no Electron, no file system, relative imports only, so `node --test` loads it.
import { createHash, randomBytes } from 'node:crypto';

export type Annotation = {
    playCount?: number;
    playDate?: string;
    ratedAt?: string;
    rating?: number;
    starred?: boolean;
    starredAt?: string;
};

export type LibraryState = {
    // when each album first appeared ("recently added"), kept so copying or touching files never reshuffles it
    albumCreated?: Record<string, string>;
    ann: Record<string, Annotation>; // by song, album or artist id
    // ids by album key / artist name / folder / file path, kept forever so a song that comes back keeps its id
    ids: {
        album: Record<string, string>;
        artist: Record<string, string>;
        folder: Record<string, string>;
        song: Record<string, string>;
    };
    images: Record<string, string>; // uploaded artist covers: artist id -> file name
    lastScan: string;
    legacyAlbum?: Record<string, string>; // song id -> Navidrome album id, until each album has its id
    playlists: Record<string, PlaylistRecord>;
    queue: { current: number; ids: string[]; position: number; updatedAt: string };
    // internet radio stations you add yourself (Settings); BolBeats never adds any
    radios?: Record<
        string,
        {
            createdAt: string;
            homePageUrl: string;
            id: string;
            name: string;
            streamUrl: string;
            updatedAt: string;
        }
    >;
    secret: string; // signs this Mac's login tokens
    tracks: Record<string, Track>; // by song id
    userId: string;
    version: 1;
};

export type PlaylistRecord = {
    comment: string;
    createdAt: string;
    id: string;
    image?: string; // file name of an uploaded cover
    name: string;
    public: boolean;
    rules: null | Record<string, unknown>;
    sync: boolean;
    tracks: string[]; // song ids, in order
    updatedAt: string;
};

export type Track = {
    album: string;
    albumArtists: string[]; // as tagged; empty = same as artists
    artists: string[];
    birth: number; // ms
    bitDepth: number;
    bitRate: number;
    bpm: number;
    channels: number;
    codec: string;
    comment: string;
    compilation: boolean;
    createdAt: string; // first seen by the library (ISO)
    date: string;
    disc: number;
    discSubtitle: string;
    duration: number; // seconds
    explicit: string; // 'e' | 'c' | ''
    genres: string[];
    hasCover: boolean;
    id: string;
    lyrics: string;
    mbz: Record<string, string>; // musicbrainz_* tags, lowercase names
    mtime: number; // ms
    originalDate: string;
    people: Record<string, string[]>; // composer, lyricist, conductor, remixer, producer
    rel: string; // path inside the music folder, "/" separators
    releaseDate: string;
    rg: { albumGain?: number; albumPeak?: number; trackGain?: number; trackPeak?: number };
    sampleRate: number;
    size: number;
    sort: { album?: string; albumArtist?: string; artist?: string; title?: string };
    suffix: string;
    tags: Record<string, string[]>; // genre, mood, grouping, ... (filters and the tag list)
    title: string;
    track: number;
};

export const emptyState = (): LibraryState => ({
    ann: {},
    ids: { album: {}, artist: {}, folder: {}, song: {} },
    images: {},
    lastScan: '',
    playlists: {},
    queue: { current: 0, ids: [], position: 0, updatedAt: '' },
    secret: randomBytes(24).toString('hex'),
    tracks: {},
    userId: newId(),
    version: 1,
});

// 22 base62 characters, like Navidrome's ids (saved best parts, playlists and play counts keep using them).
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const newId = () => [...randomBytes(22)].map((b) => B62[b % 62]).join('');
export const hash = (s: string) => createHash('md5').update(s).digest('hex').slice(0, 16);

// ---- tags -> track -------------------------------------------------------------------------------------------

// Same artist splitting the library always used: "Karan Aujla/Ikky" is two artists; AC/DC stays one.
const SPLIT = / \/ |\/| feat\. | feat | ft\. | ft |; /i;
const SPLIT_EXCEPTIONS = ['AC/DC'];
export const splitArtists = (values: string[] = []) => {
    const out: string[] = [];
    for (const v of values) {
        let rest = v;
        const keep: string[] = [];
        for (const ex of SPLIT_EXCEPTIONS) {
            if (rest.includes(ex)) {
                keep.push(ex);
                rest = rest.split(ex).join('\uE000');
            }
        }
        for (const part of rest.split(SPLIT)) {
            const name = part.replace(/\uE000/g, () => keep.shift() ?? '').trim();
            if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
        }
    }
    return out;
};

const num = (v?: string) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const float = (v?: string) => {
    const n = parseFloat((v ?? '').replace(/[^0-9.+-eE]/g, ''));
    return Number.isFinite(n) ? n : undefined;
};
const one = (t: Record<string, string[]>, k: string) => t[k]?.find((v) => v.trim())?.trim() ?? '';

const TAG_FIELDS = [
    'genre',
    'mood',
    'grouping',
    'releasetype',
    'recordlabel',
    'media',
    'language',
    'subtitle',
    'albumversion',
];
const PEOPLE = [
    'composer',
    'lyricist',
    'conductor',
    'remixer',
    'producer',
    'arranger',
    'engineer',
    'mixer',
    'djmixer',
];

export type AudioInfo = {
    bitDepth?: number;
    bitrate?: number;
    channels?: number;
    codec?: string;
    duration?: number;
    durationMs?: number;
    sampleRate?: number;
};

// `t`: every tag with lowercase names (TagLib's wire names, e.g. "albumartist", "musicbrainz_trackid").
export const trackFromTags = (
    file: { birth: number; mtime: number; rel: string; size: number },
    t: Record<string, string[]>,
    audio: AudioInfo,
    hasCover: boolean,
): Omit<Track, 'createdAt' | 'id'> => {
    const base = file.rel.split('/').pop() ?? file.rel;
    const suffix = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
    const artists = splitArtists(t.artists?.length ? t.artists : t.artist);
    const [track] = one(t, 'tracknumber').split('/');
    const [disc, discTotal] = one(t, 'discnumber').split('/');
    const tags: Record<string, string[]> = {};
    for (const k of TAG_FIELDS) {
        const v = (k === 'recordlabel' ? [...(t.label ?? []), ...(t.publisher ?? [])] : t[k]) ?? [];
        const vals = (k === 'genre' ? v.flatMap((g) => g.split(/[;/]/)) : v)
            .map((s) => s.trim())
            .filter(Boolean);
        if (vals.length) tags[k] = [...new Set(vals)];
    }
    if (discTotal) tags.disctotal = [discTotal];
    const people: Record<string, string[]> = {};
    for (const k of PEOPLE) {
        const v = splitArtists(t[k === 'remixer' ? 'remixer' : k]);
        if (v.length) people[k] = v;
    }
    const mbz: Record<string, string> = {};
    for (const [k, v] of Object.entries(t)) if (k.startsWith('musicbrainz_') && v[0]) mbz[k] = v[0];
    const advisory = one(t, 'itunesadvisory');
    const compilation = ['1', 'true', 'yes'].includes(one(t, 'compilation').toLowerCase());
    return {
        album: one(t, 'album') || '[Unknown Album]',
        albumArtists: splitArtists(t.albumartists?.length ? t.albumartists : t.albumartist),
        artists: artists.length ? artists : ['[Unknown Artist]'],
        birth: file.birth,
        bitDepth: audio.bitDepth ?? 0,
        bitRate: audio.bitrate ?? 0,
        bpm: num(one(t, 'bpm')),
        channels: audio.channels ?? 0,
        codec: audio.codec ?? '',
        comment: one(t, 'comment'),
        compilation,
        date: one(t, 'date') || one(t, 'year'),
        disc: num(disc),
        discSubtitle: one(t, 'discsubtitle'),
        duration:
            Math.round((audio.durationMs ? audio.durationMs / 1000 : (audio.duration ?? 0)) * 100) /
            100,
        explicit: advisory === '1' || advisory === '4' ? 'e' : advisory === '2' ? 'c' : '',
        genres: tags.genre ?? [],
        hasCover,
        lyrics: one(t, 'lyrics'),
        mbz,
        mtime: file.mtime,
        originalDate: one(t, 'originaldate') || one(t, 'originalyear'),
        people,
        rel: file.rel,
        releaseDate: one(t, 'releasedate'),
        rg: {
            albumGain: float(one(t, 'replaygain_album_gain')),
            albumPeak: float(one(t, 'replaygain_album_peak')),
            trackGain: float(one(t, 'replaygain_track_gain')),
            trackPeak: float(one(t, 'replaygain_track_peak')),
        },
        sampleRate: audio.sampleRate ?? 0,
        size: file.size,
        sort: {
            album: one(t, 'albumsort') || undefined,
            albumArtist: one(t, 'albumartistsort') || undefined,
            artist: one(t, 'artistsort') || undefined,
            title: one(t, 'titlesort') || undefined,
        },
        suffix,
        tags,
        title: one(t, 'title') || base.replace(/\.[^.]+$/, ''),
        track: num(track),
    };
};

// ---- .ndignore ----------------------------------------------------------------------------------------------

// The music folder's .ndignore files (BolBeats hides second copies of a song through them; you can add lines too).
// A line starting with "/" is a path from that .ndignore's folder; other lines match a name anywhere below it.
// "*" is a wildcard; BolBeats escapes other special characters with "\".
export const ignoreMatcher = (files: { dir: string; text: string }[]) => {
    const rules = files.flatMap(({ dir, text }) => {
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        // An .ndignore with no patterns hides the whole folder (Navidrome did the same).
        if (!lines.length) return [{ dir, re: /.*/ }];
        return lines.map((line) => {
            const anchored = line.startsWith('/');
            const body = (anchored ? line.slice(1) : line).replace(/\/$/, '');
            let src = '';
            for (let i = 0; i < body.length; i++) {
                const c = body[i];
                if (c === '\\' && i + 1 < body.length)
                    src += body[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
                else if (c === '*') src += '[^/]*';
                else if (c === '?') src += '[^/]';
                else src += c.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
            }
            return { dir, re: new RegExp(anchored ? `^${src}(/|$)` : `(^|/)${src}(/|$)`, 'i') };
        });
    });
    return (rel: string) =>
        rules.some(({ dir, re }) => {
            if (dir && !rel.startsWith(`${dir}/`)) return false;
            return re.test(dir ? rel.slice(dir.length + 1) : rel);
        });
};

// ---- the library built from tracks ---------------------------------------------------------------------------

const ARTICLES = /^(the|el|la|los|las|le|les|os|as|o|a)\s+/i;
export const orderName = (s: string, noArticle = true) => {
    const plain = s
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
        .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
        .toLowerCase()
        .trim();
    return noArticle ? plain.replace(ARTICLES, '') : plain;
};

export type Album = {
    albumArtists: string[];
    artistIds: string[];
    createdAt: string;
    id: string;
    key: string;
    name: string;
    songs: Track[];
    updatedAt: string;
};
export type Artist = {
    createdAt: string;
    id: string;
    name: string;
    // role -> stats
    stats: Record<
        string,
        { albumCount: number; albums: Set<string>; size: number; songCount: number }
    >;
    updatedAt: string;
};

export type Library = {
    albumOf: Map<string, Album>; // by song id
    albums: Map<string, Album>;
    artistByName: Map<string, Artist>;
    artists: Map<string, Artist>;
    folder: string;
    genres: Map<string, { albums: Set<string>; id: string; name: string; songs: number }>;
    songs: Track[];
    tagValues: Map<
        string,
        { albums: Set<string>; id: string; name: string; songs: number; value: string }
    >;
};

const iso = (ms: number) => new Date(ms).toISOString();
const displayAlbumArtists = (t: Track) => (t.albumArtists.length ? t.albumArtists : t.artists);
export const albumKey = (t: Track) =>
    `${t.compilation && !t.albumArtists.length ? 'various artists' : displayAlbumArtists(t)[0].toLowerCase()}\uE000${t.album.toLowerCase()}`;

export const buildLibrary = (state: LibraryState, folder: string): Library => {
    const ids = (kind: 'album' | 'artist', key: string) => (state.ids[kind][key] ??= newId());
    // mtime -1: moved over from Navidrome and not read yet (only its id and date are known)
    const songs = Object.values(state.tracks)
        .filter((t) => t.mtime !== -1)
        .sort((a, b) => a.rel.localeCompare(b.rel));
    const usedAlbumIds = new Set(Object.values(state.ids.album));
    const albums = new Map<string, Album>();
    const albumOf = new Map<string, Album>();
    const artists = new Map<string, Artist>();
    const artistByName = new Map<string, Artist>();
    const genres: Library['genres'] = new Map();
    const tagValues: Library['tagValues'] = new Map();
    const artist = (name: string, at: string) => {
        const key = name.toLowerCase();
        let a = artistByName.get(key);
        if (!a) {
            a = { createdAt: at, id: ids('artist', key), name, stats: {}, updatedAt: at };
            artistByName.set(key, a);
            artists.set(a.id, a);
        }
        if (at < a.createdAt) a.createdAt = at;
        if (at > a.updatedAt) a.updatedAt = at;
        return a;
    };
    const credit = (a: Artist, role: string, t: Track, albumId: string) => {
        const s = (a.stats[role] ??= { albumCount: 0, albums: new Set(), size: 0, songCount: 0 });
        s.songCount++;
        s.size += t.size;
        s.albums.add(albumId);
        s.albumCount = s.albums.size;
    };
    // Album ids first: one that came from Navidrome goes to the album holding most of its songs.
    const groups = new Map<string, Track[]>();
    for (const t of songs) groups.set(albumKey(t), [...(groups.get(albumKey(t)) ?? []), t]);
    const legacyVotes = [...groups].map(([key, list]) => {
        const votes = new Map<string, number>();
        for (const t of list) {
            const l = state.legacyAlbum?.[t.id];
            if (l) votes.set(l, (votes.get(l) ?? 0) + 1);
        }
        const [best, n] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
        return { best, key, n };
    });
    for (const { best, key } of legacyVotes.sort((a, b) => b.n - a.n)) {
        if (state.ids.album[key]) continue;
        state.ids.album[key] = best && !usedAlbumIds.has(best) ? best : newId();
        usedAlbumIds.add(state.ids.album[key]);
    }
    const songAlbumArtists = (t: Track) =>
        t.compilation && !t.albumArtists.length ? ['Various Artists'] : displayAlbumArtists(t);
    for (const t of songs) {
        const key = albumKey(t);
        let al = albums.get(key);
        if (!al) {
            al = {
                albumArtists: [],
                artistIds: [],
                createdAt: iso(t.birth),
                id: ids('album', key),
                key,
                name: t.album,
                songs: [],
                updatedAt: iso(t.mtime),
            };
            albums.set(key, al);
        }
        const mine = songAlbumArtists(t);
        for (const n of mine)
            if (!al.albumArtists.some((x) => x.toLowerCase() === n.toLowerCase()))
                al.albumArtists.push(n);
        al.songs.push(t);
        if (iso(t.birth) < al.createdAt) al.createdAt = iso(t.birth);
        if (iso(t.mtime) > al.updatedAt) al.updatedAt = iso(t.mtime);
        albumOf.set(t.id, al);
        const seen = iso(t.mtime);
        for (const n of mine) credit(artist(n, t.createdAt), 'albumartist', t, al.id);
        for (const n of t.artists) credit(artist(n, t.createdAt), 'artist', t, al.id);
        for (const n of new Set([...mine, ...t.artists]))
            credit(artist(n, t.createdAt), 'maincredit', t, al.id);
        for (const [role, names] of Object.entries(t.people))
            for (const n of names) credit(artist(n, seen), role, t, al.id);
        for (const g of t.genres) {
            const gk = g.toLowerCase();
            const e = genres.get(gk) ?? {
                albums: new Set<string>(),
                id: hash(`genre:${gk}`).slice(0, 16),
                name: g,
                songs: 0,
            };
            e.songs++;
            e.albums.add(al.id);
            genres.set(gk, e);
        }
        for (const [name, vals] of Object.entries(t.tags)) {
            for (const v of vals) {
                const tk = `${name}\uE000${v.toLowerCase()}`;
                const e = tagValues.get(tk) ?? {
                    albums: new Set<string>(),
                    id: hash(`tag:${tk}`),
                    name,
                    songs: 0,
                    value: v,
                };
                e.songs++;
                e.albums.add(al.id);
                tagValues.set(tk, e);
            }
        }
    }
    state.albumCreated ??= {};
    for (const al of albums.values()) {
        al.createdAt = state.albumCreated[al.id] ??= al.createdAt;
        al.songs.sort((a, b) => a.disc - b.disc || a.track - b.track || a.rel.localeCompare(b.rel));
        al.artistIds = al.albumArtists.map((n) => artistByName.get(n.toLowerCase())!.id);
    }
    return {
        albumOf,
        albums: new Map([...albums.values()].map((a) => [a.id, a])),
        artistByName,
        artists,
        folder,
        genres,
        songs,
        tagValues,
    };
};

// ---- Navidrome JSON --------------------------------------------------------------------------------------------

const year = (d: string) => num(d.slice(0, 4));
const annOf = (state: LibraryState, id: string) => {
    const a = state.ann[id] ?? {};
    return {
        playCount: a.playCount ?? 0,
        playDate: a.playDate,
        ratedAt: a.ratedAt,
        rating: a.rating ?? 0,
        starred: Boolean(a.starred),
        starredAt: a.starred ? a.starredAt : undefined,
    };
};
const ref = (lib: Library, name: string) => ({
    id: lib.artistByName.get(name.toLowerCase())?.id ?? '',
    missing: false,
    name,
});
const join = (names: string[]) => names.join(' • ');

export const coverId = (kind: 'al' | 'ar' | 'mf' | 'pl', id: string, stamp: number | string) =>
    `${kind}-${id}_${hash(`${id}:${stamp}`)}`;
export const folderId = (state: LibraryState, rel: string) => {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    return (state.ids.folder[dir] ??= newId());
};

const participants = (lib: Library, t: Track) => {
    const p: Record<string, ReturnType<typeof ref>[]> = {
        albumartist: (t.albumArtists.length
            ? t.albumArtists
            : t.compilation
              ? ['Various Artists']
              : t.artists
        ).map((n) => ref(lib, n)),
        artist: t.artists.map((n) => ref(lib, n)),
    };
    for (const [role, names] of Object.entries(t.people)) p[role] = names.map((n) => ref(lib, n));
    return p;
};

export const ndSong = (lib: Library, state: LibraryState, t: Track) => {
    const al = lib.albumOf.get(t.id)!;
    const p = participants(lib, t);
    const genres = t.genres.map((g) => ({
        id: lib.genres.get(g.toLowerCase())?.id ?? '',
        name: g,
    }));
    const a = annOf(state, t.id);
    return {
        album: t.album,
        albumArtist: t.albumArtists.length ? join(t.albumArtists) : al.albumArtists[0],
        albumArtistId: al.artistIds[0],
        albumId: al.id,
        artist: join(t.artists),
        artistId: p.artist[0]?.id ?? '',
        birthTime: iso(t.birth),
        bitDepth: t.bitDepth || undefined,
        bitRate: t.bitRate,
        bookmarkPosition: 0,
        bpm: t.bpm || undefined,
        channels: t.channels,
        codec: t.codec,
        comment: t.comment || undefined,
        compilation: t.compilation,
        createdAt: t.createdAt,
        date: t.date || undefined,
        discNumber: t.disc,
        discSubtitle: t.discSubtitle || undefined,
        duration: t.duration,
        explicitStatus: t.explicit,
        folderId: folderId(state, t.rel),
        genre: t.genres[0] ?? '',
        genres: genres.length ? genres : undefined,
        hasCoverArt: t.hasCover,
        id: t.id,
        imageHash: hash(`${t.id}:${t.mtime}`),
        libraryId: 1,
        libraryName: 'Music Library',
        libraryPath: lib.folder,
        lyrics: t.lyrics
            ? JSON.stringify([
                  {
                      lang: 'xxx',
                      line: t.lyrics.split(/\r?\n/).map((value) => ({ value })),
                      synced: false,
                  },
              ])
            : '[]',
        mbzAlbumArtistId: t.mbz.musicbrainz_albumartistid,
        mbzAlbumId: t.mbz.musicbrainz_albumid,
        mbzAlbumType: t.tags.releasetype?.[0],
        mbzArtistId: t.mbz.musicbrainz_artistid,
        mbzRecordingID: t.mbz.musicbrainz_trackid,
        mbzReleaseGroupId: t.mbz.musicbrainz_releasegroupid,
        mbzReleaseTrackId: t.mbz.musicbrainz_releasetrackid,
        missing: false,
        orderAlbumArtistName: orderName(t.sort.albumArtist ?? al.albumArtists[0]),
        orderAlbumName: orderName(t.sort.album ?? t.album),
        orderArtistName: orderName(t.sort.artist ?? t.artists[0]),
        orderTitle: orderName(t.sort.title ?? t.title, false),
        originalDate: t.originalDate || undefined,
        originalYear: year(t.originalDate),
        participants: p,
        path: t.rel,
        playCount: a.playCount,
        playDate: a.playDate,
        rating: a.rating,
        releaseDate: t.releaseDate || undefined,
        releaseYear: year(t.releaseDate),
        rgAlbumGain: t.rg.albumGain ?? null,
        rgAlbumPeak: t.rg.albumPeak ?? null,
        rgTrackGain: t.rg.trackGain ?? null,
        rgTrackPeak: t.rg.trackPeak ?? null,
        sampleRate: t.sampleRate,
        size: t.size,
        sortAlbumArtistName: t.sort.albumArtist,
        sortAlbumName: t.sort.album,
        sortArtistName: t.sort.artist,
        sortTitle: t.sort.title,
        starred: a.starred,
        starredAt: a.starredAt,
        suffix: t.suffix,
        tags: Object.keys(t.tags).length ? t.tags : undefined,
        title: t.title,
        trackNumber: t.track,
        updatedAt: iso(t.mtime),
        year: year(t.date),
    };
};

export const ndAlbum = (lib: Library, state: LibraryState, al: Album) => {
    const s = al.songs;
    const first = s[0];
    const years = s.map((t) => year(t.date)).filter(Boolean);
    const oYears = s.map((t) => year(t.originalDate)).filter(Boolean);
    const genreNames = [...new Set(s.flatMap((t) => t.genres))];
    const tags: Record<string, string[]> = {};
    for (const t of s)
        for (const [k, v] of Object.entries(t.tags))
            tags[k] = [...new Set([...(tags[k] ?? []), ...v])];
    const discs: Record<string, string> = {};
    for (const t of s) discs[String(t.disc || 1)] ||= t.discSubtitle;
    const artistNames = [...new Set(s.flatMap((t) => t.artists))];
    const people: Record<string, ReturnType<typeof ref>[]> = {
        albumartist: al.albumArtists.map((n) => ref(lib, n)),
        artist: artistNames.map((n) => ref(lib, n)),
    };
    const a = annOf(state, al.id);
    return {
        albumArtist: first.albumArtists.length ? join(first.albumArtists) : al.albumArtists[0],
        albumArtistId: al.artistIds[0],
        allArtistIds: [...new Set([...al.artistIds, ...people.artist.map((p) => p.id)])].join(' '),
        comment: first.comment || undefined,
        compilation: s.some((t) => t.compilation),
        createdAt: al.createdAt,
        date: first.date || undefined,
        discs,
        duration: Math.round(s.reduce((n, t) => n + t.duration, 0) * 100) / 100,
        explicitStatus: s.some((t) => t.explicit === 'e')
            ? 'e'
            : s.some((t) => t.explicit === 'c')
              ? 'c'
              : '',
        externalInfoUpdatedAt: null,
        genre: genreNames[0] ?? '',
        genres: genreNames.length
            ? genreNames.map((g) => ({ id: lib.genres.get(g.toLowerCase())!.id, name: g }))
            : null,
        id: al.id,
        imageHash: hash(`${al.id}:${first.id}:${first.mtime}`),
        importedAt: s.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), s[0].createdAt),
        libraryId: 1,
        libraryName: 'Music Library',
        libraryPath: lib.folder,
        maxOriginalYear: oYears.length ? Math.max(...oYears) : 0,
        maxYear: years.length ? Math.max(...years) : 0,
        mbzAlbumArtistId: first.mbz.musicbrainz_albumartistid,
        mbzAlbumId: first.mbz.musicbrainz_albumid,
        mbzAlbumType: first.tags.releasetype?.[0],
        mbzReleaseGroupId: first.mbz.musicbrainz_releasegroupid,
        minOriginalYear: oYears.length ? Math.min(...oYears) : 0,
        minYear: years.length ? Math.min(...years) : 0,
        missing: false,
        name: al.name,
        orderAlbumArtistName: orderName(first.sort.albumArtist ?? al.albumArtists[0]),
        orderAlbumName: orderName(first.sort.album ?? al.name),
        originalDate: first.originalDate || undefined,
        participants: people,
        playCount: a.playCount,
        playDate: a.playDate,
        ratedAt: a.ratedAt,
        rating: a.rating,
        releaseDate: first.releaseDate || undefined,
        rgAlbumGain: first.rg.albumGain ?? null,
        rgAlbumPeak: first.rg.albumPeak ?? null,
        size: s.reduce((n, t) => n + t.size, 0),
        songCount: s.length,
        sortAlbumArtistName: first.sort.albumArtist,
        sortAlbumName: first.sort.album,
        starred: a.starred,
        starredAt: a.starredAt,
        tags: Object.keys(tags).length ? tags : undefined,
        updatedAt: al.updatedAt,
    };
};

export const ndArtist = (state: LibraryState, ar: Artist) => {
    const stats: Record<string, { albumCount: number; size: number; songCount: number }> = {};
    for (const [role, s] of Object.entries(ar.stats))
        stats[role] = { albumCount: s.albumCount, size: s.size, songCount: s.songCount };
    const main = stats.maincredit ??
        Object.values(stats)[0] ?? { albumCount: 0, size: 0, songCount: 0 };
    const a = annOf(state, ar.id);
    const uploaded = state.images[ar.id];
    return {
        albumCount: main.albumCount,
        createdAt: ar.createdAt,
        id: ar.id,
        imageAbsent: false,
        missing: false,
        name: ar.name,
        orderArtistName: orderName(ar.name),
        playCount: a.playCount,
        playDate: a.playDate,
        ratedAt: a.ratedAt,
        rating: a.rating,
        size: main.size,
        songCount: main.songCount,
        starred: a.starred,
        starredAt: a.starredAt,
        stats,
        updatedAt: ar.updatedAt,
        uploadedImage: uploaded ?? '',
    };
};

export const ndPlaylist = (_lib: Library, state: LibraryState, p: PlaylistRecord) => {
    const songs = p.tracks.map((id) => state.tracks[id]).filter(Boolean);
    return {
        comment: p.comment,
        createdAt: p.createdAt,
        duration: Math.round(songs.reduce((n, t) => n + t.duration, 0) * 100) / 100,
        evaluatedAt: null,
        id: p.id,
        imageHash: hash(`${p.id}:${p.updatedAt}`),
        name: p.name,
        ownerId: state.userId,
        ownerName: 'admin',
        path: '',
        public: p.public,
        rules: p.rules,
        size: songs.reduce((n, t) => n + t.size, 0),
        songCount: songs.length,
        sync: p.sync,
        updatedAt: p.updatedAt,
        uploadedImage: p.image ?? '',
    };
};

// ---- Subsonic JSON ---------------------------------------------------------------------------------------------

const MIME: Record<string, string> = {
    aac: 'audio/aac',
    aif: 'audio/aiff',
    aiff: 'audio/aiff',
    alac: 'audio/mp4',
    ape: 'audio/x-ape',
    dsf: 'audio/dsf',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    m4b: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    mpc: 'audio/x-musepack',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    wma: 'audio/x-ms-wma',
    wv: 'audio/x-wavpack',
};
export const mimeOf = (suffix: string) => MIME[suffix] ?? 'application/octet-stream';

export const ssSong = (lib: Library, state: LibraryState, t: Track) => {
    const al = lib.albumOf.get(t.id)!;
    const a = annOf(state, t.id);
    const artists = t.artists.map((n) => ({ id: ref(lib, n).id, name: n }));
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');
    return {
        album: t.album,
        albumArtists: al.albumArtists.map((n) => ({ id: ref(lib, n).id, name: n })),
        albumId: al.id,
        artist: join(t.artists),
        artistId: artists[0]?.id,
        artists,
        averageRating: 0,
        bitDepth: t.bitDepth,
        bitRate: t.bitRate,
        bpm: t.bpm,
        channelCount: t.channels,
        comment: t.comment,
        contentType: mimeOf(t.suffix),
        contributors: [],
        coverArt: coverId('mf', t.id, t.mtime),
        created: t.createdAt,
        discNumber: t.disc || undefined,
        displayAlbumArtist: t.albumArtists.length ? join(t.albumArtists) : al.albumArtists[0],
        displayArtist: join(t.artists),
        displayComposer: join(t.people.composer ?? []),
        duration: Math.floor(t.duration),
        explicitStatus: t.explicit === 'e' ? 'explicit' : t.explicit === 'c' ? 'clean' : '',
        genre: t.genres[0],
        genres: t.genres.map((name) => ({ name })),
        groupings: t.tags.grouping ?? [],
        id: t.id,
        isDir: false,
        isrc: [],
        mediaType: 'song',
        moods: t.tags.mood ?? [],
        movements: [],
        musicBrainzId: t.mbz.musicbrainz_trackid ?? '',
        parent: al.id,
        path: `${safe(al.albumArtists[0])}/${safe(t.album)}/${t.track ? `${String(t.track).padStart(2, '0')} - ` : ''}${safe(t.title)}.${t.suffix}`,
        playCount: a.playCount || undefined,
        played: a.playDate,
        replayGain: {
            albumGain: t.rg.albumGain,
            albumPeak: t.rg.albumPeak,
            trackGain: t.rg.trackGain,
            trackPeak: t.rg.trackPeak,
        },
        samplingRate: t.sampleRate,
        size: t.size,
        sortName: orderName(t.sort.title ?? t.title, false),
        starred: a.starredAt,
        suffix: t.suffix,
        title: t.title,
        track: t.track || undefined,
        type: 'music',
        userRating: a.rating || undefined,
        works: [],
        year: year(t.date) || undefined,
    };
};

export const ssAlbum = (lib: Library, state: LibraryState, al: Album, withSongs = false) => {
    const nd = ndAlbum(lib, state, al);
    const a = annOf(state, al.id);
    return {
        artist: al.albumArtists[0],
        artistId: al.artistIds[0],
        artists: al.albumArtists.map((n) => ({ id: ref(lib, n).id, name: n })),
        coverArt: coverId('al', al.id, al.songs[0].mtime),
        created: al.createdAt,
        discTitles: Object.entries(nd.discs)
            .filter(([, title]) => title)
            .map(([disc, title]) => ({ disc: Number(disc), title })),
        displayArtist: join(al.albumArtists),
        duration: Math.floor(nd.duration),
        explicitStatus:
            nd.explicitStatus === 'e' ? 'explicit' : nd.explicitStatus === 'c' ? 'clean' : '',
        genre: nd.genre || undefined,
        genres: (nd.genres ?? []).map((g) => ({ name: g.name })),
        id: al.id,
        isCompilation: nd.compilation,
        isDir: true,
        moods: nd.tags?.mood ?? [],
        musicBrainzId: nd.mbzAlbumId ?? '',
        name: al.name,
        originalReleaseDate: {},
        parent: al.artistIds[0],
        playCount: a.playCount || undefined,
        played: a.playDate,
        recordLabels: (nd.tags?.recordlabel ?? []).map((name) => ({ name })),
        releaseDate: {},
        releaseTypes: nd.tags?.releasetype ?? [],
        song: withSongs ? al.songs.map((t) => ssSong(lib, state, t)) : undefined,
        songCount: al.songs.length,
        sortName: nd.orderAlbumName,
        starred: a.starredAt,
        title: al.name,
        userRating: a.rating || 0,
        version: nd.tags?.albumversion?.join(' · ') ?? '',
        year: nd.maxYear || undefined,
    };
};

export const ssArtist = (_lib: Library, state: LibraryState, ar: Artist) => {
    const a = annOf(state, ar.id);
    return {
        albumCount: ar.stats.albumartist?.albumCount ?? 0,
        coverArt: coverId('ar', ar.id, ar.updatedAt),
        id: ar.id,
        musicBrainzId: '',
        name: ar.name,
        roles: Object.keys(ar.stats),
        sortName: orderName(ar.name),
        starred: a.starredAt,
        userRating: a.rating || undefined,
    };
};

// ---- list queries (Navidrome's _sort / _order / _start / _end and filters) -------------------------------------

export type Query = Record<string, string | string[] | undefined>;
export const all = (q: Query, k: string) => {
    const v = q[k];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
export const first = (q: Query, k: string) => all(q, k)[0];
const bool = (q: Query, k: string) => {
    const v = first(q, k);
    return v === undefined ? undefined : v === 'true';
};

// Plain character order, like Navidrome's database ("52 bars" before "9:45").
const cmp = (a: unknown, b: unknown) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' || typeof b === 'boolean')
        return Number(Boolean(a)) - Number(Boolean(b));
    const x = String(a ?? '');
    const y = String(b ?? '');
    return x < y ? -1 : x > y ? 1 : 0;
};

// Sorts with ties broken by the next keys, then pages. Returns the page and the total.
export const page = <T>(
    items: T[],
    q: Query,
    keys: Record<string, (x: T) => unknown[]>,
    fallback: string,
) => {
    const sort = first(q, '_sort') ?? fallback;
    const desc = first(q, '_order')?.toUpperCase() === 'DESC';
    let list = items;
    if (sort === 'random') {
        list = [...items];
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
    } else {
        const key = keys[sort] ?? keys[fallback];
        const decorated = items.map((x) => ({ k: key(x), x }));
        decorated.sort((a, b) => {
            for (let i = 0; i < a.k.length; i++) {
                const c = cmp(a.k[i], b.k[i]);
                if (c) return desc ? -c : c; // Navidrome turns every sort key around, not just the first
            }
            return 0;
        });
        list = decorated.map((d) => d.x);
    }
    const start = Math.max(0, Number(first(q, '_start') ?? 0) || 0);
    const end = Number(first(q, '_end') ?? 0) || 0;
    return { items: end > 0 ? list.slice(start, end) : list.slice(start), total: items.length };
};

// Navidrome's search: every word you type starts a word in the text ("the" finds "Theme", not "other").
const words = (s: string) =>
    orderName(s, false)
        .split(/[^\p{L}\p{N}']+/u)
        .filter(Boolean);
export const contains = (hay: string, needle?: string) => {
    const want = needle ? words(needle) : [];
    if (!want.length) return true;
    const have = words(hay);
    return want.every((w) => have.some((h) => h.startsWith(w)));
};

// Song filters the app sends (album, artist, genre, favourites, rating, year, title search, path, any tag).
export const filterSongs = (lib: Library, state: LibraryState, q: Query) => {
    const albumIds = new Set(all(q, 'album_id'));
    const artistIds = new Set([
        ...all(q, 'album_artist_id'),
        ...all(q, 'artist_id'),
        ...all(q, 'artists_id'),
    ]);
    const genreIds = new Set(all(q, 'genre_id'));
    const starred = bool(q, 'starred');
    const hasRating = bool(q, 'has_rating');
    const y = Number(first(q, 'year')) || 0;
    const title = first(q, 'title');
    const path = first(q, 'path');
    const ids = new Set(all(q, 'id'));
    const tagFilters = [...lib.tagValues.values()].length
        ? Object.keys(q).filter((k) => !k.startsWith('_') && !SONG_FILTER_KEYS.has(k))
        : [];
    return lib.songs.filter((t) => {
        const al = lib.albumOf.get(t.id)!;
        if (ids.size && !ids.has(t.id)) return false;
        if (albumIds.size && !albumIds.has(al.id)) return false;
        if (artistIds.size) {
            const mine = [
                ...t.artists,
                ...displayAlbumArtists(t),
                ...Object.values(t.people).flat(),
            ].map((n) => lib.artistByName.get(n.toLowerCase())?.id);
            if (!mine.some((id) => id && artistIds.has(id))) return false;
        }
        if (
            genreIds.size &&
            !t.genres.some((g) => genreIds.has(lib.genres.get(g.toLowerCase())?.id ?? ''))
        )
            return false;
        const a = state.ann[t.id];
        if (starred !== undefined && Boolean(a?.starred) !== starred) return false;
        if (hasRating !== undefined && Boolean(a?.rating) !== hasRating) return false;
        if (y && year(t.date) !== y) return false;
        if (
            title &&
            !(
                contains(t.title, title) ||
                contains(t.artists.join(' '), title) ||
                contains(t.album, title)
            )
        )
            return false;
        if (path && !t.rel.startsWith(path)) return false;
        for (const k of tagFilters) {
            const want = all(q, k);
            const have = (t.tags[k] ?? []).map(
                (v) => lib.tagValues.get(`${k}\uE000${v.toLowerCase()}`)?.id,
            );
            if (want.length && !want.some((w) => have.includes(w))) return false;
        }
        return true;
    });
};
const SONG_FILTER_KEYS = new Set([
    'album_artist_id',
    'album_id',
    'artist_id',
    'artists_id',
    'compilation',
    'genre_id',
    'has_rating',
    'id',
    'library_id',
    'missing',
    'name',
    'owner_id',
    'path',
    'q',
    'recently_added',
    'recently_played',
    'role',
    'smart',
    'starred',
    'tag_name',
    'tag_value',
    'title',
    'year',
]);

export const songSorts = (
    lib: Library,
    state: LibraryState,
): Record<string, (t: Track) => unknown[]> => {
    const al = (t: Track) => lib.albumOf.get(t.id)!;
    const a = (t: Track) => state.ann[t.id] ?? {};
    const ord = {
        album: (t: Track) => orderName(t.sort.album ?? t.album),
        albumArtist: (t: Track) =>
            orderName(t.sort.albumArtist ?? (t.albumArtists[0] || al(t).albumArtists[0])),
        artist: (t: Track) => orderName(t.sort.artist ?? t.artists[0]),
        title: (t: Track) => orderName(t.sort.title ?? t.title, false),
    };
    // Navidrome's sort keys; ties then follow the album order so lists never jump around.
    const albumOrder = (t: Track) => [
        ord.album(t),
        al(t).id,
        t.disc,
        t.track,
        ord.artist(t),
        t.title,
        t.rel,
    ];
    const tie = (t: Track) => [ord.album(t), t.disc, t.track, t.rel];
    return {
        album: albumOrder,
        artist: (t) => [ord.artist(t), ord.album(t), t.releaseDate, t.disc, t.track, t.rel],
        bpm: (t) => [t.bpm, ...tie(t)],
        channels: (t) => [t.channels, ...tie(t)],
        comment: (t) => [t.comment, ...tie(t)],
        createdAt: (t) => [t.createdAt, ...tie(t)],
        duration: (t) => [t.duration, ...tie(t)],
        explicitStatus: (t) => [t.explicit, ...tie(t)],
        genre: (t) => [t.genres[0] ?? '', ...tie(t)],
        id: (t) => [t.id],
        order_album_artist_name: (t) => [
            ord.albumArtist(t),
            ord.album(t),
            t.releaseDate,
            t.disc,
            t.track,
            t.rel,
        ],
        playCount: (t) => [a(t).playCount ?? 0, ...tie(t)],
        playDate: (t) => [a(t).playDate ?? '', ...tie(t)],
        rating: (t) => [a(t).rating ?? 0, a(t).ratedAt ?? '', ...tie(t)],
        releaseYear: (t) => [year(t.releaseDate) || year(t.date), ...tie(t)],
        starred_at: (t) => [Boolean(a(t).starred), a(t).starredAt ?? '', ...tie(t)],
        title: (t) => [ord.title(t), ...tie(t)],
        track: (t) => [t.track, ...tie(t)],
        updatedAt: (t) => [t.mtime, ...tie(t)],
        year: (t) => [year(t.date), ...tie(t)],
    };
};

export const albumSorts = (state: LibraryState): Record<string, (al: Album) => unknown[]> => {
    const a = (al: Album) => state.ann[al.id] ?? {};
    const name = (al: Album) => [
        orderName(al.songs[0].sort.album ?? al.name),
        orderName(al.albumArtists[0]),
    ];
    const maxYear = (al: Album) => Math.max(0, ...al.songs.map((t) => year(t.date)));
    const maxOriginal = (al: Album) => Math.max(0, ...al.songs.map((t) => year(t.originalDate)));
    const comp = (al: Album) => al.songs.some((t) => t.compilation);
    return {
        album_artist: (al) => [comp(al), orderName(al.albumArtists[0]), ...name(al)],
        artist: (al) => [comp(al), orderName(al.albumArtists[0]), ...name(al)],
        duration: (al) => [al.songs.reduce((n, t) => n + t.duration, 0), ...name(al)],
        explicitStatus: (al) => [al.songs.some((t) => t.explicit === 'e'), ...name(al)],
        max_year: (al) => [maxOriginal(al) || maxYear(al), maxYear(al), ...name(al)],
        name,
        play_count: (al) => [a(al).playCount ?? 0, ...name(al)],
        play_date: (al) => [a(al).playDate ?? '', ...name(al)],
        rating: (al) => [a(al).rating ?? 0, ...name(al)],
        recently_added: (al) => [al.createdAt, ...name(al)],
        songCount: (al) => [al.songs.length, ...name(al)],
        starred_at: (al) => [Boolean(a(al).starred), a(al).starredAt ?? '', ...name(al)],
    };
};

export const artistSorts = (
    state: LibraryState,
    role: string,
): Record<string, (ar: Artist) => unknown[]> => {
    const a = (ar: Artist) => state.ann[ar.id] ?? {};
    const s = (ar: Artist) =>
        ar.stats[role || 'maincredit'] ?? ar.stats.maincredit ?? { albumCount: 0, songCount: 0 };
    const name = (ar: Artist) => [orderName(ar.name)];
    return {
        albumCount: (ar) => [s(ar).albumCount, ...name(ar)],
        name,
        playCount: (ar) => [a(ar).playCount ?? 0, ...name(ar)],
        rating: (ar) => [a(ar).rating ?? 0, ...name(ar)],
        songCount: (ar) => [s(ar).songCount, ...name(ar)],
        starred_at: (ar) => [Boolean(a(ar).starred), a(ar).starredAt ?? '', ...name(ar)],
    };
};

// One play: the song, its album and its artists each count it (Navidrome did the same).
export const scrobble = (
    lib: Library,
    state: LibraryState,
    id: string,
    when = new Date().toISOString(),
) => {
    const t = state.tracks[id];
    if (!t) return false;
    const al = lib.albumOf.get(id);
    const artistIds = [
        ...new Set([
            ...(al?.artistIds ?? []),
            ...t.artists.map((n) => lib.artistByName.get(n.toLowerCase())?.id),
        ]),
    ];
    for (const item of [id, al?.id, ...artistIds]) {
        if (!item) continue;
        const a = (state.ann[item] ??= {});
        a.playCount = (a.playCount ?? 0) + 1;
        a.playDate = when;
    }
    return true;
};
