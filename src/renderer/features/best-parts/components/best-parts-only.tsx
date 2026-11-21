// BolBeats: "Best parts only". While it's on, whatever plays (an album, an artist, search, the queue) plays just each
// song's best parts and then moves on to the next song. A song you haven't made parts for gets them found on the fly
// (about half a second) and remembered, without adding them to your Best parts; the next song is prepared ahead.
// Drag somewhere outside a part and BolBeats lets you listen there until the song changes.
import { useEffect, useRef, useState } from 'react';
import { createWithEqualityFn } from 'zustand/traditional';

import styles from './now-playing-parts.module.css';

import { suggestHooksAsync } from '/@/renderer/features/best-parts/engine/hook-async';
import { decodeSong } from '/@/renderer/features/best-parts/mix-player';
import { partsOfSong } from '/@/renderer/features/best-parts/store/best-parts.store';
import {
    disliked,
    heardPart,
    learnedTaste,
    skippedPart,
} from '/@/renderer/features/best-parts/store/taste.store';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    usePlayerSong,
    usePlayerStatus,
    usePlayerStoreBase,
    usePlayerTimestamp,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus } from '/@/shared/types/types';

const ON = 'hookline_best_parts_only';
const FOUND = 'hookline_found_ranges_v2'; // song id -> parts found for playing (not your Best parts); v2: 25 s+ parts

const read = <T,>(key: string, fallback: T): T => {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
        return fallback;
    }
};
const write = (key: string, value: unknown) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage full or blocked: found parts are just found again
    }
};

export const useBestPartsOnly = createWithEqualityFn<{ on: boolean }>(() => ({
    on: read(ON, false),
}));

export const toggleBestPartsOnly = () => {
    const on = !useBestPartsOnly.getState().on;
    useBestPartsOnly.setState({ on });
    write(ON, on);
    toast.info({
        message: on
            ? 'Every song plays just its best parts, then the next song.'
            : 'Songs play in full again.',
        title: on ? 'Best parts only' : 'Full songs',
    });
};

type Range = [number, number];
try {
    localStorage.removeItem('hookline_found_ranges'); // BolBeats: the cache from before 25 s parts
} catch {
    // storage blocked
}
const found: Record<string, Range[]> = read(FOUND, {});
const finding = new Map<string, Promise<Range[]>>();

const rangesFor = (songId: string): Promise<Range[]> => {
    // BolBeats: parts you've given a thumbs down (or keep skipping) are left out; none left means the whole song
    const all = partsOfSong(songId);
    const mine = all.filter((p) => !disliked(p.id));
    if (all.length) return Promise.resolve(mine.map((p) => [p.start, p.end]));
    if (found[songId]) return Promise.resolve(found[songId]);
    let job = finding.get(songId);
    if (!job) {
        job = decodeSong(songId)
            .then((buf) => suggestHooksAsync(buf, 22, learnedTaste().minPart ?? undefined))
            .then((r) => {
                const sorted = [...r].sort(([a], [b]) => a - b);
                found[songId] = sorted;
                const keys = Object.keys(found);
                for (const k of keys.slice(0, Math.max(0, keys.length - 3000))) delete found[k]; // keep the newest 3000
                write(FOUND, found);
                return sorted;
            })
            .finally(() => finding.delete(songId));
        finding.set(songId, job);
    }
    return job;
};

