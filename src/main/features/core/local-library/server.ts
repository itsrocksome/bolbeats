// BolBeats: the library's local web service on 127.0.0.1, inside the app (no separate server program). It answers
// the parts of Navidrome's API and the Subsonic API that the app uses, so every screen works as it did.
// Every request needs this Mac's login, and only this computer can reach it.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { type CoverSource, getCover, parseCoverId } from './covers';
import {
    albumSorts,
    all,
    type Annotation,
    artistSorts,
    contains,
    filterSongs,
    first,
    type Library,
    type LibraryState,
    mimeOf,
    ndAlbum,
    ndArtist,
    ndPlaylist,
    ndSong,
    newId,
    orderName,
    page,
    type Query,
    scrobble,
    songSorts,
    ssAlbum,
    ssArtist,
    ssSong,
    type Track,
} from './model';

export const SERVER_VERSION = '0.64.2 (BolBeats library)'; // the app turns on Navidrome features by this version
const USER = 'admin';

export type LibraryHost = {
    dirs: { cache: string; images: string };
    lib: () => Library;
    password: string;
    rescan: (full: boolean) => void;
    save: () => void;
    scanStatus: () => { count: number; folderCount: number; lastScan: string; scanning: boolean };
    state: LibraryState;
    warn?: (message: string) => void; // requests the library does not answer, for the log
};

type Res = http.ServerResponse;
class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const eq = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const now = () => new Date().toISOString();

