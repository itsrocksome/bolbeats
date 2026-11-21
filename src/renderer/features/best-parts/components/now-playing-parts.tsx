// BolBeats: the playing song's best parts, shown where you play it. A ring around the player cover (the whole song;
// the white arc is how far you are, the glowing arcs are its best parts), glowing marks on the progress bar, and a
// "Best part" button that jumps to the next one.
import clsx from 'clsx';
import { useMemo } from 'react';

import styles from './now-playing-parts.module.css';

import {
    type BestPart,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { usePlayerSong, usePlayerTimestamp } from '/@/renderer/store';

const useSongParts = () => {
    const song = usePlayerSong();
    const parts = useBestPartsStore((s) => s.parts);
    const mine = useMemo(
        () =>
            song
                ? Object.values(parts)
                      .filter((p) => p.songId === song.id)
                      .sort((a, b) => a.start - b.start)
                : [],
        [parts, song],
    );
    const seconds = song?.duration ? song.duration / 1000 : (mine[0]?.songDuration ?? 0);
    return { parts: mine, seconds };
};

const arc = (r: number, from: number, to: number) => {
    const a0 = from * 2 * Math.PI - Math.PI / 2;
    const a1 = Math.min(to, 0.9999) * 2 * Math.PI - Math.PI / 2;
    const p = (a: number) => `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`;
    return `M ${p(a0)} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${p(a1)}`;
};

// The whole song as a ring: white arc = how far you are (optional), glowing arcs = its best parts.
export const SongRing = ({
    className,
    parts,
    played,
    seconds,
}: {
    className?: string;
    parts: Pick<BestPart, 'end' | 'id' | 'start'>[];
    played?: number;
    seconds: number;
}) => (
    <svg aria-hidden="true" className={clsx(styles.ring, className)} viewBox="0 0 100 100">
        <circle className={styles.track} cx="50" cy="50" r="47" />
        {played != null && played > 0.002 && (
            <path className={styles.played} d={arc(47, 0, played)} />
        )}
        {parts.map((p) => (
            <path
                className={styles.part}
                d={arc(47, p.start / seconds, p.end / seconds)}
                key={p.id}
            />
        ))}
    </svg>
);

export const CoverRing = () => {
    const { parts, seconds } = useSongParts();
    const now = usePlayerTimestamp();
    if (!seconds) return null;
    return <SongRing parts={parts} played={Math.min(1, now / seconds)} seconds={seconds} />;
};

export const PartMarks = () => {
    const { parts, seconds } = useSongParts();
    if (!seconds || !parts.length) return null;
    return (
        <div aria-hidden="true" className={styles.marks}>
            {parts.map((p) => (
                <span
                    key={p.id}
                    style={{
                        left: `${(p.start / seconds) * 100}%`,
                        width: `${((p.end - p.start) / seconds) * 100}%`,
                    }}
                />
            ))}
        </div>
    );
};

const nextPart = (parts: BestPart[], now: number) =>
    parts.find((p) => p.start > now + 1) ?? parts[0];

export const JumpToPart = () => {
    const { parts } = useSongParts();
    const now = usePlayerTimestamp();
    const { mediaSeekToTimestamp } = usePlayer();
    if (!parts.length) return null;
    const inPart = parts.some((p) => now >= p.start && now <= p.end);
    return (
        <button
            aria-label="Jump to the next best part of this song"
            className={styles.jump}
            data-on={inPart || undefined}
            onClick={(e) => {
                e.stopPropagation();
                mediaSeekToTimestamp(nextPart(parts, now).start);
            }}
            type="button"
        >
            {inPart ? 'Best part' : 'Jump to best part'}
        </button>
    );
};
