// BolBeats: find a song again after the library moved or BolBeats was reinstalled (song ids change with the file path).
// Pure and import-free so tests load it. Order: same path, same path inside the new music folder, then
// same title + artist with a length within 3 seconds.

export type Findable = { artist: string; path: string; seconds: number; title: string };
export type LibSong = {
    artistName: string;
    duration: number;
    id: string;
    name: string;
    path: null | string;
};

const norm = (s: string) =>
    s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

export const songFinder = (songs: LibSong[], newFolder: string) => {
    const byPath = new Map(songs.filter((s) => s.path).map((s) => [s.path!, s]));
    const byName = new Map<string, LibSong[]>();
    for (const s of songs) {
        const k = `${norm(s.name)}|${norm(s.artistName)}`;
        byName.set(k, [...(byName.get(k) ?? []), s]);
    }
    return (want: Findable, oldFolder?: string): LibSong | undefined => {
        if (want.path && byPath.has(want.path)) return byPath.get(want.path);
        if (want.path && oldFolder && want.path.startsWith(oldFolder)) {
            const moved = byPath.get(newFolder + want.path.slice(oldFolder.length));
            if (moved) return moved;
        }
        const same = byName.get(`${norm(want.title)}|${norm(want.artist)}`) ?? [];
        return (
            same.find((s) => Math.abs(s.duration / 1000 - want.seconds) <= 3) ??
            (same.length === 1 && !want.seconds ? same[0] : undefined)
        );
    };
};
