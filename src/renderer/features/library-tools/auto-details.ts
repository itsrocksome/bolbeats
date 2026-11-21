// BolBeats: fills in missing song details by itself. Songs with no artist or album are looked up online (only the song
// and artist names leave the Mac); a clear match is written into the file with its cover (the original is backed up
// first and can be put back from Your library); anything less sure waits for you in Your library > Song details.
// Songs that have their details but still show the server's stand-in picture get just a cover, the same careful way.
// Runs a little after launch and whenever new songs arrive. An unsure match is asked about again after a week; no
// answer at all (offline, a busy service) is retried the next day.
import { createWithEqualityFn } from 'zustand/traditional';

import { coverUrl } from '/@/renderer/features/best-parts/utils';
import {
    isSure,
    lookUpByTags,
    lookUpSong,
    SURE,
    writeCover,
    writeDetails,
} from '/@/renderer/features/library-tools/details';
import {
    allLibrarySongs,
    fileName,
    needsDetails,
} from '/@/renderer/features/library-tools/library-songs';
import { rescanLibrary } from '/@/renderer/features/local-library/connect-local-library';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { loadsAsPlaceholder } from '/@/shared/components/image/server-placeholder';
import { toast } from '/@/shared/components/toast/toast';

export type AutoFix = {
    artist: string;
    backup: string;
    file: string;
    path: string;
    title: string;
    what?: 'cover';
    when: number;
};
type Saved = { fixed: AutoFix[]; on: boolean; tried: Record<string, number> }; // tried: path -> don't ask again before

const KEY = 'hookline_auto_details';
const DAY = 86_400_000;

const load = (): Saved => {
    try {
        return { fixed: [], on: true, tried: {}, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
        return { fixed: [], on: true, tried: {} };
    }
};

export const useAutoDetails = createWithEqualityFn<Saved & { running: boolean }>(() => ({
    ...load(),
    running: false,
}));

const save = () => {
    const { fixed, on, tried } = useAutoDetails.getState();
    try {
        localStorage.setItem(KEY, JSON.stringify({ fixed: fixed.slice(0, 50), on, tried }));
    } catch {
        // storage full or blocked; the next run just looks up again
    }
};

export const runAutoDetails = async () => {
    const st = useAutoDetails.getState();
    if (!st.on || st.running || !useAuthStore.getState().currentServer) return;
    useAutoDetails.setState({ running: true });
    const now: AutoFix[] = [];
    try {
        const songs = (await allLibrarySongs()).filter(
            (s) => s.path && needsDetails(s) && Date.now() >= (st.tried[s.path] ?? 0),
        );
        for (const song of songs) {
            if (!useAutoDetails.getState().on) break;
            const cands = await lookUpSong(song);
            // unsure only counts once MusicBrainz has answered too; iTunes alone misses soundtracks and regional songs
            const next = Date.now() + (cands.some((c) => c.source === 'MusicBrainz') ? 7 : 1) * DAY;
            useAutoDetails.setState((s) => ({ tried: { ...s.tried, [song.path!]: next } }));
            if (!isSure(cands)) continue;
            const backup = await window.api.onlineLookup.backupFiles([song.path!]);
            if (await writeDetails(song, cands[0])) {
                now.push({
                    artist: cands[0].artist,
                    backup,
                    file: fileName(song),
                    path: song.path!,
                    title: cands[0].title,
                    when: Date.now(),
                });
            }
        }
        await addCovers(now);
        if (now.length) {
            useAutoDetails.setState((s) => ({ fixed: [...now, ...s.fixed] }));
            await rescanLibrary();
            const covers = now.filter((f) => f.what === 'cover').length;
            toast.success({
                message: `${now.map((f) => `${f.title} by ${f.artist}`).join(', ')}. You can undo this in Your library.`,
                title:
                    covers === now.length
                        ? `Cover added to ${covers} ${covers === 1 ? 'song' : 'songs'}`
                        : now.length === 1
                          ? 'Song details filled in'
                          : `Details filled in for ${now.length} songs`,
            });
        }
    } catch {
        // offline or the lookup failed; try again next time
    } finally {
        useAutoDetails.setState({ running: false });
        save();
    }
};

// Songs with their details but the server's stand-in cover: look up by title and artist, embed a sure match's cover.
// At most 200 covers are checked per run (each check is one small local image), each song once a month.
const addCovers = async (now: AutoFix[]) => {
    const key = (p: string) => `cover:${p}`;
    const songs = (await allLibrarySongs())
        .filter(
            (s) =>
                s.path &&
                !needsDetails(s) &&
                Date.now() >= (useAutoDetails.getState().tried[key(s.path)] ?? 0),
        )
        .slice(0, 200);
    for (const song of songs) {
        if (!useAutoDetails.getState().on) break;
        const url = coverUrl(song.id);
        const placeholder = url ? await loadsAsPlaceholder(url) : false;
        if (!placeholder) {
            useAutoDetails.setState((s) => ({
                tried: { ...s.tried, [key(song.path!)]: Date.now() + 30 * DAY },
            }));
            continue;
        }
        const cands = await lookUpByTags(song);
        // any sure match's cover will do (one picture can be missing from its archive); if none downloads, retry tomorrow
        const urls = isSure(cands)
            ? cands.filter((c) => c.artworkUrl && c.score >= SURE).map((c) => c.artworkUrl!)
            : [];
        let added = false;
        if (urls.length) {
            const backup = await window.api.onlineLookup.backupFiles([song.path!]);
            for (const u of urls) if ((added = await writeCover(song, u).catch(() => false))) break;
            if (added)
                now.push({
                    artist: song.artistName,
                    backup,
                    file: fileName(song),
                    path: song.path!,
                    title: song.name,
                    what: 'cover',
                    when: Date.now(),
                });
        }
        const days = added
            ? 30
            : urls.length
              ? 1
              : cands.some((c) => c.source === 'MusicBrainz')
                ? 7
                : 1;
        useAutoDetails.setState((s) => ({
            tried: { ...s.tried, [key(song.path!)]: Date.now() + days * DAY },
        }));
    }
};

export const setAutoDetails = (on: boolean) => {
    useAutoDetails.setState({ on });
    save();
    if (on) runAutoDetails();
};

// Puts the original file back, and never changes that file on its own again.
export const undoAutoFix = async (fix: AutoFix) => {
    await window.api.onlineLookup.restoreBackupFile(fix.backup, fix.path);
    const key = fix.what === 'cover' ? `cover:${fix.path}` : fix.path;
    useAutoDetails.setState((s) => ({
        fixed: s.fixed.filter((f) => f !== fix),
        tried: { ...s.tried, [key]: Number.MAX_SAFE_INTEGER },
    }));
    save();
    await rescanLibrary();
};

// Dev builds share your real music folder, so only the installed app changes files on its own.
if (!import.meta.env.DEV) {
    setTimeout(runAutoDetails, 12_000);
    window.addEventListener('bolbeats:library-changed', () => setTimeout(runAutoDetails, 3000));
}
