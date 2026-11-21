import type { Song } from '/@/shared/types/domain-types';
import type { ArtistRelease } from '/@/shared/types/online-lookup';

// BolBeats: Home, "for you". A daily page built on this Mac from what you play and when: the hook of the day,
// best-parts playlists made for you, a listening streak, your songs for this time of day, playlists from your
// library, and new releases. Nothing about your listening leaves the Mac.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { generatePath, Link, useNavigate } from 'react-router';

import styles from './for-you.module.css';

import { api } from '/@/renderer/api';
import {
    MadeForYouShelf,
    PlaylistsToConvert,
    TuneYourOwn,
} from '/@/renderer/features/best-parts/components/made-for-you';
import { SongRing } from '/@/renderer/features/best-parts/components/now-playing-parts';
import {
    Cover,
    facts,
    openSongMenu,
    Poster,
    SongMenuButton,
} from '/@/renderer/features/best-parts/components/shared';
import { seeded, streak } from '/@/renderer/features/best-parts/engine/recommend';
import { playParts } from '/@/renderer/features/best-parts/mix-player';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { libraryPicks } from '/@/renderer/features/for-you/library-picks';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import {
    blockOf,
    BLOCKS,
    dayKey,
    topInBlock,
    useListeningStore,
} from '/@/renderer/features/listening/listening.store';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { queryClient } from '/@/renderer/lib/react-query';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Play } from '/@/shared/types/types';

const GREETING = ['Still up?', 'Good morning', 'Good afternoon', 'Good evening', 'Tonight'];
// "Pusher [From GTAVI: Original Score]" reads as "Pusher" in the big hero type; the full title stays in the player.
const shortTitle = (t: string) =>
    t.replace(/\s*[[(](from|feat\.?|ft\.?|with)\b[^\])]*[\])]/gi, '').trim() || t;
const BLOCK_ICON = [
    'timeLateNight',
    'timeMorning',
    'timeAfternoon',
    'timeEvening',
    'timeNight',
] as const;

const releasesFromCache = (): ArtistRelease[] => {
    try {
        return JSON.parse(localStorage.getItem('hookline_release_cache') ?? '{}').data ?? [];
    } catch {
        return [];
    }
};

const lastWeek = () =>
    Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d;
    });

