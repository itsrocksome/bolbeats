// BolBeats: playlists for you, built from your own library (play counts, when songs were added and last played,
// genres). Pure and import-free so tests load it; nothing leaves the Mac.

export type LibraryPick = { id: string; songIds: string[]; title: string; why: string };
export type PickSong = {
    artistName: string;
    createdAt: string;
    genres: { name: string }[];
    id: string;
    lastPlayedAt: null | string;
    playCount: number;
};

const DAY = 86_400_000;
const time = (s: null | string) => (s ? Date.parse(s) || 0 : 0);

// Same seed, same order all day; a new shuffle tomorrow.
const shuffled = <T>(xs: T[], seed: string) => {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () =>
        ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>>
            0) /
        4294967296;
    return xs
        .map((x) => [x, rnd()] as const)
        .sort((a, b) => a[1] - b[1])
        .map(([x]) => x);
};

export function libraryPicks(songs: PickSong[], today: string, now: number): LibraryPick[] {
    const out: LibraryPick[] = [];
    const add = (id: string, title: string, why: string, list: PickSong[], min = 3) => {
        if (list.length >= min)
            out.push({ id, songIds: list.slice(0, 50).map((s) => s.id), title, why });
    };

    add(
        'repeat',
        'On repeat',
        'The songs you keep coming back to',
        [...songs].filter((s) => s.playCount >= 2).sort((a, b) => b.playCount - a.playCount),
    );
    add(
        'forgotten',
        'Forgotten favourites',
        'Songs you loved but haven’t played in a month',
        songs
            .filter((s) => s.playCount >= 2 && now - time(s.lastPlayedAt) > 30 * DAY)
            .sort((a, b) => b.playCount - a.playCount),
    );
    add(
        'fresh',
        'Fresh in your library',
        'The newest songs in your folder',
        [...songs].sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, 25),
    );
    add(
        'unheard',
        'Never played',
        'Songs you have but haven’t heard here yet, shuffled daily',
        shuffled(
            songs.filter((s) => !s.playCount),
            today,
        ),
    );

    const byGenre = new Map<string, PickSong[]>();
    for (const s of songs)
        for (const g of s.genres.slice(0, 1))
            byGenre.set(g.name, [...(byGenre.get(g.name) ?? []), s]);
    [...byGenre.entries()]
        .filter(([, list]) => list.length >= 3 && list.length < songs.length)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 4)
        .forEach(([g, list]) =>
            add(
                `genre:${g}`,
                `${g} mix`,
                `Your ${g.toLowerCase()} songs, shuffled daily`,
                shuffled(list, today + g),
            ),
        );

    const byArtist = new Map<string, PickSong[]>();
    for (const s of songs)
        if (s.artistName && !/^\[unknown/i.test(s.artistName))
            byArtist.set(s.artistName, [...(byArtist.get(s.artistName) ?? []), s]);
    const top = [...byArtist.entries()]
        .filter(([, l]) => l.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)[0];
    if (top)
        add(
            `artist:${top[0]}`,
            `This is ${top[0]}`,
            'The artist you have the most songs from',
            shuffled(top[1], today),
        );

    // Small libraries still get something to press play on.
    if (!out.length)
        add(
            'all',
            'Your library, shuffled',
            'Every song, a new order every day',
            shuffled(songs, today),
            1,
        );
    return out;
}
