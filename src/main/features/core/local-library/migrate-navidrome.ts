// BolBeats: moves what the old bundled Navidrome knew into BolBeats' own library, once: every song, album and artist
// id (best parts, playlists and taste are saved against them), play counts, favourites, ratings, playlists, the play
// queue and uploaded covers. It only reads navidrome.db; the old files stay where they are.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type LibraryState, newId, type PlaylistRecord } from './model';

const iso = (v: unknown) => {
    if (typeof v !== 'string' || !v || v.startsWith('0001-')) return undefined;
    const d = new Date(v.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

type Row = Record<string, unknown>;

export const migrateNavidrome = (dbFile: string, state: LibraryState, imagesDir: string) => {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
        const rows = (sql: string) => db.prepare(sql).all() as Row[];
        const has = (table: string) =>
            rows(`select name from sqlite_master where type='table' and name='${table}'`).length >
            0;

        const user = rows(
            "select id from user order by user_name = 'admin' desc, created_at limit 1",
        )[0];
        if (user?.id) state.userId = String(user.id);

        const legacyAlbum: Record<string, string> = {};
        for (const r of rows('select id, path, album_id, created_at from media_file')) {
            const id = String(r.id);
            const rel = String(r.path).replace(/\\/g, '/');
            state.ids.song[rel] = id;
            legacyAlbum[id] = String(r.album_id);
            // a placeholder the first scan fills in (it keeps the id and the date it was first added)
            state.tracks[id] = {
                createdAt: iso(r.created_at) ?? new Date().toISOString(),
                id,
                mtime: -1,
                rel,
            } as never;
        }
        state.legacyAlbum = legacyAlbum;
        state.albumCreated = {};
        for (const r of rows('select id, created_at from album')) {
            const at = iso(r.created_at);
            if (at) state.albumCreated[String(r.id)] = at;
        }

        const artistDir = path.dirname(dbFile);
        for (const r of rows('select id, name, uploaded_image from artist')) {
            state.ids.artist[String(r.name).toLowerCase()] = String(r.id);
            const img = copyUpload(artistDir, String(r.uploaded_image ?? ''), imagesDir);
            if (img) state.images[String(r.id)] = img;
        }

        for (const r of rows(
            'select item_id, play_count, play_date, rating, starred, starred_at, rated_at from annotation',
        )) {
            state.ann[String(r.item_id)] = {
                playCount: Number(r.play_count) || undefined,
                playDate: iso(r.play_date),
                ratedAt: iso(r.rated_at),
                rating: Number(r.rating) || undefined,
                starred: Boolean(r.starred) || undefined,
                starredAt: iso(r.starred_at),
            };
        }

        const tracks = new Map<string, string[]>();
        for (const r of rows(
            'select playlist_id, media_file_id from playlist_tracks order by playlist_id, id',
        )) {
            const list = tracks.get(String(r.playlist_id)) ?? [];
            list.push(String(r.media_file_id));
            tracks.set(String(r.playlist_id), list);
        }
        for (const r of rows('select * from playlist')) {
            const id = String(r.id);
            let rules: PlaylistRecord['rules'] = null;
            try {
                rules = r.rules ? JSON.parse(String(r.rules)) : null;
            } catch {
                rules = null;
            }
            state.playlists[id] = {
                comment: String(r.comment ?? ''),
                createdAt: iso(r.created_at) ?? new Date().toISOString(),
                id,
                image: copyUpload(artistDir, String(r.uploaded_image ?? ''), imagesDir),
                name: String(r.name),
                public: Boolean(r.public),
                rules,
                sync: Boolean(r.sync),
                tracks: tracks.get(id) ?? [],
                updatedAt: iso(r.updated_at) ?? new Date().toISOString(),
            };
        }

        if (has('playqueue')) {
            const q = rows('select current, position, items, updated_at from playqueue limit 1')[0];
            if (q) {
                state.queue = {
                    current: Number(q.current) || 0,
                    ids: String(q.items ?? '')
                        .split(',')
                        .filter(Boolean),
                    position: Number(q.position) || 0,
                    updatedAt: iso(q.updated_at) ?? '',
                };
            }
        }
        return {
            playlists: Object.keys(state.playlists).length,
            songs: Object.keys(legacyAlbum).length,
        };
    } finally {
        db.close();
    }
};

// Navidrome kept uploaded covers under <data>/artwork/... by file name.
const copyUpload = (dataDir: string, name: string, imagesDir: string) => {
    if (!name) return undefined;
    const from = [path.join(dataDir, 'artwork', 'images', name), path.join(dataDir, name)].find(
        (p) => existsSync(p),
    );
    if (!from) return undefined;
    mkdirSync(imagesDir, { recursive: true });
    const to = `${newId()}${path.extname(name)}`;
    copyFileSync(from, path.join(imagesDir, to));
    return to;
};
