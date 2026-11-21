import type { ArtistRelease, ChartSong, LookupCandidate } from '/@/shared/types/online-lookup';

// BolBeats: free metadata lookups (iTunes Search, MusicBrainz + Cover Art Archive) and new-release checks.
// Only song names / artist names leave the Mac. Also backs up audio files before their tags are rewritten.
import { app, ipcMain } from 'electron';
import { copyFile, mkdir } from 'fs/promises';
import path from 'path';

import { store } from '/@/main/features/core/settings';
import log from '/@/main/logger';

// Generic client name on purpose: nothing identifying about the user is sent.
const UA = 'BolBeats/1.0 (personal music player)';
const IMAGE_HOSTS = /(^|\.)(mzstatic\.com|coverartarchive\.org|archive\.org)$/;

const getJson = async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
};

const bigArt = (url?: string) => url?.replace(/\/\d+x\d+bb\./, '/600x600bb.');

const price = (r: any) =>
    typeof r?.trackPrice === 'number' && r.trackPrice > 0
        ? new Intl.NumberFormat(undefined, {
              currency: r.currency || 'USD',
              style: 'currency',
          }).format(r.trackPrice)
        : null;

// The Mac's region picks the right iTunes Store (local songs, local prices); it is a two-letter code, nothing more.
const itunesStore = () =>
    /^[A-Z]{2}$/.test(app.getLocaleCountryCode()) ? `&country=${app.getLocaleCountryCode()}` : '';

const itunesSongs = async (term: string): Promise<LookupCandidate[]> => {
    const j = await getJson(
        `https://itunes.apple.com/search?media=music&entity=song&limit=8${itunesStore()}&term=${encodeURIComponent(term)}`,
    );
    return (j.results ?? []).map((r: any) => ({
        album: r.collectionName ?? null,
        artist: r.artistName,
        artworkUrl: bigArt(r.artworkUrl100) ?? null,
        buyUrl: r.trackViewUrl ?? null,
        durationSec: r.trackTimeMillis ? r.trackTimeMillis / 1000 : null,
        genre: r.primaryGenreName ?? null,
        price: price(r),
        source: 'iTunes',
        title: r.trackName,
        year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
    }));
};

// MusicBrainz asks for at most one request per second.
let mbQueue = Promise.resolve();
const mbThrottle = <T>(fn: () => Promise<T>) => {
    const run = mbQueue.then(fn);
    mbQueue = run.then(
        () => new Promise((r) => setTimeout(r, 1100)),
        () => new Promise((r) => setTimeout(r, 1100)),
    );
    return run;
};

// MusicBrainz search syntax needs these characters escaped inside a quoted value.
const mbQuote = (s: string) => `"${s.replace(/["\\]/g, ' ').trim()}"`;

// MusicBrainz answers 503 when it is busy or we were too quick; wait longer each time and ask again (4 times at most).
const mbJson = async (url: string) => {
    for (let attempt = 0; ; attempt++) {
        try {
            return await getJson(url);
        } catch (err) {
            if (attempt >= 4 || !String(err).includes('503')) throw err;
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
};

const musicBrainzSongs = (query: string): Promise<LookupCandidate[]> =>
    mbThrottle(async () => {
        const j = await mbJson(
            `https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=${encodeURIComponent(query)}`,
        );
        return (j.recordings ?? []).map((r: any) => {
            // the album it's on, rather than the single, when there is one
            const rel =
                r.releases?.find(
                    (x: any) =>
                        x['release-group']?.['primary-type'] === 'Album' && x.status !== 'Bootleg',
                ) ?? r.releases?.[0];
            return {
                album: rel?.title ?? null,
                artist: (r['artist-credit'] ?? [])
                    .map((a: any) => a.name + (a.joinphrase ?? ''))
                    .join(''),
                // the album's cover (release group) is there far more often than one pressing's own picture
                artworkUrl: rel?.['release-group']?.id
                    ? `https://coverartarchive.org/release-group/${rel['release-group'].id}/front-500`
                    : rel
                      ? `https://coverartarchive.org/release/${rel.id}/front-500`
                      : null,
                durationSec: r.length ? r.length / 1000 : null,
                genre: null,
                source: 'MusicBrainz',
                title: r.title,
                year: rel?.date ? Number(String(rel.date).slice(0, 4)) : null,
            };
        });
    });

ipcMain.handle('online-country', () =>
    /^[A-Z]{2}$/.test(app.getLocaleCountryCode()) ? app.getLocaleCountryCode() : 'US',
);

// `parts` = the file name split into its two halves (title and artist, either order). With them MusicBrainz is
// searched field by field, which finds songs that aren't sold on iTunes (soundtracks, regional releases).
ipcMain.handle('online-song-lookup', async (_e, term: string, parts?: string[]) => {
    const out: LookupCandidate[] = [];
    try {
        out.push(...(await itunesSongs(term)));
    } catch (err) {
        log.warn('[online-lookup] iTunes failed', { err: String(err) });
    }
    const [a, b] = (parts ?? []).filter(Boolean).slice(0, 2);
    try {
        if (a && b) {
            const fielded = await musicBrainzSongs(
                `recording:${mbQuote(a)} AND artist:${mbQuote(b)}`,
            );
            out.push(
                ...(fielded.length
                    ? fielded
                    : await musicBrainzSongs(`recording:${mbQuote(b)} AND artist:${mbQuote(a)}`)),
            );
        } else if (out.length < 3) {
            out.push(...(await musicBrainzSongs(term)));
        }
    } catch (err) {
        log.warn('[online-lookup] MusicBrainz failed', { err: String(err) });
    }
    return out;
});

ipcMain.handle('online-fetch-image', async (_e, url: string) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !IMAGE_HOSTS.test(u.hostname))
        throw new Error('Image host not allowed');
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
});

