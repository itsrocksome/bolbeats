// BolBeats: small pieces shared by the best-parts pages.
import { openContextModal } from '@mantine/modals';
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import styles from './best-parts.module.css';

import { api } from '/@/renderer/api';
import { keyName } from '/@/renderer/features/best-parts/engine/engine';
import {
    mixElapsed,
    playMixById,
    skipMixPart,
    stopMix,
    toggleMixPause,
    useMixPlayer,
} from '/@/renderer/features/best-parts/mix-player';
import {
    type BestPart,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { coverUrl, formatClock } from '/@/renderer/features/best-parts/utils';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useCovers } from '/@/renderer/features/covers/covers.store';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Select } from '/@/shared/components/select/select';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem, type Song } from '/@/shared/types/domain-types';

// Enough of a Song for the editor; it only reads these fields.
const songOf = (p: BestPart) =>
    ({
        _itemType: LibraryItem.SONG,
        album: p.album,
        artistName: p.artist,
        duration: p.songDuration * 1000,
        id: p.songId,
        imageUrl: p.imageUrl,
        name: p.title,
    }) as Song;

export const openPartEditor = (p: BestPart, mixId?: string) =>
    openContextModal({
        innerProps: { mixId, song: songOf(p) },
        modal: 'bestParts',
        size: 'xl',
        title: `Best parts of “${p.title}”`,
    });

// The full song menu (play next, add to queue, add to playlist, go to album, best-part actions) for a part's song,
// from a visible ⋯ button or a right-click on the row.
export const openSongMenu = async (songId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return;
    const song = await api.controller
        .getSongDetail({ apiClientProps: { serverId }, query: { id: songId } })
        .catch(() => null);
    if (!song) {
        toast.error({ message: 'This song isn’t in your library any more.' });
        return;
    }
    ContextMenuController.call({ cmd: { items: [song], type: LibraryItem.SONG }, event });
};

export const SongMenuButton = ({ songId, title }: { songId: string; title: string }) => (
    <ActionIcon
        aria-label={`More options for ${title}`}
        icon="ellipsisHorizontal"
        onClick={(e) => openSongMenu(songId, e)}
        tooltip={{ label: 'More options' }}
        variant="subtle"
    />
);

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export const Cover = ({
    className,
    part,
}: {
    className?: string;
    part: Pick<BestPart, 'songId' | 'title'>;
}) => {
    const [failed, setFailed] = useState(false);
    const src = coverUrl(part.songId);
    if (src && !failed)
        return (
            <img
                alt=""
                className={clsx(styles.cover, className)}
                onError={() => setFailed(true)}
                src={src}
            />
        );
    return (
        <span
            aria-hidden
            className={clsx(styles.cover, styles.coverFallback, className)}
            style={{ ['--h' as string]: hue(part.title) }}
        >
            {part.title.trim()[0] ?? '♪'}
        </span>
    );
};

// 2x2 cover collage; 2-3 songs still fill it by repeating covers.
export const Collage = ({ className, parts }: { className?: string; parts: BestPart[] }) => (
    <span className={clsx(styles.collage, parts.length < 2 && styles.single, className)}>
        {(parts.length < 2 ? parts : [0, 1, 2, 3].map((i) => parts[i % parts.length])).map(
            (p, i) => (
                <Cover key={`${p.id}-${i}`} part={p} />
            ),
        )}
    </span>
);

// A best-parts playlist's cover: a lit poster with its name, never an album cover, so playlists read as playlists.
export const Poster = ({
    badge,
    className,
    coverKey,
    name,
    parts,
}: {
    badge?: string;
    className?: string;
    coverKey?: string;
    name: string;
    parts: Pick<BestPart, 'id' | 'songId' | 'title'>[];
}) => {
    const songs = [...new Map(parts.map((p) => [p.songId, p])).values()].slice(0, 3);
    const custom = useCovers((s) => (coverKey ? s.covers[coverKey] : undefined)); // Change cover…
    if (custom) {
        return (
            <span className={clsx(styles.poster, styles.posterCustom, className)}>
                <img alt="" src={custom.dataUrl} />
                {badge && <span className={styles.posterBadge}>{badge}</span>}
            </span>
        );
    }
    return (
        <span className={clsx(styles.poster, className)} style={{ ['--h' as string]: hue(name) }}>
            <span className={styles.posterCovers}>
                {songs.map((p) => (
                    <Cover key={p.id} part={p} />
                ))}
            </span>
            {badge && <span className={styles.posterBadge}>{badge}</span>}
            <b>{name}</b>
            <i aria-hidden className={styles.posterBulbs} />
        </span>
    );
};

