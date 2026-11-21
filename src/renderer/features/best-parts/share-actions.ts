import type { TransitionType } from '/@/renderer/features/best-parts/engine/engine';

// BolBeats: send a best-parts playlist as a .bolbeats file, and open one someone sent you: each part is matched to your
// own copy of the song (title + artist, length within a few seconds) and the playlist is built again from those.
// Side-effect import in app.tsx: files opened from Finder or AirDrop arrive here.
import { nanoid } from 'nanoid/non-secure';

import { analyzeBuffer, decodeSong, slice } from '/@/renderer/features/best-parts/mix-player';
import {
    readSharedMix,
    type SharedMix,
    shareFileName,
    toSharedMix,
} from '/@/renderer/features/best-parts/share-mix';
import {
    ALL_PARTS_MIX,
    type BestPart,
    partsOfSong,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { songFinder } from '/@/renderer/features/bolify-folder/relink';
import { mixCoverKey, useCovers } from '/@/renderer/features/covers/covers.store';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { useLocalLibrary } from '/@/renderer/features/local-library/connect-local-library';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { toast } from '/@/shared/components/toast/toast';

const fileFor = (mixId: string) => {
    const { mixes, parts } = useBestPartsStore.getState();
    const mix = mixes[mixId];
    if (!mix) return null;
    const list = mix.partIds.map((id) => parts[id]).filter(Boolean);
    const shared = toSharedMix(
        mixId === ALL_PARTS_MIX ? 'All my best parts' : mix.name,
        list.map((p) => ({ ...p, seconds: p.songDuration })),
        mix.picks,
        useCovers.getState().covers[mixCoverKey(mixId)]?.dataUrl,
    );
    return { content: JSON.stringify(shared), name: shareFileName(shared.name) };
};

// how = 'share': the macOS share menu (AirDrop, Messages, Mail...); 'save': choose where to keep the file
export const shareMix = async (mixId: string, how: 'save' | 'share') => {
    const f = fileFor(mixId);
    if (!f) return;
    try {
        if (how === 'share') await window.api.bolifyFolder.mixShare(f.name, f.content);
        else {
            const where = await window.api.bolifyFolder.mixSave(f.name, f.content);
            if (where)
                toast.success({
                    message: `Saved as ${f.name}. Whoever opens it in BolBeats gets this playlist, built from their own songs.`,
                    title: 'Playlist file saved',
                });
        }
    } catch (e) {
        toast.error({ message: (e as Error).message, title: 'Couldn’t share the playlist' });
    }
};

// Builds the shared playlist from your songs. Returns the new playlist's id, or null.
export const importSharedMix = async (raw: string) => {
    const shared: null | SharedMix = readSharedMix(raw);
    if (!shared) {
        toast.error({
            message: 'This file isn’t a BolBeats playlist, or it’s damaged.',
            title: 'Couldn’t open it',
        });
        return null;
    }
    toast.info({ message: `Finding its songs in your library…`, title: `Opening ${shared.name}` });
    const songs = await allLibrarySongs();
    const find = songFinder(songs, useLocalLibrary.getState().folder);
    const ids: string[] = [];
    const missing = new Set<string>();
    for (const p of shared.parts) {
        const want = { artist: p.artist, path: '', seconds: p.seconds, title: p.title };
        // a slightly different copy of the song (a few seconds longer or shorter) still counts if it's the only one
        const loose = find({ ...want, seconds: 0 });
        const song =
            find(want) ??
            (loose && Math.abs(loose.duration / 1000 - p.seconds) <= 10 ? loose : undefined);
        if (!song) {
            missing.add(p.artist ? `${p.title} (${p.artist})` : p.title);
            ids.push('');
            continue;
        }
        const same = partsOfSong(song.id).find(
            (x) => Math.abs(x.start - p.start) < 1 && Math.abs(x.end - p.end) < 1,
        );
        if (same) {
            ids.push(same.id);
            continue;
        }
        try {
            const buf = await decodeSong(song.id);
            const end = Math.min(p.end, buf.duration);
            if (end - p.start < 3) throw new Error('past the end of your copy');
            const full = songs.find((s) => s.id === song.id);
            const part: BestPart = {
                album: full?.album ?? p.album,
                analysis: analyzeBuffer(slice(buf, p.start, end)),
                artist: full?.artistName ?? p.artist,
                auto: false, // someone picked it by hand or by ear: BolBeats' finder leaves it alone
                created: Date.now(),
                end,
                id: nanoid(),
                imageUrl: full?.imageUrl ?? null,
                songDuration: buf.duration,
                songId: song.id,
                start: p.start,
                title: full?.name ?? p.title,
            };
            useBestPartsStore.getState().savePart(part);
            ids.push(part.id);
        } catch {
            missing.add(p.artist ? `${p.title} (${p.artist})` : p.title);
            ids.push('');
        }
    }
    const kept = ids.filter(Boolean);
    if (!kept.length) {
        toast.error({
            message: `None of its ${shared.parts.length} songs are in your library.`,
            title: `Couldn’t build ${shared.name}`,
        });
        return null;
    }
    const store = useBestPartsStore.getState();
    const mixId = store.createMix(shared.name, kept);
    // the joins they chose, where both neighbours made it
    const picks: Record<string, string> = {};
    for (const [k, type] of Object.entries(shared.joins)) {
        const [a, b] = k.split('>').map(Number);
        if (ids[a] && ids[b]) picks[`${ids[a]}>${ids[b]}`] = type;
    }
    store.updateMix(mixId, { picks: picks as Record<string, TransitionType> });
    if (shared.cover)
        useCovers
            .getState()
            .setCover(mixCoverKey(mixId), { dataUrl: shared.cover, kind: 'picture' });
    const gone = [...missing];
    toast.success({
        message: gone.length
            ? `${kept.length} of ${shared.parts.length} parts. Not in your library: ${gone.slice(0, 4).join(', ')}${gone.length > 4 ? ` and ${gone.length - 4} more` : ''}.`
            : `All ${kept.length} parts, from your own songs.`,
        title: `${shared.name} is in your best-parts playlists`,
    });
    window.location.hash = `#/best-parts/${mixId}`;
    return mixId;
};

export const openSharedMixFile = async () => {
    try {
        const raw = await window.api.bolifyFolder.mixOpen();
        if (raw) await importSharedMix(raw);
    } catch (e) {
        toast.error({ message: (e as Error).message, title: 'Couldn’t open it' });
    }
};

// Files opened from Finder or AirDrop: wait for the library and your saved parts, then build them.
const ready = () =>
    new Promise<void>((resolve) => {
        const check = () =>
            useAuthStore.getState().currentServer && useBestPartsStore.persist.hasHydrated()
                ? resolve()
                : setTimeout(check, 500);
        check();
    });
if (window.api?.bolifyFolder?.onMixOpened) {
    window.api.bolifyFolder.onMixOpened((raw) => ready().then(() => importSharedMix(raw)));
    ready()
        .then(() => window.api.bolifyFolder.mixWaiting())
        .then(async (all) => {
            for (const raw of all) await importSharedMix(raw); // one at a time
        });
}
