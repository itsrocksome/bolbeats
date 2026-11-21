import type { Song } from '/@/shared/types/domain-types';

// BolBeats: clone a Spotify / Apple Music playlist from its export, using the songs you already own.
// Nothing is downloaded: missing songs get a legal way to own them (an iTunes Store page with its price, or a search).
import { useEffect, useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from '../library-tools.module.css';

import { api } from '/@/renderer/api';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { matchScore, parsePlaylistText } from '/@/renderer/features/library-tools/match';
import { queryClient } from '/@/renderer/lib/react-query';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { Textarea } from '/@/shared/components/textarea/textarea';
import { toast } from '/@/shared/components/toast/toast';

type Result = { matched: { song: Song; track: Track }[]; missing: Track[] };
type Track = { artist: string; title: string };

const MATCH = 0.62;
const searchLinks = (t: Track) => {
    const q = encodeURIComponent(`${t.title} ${t.artist}`.trim());
    return [
        { label: 'Apple Music', url: `https://music.apple.com/search?term=${q}` },
        { label: 'Bandcamp', url: `https://bandcamp.com/search?q=${q}` },
    ];
};

type Buy = null | { price: null | string; url: string };

// Looks up missing songs on the iTunes Store one at a time (it allows ~20 lookups a minute).
const useBuyLinks = (missing: Track[] | undefined) => {
    const [buy, setBuy] = useState<Record<number, Buy>>({});
    useEffect(() => {
        let live = true;
        setBuy({});
        (async () => {
            for (const [i, t] of (missing ?? []).slice(0, 20).entries()) {
                if (!live) return;
                const found = await window.api.onlineLookup
                    .songLookup(`${t.title} ${t.artist}`.trim())
                    .catch(() => []);
                const hit = found
                    .filter((c) => c.source === 'iTunes' && c.buyUrl)
                    .map(
                        (c) =>
                            [
                                c,
                                matchScore([t.title, t.artist], {
                                    artist: c.artist,
                                    title: c.title,
                                }),
                            ] as const,
                    )
                    .sort((a, b) => b[1] - a[1])
                    .find(([, score]) => score >= MATCH)?.[0];
                if (live)
                    setBuy((b) => ({
                        ...b,
                        [i]: hit ? { price: hit.price ?? null, url: hit.buyUrl! } : null,
                    }));
                await new Promise((r) => setTimeout(r, 1500));
            }
        })();
        return () => {
            live = false;
        };
    }, [missing]);
    return buy;
};

export const PlaylistCloner = () => {
    const navigate = useNavigate();
    const file = useRef<HTMLInputElement>(null);
    const [text, setText] = useState('');
    const [name, setName] = useState('');
    const [result, setResult] = useState<null | Result>(null);
    const [busy, setBusy] = useState(false);
    const isLink = /^\s*https?:\/\/(open\.spotify\.com|music\.apple\.com)/i.test(text);
    const buy = useBuyLinks(result?.missing);

    const readFile = async (f?: File) => {
        if (!f) return;
        const buf = await f.arrayBuffer();
        const b = new Uint8Array(buf);
        // Apple Music exports "Unicode Text", which is UTF-16 with a byte-order mark
        const enc =
            b[0] === 0xff && b[1] === 0xfe
                ? 'utf-16le'
                : b[0] === 0xfe && b[1] === 0xff
                  ? 'utf-16be'
                  : 'utf-8';
        setText(new TextDecoder(enc).decode(buf));
        if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
        setResult(null);
    };

    const match = async () => {
        setBusy(true);
        try {
            const tracks = parsePlaylistText(text).filter((t) => t.title);
            const library = await allLibrarySongs();
            const res: Result = { matched: [], missing: [] };
            for (const track of tracks) {
                let best: null | Song = null;
                let top = 0;
                for (const s of library) {
                    const sc = matchScore([track.title, track.artist], {
                        artist: s.artistName,
                        title: s.name,
                    });
                    if (sc > top) [top, best] = [sc, s];
                }
                if (best && top >= MATCH) res.matched.push({ song: best, track });
                else res.missing.push(track);
            }
            setResult(res);
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t read your library' });
        } finally {
            setBusy(false);
        }
    };

    const create = async () => {
        const serverId = useAuthStore.getState().currentServer?.id;
        if (!result?.matched.length || !serverId) return;
        setBusy(true);
        try {
            const created = await api.controller.createPlaylist({
                apiClientProps: { serverId },
                body: { name: name.trim() || 'Imported playlist' },
            });
            if (!created?.id) throw new Error('The library did not create the playlist.');
            await api.controller.addToPlaylist({
                apiClientProps: { serverId },
                body: { songId: result.matched.map((m) => m.song.id) },
                query: { id: created.id },
            });
            await queryClient.invalidateQueries(); // the sidebar and playlist lists pick it up
            toast.success({
                message: `${result.matched.length} songs added.`,
                title: 'Playlist cloned',
            });
            navigate(generatePath(AppRoute.PLAYLISTS_DETAIL_SONGS, { playlistId: created.id }));
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t create the playlist' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.block}>
            <ol className={styles.steps}>
                <li>
                    <b>From Apple Music:</b> in the Music app, select the playlist, then File ›
                    Library › Export Playlist… and keep “Unicode Text”.
                </li>
                <li>
                    <b>From Spotify:</b> export it as a CSV with{' '}
                    <a href="https://exportify.app" rel="noreferrer" target="_blank">
                        Exportify
                    </a>{' '}
                    (free, open source, signs in with your Spotify account).
                </li>
                <li>
                    Choose that file here, or paste a list of songs (one “Artist - Title” per line).
                </li>
            </ol>

            <div className={styles.importRow}>
                <input
                    accept=".txt,.csv,.m3u,.m3u8"
                    hidden
                    onChange={(e) => readFile(e.currentTarget.files?.[0])}
                    ref={file}
                    type="file"
                />
                <Button
                    leftSection={<Icon icon="upload" />}
                    onClick={() => file.current?.click()}
                    variant="default"
                >
                    Choose export file
                </Button>
                <TextInput
                    aria-label="Playlist name"
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder="Playlist name"
                    value={name}
                />
            </div>
            <Textarea
                aria-label="Songs to import"
                autosize
                maxRows={10}
                minRows={4}
                onChange={(e) => (setText(e.currentTarget.value), setResult(null))}
                placeholder={'Arijit Singh - Kesariya\nAP Dhillon - Excuses'}
                value={text}
            />
            {isLink && (
                <Text className={styles.note} size="sm">
                    Playlist links can’t be read directly without a streaming account login. Export
                    the playlist with the steps above and choose the file instead.
                </Text>
            )}
            <div className={styles.actions}>
                <Button
                    disabled={!text.trim() || isLink}
                    loading={busy && !result}
                    onClick={match}
                    variant="filled"
                >
                    Match with my library
                </Button>
            </div>

            {result && (
                <div className={styles.result}>
                    <Text size="lg">
                        {result.matched.length} of {result.matched.length + result.missing.length}{' '}
                        songs are in your library.
                    </Text>
                    {result.matched.length > 0 && (
                        <Button loading={busy} onClick={create} size="md" variant="filled">
                            Create “{name.trim() || 'Imported playlist'}” with{' '}
                            {result.matched.length} songs
                        </Button>
                    )}
                    {result.missing.length > 0 && (
                        <>
                            <Text fw={600} mt="md">
                                Not in your library
                            </Text>
                            <Text isMuted size="sm">
                                Songs bought on the iTunes Store download as normal files you keep:
                                add them to your music folder and they appear here.
                            </Text>
                            <ul className={styles.missing}>
                                {result.missing.map((t, i) => (
                                    <li key={i}>
                                        <span>
                                            <b>{t.title}</b>{' '}
                                            {t.artist && (
                                                <Text component="span" isMuted size="sm">
                                                    {t.artist}
                                                </Text>
                                            )}
                                        </span>
                                        <span className={styles.links}>
                                            {buy[i] && (
                                                <a
                                                    className={styles.buy}
                                                    href={buy[i]!.url}
                                                    rel="noreferrer"
                                                    target="_blank"
                                                >
                                                    Buy{buy[i]!.price ? ` ${buy[i]!.price}` : ''} on
                                                    iTunes
                                                </a>
                                            )}
                                            {searchLinks(t).map((l) => (
                                                <a
                                                    href={l.url}
                                                    key={l.label}
                                                    rel="noreferrer"
                                                    target="_blank"
                                                >
                                                    {l.label}
                                                </a>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
