// BolBeats: the Best parts library: every saved part, grouped by song, plus your part mixes.
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from '/@/renderer/features/best-parts/components/best-parts.module.css';
import {
    MadeForYouShelf,
    PlaylistCard,
    PlaylistsToConvert,
    TuneYourOwn,
} from '/@/renderer/features/best-parts/components/made-for-you';
import {
    Cover,
    facts,
    openPartEditor,
    openSongMenu,
    partLength,
    PartStrip,
    QuickKeys,
    SongMenuButton,
} from '/@/renderer/features/best-parts/components/shared';
import {
    playMixById,
    playParts,
    smartOrder,
    useMixPlayer,
} from '/@/renderer/features/best-parts/mix-player';
import {
    ALL_PARTS_MIX,
    type BestPart,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';

const mixRoute = (mixId: string) => generatePath(AppRoute.BEST_PARTS_MIX, { mixId });

const BestPartsRoute = () => {
    const navigate = useNavigate();
    const partMap = useBestPartsStore((s) => s.parts);
    const mixMap = useBestPartsStore((s) => s.mixes);
    const playing = useMixPlayer((s) => (s.status === 'idle' ? null : s.partIds[s.index]));
    const [picked, setPicked] = useState<Set<string>>(new Set());

    const parts = useMemo(() => Object.values(partMap), [partMap]);

    // Keep saved parts' titles and artists in step with the library (e.g. after fixing song details).
    useEffect(() => {
        allLibrarySongs().then((songs) => {
            const byId = new Map(songs.map((x) => [x.id, x]));
            for (const p of Object.values(useBestPartsStore.getState().parts)) {
                const song = byId.get(p.songId);
                if (
                    song &&
                    (song.name !== p.title ||
                        song.artistName !== p.artist ||
                        song.album !== p.album)
                ) {
                    useBestPartsStore.getState().savePart({
                        ...p,
                        album: song.album,
                        artist: song.artistName,
                        title: song.name,
                    });
                }
            }
        });
    }, []);
    const songs = useMemo(() => {
        const bySong = new Map<string, BestPart[]>();
        for (const p of parts) bySong.set(p.songId, [...(bySong.get(p.songId) ?? []), p]);
        return [...bySong.values()]
            .map((g) => g.sort((a, b) => a.start - b.start))
            .sort(
                (a, b) =>
                    Math.max(...b.map((p) => p.created)) - Math.max(...a.map((p) => p.created)),
            );
    }, [parts]);
    const mixes = useMemo(
        () =>
            Object.values(mixMap)
                .filter((m) => m.id !== ALL_PARTS_MIX)
                .sort((a, b) => b.created - a.created),
        [mixMap],
    );

    const toggle = (id: string) =>
        setPicked((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    const playAll = () => {
        const order = smartOrder(parts);
        const picks = mixMap[ALL_PARTS_MIX]?.picks ?? {};
        playParts(
            order.map((id) => partMap[id]),
            picks,
            { label: 'All best parts', mixId: ALL_PARTS_MIX },
        );
    };

    const newMix = () => {
        const chosen = parts.filter((p) => picked.has(p.id));
        const id = useBestPartsStore
            .getState()
            .createMix(`My best parts ${mixes.length + 1}`, smartOrder(chosen));
        setPicked(new Set());
        navigate(mixRoute(id));
    };

    if (!parts.length) {
        return (
            <AnimatedPage scroll>
                <section className={styles.empty}>
                    <Icon icon="bestParts" size="3xl" />
                    <h1>Keep only the parts you love</h1>
                    <Text isMuted>
                        Pick a playlist below and let BolBeats find the hook of every song, or
                        right-click any song and choose <b>Mark best parts</b>. While a song plays,
                        press B when your part starts and again when it ends.
                    </Text>
                    <PlaylistsToConvert />
                    <Button onClick={() => navigate(AppRoute.LIBRARY_SONGS)} variant="default">
                        Browse your tracks
                    </Button>
                </section>
            </AnimatedPage>
        );
    }

    return (
        <AnimatedPage scroll>
            <div className={styles.page}>
                <header className={styles.hero}>
                    <div>
                        <h1>Best parts</h1>
                        <Text isMuted>
                            {parts.length} parts from {songs.length} songs,{' '}
                            {formatClock(partLength(parts))} in total
                        </Text>
                    </div>
                    <div className={styles.actions}>
                        <Button
                            leftSection={<Icon icon="mediaPlay" />}
                            onClick={playAll}
                            size="md"
                            variant="filled"
                        >
                            Play all
                        </Button>
                        <Button
                            disabled={picked.size < 2}
                            leftSection={<Icon icon="add" />}
                            onClick={newMix}
                            size="md"
                            variant="default"
                        >
                            {picked.size < 2
                                ? 'Tick parts below to make a playlist'
                                : `New best-parts playlist (${picked.size} parts)`}
                        </Button>
                    </div>
                </header>

                <QuickKeys />
                <Text className={styles.tip} isMuted size="sm">
                    Press B while a song plays to mark a part. Give a best-parts playlist a quick
                    key (1-6) on its page to play it from anywhere.
                </Text>

                <h2 className={styles.sectionTitle}>Made for you</h2>
                <Text className={styles.sectionSub} isMuted size="sm">
                    Built from your parts, mixed so they flow. New picks every day.
                </Text>
                <MadeForYouShelf />
                <TuneYourOwn />

                <h2 className={styles.sectionTitle}>Your best-parts playlists</h2>
                <div className={styles.shelf}>
                    <PlaylistCard
                        mix={{ name: 'All best parts', partIds: songs.map((g) => g[0].id) }}
                        onOpen={() => navigate(mixRoute(ALL_PARTS_MIX))}
                        onPlay={playAll}
                        sub={`${parts.length} parts, smart order`}
                    />
                    {mixes.map((m) => {
                        const ps = m.partIds.map((id) => partMap[id]).filter(Boolean);
                        return (
                            <PlaylistCard
                                badge={m.sourcePlaylistId ? 'Playlist version' : undefined}
                                key={m.id}
                                mix={m}
                                onOpen={() => navigate(mixRoute(m.id))}
                                onPlay={() => playMixById(m.id)}
                                sub={`${ps.length} parts, ${formatClock(partLength(ps))}${m.auto ? ', picked by BolBeats' : ''}`}
                            />
                        );
                    })}
                </div>

                <PlaylistsToConvert
                    heading={
                        <>
                            <h2 className={styles.sectionTitle}>Make a best-parts version</h2>
                            <Text className={styles.sectionSub} isMuted size="sm">
                                Your playlists stay as they are; each gets a separate playlist of
                                just its best parts.
                            </Text>
                        </>
                    }
                />

                <h2 className={styles.sectionTitle}>All parts</h2>
                <ul className={styles.songs}>
                    {songs.map((g) => (
                        <li
                            className={styles.song}
                            key={g[0].songId}
                            onContextMenu={(e) => openSongMenu(g[0].songId, e)}
                        >
                            <Cover part={g[0]} />
                            <div className={styles.songMeta}>
                                <Text fw={600} truncate>
                                    {g[0].title}
                                </Text>
                                <Text isMuted size="sm" truncate>
                                    {g[0].artist || 'Unknown artist'}
                                </Text>
                                <PartStrip duration={g[0].songDuration} parts={g} />
                            </div>
                            <div className={styles.chips}>
                                {g.map((p, i) => (
                                    <span
                                        className={clsx(
                                            styles.partChip,
                                            playing === p.id && styles.isPlaying,
                                        )}
                                        key={p.id}
                                    >
                                        <Checkbox
                                            aria-label={`Select part ${i + 1} of ${p.title}`}
                                            checked={picked.has(p.id)}
                                            onChange={() => toggle(p.id)}
                                            size="xs"
                                        />
                                        <button
                                            className={styles.partPlay}
                                            onClick={() =>
                                                playParts(
                                                    [p],
                                                    {},
                                                    {
                                                        label: `${p.title}, part ${i + 1}`,
                                                        mixId: null,
                                                    },
                                                )
                                            }
                                            title={facts(p)}
                                            type="button"
                                        >
                                            <Icon icon="mediaPlay" size="sm" />
                                            {formatClock(p.start)}–{formatClock(p.end)}
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <span className={styles.songEdit}>
                                <ActionIcon
                                    aria-label={`Edit the best parts of ${g[0].title}`}
                                    icon="edit"
                                    onClick={() => openPartEditor(g[0])}
                                    tooltip={{ label: 'Edit parts' }}
                                    variant="subtle"
                                />
                                <SongMenuButton songId={g[0].songId} title={g[0].title} />
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </AnimatedPage>
    );
};

const BestPartsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <BestPartsRoute />
    </PageErrorBoundary>
);

export default BestPartsRouteWithBoundary;