export const BestPartsOnly = () => {
    const on = useBestPartsOnly((s) => s.on);
    const song = usePlayerSong();
    const now = usePlayerTimestamp();
    const status = usePlayerStatus();
    const { mediaNext, mediaSeekToTimestamp } = usePlayer();
    const [ranges, setRanges] = useState<null | { id: string; parts: Range[] }>(null);
    // where we are: 'start' = not in a part yet, a number = inside that part, 'free' = you moved outside the parts,
    // 'leaving' = asked for the next song (wait for it; asking twice would skip a song)
    const where = useRef<{
        at: 'free' | 'leaving' | 'start' | number;
        half?: number; // the playing saved part's halfway point, and where it got to (for learning your taste)
        id: string;
        last?: number;
        part?: string;
        seekedAt: number;
        since: number;
    }>({
        at: 'start',
        id: '',
        seekedAt: 0,
        since: 0,
    });

    useEffect(() => {
        if (!on || !song?.id || !song.duration) return;
        let alive = true;
        rangesFor(song.id)
            .then((parts) => alive && setRanges({ id: song.id, parts }))
            .catch(() => alive && setRanges({ id: song.id, parts: [] }));
        const next = usePlayerStoreBase.getState().getPlayerData().nextSong;
        const early = next?.id
            ? setTimeout(() => rangesFor(next.id).catch(() => {}), 4000)
            : undefined;
        return () => {
            alive = false;
            clearTimeout(early);
        };
    }, [on, song?.id, song?.duration]);

    useEffect(() => {
        const w = where.current;
        // a new queue entry, or the song started again from the top: find its first part again
        const entry = song ? `${song._uniqueId ?? ''}|${song.id}` : '';
        // you moved on before a saved part's halfway point: a skip, which teaches BolBeats
        if (entry !== w.id && typeof w.at === 'number' && w.part && (w.last ?? 0) < (w.half ?? 0))
            skippedPart(w.part);
        if (entry !== w.id || (now < 1 && w.at !== 'start'))
            Object.assign(w, {
                at: 'start',
                id: entry,
                part: undefined,
                seekedAt: 0,
                since: performance.now(),
            });
        // just after a song changes the player still reports the old song's position for a moment: wait for it
        if (now > 3 && performance.now() - w.since < 1500) return;
        if (!on || !song || status !== PlayerStatus.PLAYING || w.at === 'leaving') return;
        if (ranges?.id !== song.id || !ranges.parts.length) return;
        const parts = ranges.parts;
        const settling = performance.now() - w.seekedAt < 1500; // our own seek hasn't landed yet
        const inside = parts.findIndex(([a, z]) => now >= a - 0.4 && now < z - 0.4);
        const enter = (i: number) => {
            const [a, z] = parts[i];
            w.at = i;
            w.half = (a + z) / 2;
            w.part = partsOfSong(song.id).find(
                (p) => Math.abs(p.start - a) < 0.5 && Math.abs(p.end - z) < 0.5,
            )?.id;
        };
        const go = (to: number | undefined) => {
            w.seekedAt = performance.now();
            if (to !== undefined) return mediaSeekToTimestamp(to);
            w.at = 'leaving';
            mediaNext(false);
        };
        if (typeof w.at === 'number') {
            const [, z] = parts[w.at];
            if (inside === w.at) {
                w.last = now;
                return;
            }
            if (now >= z - 0.4 && now < z + 3) {
                // this part is over: the next part, or the next song
                if (w.part) heardPart(w.part);
                const next = parts[w.at + 1];
                Object.assign(w, { at: 'start', part: undefined });
                return go(next?.[0]);
            }
            if (inside >= 0)
                enter(inside); // you moved
            else Object.assign(w, { at: 'free', part: undefined });
            return;
        }
        if (inside >= 0) {
            enter(inside);
            return;
        }
        if (w.at === 'start' && !settling) {
            const ahead = parts.find(([a]) => a > now - 0.4);
            go(ahead?.[0]);
        }
    }, [mediaNext, mediaSeekToTimestamp, now, on, ranges, song, status]);

    return (
        <button
            aria-label="Best parts only"
            aria-pressed={on}
            className={styles.jump}
            data-on={on || undefined}
            onClick={(e) => {
                e.stopPropagation();
                toggleBestPartsOnly();
            }}
            title={
                on
                    ? 'Every song plays just its best parts. Click to hear full songs.'
                    : 'Play just the best parts of every song'
            }
            type="button"
        >
            {on ? 'Best parts only' : 'Full songs'}
        </button>
    );
};
