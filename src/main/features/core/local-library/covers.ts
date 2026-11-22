// BolBeats: cover art for songs, albums, artists and playlists, resized with Electron's own image tools and cached
// on disk. A song's cover is its embedded picture, else an image next to it (cover.jpg, folder.jpg, ...). An artist
// without an uploaded photo shows their first album's cover; a playlist without one gets a 2x2 collage.
import { nativeImage } from 'electron';
import { existsSync, promises as fs, mkdirSync } from 'node:fs';
import path from 'node:path';

import { hash, type Library, type LibraryState, type Track } from './model';
import { getTagLib } from './scan';

const FOLDER_IMAGES =
    /^(cover|folder|front|album|albumart|albumartsmall|thumb)\.(jpe?g|png|webp)$/i;

const embedded = async (abs: string) => {
    const f = await (await getTagLib()).open(abs, { partial: true });
    try {
        const pics = f.getPictures();
        const pic = pics.find((p) => Number(p.type) === 3) ?? pics[0]; // 3 = front cover
        return pic ? Buffer.from(pic.data) : null;
    } finally {
        f.dispose();
    }
};

const nextTo = async (abs: string) => {
    const dir = path.dirname(abs);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const name =
        names.find((n) => FOLDER_IMAGES.test(n)) ??
        names.find((n) => /\.(jpe?g|png|webp)$/i.test(n));
    return name ? fs.readFile(path.join(dir, name)) : null;
};

const songCover = async (folder: string, t: Track) => {
    const abs = path.join(folder, ...t.rel.split('/'));
    return (
        (t.hasCover ? await embedded(abs).catch(() => null) : null) ??
        (await nextTo(abs).catch(() => null))
    );
};

const albumCover = async (folder: string, songs: Track[]) => {
    for (const t of [...songs.filter((s) => s.hasCover), ...songs.filter((s) => !s.hasCover)].slice(
        0,
        4,
    )) {
        const img = await songCover(folder, t);
        if (img) return img;
    }
    return null;
};

// Four covers side by side, drawn into one bitmap (BGRA rows), so there is no image library to ship.
const collage = (images: Buffer[], size = 600) => {
    const half = size / 2;
    const out = Buffer.alloc(size * size * 4);
    images.slice(0, 4).forEach((buf, i) => {
        const tile = nativeImage
            .createFromBuffer(buf)
            .resize({ height: half, quality: 'good', width: half });
        const bmp = tile.toBitmap();
        if (bmp.length < half * half * 4) return;
        const ox = (i % 2) * half;
        const oy = Math.floor(i / 2) * half;
        for (let y = 0; y < half; y++)
            bmp.copy(out, ((oy + y) * size + ox) * 4, y * half * 4, (y + 1) * half * 4);
    });
    return nativeImage.createFromBitmap(out, { height: size, width: size }).toJPEG(90);
};

export type CoverSource = { id: string; kind: 'al' | 'ar' | 'mf' | 'pl' };

// "mf-<id>_<hash>", "al-...", "ar-...", "pl-...", or a bare id (song, album, artist, then playlist).
export const parseCoverId = (
    lib: Library,
    state: LibraryState,
    raw: string,
): CoverSource | null => {
    const id = raw.split('&')[0];
    const m = /^(al|ar|mf|pl)-([^_]+)/.exec(id);
    if (m) return { id: m[2], kind: m[1] as CoverSource['kind'] };
    const bare = id.split('_')[0];
    if (state.tracks[bare]) return { id: bare, kind: 'mf' };
    if (lib.albums.has(bare)) return { id: bare, kind: 'al' };
    if (lib.artists.has(bare)) return { id: bare, kind: 'ar' };
    if (state.playlists[bare]) return { id: bare, kind: 'pl' };
    return null;
};

const original = async (
    lib: Library,
    state: LibraryState,
    imagesDir: string,
    src: CoverSource,
): Promise<Buffer | null> => {
    const upload = (name?: string) =>
        name && existsSync(path.join(imagesDir, name))
            ? fs.readFile(path.join(imagesDir, name))
            : null;
    if (src.kind === 'mf') {
        const t = state.tracks[src.id];
        return t ? songCover(lib.folder, t) : null;
    }
    if (src.kind === 'al') {
        const al = lib.albums.get(src.id);
        return al ? albumCover(lib.folder, al.songs) : null;
    }
    if (src.kind === 'ar') {
        const up = await upload(state.images[src.id]);
        if (up) return up;
        const ar = lib.artists.get(src.id);
        const albumId =
            ar && [...(ar.stats.albumartist?.albums ?? ar.stats.maincredit?.albums ?? [])][0];
        const al = albumId ? lib.albums.get(albumId) : undefined;
        return al ? albumCover(lib.folder, al.songs) : null;
    }
    const p = state.playlists[src.id];
    if (!p) return null;
    const up = await upload(p.image);
    if (up) return up;
    const albums: string[] = [];
    for (const id of p.tracks) {
        const al = lib.albumOf.get(id);
        if (al && !albums.includes(al.id)) albums.push(al.id);
        if (albums.length === 4) break;
    }
    const covers = (
        await Promise.all(albums.map((id) => albumCover(lib.folder, lib.albums.get(id)!.songs)))
    ).filter((b) => b !== null) as Buffer[];
    if (!covers.length) return null;
    if (covers.length < 4) return covers[0];
    return collage(covers);
};

// What a cover's cache file depends on, so it is redrawn after a change.
const stamp = (lib: Library, state: LibraryState, src: CoverSource) => {
    if (src.kind === 'mf') return String(state.tracks[src.id]?.mtime);
    if (src.kind === 'al')
        return (
            lib.albums
                .get(src.id)
                ?.songs.map((t) => t.mtime)
                .join(',') ?? ''
        );
    if (src.kind === 'ar')
        return `${state.images[src.id] ?? ''}:${lib.artists.get(src.id)?.updatedAt ?? ''}`;
    const p = state.playlists[src.id];
    return `${p?.image ?? ''}:${p?.tracks.slice(0, 40).join(',') ?? ''}`;
};

export const getCover = async (
    lib: Library,
    state: LibraryState,
    dirs: { cache: string; images: string },
    src: CoverSource,
    size: number,
): Promise<null | { body: Buffer; type: string }> => {
    const key = hash(`${src.kind}:${src.id}:${stamp(lib, state, src)}:${size}`);
    const file = path.join(dirs.cache, `${key}.jpg`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return { body: cached, type: 'image/jpeg' };
    const img = await original(lib, state, dirs.images, src).catch(() => null);
    if (!img) return null;
    let body: Buffer = img;
    const ni = nativeImage.createFromBuffer(img);
    if (!ni.isEmpty()) {
        const { width } = ni.getSize();
        body =
            size > 0 && width > size
                ? ni.resize({ quality: 'good', width: size }).toJPEG(88)
                : ni.toJPEG(92);
    }
    mkdirSync(dirs.cache, { recursive: true });
    await fs.writeFile(file, body).catch(() => undefined);
    return { body, type: 'image/jpeg' };
};