// A song-length bar with each best part marked like a highlighter stroke.
export const PartStrip = ({ duration, parts }: { duration: number; parts: BestPart[] }) => (
    <span className={styles.strip}>
        {parts.map((p) => (
            <i
                key={p.id}
                style={{
                    left: `${(p.start / duration) * 100}%`,
                    width: `${((p.end - p.start) / duration) * 100}%`,
                }}
            />
        ))}
    </span>
);

export const facts = (p: BestPart) =>
    `${Math.round(p.analysis.bpm)} BPM, ${keyName(p.analysis.key)}`;
export const partLength = (parts: BestPart[]) => parts.reduce((s, p) => s + p.end - p.start, 0);

// Elapsed time of the playing mix, ticking in state (the React Compiler would cache a plain mixElapsed() call).
const useMixElapsed = () => {
    const s = useMixPlayer();
    const [e, setElapsed] = useState(0);
    useEffect(() => {
        setElapsed(mixElapsed());
        if (s.status !== 'playing') return;
        const t = setInterval(() => setElapsed(mixElapsed()), 250);
        return () => clearInterval(t);
    }, [s.status, s.t0]);
    return e;
};

const MixProgress = ({ e }: { e: number }) => {
    const s = useMixPlayer();
    return (
        <div className={styles.mixProgress}>
            <span>{formatClock(e)}</span>
            <span className={styles.progress}>
                <span style={{ width: `${s.total ? (e / s.total) * 100 : 0}%` }} />
                {s.seams.map((x, i) => (
                    <b key={i} style={{ left: `${(x / s.total) * 100}%` }} />
                ))}
            </span>
            <span>{formatClock(s.total)}</span>
        </div>
    );
};

// BolBeats: while a best-parts playlist plays, the app's player bar shows it (one player, not two): the part playing,
// previous / play-pause / next part / stop, and the mix's timeline with a tick at every join.
export const MixBarNow = () => {
    const s = useMixPlayer();
    const parts = useBestPartsStore((st) => st.parts);
    const cur = parts[s.partIds[Math.max(0, s.index)]];
    const loading = s.status === 'loading';
    return (
        <div className={styles.barNow}>
            {cur && <Cover className={styles.barCover} part={cur} />}
            <div className={styles.songMeta}>
                <Text fw={600} truncate>
                    {loading ? 'Preparing…' : (cur?.title ?? s.label)}
                </Text>
                <Text isMuted size="sm" truncate>
                    {cur?.artist ? `${cur.artist} · ` : ''}
                    {s.label}
                    {!loading && s.partIds.length > 1
                        ? `, part ${s.offset + s.index + 1} of ${s.offset + s.partIds.length}`
                        : ''}
                </Text>
            </div>
        </div>
    );
};

export const MixBarControls = () => {
    const s = useMixPlayer();
    const e = useMixElapsed();
    const loading = s.status === 'loading';
    return (
        <div aria-label="Best-parts player" className={styles.barCenter} role="region">
            <div className={styles.barButtons}>
                <ActionIcon
                    disabled={loading || s.preview}
                    icon="mediaPrevious"
                    onClick={() => skipMixPart(-1)}
                    tooltip={{ label: 'Previous part' }}
                    variant="subtle"
                />
                <ActionIcon
                    disabled={loading}
                    icon={s.status === 'playing' ? 'mediaPause' : 'mediaPlay'}
                    onClick={toggleMixPause}
                    radius="xl"
                    size="lg"
                    tooltip={{ label: s.status === 'playing' ? 'Pause' : 'Resume' }}
                    variant="filled"
                />
                <ActionIcon
                    disabled={loading || s.preview}
                    icon="mediaNext"
                    onClick={() => skipMixPart(1)}
                    tooltip={{ label: 'Next part' }}
                    variant="subtle"
                />
                <ActionIcon
                    icon="mediaStop"
                    onClick={stopMix}
                    tooltip={{ label: 'Stop the best parts' }}
                    variant="subtle"
                />
            </div>
            <MixProgress e={e} />
        </div>
    );
};

