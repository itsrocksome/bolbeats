// BolBeats: reads the music folder into the library. Only new or changed files are read again (by size and time),
// .ndignore files hide songs, and a song that was moved or renamed keeps its id (and so its best parts and plays).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type AudioProperties, PROPERTIES, TagLib } from 'taglib-wasm';

import { ignoreMatcher, type LibraryState, newId, type Track, trackFromTags } from './model';

export const AUDIO = new Set([
    'aac',
    'aif',
    'aiff',
    'ape',
    'dsf',
    'flac',
    'm4a',
    'm4b',
    'mp3',
    'mp4',
    'mpc',
    'oga',
    'ogg',
    'opus',
    'wav',
    'wma',
    'wv',
]);

let taglib: null | Promise<TagLib> = null;
export const getTagLib = () => (taglib ??= TagLib.initialize());

// TagLib's camelCase names back to their wire names, lowercased ("albumArtist" -> "albumartist").
const WIRE: Record<string, string> = Object.fromEntries(
    Object.entries(PROPERTIES).map(([k, v]) => [
        k,
        String((v as { key: string }).key).toLowerCase(),
    ]),
);

export const readFileTags = async (abs: string) => {
    const tl = await getTagLib();
    const f = await tl.open(abs, { partial: true });
    try {
        const tags: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(f.properties()))
            if (v?.length) tags[WIRE[k] ?? k.toLowerCase()] = v;
        const audio = f.audioProperties() as AudioProperties | undefined;
        let hasCover = false;
        try {
            hasCover = f.getPictures().length > 0;
        } catch {
            hasCover = false;
        }
        return { audio: { ...audio, bitDepth: audio?.bitsPerSample }, hasCover, tags };
    } finally {
        f.dispose();
    }
};

type Found = { abs: string; birth: number; mtime: number; rel: string; size: number };

const walk = async (root: string) => {
    const files: Found[] = [];
    const ignores: { dir: string; text: string }[] = [];
    const visit = async (dir: string) => {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        const rel = path.relative(root, dir).split(path.sep).join('/');
        for (const e of entries) {
            if (e.name === '.ndignore') {
                ignores.push({
                    dir: rel,
                    text: await fs.readFile(path.join(dir, e.name), 'utf8').catch(() => ''),
                });
            }
        }
        for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) await visit(abs);
            else if (e.isFile() && AUDIO.has(path.extname(e.name).slice(1).toLowerCase())) {
                const st = await fs.stat(abs).catch(() => null);
                if (st)
                    files.push({
                        abs,
                        birth: st.birthtimeMs || st.mtimeMs,
                        mtime: Math.round(st.mtimeMs),
                        rel: path.relative(root, abs).split(path.sep).join('/'),
                        size: st.size,
                    });
            }
        }
    };
    await visit(root);
    const ignored = ignoreMatcher(ignores);
    return files.filter((f) => !ignored(f.rel));
};

const same = (
    a: Pick<Track, 'album' | 'artists' | 'duration' | 'title'>,
    b: Pick<Track, 'album' | 'artists' | 'duration' | 'title'>,
) =>
    a.title.toLowerCase() === b.title.toLowerCase() &&
    a.album.toLowerCase() === b.album.toLowerCase() &&
    a.artists.join('/').toLowerCase() === b.artists.join('/').toLowerCase() &&
    Math.abs(a.duration - b.duration) < 1;

export type ScanResult = {
    added: number;
    changed: number;
    count: number;
    folders: number;
    removed: number;
};

export const scanFolder = async (
    root: string,
    state: LibraryState,
    full = false,
): Promise<ScanResult> => {
    const files = await walk(root);
    const seen = new Set<string>();
    const gone = new Map(Object.values(state.tracks).map((t) => [t.id, t]));
    const fresh: Found[] = [];
    let changed = 0;
    for (const f of files) {
        const id = state.ids.song[f.rel];
        const old = id ? state.tracks[id] : undefined;
        if (old) gone.delete(old.id);
        if (!full && old && old.mtime === f.mtime && old.size === f.size) {
            seen.add(old.id);
            continue;
        }
        fresh.push(f);
    }
    let added = 0;
    for (const f of fresh) {
        let read;
        try {
            read = await readFileTags(f.abs);
        } catch {
            continue; // not a readable audio file
        }
        const t = trackFromTags(f, read.tags, read.audio, read.hasCover);
        let id = state.ids.song[f.rel];
        if (!id || !state.tracks[id]) {
            // moved or renamed: the same song that just disappeared from somewhere else keeps its id
            const moved = [...gone.values()].find((g) => g.mtime !== -1 && same(g, t));
            if (moved) {
                id = moved.id;
                gone.delete(moved.id);
            } else if (!id) {
                id = newId();
                added++;
            }
            state.ids.song[f.rel] = id;
        }
        const prev = state.tracks[id];
        if (prev && prev.mtime !== -1) changed++;
        state.tracks[id] = { ...t, createdAt: prev?.createdAt ?? new Date().toISOString(), id };
        seen.add(id);
    }
    for (const id of gone.keys()) delete state.tracks[id];
    for (const id of Object.keys(state.tracks)) if (!seen.has(id)) delete state.tracks[id];
    state.lastScan = new Date().toISOString();
    return {
        added,
        changed,
        count: Object.keys(state.tracks).length,
        folders: new Set(files.map((f) => path.dirname(f.rel))).size,
        removed: gone.size,
    };
};
