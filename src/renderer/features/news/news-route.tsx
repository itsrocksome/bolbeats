// BolBeats: Music news. A feed of posts from your favourite artists (and, if you like, everyone in your library):
// what just dropped, and what's announced with a countdown and a "remind me" for release day.
// Sources: iTunes Search (releases + pre-orders) and MusicBrainz (announced releases). Only artist names are sent.
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import styles from './news.module.css';

import { allLibrarySongs, isUnknown } from '/@/renderer/features/library-tools/library-songs';
import { Charts } from '/@/renderer/features/news/charts';
import {
    cleanTitle,
    describe,
    type FeedRelease,
    isUpcoming,
    mergeReleases,
} from '/@/renderer/features/news/feed';
import {
    loadReminders,
    toggleReminder,
    useReminders,
} from '/@/renderer/features/news/release-reminders';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';

const FOLLOWED = 'hookline_followed_artists'; // your favourite artists
const CACHE = 'hookline_release_cache';
const TTL = 12 * 60 * 60 * 1000;
const DAY = 86_400_000;

const load = <T,>(k: string, fallback: T): T => {
    try {
        return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? fallback;
    } catch {
        return fallback;
    }
};
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11);

const Art = ({ className, r }: { className?: string; r: FeedRelease }) => {
    const [failed, setFailed] = useState(false);
    if (r.artworkUrl && !failed)
        return (
            <img
                alt=""
                className={className}
                loading="lazy"
                onError={() => setFailed(true)}
                src={r.artworkUrl}
            />
        );
    return (
        <span
            aria-hidden
            className={clsx(className, styles.artFallback)}
            style={{ ['--h' as string]: hue(r.title) }}
        >
            {cleanTitle(r)}
        </span>
    );
};