// The playing part, big, for the side of a best-parts playlist page.
export const NowPlaying = ({ mixId }: { mixId: string }) => {
    const s = useMixPlayer();
    const parts = useBestPartsStore((st) => st.parts);
    const e = useMixElapsed();
    if (s.mixId !== mixId || s.status === 'idle') return null;
    const cur = parts[s.partIds[Math.max(0, s.index)]];
    const next = parts[s.partIds[s.index + 1]];
    const into = cur && s.status !== 'loading' ? Math.max(0, e - (s.at[s.index] ?? 0)) : 0;
    const len = cur ? cur.end - cur.start : 1;
    return (
        <section aria-label="Now playing" className={styles.nowPlaying}>
            <Text className={styles.nowLabel} size="sm">
                {s.status === 'loading'
                    ? 'Getting the parts ready…'
                    : s.preview
                      ? 'Previewing a join'
                      : 'Now playing'}
            </Text>
            {cur && (
                <>
                    <Cover className={styles.nowCover} part={cur} />
                    <div className={styles.songMeta}>
                        <Text fw={700} truncate>
                            {cur.title}
                        </Text>
                        <Text isMuted size="sm" truncate>
                            {cur.artist}
                        </Text>
                        <Text isMuted size="sm">
                            {formatClock(cur.start)}–{formatClock(cur.end)} of the song
                        </Text>
                    </div>
                    <span className={styles.partProgress}>
                        <span style={{ width: `${Math.min(100, (into / len) * 100)}%` }} />
                    </span>
                    <Text className={styles.nowNext} isMuted size="sm" truncate>
                        Part {s.offset + s.index + 1} of {s.offset + s.partIds.length}
                        {next ? `. Up next: ${next.title}` : '. Last part'}
                    </Text>
                </>
            )}
        </section>
    );
};

// Quick keys: press 1-6 anywhere to play the best-parts playlist on that key. Set from a playlist's page.
export const QuickKeys = () => {
    const presets = useBestPartsStore((s) => s.presets);
    const mixes = useBestPartsStore((s) => s.mixes);
    const set = presets
        .map((id, i) => [i, id ? mixes[id] : undefined] as const)
        .filter(([, m]) => m);
    if (!set.length) return null;
    return (
        <div aria-label="Quick keys" className={styles.quickKeys} role="group">
            <Text isMuted size="sm">
                Quick keys, press the number anywhere:
            </Text>
            {set.map(([i, mix]) => (
                <span className={styles.quickKey} key={i}>
                    <button
                        onClick={() => playMixById(mix!.id)}
                        title={`Play ${mix!.name}`}
                        type="button"
                    >
                        <b>{i + 1}</b> {mix!.name}
                    </button>
                    <ActionIcon
                        aria-label={`Clear key ${i + 1}`}
                        icon="x"
                        onClick={() => useBestPartsStore.getState().setPreset(i, null)}
                        size="sm"
                        tooltip={{ label: `Clear key ${i + 1}` }}
                        variant="subtle"
                    />
                </span>
            ))}
        </div>
    );
};

export const QuickKeySelect = ({ mixId }: { mixId: string }) => {
    const presets = useBestPartsStore((s) => s.presets);
    const mixes = useBestPartsStore((s) => s.mixes);
    const mine = presets.indexOf(mixId);
    return (
        <Select
            allowDeselect={false}
            aria-label="Quick key"
            data={[
                { label: 'No quick key', value: '-1' },
                ...presets.map((id, i) => ({
                    label: `Key ${i + 1}${id && id !== mixId && mixes[id] ? ` (now ${mixes[id].name})` : ''}`,
                    value: String(i),
                })),
            ]}
            description="Press the number anywhere in BolBeats to play this."
            label="Quick key"
            onChange={(v) => {
                const k = Number(v);
                if (k < 0) useBestPartsStore.getState().setPreset(mine, null);
                else useBestPartsStore.getState().setPreset(k, mixId);
            }}
            size="xs"
            value={String(mine)}
        />
    );
};
