// BolBeats: "made for you" best-parts playlists, built from the parts you saved. Pure, no imports, so tests load it.
// Ideas from music-listening research: people replay favourites daily (Conrad et al. 2019), listening follows the time
// of day (Heggli et al. 2021), and recommendations feel better when the listener can steer them (Jin et al. 2019).

export type Plays = Record<string, { last: number; n: number }>;
export type RecPart = {
    analysis: { bpm: number; key: { minor: boolean; tonic: number }; loudness: number };
    end: number;
    id: string;
    songId: string;
    start: number;
};
export type Suggestion = { id: string; partIds: string[]; title: string; why: string };

const DAY = 86_400_000;

// 0 = calm, 1 = hype: loudness and tempo, ranked within your own parts.
export const energies = (parts: RecPart[]) => {
    const rank = (vals: number[]) => {
        const sorted = [...vals].sort((a, b) => a - b);
        return vals.map((v) => (vals.length < 2 ? 0.5 : sorted.indexOf(v) / (vals.length - 1)));
    };
    const loud = rank(parts.map((p) => p.analysis.loudness));
    const tempo = rank(parts.map((p) => p.analysis.bpm));
    return new Map(parts.map((p, i) => [p.id, 0.65 * loud[i] + 0.35 * tempo[i]]));
};

// Same seed, same numbers: today's picks stay put all day and change tomorrow.
export const seeded = (seed: string) => {
    let h = 1779033703 ^ seed.length;
    for (const c of seed) {
        h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
};

// Climb to a peak about two-thirds in, then ease off: the shape DJs give a set.
export const arc = <T>(items: T[], energy: (t: T) => number) => {
    const sorted = [...items].sort((a, b) => energy(a) - energy(b));
    const up: T[] = [];
    const down: T[] = [];
    sorted.forEach((x, i) => (i % 3 === 2 ? down : up).push(x));
    return [...up, ...down.reverse()];
};

// One part per song (the most played, else the first) so a made-for-you list never repeats a song.
const onePerSong = (parts: RecPart[], plays: Plays) => {
    const best = new Map<string, RecPart>();
    for (const p of parts) {
        const cur = best.get(p.songId);
        if (!cur || (plays[p.id]?.n ?? 0) > (plays[cur.id]?.n ?? 0)) best.set(p.songId, p);
    }
    return [...best.values()];
};

export function madeForYou(
    parts: RecPart[],
    plays: Plays,
    today: string,
    now: number,
    compatible: (a: RecPart['analysis']['key'], b: RecPart['analysis']['key']) => boolean,
): Suggestion[] {
    const e = energies(parts);
    const en = (p: RecPart) => e.get(p.id) ?? 0.5;
    const songs = onePerSong(parts, plays);
    const out: Suggestion[] = [];
    const add = (id: string, title: string, why: string, list: RecPart[]) => {
        if (list.length >= 3) out.push({ id, partIds: list.map((p) => p.id), title, why });
    };

    // Weighted daily sample: less-played parts come up more often (a fresh mix, not the same favourites).
    const rnd = seeded(today);
    const daily = songs
        .map((p) => [p, rnd() ** (1 + (plays[p.id]?.n ?? 0) / 4)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([p]) => p);
    add(
        'daily',
        'Daily hooks',
        'A fresh pick of your parts every day, building up and easing off',
        arc(daily, en),
    );

    const byEnergy = [...songs].sort((a, b) => en(a) - en(b));
    const cut = Math.max(3, Math.round(songs.length * 0.4));
    if (songs.length >= 6) {
        add(
            'hype',
            'Turn it up',
            'Your loudest, fastest parts',
            arc(byEnergy.slice(-cut).slice(-15), en),
        );
        add(
            'calm',
            'Wind down',
            'Your calmest parts, getting softer as it goes',
            byEnergy.slice(0, cut).slice(0, 15).reverse(),
        );
    }

    let run: RecPart[] = [];
    for (const p of songs) {
        const near = songs.filter((q) => compatible(p.analysis.key, q.analysis.key));
        if (near.length > run.length) run = near;
    }
    if (run.length < songs.length)
        add(
            'key',
            'In tune',
            'Parts in neighbouring keys, so every change sounds smooth',
            arc(run.slice(0, 15), en),
        );

    if (Object.keys(plays).length >= 3) {
        const old = songs
            .filter((p) => now - (plays[p.id]?.last ?? 0) > 21 * DAY)
            .sort((a, b) => (plays[a.id]?.last ?? 0) - (plays[b.id]?.last ?? 0))
            .slice(0, 12);
        add(
            'rediscover',
            'Forgotten favourites',
            'Parts you saved but haven’t heard in weeks',
            old,
        );
    }
    return out;
}

// Steer a mix yourself: pick an energy (0 calm .. 1 hype) and a length; the closest parts fill it.
export function tune(parts: RecPart[], energy: number, minutes: number) {
    const e = energies(parts);
    const en = (p: RecPart) => e.get(p.id) ?? 0.5;
    const picked: RecPart[] = [];
    let total = 0;
    for (const p of onePerSong(parts, {}).sort(
        (a, b) => Math.abs(en(a) - energy) - Math.abs(en(b) - energy),
    )) {
        if (total >= minutes * 60) break;
        picked.push(p);
        total += p.end - p.start;
    }
    return (energy < 0.35 ? picked.sort((a, b) => en(b) - en(a)) : arc(picked, en)).map(
        (p) => p.id,
    );
}

// Days in a row (ending today, or yesterday if today hasn't started) with at least a minute of listening.
export const streak = (days: Record<string, number>, today: Date) => {
    const key = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const d = new Date(today);
    if ((days[key(d)] ?? 0) < 60) d.setDate(d.getDate() - 1);
    let n = 0;
    while ((days[key(d)] ?? 0) >= 60) {
        n++;
        d.setDate(d.getDate() - 1);
    }
    return n;
};