const NewsRoute = () => {
    const navigate = useNavigate();
    const [libraryArtists, setLibraryArtists] = useState<null | string[]>(null);
    const [favourites, setFavourites] = useState<string[]>(() => load(FOLLOWED, []));
    const [releases, setReleases] = useState<FeedRelease[]>(
        () => load<{ data?: FeedRelease[] }>(CACHE, {}).data ?? [],
    );
    const [loading, setLoading] = useState(false);
    const [scope, setScope] = useState(() =>
        load<string[]>(FOLLOWED, []).length ? 'favourites' : 'library',
    );
    const [add, setAdd] = useState('');
    const reminders = useReminders();
    const [now] = useState(Date.now);

    useEffect(() => {
        allLibrarySongs().then((songs) => {
            const count = new Map<string, number>();
            for (const s of songs)
                for (const a of s.artistName.split(
                    /,| & (?!the )| feat\.? | ft\.? /i,
                ) /* "X & The Y" is one band */) {
                    const name = a.trim();
                    if (!isUnknown(name)) count.set(name, (count.get(name) ?? 0) + 1);
                }
            setLibraryArtists([...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n));
        });
    }, []);

    const saveFavourites = (next: string[]) => {
        setFavourites(next);
        localStorage.setItem(FOLLOWED, JSON.stringify(next));
    };
    const toggleFavourite = (name: string) =>
        saveFavourites(
            favourites.includes(name)
                ? favourites.filter((f) => f !== name)
                : [...favourites, name],
        );

    const artists = useMemo(
        () => [...new Set([...(libraryArtists ?? []), ...favourites])].slice(0, 60),
        [favourites, libraryArtists],
    );

    const refresh = useCallback(
        async (force = false) => {
            const cache = load<null | { at: number; data: FeedRelease[]; key: string }>(
                CACHE,
                null,
            );
            const key = artists.join('|');
            if (!force && cache && cache.key === key && Date.now() - cache.at < TTL)
                return setReleases(cache.data);
            setLoading(true);
            const store: FeedRelease[] = [];
            for (const a of artists)
                store.push(...(await window.api.onlineLookup.artistReleases(a).catch(() => [])));
            setReleases(mergeReleases([store]));
            // Announced releases for favourites only: MusicBrainz allows one question a second.
            const announced: FeedRelease[] = [];
            for (const a of favourites.slice(0, 20))
                announced.push(
                    ...(await window.api.onlineLookup.artistUpcoming(a).catch(() => [])),
                );
            const all = mergeReleases([store, announced]);
            localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data: all, key }));
            setReleases(all);
            setLoading(false);
        },
        [artists, favourites],
    );

    useEffect(() => {
        if (libraryArtists && artists.length) refresh();
    }, [artists.length, libraryArtists, refresh]);

    const inScope = (r: FeedRelease) =>
        scope === 'library' ||
        favourites.some((f) => r.artist.toLowerCase().includes(f.toLowerCase()));
    const upcoming = releases
        .filter((r) => inScope(r) && isUpcoming(r, now))
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const feed = releases
        .filter((r) => inScope(r) && !isUpcoming(r, now) && now - Date.parse(r.date) <= 365 * DAY)
        .slice(0, 60);
    const suggestions = (libraryArtists ?? []).filter((a) => !favourites.includes(a)).slice(0, 12);

    return (
        <AnimatedPage scroll>
            <div className={styles.page}>
                <header className={styles.header}>
                    <div>
                        <h1>Music news</h1>
                        <Text isMuted>
                            New songs, albums and announcements from the artists you care about, in
                            one place.
                        </Text>
                    </div>
                    <Button
                        leftSection={<Icon icon="refresh" />}
                        loading={loading}
                        onClick={() => refresh(true)}
                        variant="default"
                    >
                        Check now
                    </Button>
                </header>

                <section aria-label="Your favourite artists" className={styles.favs}>
                    <div className={styles.favRow}>
                        {favourites.map((f) => (
                            <button
                                aria-pressed
                                className={clsx(styles.fav, styles.on)}
                                key={f}
                                onClick={() => toggleFavourite(f)}
                                title="Remove from favourites"
                                type="button"
                            >
                                <span
                                    className={styles.avatar}
                                    style={{ ['--h' as string]: hue(f) }}
                                >
                                    {f[0]}
                                </span>
                                {f}
                            </button>
                        ))}
                        <form
                            className={styles.addFav}
                            onSubmit={(e) => (
                                e.preventDefault(),
                                add.trim() &&
                                    saveFavourites([...new Set([add.trim(), ...favourites])]),
                                setAdd('')
                            )}
                        >
                            <TextInput
                                aria-label="Add a favourite artist"
                                onChange={(e) => setAdd(e.currentTarget.value)}
                                placeholder="Add an artist, e.g. Arijit Singh"
                                value={add}
                            />
                            <Button disabled={!add.trim()} type="submit" variant="default">
                                Add
                            </Button>
                        </form>
                    </div>
                    {suggestions.length > 0 && (
                        <div className={styles.suggest}>
                            <Text isMuted size="sm">
                                From your library:
                            </Text>
                            {suggestions.map((a) => (
                                <button
                                    className={styles.fav}
                                    key={a}
                                    onClick={() => toggleFavourite(a)}
                                    type="button"
                                >
                                    <Icon icon="add" size="sm" /> {a}
                                </button>
                            ))}
                        </div>
                    )}
                    <SegmentedControl
                        aria-label="Whose news"
                        data={[
                            { label: 'Favourites', value: 'favourites' },
                            { label: 'Everyone in my library', value: 'library' },
                        ]}
                        onChange={setScope}
                        value={scope}
                    />
                </section>

                {libraryArtists && !libraryArtists.length && !favourites.length && (
                    <div className={styles.note}>
                        <Text>
                            Your songs don’t have artist names yet. Fix them, or add a favourite
                            artist above.
                        </Text>
                        <Button onClick={() => navigate(AppRoute.LIBRARY_TOOLS)} variant="filled">
                            Fix song details
                        </Button>
                    </div>
                )}

                {upcoming.length > 0 && (
                    <section>
                        <h2>Coming soon</h2>
                        <ul className={styles.soon}>
                            {upcoming.map((r) => {
                                const on = !!reminders[r.url];
                                const days = Math.max(
                                    1,
                                    Math.round((Date.parse(r.date) - now) / DAY),
                                );
                                return (
                                    <li key={r.url}>
                                        <Art className={styles.soonArt} r={r} />
                                        <span className={styles.count}>
                                            <b>{days}</b> {days === 1 ? 'day' : 'days'}
                                        </span>
                                        <Text fw={700} lineClamp={2}>
                                            {cleanTitle(r)}
                                        </Text>
                                        <Text isMuted size="sm" truncate>
                                            {r.artist}
                                        </Text>
                                        <Text className={styles.date} size="sm">
                                            {new Date(r.date).toLocaleDateString(undefined, {
                                                day: 'numeric',
                                                month: 'short',
                                                weekday: 'short',
                                            })}
                                        </Text>
                                        <Button
                                            aria-pressed={on}
                                            leftSection={
                                                <Icon icon={on ? 'check' : 'remind'} size="sm" />
                                            }
                                            onClick={() => toggleReminder(r)}
                                            size="compact-sm"
                                            variant={on ? 'filled' : 'default'}
                                        >
                                            {on ? 'Reminder on' : 'Remind me'}
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                <Charts />

                <section>
                    <h2>Latest</h2>
                    {loading && !feed.length && (
                        <Text isMuted>Checking {artists.length} artists…</Text>
                    )}
                    {!loading && !feed.length && (
                        <Text isMuted>
                            {scope === 'favourites'
                                ? 'Nothing from your favourites this year. Add more artists, or switch to everyone in your library.'
                                : 'Nothing new this year.'}
                        </Text>
                    )}
                    <ol className={styles.feed}>
                        {feed.map((r) => {
                            const { verb, when } = describe(r, now);
                            return (
                                <li className={styles.post} key={r.url}>
                                    <div className={styles.postHead}>
                                        <span
                                            className={styles.avatar}
                                            style={{ ['--h' as string]: hue(r.artist) }}
                                        >
                                            {r.artist[0]}
                                        </span>
                                        <span>
                                            <span>
                                                <b>{r.artist}</b> {verb}
                                            </span>
                                            <small>{when}</small>
                                        </span>
                                    </div>
                                    <a
                                        className={styles.postBody}
                                        href={r.url}
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        <Art className={styles.postArt} r={r} />
                                        <span>
                                            <Text fw={700} lineClamp={2} size="lg">
                                                {cleanTitle(r)}
                                            </Text>
                                            <Text isMuted size="sm">
                                                {r.trackCount
                                                    ? `${r.trackCount} ${r.trackCount === 1 ? 'song' : 'songs'} · `
                                                    : ''}
                                                {new Date(r.date).toLocaleDateString(undefined, {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                })}
                                            </Text>
                                            <Text className={styles.open} size="sm">
                                                {r.source === 'MusicBrainz'
                                                    ? 'Details on MusicBrainz'
                                                    : 'Listen on Apple Music'}
                                            </Text>
                                        </span>
                                    </a>
                                </li>
                            );
                        })}
                    </ol>
                </section>
            </div>
        </AnimatedPage>
    );
};

// keep reminders loaded even if this page opens first
loadReminders();

const NewsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <NewsRoute />
    </PageErrorBoundary>
);

export default NewsRouteWithBoundary;