ipcMain.handle('online-artist-releases', async (_e, artist: string): Promise<ArtistRelease[]> => {
    const j = await getJson(
        `https://itunes.apple.com/search?media=music&entity=album&attribute=artistTerm&limit=50&term=${encodeURIComponent(artist)}`,
    );
    const want = artist.toLowerCase();
    return (j.results ?? [])
        .filter((r: any) => String(r.artistName).toLowerCase().includes(want))
        .map((r: any) => ({
            artist: r.artistName,
            artworkUrl: bigArt(r.artworkUrl100) ?? null,
            date: r.releaseDate,
            source: 'iTunes',
            title: r.collectionName,
            trackCount: r.trackCount ?? null,
            url: r.collectionViewUrl,
        }));
});

// Announced releases (a release date still ahead) from MusicBrainz, which lists them before stores do.
ipcMain.handle('online-artist-upcoming', (_e, artist: string): Promise<ArtistRelease[]> =>
    mbThrottle(async () => {
        const from = new Date().toISOString().slice(0, 10);
        const to = `${new Date().getFullYear() + 2}-12-31`;
        const q = `artist:"${artist.replace(/"/g, '')}" AND firstreleasedate:[${from} TO ${to}]`;
        const j = await mbJson(
            `https://musicbrainz.org/ws/2/release-group?fmt=json&limit=25&query=${encodeURIComponent(q)}`,
        );
        const want = artist.toLowerCase();
        return (j['release-groups'] ?? [])
            .filter(
                (g: any) =>
                    g['first-release-date'] &&
                    (g['artist-credit'] ?? []).some((a: any) =>
                        String(a.name).toLowerCase().includes(want),
                    ),
            )
            .map((g: any) => ({
                artist: (g['artist-credit'] ?? [])
                    .map((a: any) => a.name + (a.joinphrase ?? ''))
                    .join(''),
                artworkUrl: `https://coverartarchive.org/release-group/${g.id}/front-500`,
                date: new Date(g['first-release-date']).toISOString(),
                kind: g['primary-type'] ?? undefined,
                source: 'MusicBrainz',
                title: g.title,
                trackCount: null,
                url: `https://musicbrainz.org/release-group/${g.id}`,
            }));
    }),
);

// Most-played songs in one country's Apple Music store (Apple's public chart feed), with store previews.
// Sends only the two-letter country. The feed sometimes answers 504, so it gets one retry.
ipcMain.handle('online-chart', async (_e, country: string): Promise<ChartSong[]> => {
    const cc = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';
    const url = `https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/25/songs.json`;
    const feed = await getJson(url).catch(() => getJson(url));
    const rows: any[] = feed?.feed?.results ?? [];
    const ids = rows.map((r) => r.id).filter((id) => /^\d+$/.test(id));
    const extra = ids.length
        ? new Map(
              (
                  (
                      await getJson(
                          `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${cc}`,
                      ).catch(() => null)
                  )?.results ?? []
              ).map((r: any) => [String(r.trackId), r]),
          )
        : new Map();
    return rows.map((r, i) => {
        const x: any = extra.get(String(r.id));
        return {
            artist: r.artistName,
            artworkUrl: bigArt(r.artworkUrl100) ?? null,
            genre: r.genres?.find((g: any) => g.name !== 'Music')?.name ?? null,
            id: String(r.id),
            previewUrl: x?.previewUrl ?? null,
            price: price(x),
            rank: i + 1,
            releaseDate: r.releaseDate ?? null,
            storeUrl: x?.trackViewUrl ?? r.url,
            title: r.name,
        };
    });
});

// Copies files into <settings dir>/tag-backups/<timestamp>/ before tags are rewritten.
// Puts a backed-up original back (undo of an automatic details fix). Only reads from BolBeats's own backup folder.
ipcMain.handle('restore-backup-file', async (_e, backupDir: string, target: string) => {
    const root = path.join(path.dirname(store.path), 'tag-backups');
    const from = path.join(backupDir, path.basename(target));
    if (path.relative(root, from).startsWith('..') || path.isAbsolute(path.relative(root, from)))
        throw new Error('Not a BolBeats backup.');
    await copyFile(from, target);
    return true;
});

ipcMain.handle('backup-files', async (_e, files: string[]) => {
    const dir = path.join(
        path.dirname(store.path),
        'tag-backups',
        new Date().toISOString().replace(/[:.]/g, '-'),
    );
    await mkdir(dir, { recursive: true });
    const used = new Set<string>();
    for (const f of files) {
        // Same file name in two folders: number the second one instead of overwriting the first backup.
        let name = path.basename(f);
        for (let i = 2; used.has(name); i++)
            name = `${path.parse(f).name} (${i})${path.extname(f)}`;
        used.add(name);
        await copyFile(f, path.join(dir, name));
    }
    return dir;
});