const ForYouRoute = () => {
    const navigate = useNavigate();
    const { addToQueueByData } = usePlayer();
    const serverId = useAuthStore((s) => s.currentServer?.id);
    const partMap = useBestPartsStore((s) => s.parts);
    const days = useListeningStore((s) => s.days);
    const songCounts = useListeningStore((s) => s.songs);
    const [hookShift, setHookShift] = useState(0);
    const today = dayKey();
    const block = blockOf();

    const { data: songs = [] } = useQuery({
        enabled: !!serverId,
        queryFn: allLibrarySongs,
        queryKey: ['hookline', 'library-songs', serverId],
        staleTime: 5 * 60_000,
    });
    const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
    const [now] = useState(Date.now);
    const picks = useMemo(() => libraryPicks(songs, today, now), [songs, today, now]);
    const yourBlock = useMemo(
        () =>
            topInBlock(songCounts, block)
                .map((id) => byId.get(id))
                .filter(Boolean) as Song[],
        [songCounts, block, byId],
    );

    const parts = useMemo(() => Object.values(partMap), [partMap]);
    const hook = useMemo(() => {
        if (!parts.length) return null;
        const rnd = seeded(today);
        return parts[(Math.floor(rnd() * parts.length) + hookShift) % parts.length];
    }, [parts, today, hookShift]);

    const week = lastWeek();
    const minutes = Math.round(week.reduce((s, d) => s + (days[dayKey(d)] ?? 0), 0) / 60);
    const run = streak(days, new Date());
    const allReleases = releasesFromCache();
    const releases = allReleases.filter((r) => Date.parse(r.date) <= now).slice(0, 6);
    const soon = allReleases.filter((r) => Date.parse(r.date) > now).length;

    const playSongs = (ids: string[]) => {
        const list = ids.map((id) => byId.get(id)).filter(Boolean) as Song[];
        if (list.length) addToQueueByData(list, Play.NOW);
    };
    const savePick = async (title: string, ids: string[]) => {
        if (!serverId) return;
        try {
            const created = await api.controller.createPlaylist({
                apiClientProps: { serverId },
                body: { name: title },
            });
            if (!created?.id) throw new Error('The library did not create the playlist.');
            await api.controller.addToPlaylist({
                apiClientProps: { serverId },
                body: { songId: ids },
                query: { id: created.id },
            });
            await queryClient.invalidateQueries();
            toast.success({ message: `“${title}” is in your playlists.` });
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t save the playlist' });
        }
    };

    return (
        <AnimatedPage scroll>
            <div className={styles.page}>
                <header className={styles.header}>
                    <Text className={styles.when} size="sm">
                        <Icon icon={BLOCK_ICON[block]} />{' '}
                        {new Date().toLocaleDateString(undefined, { weekday: 'long' })}{' '}
                        {BLOCKS[block]}
                    </Text>
                    <div className={styles.chips}>
                        <span
                            className={styles.chip}
                            title="Days in a row with at least a minute of music"
                        >
                            <Icon icon="streak" />{' '}
                            {run ? `${run}-day streak` : 'Start a streak today'}
                        </span>
                        <span
                            aria-label={`${minutes} minutes of music this week`}
                            className={styles.chip}
                            role="img"
                        >
                            <span className={styles.bulbs}>
                                {week.map((d) => (
                                    <i
                                        className={
                                            (days[dayKey(d)] ?? 0) >= 60 ? styles.lit : undefined
                                        }
                                        key={dayKey(d)}
                                        title={d.toLocaleDateString(undefined, { weekday: 'long' })}
                                    />
                                ))}
                            </span>
                            {minutes} min this week
                        </span>
                    </div>
                </header>

                {hook ? (
                    <section aria-label="Hook of the day" className={styles.hero}>
                        <div className={styles.disc}>
                            <Cover className={styles.discArt} part={hook} />
                            <SongRing
                                className={styles.discRing}
                                parts={[hook]}
                                seconds={hook.songDuration}
                            />
                            <span aria-hidden className={styles.hole} />
                        </div>
                        <div className={styles.heroText}>
                            <Text className={styles.kicker}>Hook of the day</Text>
                            <h1 className={styles.heroTitle} title={hook.title}>
                                {shortTitle(hook.title)}
                            </h1>
                            <Text className={styles.by}>{hook.artist || 'Unknown artist'}</Text>
                            <dl className={styles.facts}>
                                <div>
                                    <dd>
                                        {formatClock(hook.start)} – {formatClock(hook.end)}
                                    </dd>
                                    <dt>the best part</dt>
                                </div>
                                <div>
                                    <dd>{Math.round(hook.analysis.bpm)}</dd>
                                    <dt>BPM</dt>
                                </div>
                                <div>
                                    <dd>{facts(hook).split(', ')[1]}</dd>
                                    <dt>key</dt>
                                </div>
                            </dl>
                            <div className={styles.row}>
                                <Button
                                    className={styles.play}
                                    leftSection={<Icon icon="mediaPlay" />}
                                    onClick={() =>
                                        playParts(
                                            [hook],
                                            {},
                                            { label: 'Hook of the day', mixId: null },
                                        )
                                    }
                                    size="lg"
                                    variant="white"
                                >
                                    Play the hook
                                </Button>
                                <Button
                                    onClick={() => setHookShift(hookShift + 1)}
                                    size="lg"
                                    variant="default"
                                >
                                    Another one
                                </Button>
                            </div>
                        </div>
                    </section>
                ) : (
                    <section className={styles.empty}>
                        <h1 className={styles.heroTitle}>{GREETING[block]}</h1>
                        <Text className={styles.by}>
                            Pick a playlist and BolBeats finds the best part of every song and mixes
                            them, or right-click any song and choose Mark best parts.
                        </Text>
                        <PlaylistsToConvert />
                        <Button
                            leftSection={<Icon icon="bestParts" />}
                            onClick={() => navigate(AppRoute.LIBRARY_SONGS)}
                            size="lg"
                            variant="white"
                        >
                            Pick from your songs
                        </Button>
                    </section>
                )}

                {parts.length > 0 && (
                    <section>
                        <div className={styles.sectionHead}>
                            <h2>Made for you</h2>
                            <Link className={styles.more} to={AppRoute.BEST_PARTS}>
                                All best parts
                            </Link>
                        </div>
                        <MadeForYouShelf limit={4} />
                        <TuneYourOwn />
                    </section>
                )}

                {yourBlock.length > 0 && (
                    <section>
                        <div className={styles.sectionHead}>
                            <h2>Your {BLOCKS[block]}s</h2>
                            <Button
                                leftSection={<Icon icon="mediaPlay" size="sm" />}
                                onClick={() => playSongs(yourBlock.map((s) => s.id))}
                                size="compact-md"
                                variant="default"
                            >
                                Play
                            </Button>
                        </div>
                        <Text className={styles.sub} isMuted size="sm">
                            What you usually play at this time of day.
                        </Text>
                        <ul className={styles.songRow}>
                            {yourBlock.slice(0, 8).map((s) => (
                                <li key={s.id} onContextMenu={(e) => openSongMenu(s.id, e)}>
                                    <span className={styles.rowMore}>
                                        <SongMenuButton songId={s.id} title={s.name} />
                                    </span>
                                    <button
                                        onClick={() => addToQueueByData([s], Play.NOW)}
                                        type="button"
                                    >
                                        <Cover part={{ songId: s.id, title: s.name }} />
                                        <span>
                                            <b>{s.name}</b>
                                            <small>{s.artistName}</small>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {picks.length > 0 && (
                    <section>
                        <div className={styles.sectionHead}>
                            <h2>Playlists for you</h2>
                        </div>
                        <Text className={styles.sub} isMuted size="sm">
                            Made from your library. Press play, or keep one as a playlist.
                        </Text>
                        <div className={styles.shelf}>
                            {picks.map((p) => (
                                <div className={styles.pick} key={p.id}>
                                    <button
                                        aria-label={`Play ${p.title}`}
                                        className={styles.pickArt}
                                        onClick={() => playSongs(p.songIds)}
                                        type="button"
                                    >
                                        <Poster
                                            name={p.title}
                                            parts={p.songIds.slice(0, 3).map((id) => ({
                                                id,
                                                songId: id,
                                                title: byId.get(id)?.name ?? '',
                                            }))}
                                        />
                                    </button>
                                    <Text fw={700} truncate>
                                        {p.title}
                                    </Text>
                                    <Text isMuted lineClamp={2} size="sm">
                                        {p.why}. {p.songIds.length} songs.
                                    </Text>
                                    <Button
                                        leftSection={<Icon icon="add" size="sm" />}
                                        mt={4}
                                        onClick={() => savePick(p.title, p.songIds)}
                                        size="compact-sm"
                                        variant="subtle"
                                    >
                                        Keep as playlist
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <PlaylistsToConvert
                        heading={
                            <div className={styles.sectionHead}>
                                <h2>Best-parts versions to make</h2>
                            </div>
                        }
                    />
                </section>

                {releases.length > 0 && (
                    <section>
                        <div className={styles.sectionHead}>
                            <h2>New from your artists</h2>
                            <Link className={styles.more} to={AppRoute.NEW_RELEASES}>
                                {soon ? `${soon} coming soon · Music news` : 'Music news'}
                            </Link>
                        </div>
                        <ul className={styles.releases}>
                            {releases.map((r) => (
                                <li key={r.url}>
                                    <a href={r.url} rel="noreferrer" target="_blank">
                                        {r.artworkUrl && (
                                            <img alt="" loading="lazy" src={r.artworkUrl} />
                                        )}
                                        <b>{r.title}</b>
                                        <small>{r.artist}</small>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <Button
                    className={styles.browse}
                    onClick={() => navigate(generatePath(AppRoute.LIBRARY_ALBUMS))}
                    variant="subtle"
                >
                    Browse your whole library
                </Button>
            </div>
        </AnimatedPage>
    );
};

const ForYouRouteWithBoundary = () => (
    <PageErrorBoundary>
        <ForYouRoute />
    </PageErrorBoundary>
);

export default ForYouRouteWithBoundary;