const readBody = (req: http.IncomingMessage, limit = 32 * 1024 * 1024) =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > limit) {
                reject(new HttpError(413, 'Too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });

const json = (res: Res, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
};

const queryOf = (u: URL): Query => {
    const q: Query = {};
    for (const [k0, v] of u.searchParams) {
        const k = k0.replace(/\[\]$/, '');
        const cur = q[k];
        q[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
    }
    return q;
};

// The first file in a multipart/form-data body (cover uploads).
const multipartFile = (body: Buffer, contentType = '') => {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!boundary) return null;
    const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
    let at = body.indexOf(sep);
    while (at >= 0) {
        const next = body.indexOf(sep, at + sep.length);
        if (next < 0) break;
        const part = body.subarray(at + sep.length + 2, next - 2);
        const split = part.indexOf('\r\n\r\n');
        if (split > 0 && /filename=/i.test(part.subarray(0, split).toString()))
            return part.subarray(split + 4);
        at = next;
    }
    return null;
};

const imageExt = (b: Buffer) =>
    b[0] === 0x89
        ? '.png'
        : b.subarray(0, 4).toString() === 'RIFF'
          ? '.webp'
          : b[0] === 0x47
            ? '.gif'
            : '.jpg';

export const startServer = async (host: LibraryHost, port: number) => {
    const { state } = host;
    const tokenFor = (user: string) => {
        const payload = Buffer.from(JSON.stringify({ sub: user, uid: state.userId })).toString(
            'base64url',
        );
        return `${payload}.${createHmac('sha256', state.secret).update(payload).digest('base64url')}`;
    };
    const tokenOk = (token?: string) => {
        if (!token) return false;
        const [payload, sig] = token.replace(/^Bearer\s+/i, '').split('.');
        if (!payload || !sig) return false;
        return eq(sig, createHmac('sha256', state.secret).update(payload).digest('base64url'));
    };
    const subsonicOk = (q: Query) => {
        if (first(q, 'u') !== USER) return false;
        const t = first(q, 't');
        const s = first(q, 's');
        if (t && s) return eq(t.toLowerCase(), md5(host.password + s));
        let p = first(q, 'p') ?? '';
        if (p.startsWith('enc:')) p = Buffer.from(p.slice(4), 'hex').toString();
        return Boolean(p) && eq(p, host.password);
    };

    // ---- Navidrome API ------------------------------------------------------------------------------------------
    const nd = async (req: http.IncomingMessage, res: Res, parts: string[], q: Query) => {
        const lib = host.lib();
        const method = req.method ?? 'GET';
        const body = async () => {
            const raw = (await readBody(req)).toString() || '{}';
            try {
                return JSON.parse(raw) as Record<string, any>;
            } catch {
                throw new HttpError(400, 'Bad JSON');
            }
        };
        const list = <T>(items: T[], total: number) =>
            json(res, 200, items, { 'X-Total-Count': String(total) });
        const [kind, id, sub, subId] = parts;

        if (kind === 'song' && !id) {
            const { items, total } = page(
                filterSongs(lib, state, q),
                q,
                songSorts(lib, state),
                'title',
            );
            return list(
                items.map((t) => ndSong(lib, state, t)),
                total,
            );
        }
        if (kind === 'song') {
            const t = state.tracks[id];
            if (!t || !lib.albumOf.has(id)) throw new HttpError(404, 'Not found');
            return json(res, 200, ndSong(lib, state, t));
        }
        if (kind === 'album' && !id) {
            const ids = new Set([...all(q, 'album_id'), ...all(q, 'id')]);
            const artistIds = new Set(all(q, 'artist_id'));
            const genreIds = new Set(all(q, 'genre_id'));
            const starred = first(q, 'starred');
            const rated = first(q, 'has_rating');
            const played = first(q, 'recently_played') === 'true';
            const comp = first(q, 'compilation');
            const y = Number(first(q, 'year')) || 0;
            const name = first(q, 'name');
            const albums = [...lib.albums.values()].filter((al) => {
                const a: Annotation = state.ann[al.id] ?? {};
                if (ids.size && !ids.has(al.id)) return false;
                if (artistIds.size) {
                    const credited = [
                        ...al.artistIds,
                        ...al.songs.flatMap((t) =>
                            t.artists.map((n) => lib.artistByName.get(n.toLowerCase())?.id),
                        ),
                    ];
                    if (!credited.some((x) => x && artistIds.has(x))) return false;
                }
                if (
                    genreIds.size &&
                    !al.songs.some((t) =>
                        t.genres.some((g) =>
                            genreIds.has(lib.genres.get(g.toLowerCase())?.id ?? ''),
                        ),
                    )
                )
                    return false;
                if (starred !== undefined && Boolean(a.starred) !== (starred === 'true'))
                    return false;
                if (rated !== undefined && Boolean(a.rating) !== (rated === 'true')) return false;
                if (played && !a.playDate) return false;
                if (comp !== undefined && al.songs.some((t) => t.compilation) !== (comp === 'true'))
                    return false;
                if (y && !al.songs.some((t) => t.date.startsWith(String(y)))) return false;
                if (name && !(contains(al.name, name) || contains(al.albumArtists.join(' '), name)))
                    return false;
                return true;
            });
            const sort =
                played && !first(q, '_sort') ? { ...q, _order: 'DESC', _sort: 'play_date' } : q;
            const { items, total } = page(albums, sort, albumSorts(state), 'name');
            return list(
                items.map((al) => ndAlbum(lib, state, al)),
                total,
            );
        }
        if (kind === 'album') {
            const al = lib.albums.get(id);
            if (!al) throw new HttpError(404, 'Not found');
            return json(res, 200, ndAlbum(lib, state, al));
        }
        if (kind === 'artist' && sub === 'image') return uploadImage(req, res, 'artist', id);
        if (kind === 'artist' && !id) {
            const role = first(q, 'role') ?? '';
            const name = first(q, 'name');
            const starred = first(q, 'starred');
            const genreId = first(q, 'genre_id');
            const artists = [...lib.artists.values()].filter((ar) => {
                if (role && !ar.stats[role]) return false;
                if (name && !contains(ar.name, name)) return false;
                if (
                    starred !== undefined &&
                    Boolean(state.ann[ar.id]?.starred) !== (starred === 'true')
                )
                    return false;
                if (
                    genreId &&
                    !lib.songs.some(
                        (t) =>
                            t.artists.includes(ar.name) &&
                            t.genres.some((g) => lib.genres.get(g.toLowerCase())?.id === genreId),
                    )
                )
                    return false;
                return true;
            });
            const { items, total } = page(artists, q, artistSorts(state, role), 'name');
            return list(
                items.map((ar) => ndArtist(state, ar)),
                total,
            );
        }
        if (kind === 'artist') {
            const ar = lib.artists.get(id);
            if (!ar) throw new HttpError(404, 'Not found');
            return json(res, 200, ndArtist(state, ar));
        }
        if (kind === 'genre') {
            const genres = [...lib.genres.values()].filter((g) =>
                contains(g.name, first(q, 'name')),
            );
            const { items, total } = page(
                genres,
                q,
                { name: (g) => [g.name.toLowerCase()], songCount: (g) => [g.songs, g.name] },
                'name',
            );
            return list(
                items.map((g) => ({
                    albumCount: g.albums.size,
                    id: g.id,
                    name: g.name,
                    songCount: g.songs,
                })),
                total,
            );
        }
        if (kind === 'tag') {
            const tagName = first(q, 'tag_name');
            const tags = [...lib.tagValues.values()].filter(
                (t) => (!tagName || t.name === tagName) && contains(t.value, first(q, 'tag_value')),
            );
            const { items, total } = page(
                tags,
                q,
                {
                    albumCount: (t) => [t.albums.size, t.value.toLowerCase()],
                    songCount: (t) => [t.songs, t.value.toLowerCase()],
                    tagValue: (t) => [t.value.toLowerCase()],
                },
                'tagValue',
            );
            return list(
                items.map((t) => ({
                    albumCount: t.albums.size,
                    id: t.id,
                    songCount: t.songs,
                    tagName: t.name,
                    tagValue: t.value,
                })),
                total,
            );
        }
        if (kind === 'playlist') return playlistApi(req, res, method, id, sub, subId, q, body, lib);
        if (kind === 'queue') {
            if (method === 'POST') {
                const b = await body();
                state.queue = {
                    current: Number(b.current) || 0,
                    ids: Array.isArray(b.ids) ? b.ids.map(String) : [],
                    position: Number(b.position) || 0,
                    updatedAt: now(),
                };
                host.save();
                return json(res, 200, null);
            }
            const items = state.queue.ids
                .map((sid) => state.tracks[sid])
                .filter((t): t is Track => Boolean(t && lib.albumOf.has(t.id)));
            return json(res, 200, {
                changedBy: 'BolBeats',
                createdAt: state.queue.updatedAt || '0001-01-01T00:00:00Z',
                current: state.queue.current,
                id: state.queue.ids.length ? 'queue' : '',
                items: items.length ? items.map((t) => ndSong(lib, state, t)) : undefined,
                position: state.queue.position,
                updatedAt: state.queue.updatedAt || '0001-01-01T00:00:00Z',
                userId: state.userId,
            });
        }
        if (kind === 'user') {
            const at = state.lastScan || now();
            return list(
                [
                    {
                        createdAt: at,
                        email: '',
                        id: state.userId,
                        isAdmin: true,
                        lastAccessAt: now(),
                        lastLoginAt: now(),
                        name: 'BolBeats',
                        updatedAt: at,
                        userName: USER,
                    },
                ],
                1,
            );
        }
        if (kind === 'radio') return radioApi(req, res, method, id, sub, body);
        if (kind === 'share')
            throw new HttpError(501, 'Sharing needs a public server; BolBeats stays on this Mac.');
        throw new HttpError(404, 'Not found');
    };

    const playlistApi = async (
        req: http.IncomingMessage,
        res: Res,
        method: string,
        id: string | undefined,
        sub: string | undefined,
        subId: string | undefined,
        q: Query,
        body: () => Promise<Record<string, any>>,
        lib: Library,
    ) => {
        const known = (ids: unknown) =>
            Array.isArray(ids) ? ids.map(String).filter((x) => state.tracks[x]) : [];
        if (!id) {
            if (method === 'POST') {
                const b = await body();
                const pid = newId();
                state.playlists[pid] = {
                    comment: String(b.comment ?? ''),
                    createdAt: now(),
                    id: pid,
                    name: String(b.name ?? 'Playlist'),
                    public: Boolean(b.public),
                    rules: b.rules ?? null,
                    sync: Boolean(b.sync),
                    tracks: [],
                    updatedAt: now(),
                };
                host.save();
                return json(res, 200, { id: pid });
            }
            const smart = first(q, 'smart');
            const lists = Object.values(state.playlists).filter(
                (p) =>
                    contains(p.name, first(q, 'q')) &&
                    (smart === undefined || Boolean(p.rules) === (smart === 'true')),
            );
            const len = (p: (typeof lists)[number]) => p.tracks.filter((t) => state.tracks[t]);
            const { items, total } = page(
                lists,
                q,
                {
                    duration: (p) => [len(p).reduce((n, t) => n + state.tracks[t].duration, 0)],
                    name: (p) => [orderName(p.name, false)],
                    owner_name: (p) => [orderName(p.name, false)],
                    public: (p) => [p.public, orderName(p.name, false)],
                    songCount: (p) => [len(p).length, orderName(p.name, false)],
                    updatedAt: (p) => [p.updatedAt],
                },
                'name',
            );
            return json(
                res,
                200,
                items.map((p) => ndPlaylist(lib, state, p)),
                { 'X-Total-Count': String(total) },
            );
        }
        const p = state.playlists[id];
        if (!p) throw new HttpError(404, 'Not found');
        if (sub === 'image') return uploadImage(req, res, 'playlist', id);
        const touch = () => {
            p.updatedAt = now();
            host.save();
        };
        if (!sub) {
            if (method === 'DELETE') {
                delete state.playlists[id];
                host.save();
                return json(res, 200, null);
            }
            if (method === 'PUT') {
                const b = await body();
                if (b.name !== undefined) p.name = String(b.name);
                if (b.comment !== undefined) p.comment = String(b.comment);
                if (b.public !== undefined) p.public = Boolean(b.public);
                if (b.sync !== undefined) p.sync = Boolean(b.sync);
                if (b.rules !== undefined) p.rules = b.rules ?? null;
                touch();
            }
            return json(res, 200, ndPlaylist(lib, state, p));
        }
        if (sub !== 'tracks') throw new HttpError(404, 'Not found');
        if (method === 'POST') {
            const ids = known((await body()).ids);
            p.tracks.push(...ids);
            touch();
            return json(res, 200, { added: ids.length });
        }
        if (method === 'DELETE') {
            const drop = new Set(all(q, 'id').map(Number));
            p.tracks = p.tracks.filter((_, i) => !drop.has(i + 1));
            touch();
            return json(res, 200, { ids: [...drop].map(String) });
        }
        if (method === 'PUT' && subId) {
            const from = Number(subId) - 1;
            const before = Number((await body()).insert_before) - 1;
            if (from >= 0 && from < p.tracks.length) {
                const [moved] = p.tracks.splice(from, 1);
                p.tracks.splice(
                    Math.max(0, Math.min(p.tracks.length, before > from ? before - 1 : before)),
                    0,
                    moved,
                );
                touch();
            }
            return json(res, 200, null);
        }
        const rows = p.tracks
            .map((sid, i) => ({ i, t: state.tracks[sid] }))
            .filter((r): r is { i: number; t: Track } => Boolean(r.t && lib.albumOf.has(r.t.id)));
        return json(
            res,
            200,
            rows.map(({ i, t }) => ({
                ...ndSong(lib, state, t),
                id: String(i + 1),
                mediaFileId: t.id,
                playlistId: id,
            })),
            { 'X-Total-Count': String(rows.length) },
        );
    };

    const radios = () => (state.radios ??= {});
    const radioApi = async (
        _req: http.IncomingMessage,
        res: Res,
        method: string,
        id: string | undefined,
        sub: string | undefined,
        body: () => Promise<Record<string, any>>,
    ) => {
        if (sub === 'image') return json(res, 200, { status: 'ok' });
        if (!id)
            return json(res, 200, Object.values(radios()), {
                'X-Total-Count': String(Object.keys(radios()).length),
            });
        if (method === 'DELETE') delete radios()[id];
        else if (method === 'PUT' && radios()[id])
            Object.assign(radios()[id], await body(), { updatedAt: now() });
        host.save();
        return json(res, 200, radios()[id] ?? null);
    };

    const uploadImage = async (
        req: http.IncomingMessage,
        res: Res,
        kind: 'artist' | 'playlist',
        id: string,
    ) => {
        const old = kind === 'artist' ? state.images[id] : state.playlists[id]?.image;
        if (old) await fs.unlink(path.join(host.dirs.images, old)).catch(() => undefined);
        if (req.method === 'DELETE') {
            if (kind === 'artist') delete state.images[id];
            else if (state.playlists[id]) state.playlists[id].image = undefined;
        } else {
            const file = multipartFile(await readBody(req), req.headers['content-type']);
            if (!file?.length) throw new HttpError(400, 'No image');
            mkdirSync(host.dirs.images, { recursive: true });
            const name = `${newId()}${imageExt(file)}`;
            await fs.writeFile(path.join(host.dirs.images, name), file);
            if (kind === 'artist') state.images[id] = name;
            else if (state.playlists[id]) state.playlists[id].image = name;
        }
        if (kind === 'playlist' && state.playlists[id]) state.playlists[id].updatedAt = now();
        host.save();
        return json(res, 200, { status: 'ok' });
    };

    // ---- Subsonic API -------------------------------------------------------------------------------------------
    const ok = (res: Res, extra: Record<string, unknown> = {}) =>
        json(res, 200, {
            'subsonic-response': {
                openSubsonic: true,
                serverVersion: SERVER_VERSION,
                status: 'ok',
                type: 'navidrome',
                version: '1.16.1',
                ...extra,
            },
        });
    const fail = (res: Res, code: number, message: string) =>
        json(res, 200, {
            'subsonic-response': {
                error: { code, message },
                openSubsonic: true,
                serverVersion: SERVER_VERSION,
                status: 'failed',
                type: 'navidrome',
                version: '1.16.1',
            },
        });

    const shuffle = <T>(a: T[]) => {
        const out = [...a];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    };

    // Songs like this one, from this Mac only: same artists, then same genre, then the same top folder.
    const similar = (lib: Library, seed: Track[], count: number, exclude: Set<string>) => {
        const names = new Set(seed.flatMap((t) => t.artists.map((n) => n.toLowerCase())));
        const genres = new Set(seed.flatMap((t) => t.genres.map((g) => g.toLowerCase())));
        const tops = new Set(seed.map((t) => t.rel.split('/')[0]));
        const rest = lib.songs.filter((t) => !exclude.has(t.id));
        const tiers = [
            rest.filter((t) => t.artists.some((n) => names.has(n.toLowerCase()))),
            rest.filter((t) => t.genres.some((g) => genres.has(g.toLowerCase()))),
            rest.filter((t) => t.rel.includes('/') && tops.has(t.rel.split('/')[0])),
        ];
        const out: Track[] = [];
        for (const tier of tiers)
            for (const t of shuffle(tier)) if (out.length < count && !out.includes(t)) out.push(t);
        return out;
    };

    const ss = async (req: http.IncomingMessage, res: Res, name: string, q: Query) => {
        const lib = host.lib();
        const song = (t: Track) => ssSong(lib, state, t);
        const n = (k: string, d: number) => Math.max(0, Number(first(q, k) ?? d) || 0);
        switch (name) {
            case 'createInternetRadioStation': {
                const id = newId();
                radios()[id] = {
                    createdAt: now(),
                    homePageUrl: first(q, 'homepageUrl') ?? '',
                    id,
                    name: first(q, 'name') ?? '',
                    streamUrl: first(q, 'streamUrl') ?? '',
                    updatedAt: now(),
                };
                host.save();
                return ok(res);
            }
            case 'createPlaylist': {
                const ids = all(q, 'songId').filter((id) => state.tracks[id]);
                const existing = state.playlists[first(q, 'playlistId') ?? ''];
                const p = existing ?? {
                    comment: '',
                    createdAt: now(),
                    id: newId(),
                    name: first(q, 'name') ?? 'Playlist',
                    public: false,
                    rules: null,
                    sync: false,
                    tracks: [],
                    updatedAt: now(),
                };
                if (existing && first(q, 'name')) p.name = first(q, 'name')!;
                p.tracks = ids;
                p.updatedAt = now();
                state.playlists[p.id] = p;
                host.save();
                return ok(res, {
                    playlist: {
                        changed: p.updatedAt,
                        created: p.createdAt,
                        id: p.id,
                        name: p.name,
                        owner: USER,
                        public: p.public,
                        songCount: ids.length,
                    },
                });
            }
            case 'deleteInternetRadioStation':
                delete radios()[first(q, 'id') ?? ''];
                host.save();
                return ok(res);
            case 'deletePlaylist':
                delete state.playlists[first(q, 'id') ?? ''];
                host.save();
                return ok(res);
            case 'download':
            case 'stream':
                return stream(
                    req,
                    res,
                    state.tracks[first(q, 'id') ?? ''],
                    lib,
                    name === 'download',
                );
            case 'getAlbum': {
                const al = lib.albums.get(first(q, 'id') ?? '');
                return al
                    ? ok(res, { album: ssAlbum(lib, state, al, true) })
                    : fail(res, 70, 'Album not found');
            }
            case 'getAlbumInfo':
            case 'getAlbumInfo2':
                return ok(res, { albumInfo: {} });
            case 'getAlbumList':
            case 'getAlbumList2': {
                const type = first(q, 'type') ?? 'alphabeticalByName';
                const sort: Record<string, Query> = {
                    alphabeticalByArtist: { _sort: 'album_artist' },
                    alphabeticalByName: { _sort: 'name' },
                    byYear: { _sort: 'max_year' },
                    frequent: { _order: 'DESC', _sort: 'play_count' },
                    highest: { _order: 'DESC', _sort: 'rating' },
                    newest: { _order: 'DESC', _sort: 'recently_added' },
                    random: { _sort: 'random' },
                    recent: { _order: 'DESC', _sort: 'play_date' },
                    starred: { _order: 'DESC', _sort: 'starred_at' },
                };
                let albums = [...lib.albums.values()];
                if (type === 'starred') albums = albums.filter((a) => state.ann[a.id]?.starred);
                if (type === 'recent') albums = albums.filter((a) => state.ann[a.id]?.playDate);
                if (type === 'frequent') albums = albums.filter((a) => state.ann[a.id]?.playCount);
                if (type === 'byGenre')
                    albums = albums.filter((a) =>
                        a.songs.some((t) =>
                            t.genres.some(
                                (g) => g.toLowerCase() === first(q, 'genre')?.toLowerCase(),
                            ),
                        ),
                    );
                const offset = n('offset', 0);
                const { items } = page(
                    albums,
                    {
                        ...(sort[type] ?? sort.alphabeticalByName),
                        _end: String(offset + (n('size', 10) || 10)),
                        _start: String(offset),
                    },
                    albumSorts(state),
                    'name',
                );
                return ok(res, {
                    [name === 'getAlbumList2' ? 'albumList2' : 'albumList']: {
                        album: items.map((a) => ssAlbum(lib, state, a)),
                    },
                });
            }
            case 'getArtist': {
                const ar = lib.artists.get(first(q, 'id') ?? '');
                if (!ar) return fail(res, 70, 'Artist not found');
                const albums = [...lib.albums.values()].filter((al) =>
                    al.artistIds.includes(ar.id),
                );
                return ok(res, {
                    artist: {
                        ...ssArtist(lib, state, ar),
                        album: albums.map((al) => ssAlbum(lib, state, al)),
                    },
                });
            }
            case 'getArtistInfo':
            case 'getArtistInfo2': {
                const ar = lib.artists.get(first(q, 'id') ?? '');
                const mine = ar
                    ? lib.songs.filter(
                          (t) =>
                              t.artists.includes(ar.name) ||
                              lib.albumOf.get(t.id)?.artistIds.includes(ar.id),
                      )
                    : [];
                const others = [
                    ...new Set(
                        similar(lib, mine, 60, new Set(mine.map((t) => t.id))).flatMap(
                            (t) => t.artists,
                        ),
                    ),
                ]
                    .filter((x) => x !== ar?.name)
                    .slice(0, n('count', 20) || 20)
                    .map((x) => lib.artistByName.get(x.toLowerCase())!)
                    .filter(Boolean);
                return ok(res, {
                    [name === 'getArtistInfo2' ? 'artistInfo2' : 'artistInfo']: {
                        similarArtist: others.map((a) => ssArtist(lib, state, a)),
                    },
                });
            }
            case 'getArtists':
            case 'getIndexes': {
                const groups = new Map<string, ReturnType<typeof ssArtist>[]>();
                for (const ar of [...lib.artists.values()]
                    .filter((a) => a.stats.albumartist)
                    .sort((a, b) => orderName(a.name).localeCompare(orderName(b.name)))) {
                    const letter = /^[a-z]/i.test(orderName(ar.name))
                        ? orderName(ar.name)[0].toUpperCase()
                        : '#';
                    groups.set(letter, [...(groups.get(letter) ?? []), ssArtist(lib, state, ar)]);
                }
                const index = [...groups].map(([letter, artist]) => ({ artist, name: letter }));
                return ok(
                    res,
                    name === 'getArtists'
                        ? {
                              artists: {
                                  ignoredArticles: 'The El La Los Las Le Les Os As O A',
                                  index,
                              },
                          }
                        : {
                              indexes: {
                                  ignoredArticles: 'The El La Los Las Le Les Os As O A',
                                  index,
                                  lastModified: Date.now(),
                              },
                          },
                );
            }
            case 'getCoverArt': {
                const src: CoverSource | null = parseCoverId(lib, state, first(q, 'id') ?? '');
                const img = src ? await getCover(lib, state, host.dirs, src, n('size', 0)) : null;
                if (!img) throw new HttpError(404, 'No cover');
                res.writeHead(200, {
                    'Cache-Control': 'private, max-age=31536000',
                    'Content-Length': String(img.body.length),
                    'Content-Type': img.type,
                });
                return res.end(img.body);
            }
            case 'getGenres':
                return ok(res, {
                    genres: {
                        genre: [...lib.genres.values()].map((g) => ({
                            albumCount: g.albums.size,
                            songCount: g.songs,
                            value: g.name,
                        })),
                    },
                });
            case 'getInternetRadioStations':
                return ok(res, {
                    internetRadioStations: {
                        internetRadioStation: Object.values(radios()).map((r: any) => ({
                            homePageUrl: r.homePageUrl,
                            id: r.id,
                            name: r.name,
                            streamUrl: r.streamUrl,
                        })),
                    },
                });
            case 'getLicense':
            case 'ping':
                return ok(res, name === 'getLicense' ? { license: { valid: true } } : {});
            case 'getLyrics': {
                const artist = (first(q, 'artist') ?? '').toLowerCase();
                const title = (first(q, 'title') ?? '').toLowerCase();
                const t = lib.songs.find(
                    (s) =>
                        s.lyrics &&
                        s.title.toLowerCase() === title &&
                        (!artist || s.artists.join(' ').toLowerCase().includes(artist)),
                );
                return ok(res, {
                    lyrics: t
                        ? { artist: t.artists.join(' • '), title: t.title, value: t.lyrics }
                        : {},
                });
            }
            case 'getLyricsBySongId': {
                const t = state.tracks[first(q, 'id') ?? ''];
                if (!t?.lyrics) return ok(res, { lyricsList: {} });
                const lrc = [...t.lyrics.matchAll(/^\s*\[(\d+):(\d+(?:\.\d+)?)\](.*)$/gm)];
                const synced = lrc.length > 0;
                const line = synced
                    ? lrc.map((m) => ({
                          start: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000),
                          value: m[3].trim(),
                      }))
                    : t.lyrics.split(/\r?\n/).map((value) => ({ value }));
                return ok(res, {
                    lyricsList: {
                        structuredLyrics: [
                            {
                                displayArtist: t.artists.join(' • '),
                                displayTitle: t.title,
                                lang: 'xxx',
                                line,
                                synced,
                            },
                        ],
                    },
                });
            }
            case 'getMusicDirectory': {
                const id = first(q, 'id') ?? '';
                const ar = lib.artists.get(id);
                if (ar) {
                    const albums = [...lib.albums.values()].filter((al) =>
                        al.artistIds.includes(id),
                    );
                    return ok(res, {
                        directory: {
                            child: albums.map((al) => ({
                                ...ssAlbum(lib, state, al),
                                title: al.name,
                            })),
                            id,
                            name: ar.name,
                        },
                    });
                }
                const al = lib.albums.get(id);
                if (al)
                    return ok(res, {
                        directory: {
                            child: al.songs.map(song),
                            id,
                            name: al.name,
                            parent: al.artistIds[0],
                        },
                    });
                return fail(res, 70, 'Directory not found');
            }
            case 'getMusicFolders':
                return ok(res, {
                    musicFolders: { musicFolder: [{ id: 1, name: 'Music Library' }] },
                });
            case 'getOpenSubsonicExtensions':
                return ok(res, { openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }] });
            case 'getPlaylist': {
                const p = state.playlists[first(q, 'id') ?? ''];
                if (!p) return fail(res, 70, 'Playlist not found');
                const x = ndPlaylist(lib, state, p);
                const entry = p.tracks
                    .map((id) => state.tracks[id])
                    .filter((t) => t && lib.albumOf.has(t.id))
                    .map(song);
                return ok(res, {
                    playlist: {
                        changed: p.updatedAt,
                        comment: p.comment,
                        coverArt: `pl-${p.id}_${x.imageHash}`,
                        created: p.createdAt,
                        duration: Math.floor(x.duration),
                        entry,
                        id: p.id,
                        name: p.name,
                        owner: USER,
                        public: p.public,
                        songCount: entry.length,
                    },
                });
            }
            case 'getPlaylists':
                return ok(res, {
                    playlists: {
                        playlist: Object.values(state.playlists).map((p) => {
                            const x = ndPlaylist(lib, state, p);
                            return {
                                changed: p.updatedAt,
                                comment: p.comment,
                                coverArt: `pl-${p.id}_${x.imageHash}`,
                                created: p.createdAt,
                                duration: Math.floor(x.duration),
                                id: p.id,
                                name: p.name,
                                owner: USER,
                                public: p.public,
                                readonly: false,
                                songCount: x.songCount,
                            };
                        }),
                    },
                });
            case 'getPlayQueue': {
                const entry = state.queue.ids
                    .map((id) => state.tracks[id])
                    .filter((t) => t && lib.albumOf.has(t.id))
                    .map(song);
                return ok(res, {
                    playQueue: {
                        changed: state.queue.updatedAt || '0001-01-01T00:00:00Z',
                        changedBy: 'BolBeats',
                        current: entry.length ? state.queue.ids[state.queue.current] : undefined,
                        entry: entry.length ? entry : undefined,
                        position: state.queue.position,
                        username: USER,
                    },
                });
            }
            case 'getRandomSongs': {
                const genre = first(q, 'genre')?.toLowerCase();
                const from = n('fromYear', 0);
                const to = n('toYear', 0);
                const pool = lib.songs.filter((t) => {
                    const y = Number(t.date.slice(0, 4)) || 0;
                    return (
                        (!genre || t.genres.some((g) => g.toLowerCase() === genre)) &&
                        (!from || y >= from) &&
                        (!to || y <= to)
                    );
                });
                return ok(res, {
                    randomSongs: {
                        song: shuffle(pool)
                            .slice(0, n('size', 10) || 10)
                            .map(song),
                    },
                });
            }
            case 'getScanStatus': {
                const s = host.scanStatus();
                return ok(res, { scanStatus: { ...s, scanType: 'quick' } });
            }
            case 'getSimilarSongs':
            case 'getSimilarSongs2': {
                const id = first(q, 'id') ?? '';
                const count = n('count', 50) || 50;
                const al = lib.albums.get(id);
                const ar = lib.artists.get(id);
                const seed = state.tracks[id]
                    ? [state.tracks[id]]
                    : al
                      ? al.songs
                      : ar
                        ? lib.songs.filter((t) => t.artists.includes(ar.name))
                        : [];
                const exclude = new Set(state.tracks[id] ? [id] : []);
                const list =
                    ar && name === 'getSimilarSongs2'
                        ? [
                              ...shuffle(seed),
                              ...similar(lib, seed, count, new Set(seed.map((t) => t.id))),
                          ].slice(0, count)
                        : similar(lib, seed, count, exclude);
                return ok(res, {
                    [name === 'getSimilarSongs2' ? 'similarSongs2' : 'similarSongs']: {
                        song: list.map(song),
                    },
                });
            }
            case 'getSong': {
                const t = state.tracks[first(q, 'id') ?? ''];
                return t && lib.albumOf.has(t.id)
                    ? ok(res, { song: song(t) })
                    : fail(res, 70, 'Song not found');
            }
            case 'getStarred':
            case 'getStarred2': {
                const starred = (id: string) => state.ann[id]?.starred;
                return ok(res, {
                    [name === 'getStarred2' ? 'starred2' : 'starred']: {
                        album: [...lib.albums.values()]
                            .filter((a) => starred(a.id))
                            .map((a) => ssAlbum(lib, state, a)),
                        artist: [...lib.artists.values()]
                            .filter((a) => starred(a.id))
                            .map((a) => ssArtist(lib, state, a)),
                        song: lib.songs.filter((t) => starred(t.id)).map(song),
                    },
                });
            }
            case 'getTopSongs': {
                const artist = (first(q, 'artist') ?? '').toLowerCase();
                const mine = lib.songs.filter(
                    (t) =>
                        t.artists.some((x) => x.toLowerCase() === artist) &&
                        state.ann[t.id]?.playCount,
                );
                mine.sort(
                    (a, b) => (state.ann[b.id]?.playCount ?? 0) - (state.ann[a.id]?.playCount ?? 0),
                );
                return ok(res, {
                    topSongs: { song: mine.slice(0, n('count', 50) || 50).map(song) },
                });
            }
            // Every song plays straight from its file (the app remembers Navidrome asking this until it reconnects).
            case 'getTranscodeDecision':
                return ok(res, { transcodeDecision: { canDirectPlay: true, canTranscode: false } });
            case 'getUser':
                return ok(res, {
                    user: {
                        adminRole: true,
                        commentRole: false,
                        coverArtRole: true,
                        downloadRole: true,
                        folder: [1],
                        jukeboxRole: false,
                        playlistRole: true,
                        podcastRole: false,
                        scrobblingEnabled: true,
                        settingsRole: false,
                        shareRole: false,
                        streamRole: true,
                        uploadRole: false,
                        username: USER,
                        videoConversionRole: false,
                    },
                });
            case 'jukeboxControl':
                return fail(res, 0, 'Jukebox mode is not available');
            case 'savePlayQueue': {
                const ids = all(q, 'id');
                state.queue = {
                    current: Math.max(0, ids.indexOf(first(q, 'current') ?? '')),
                    ids,
                    position: n('position', 0),
                    updatedAt: now(),
                };
                host.save();
                return ok(res);
            }
            case 'scrobble': {
                if (first(q, 'submission') !== 'false') {
                    const times = all(q, 'time');
                    all(q, 'id').forEach((id, i) =>
                        scrobble(
                            lib,
                            state,
                            id,
                            times[i] ? new Date(Number(times[i])).toISOString() : now(),
                        ),
                    );
                    host.save();
                }
                return ok(res);
            }
            case 'search2':
            case 'search3': {
                const term = (first(q, 'query') ?? '').replace(/^"|"$/g, '').trim();
                const match = (s: string) => !term || contains(s, term);
                const artists = [...lib.artists.values()].filter(
                    (a) => a.stats.albumartist && match(a.name),
                );
                const albums = [...lib.albums.values()].filter(
                    (a) => match(a.name) || match(a.albumArtists.join(' ')),
                );
                const songs = lib.songs.filter(
                    (t) => match(t.title) || match(t.artists.join(' ')) || match(t.album),
                );
                const slice = <T>(a: T[], c: string, o: string) =>
                    a.slice(n(o, 0), n(o, 0) + n(c, 20));
                const key = name === 'search3' ? 'searchResult3' : 'searchResult2';
                return ok(res, {
                    [key]: {
                        album: slice(
                            albums.sort((a, b) =>
                                orderName(a.name).localeCompare(orderName(b.name)),
                            ),
                            'albumCount',
                            'albumOffset',
                        ).map((a) => ssAlbum(lib, state, a)),
                        artist: slice(
                            artists.sort((a, b) =>
                                orderName(a.name).localeCompare(orderName(b.name)),
                            ),
                            'artistCount',
                            'artistOffset',
                        ).map((a) => ssArtist(lib, state, a)),
                        song: slice(
                            songs.sort((a, b) =>
                                orderName(a.title, false).localeCompare(orderName(b.title, false)),
                            ),
                            'songCount',
                            'songOffset',
                        ).map(song),
                    },
                });
            }
            case 'setRating': {
                const a = (state.ann[first(q, 'id') ?? ''] ??= {});
                const r = Math.max(0, Math.min(5, n('rating', 0)));
                a.rating = r || undefined;
                a.ratedAt = r ? now() : undefined;
                host.save();
                return ok(res);
            }
            case 'star':
            case 'unstar': {
                for (const id of [...all(q, 'id'), ...all(q, 'albumId'), ...all(q, 'artistId')]) {
                    const a = (state.ann[id] ??= {});
                    a.starred = name === 'star' || undefined;
                    a.starredAt = name === 'star' ? now() : undefined;
                }
                host.save();
                return ok(res);
            }
            case 'startScan':
                host.rescan(first(q, 'fullScan') === 'true');
                return ok(res, { scanStatus: { ...host.scanStatus(), scanning: true } });
            case 'updateInternetRadioStation': {
                const r = radios()[first(q, 'id') ?? ''];
                if (r)
                    Object.assign(r, {
                        homePageUrl: first(q, 'homepageUrl') ?? r.homePageUrl,
                        name: first(q, 'name') ?? r.name,
                        streamUrl: first(q, 'streamUrl') ?? r.streamUrl,
                        updatedAt: now(),
                    });
                host.save();
                return ok(res);
            }
            case 'updatePlaylist': {
                const p = state.playlists[first(q, 'playlistId') ?? ''];
                if (!p) return fail(res, 70, 'Playlist not found');
                if (first(q, 'name') !== undefined) p.name = first(q, 'name')!;
                if (first(q, 'comment') !== undefined) p.comment = first(q, 'comment')!;
                if (first(q, 'public') !== undefined) p.public = first(q, 'public') === 'true';
                const drop = new Set(all(q, 'songIndexToRemove').map(Number));
                p.tracks = p.tracks.filter((_, i) => !drop.has(i));
                p.tracks.push(...all(q, 'songIdToAdd').filter((id) => state.tracks[id]));
                p.updatedAt = now();
                host.save();
                return ok(res);
            }
            default:
                host.warn?.(`/rest/${name} is not answered`);
                return fail(res, 0, `${name} is not available in the BolBeats library`);
        }
    };

    const stream = async (
        req: http.IncomingMessage,
        res: Res,
        t: Track | undefined,
        lib: Library,
        download: boolean,
    ) => {
        if (!t) throw new HttpError(404, 'Song not found');
        const abs = path.join(lib.folder, ...t.rel.split('/'));
        const st = await fs.stat(abs).catch(() => null);
        if (!st) throw new HttpError(404, 'File not found');
        const headers: Record<string, string> = {
            'Accept-Ranges': 'bytes',
            'Content-Type': mimeOf(t.suffix),
            'X-Content-Duration': String(t.duration),
        };
        if (download)
            headers['Content-Disposition'] =
                `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        let start = 0;
        let end = st.size - 1;
        if (range && (range[1] || range[2])) {
            start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
            end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
            if (start > end || start >= st.size) {
                res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
                return res.end();
            }
            res.writeHead(206, {
                ...headers,
                'Content-Length': String(end - start + 1),
                'Content-Range': `bytes ${start}-${end}/${st.size}`,
            });
        } else res.writeHead(200, { ...headers, 'Content-Length': String(st.size) });
        if (req.method === 'HEAD') return res.end();
        return void createReadStream(abs, { end, start })
            .on('error', () => res.destroy())
            .pipe(res);
    };

    let actualPort = port;
    const server = http.createServer(async (req, res) => {
        // Always, not only when the request names an origin: covers are cached for a year, and a copy first loaded by
        // an <img> (no origin) would otherwise later be refused to code that reads its pixels (the cover glow).
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
            'Access-Control-Expose-Headers',
            'X-Content-Duration, X-Total-Count, X-Nd-Authorization',
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            // Only this computer, by its own name: a web page that renames itself to 127.0.0.1 gets nothing.
            const hostHeader = (req.headers.host ?? '').toLowerCase();
            if (
                hostHeader !== `127.0.0.1:${actualPort}` &&
                hostHeader !== `localhost:${actualPort}`
            )
                throw new HttpError(403, 'Forbidden');
            if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Headers':
                        req.headers['access-control-request-headers'] ??
                        'X-Nd-Authorization, Content-Type',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, HEAD',
                    'Access-Control-Allow-Origin': '*',
                });
                return res.end();
            }
            const u = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort}`);
            const q = queryOf(u);
            const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
            if (parts[0] === 'ping') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                return res.end('.');
            }
            if (parts[0] === 'auth' && parts[1] === 'login' && req.method === 'POST') {
                let b: Record<string, string> = {};
                try {
                    b = JSON.parse((await readBody(req, 64 * 1024)).toString());
                } catch {
                    throw new HttpError(400, 'Bad JSON');
                }
                if (
                    b.username !== USER ||
                    typeof b.password !== 'string' ||
                    !eq(b.password, host.password)
                )
                    throw new HttpError(401, 'Invalid username or password');
                const salt = randomBytes(3).toString('hex');
                return json(res, 200, {
                    id: state.userId,
                    isAdmin: true,
                    name: 'BolBeats',
                    subsonicSalt: salt,
                    subsonicToken: md5(host.password + salt),
                    token: tokenFor(USER),
                    username: USER,
                });
            }
            if (parts[0] === 'api') {
                if (!tokenOk(req.headers['x-nd-authorization'] as string | undefined))
                    throw new HttpError(401, 'Not logged in');
                return await nd(req, res, parts.slice(1), q);
            }
            if (parts[0] === 'rest' && parts[1]) {
                if (
                    req.method === 'POST' &&
                    /x-www-form-urlencoded/.test(req.headers['content-type'] ?? '')
                ) {
                    for (const [k, v] of new URLSearchParams(
                        (await readBody(req, 1024 * 1024)).toString(),
                    )) {
                        const cur = q[k];
                        q[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
                    }
                }
                if (!subsonicOk(q)) return fail(res, 40, 'Wrong username or password');
                return await ss(req, res, parts[1].replace(/\.view$/, ''), q);
            }
            throw new HttpError(404, 'Not found');
        } catch (e) {
            const status = e instanceof HttpError ? e.status : 500;
            if (status >= 500 || (status === 404 && !/cover/i.test(String(e))))
                host.warn?.(
                    `${req.method} ${req.url?.split('?')[0]}: ${e instanceof Error ? e.message : String(e)}`,
                );
            if (!res.headersSent)
                json(res, status, { error: e instanceof Error ? e.message : String(e) });
            else res.destroy();
        }
    });
    server.keepAliveTimeout = 65_000;
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });
    actualPort = (server.address() as { port: number }).port;
    return { port: actualPort, server, url: `http://127.0.0.1:${actualPort}` };
};
