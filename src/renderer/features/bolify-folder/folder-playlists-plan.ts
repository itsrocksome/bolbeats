// BolBeats: the music folder as one library, divided into playlists. Pure and import-free so tests load it.
// - Every folder at the top of the music folder with songs in it is a playlist of the same name, in file-name order
//   (a folder that holds just one album stays an album).
// - The same song saved twice (same title and artist, lengths within 2 s) shows once: the other copy is hidden from the
//   library, its file stays where it is, and every playlist points at the one copy.
import type { HiddenCopy } from '/@/shared/types/bolify-folder';

export type PlanSong = {
    album: null | string;
    artistName: string;
    bitRate: number;
    duration: number;
    id: string;
    name: string;
    path: null | string;
};

const norm = (s: null | string) =>
    (s ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

// keepFirst: songs that should stay visible when they have a twin (e.g. ones with best parts)
export const findDuplicates = (
    songs: PlanSong[],
    root: string,
    keepFirst: (s: PlanSong) => boolean = () => false,
): HiddenCopy[] => {
    const rel = (s: PlanSong) => s.path!.slice(root.length + 1);
    const better = (a: PlanSong, b: PlanSong) =>
        Number(keepFirst(b)) - Number(keepFirst(a)) ||
        (b.bitRate || 0) - (a.bitRate || 0) ||
        a.path!.localeCompare(b.path!);
    const groups = new Map<string, PlanSong[]>();
    for (const s of songs) {
        if (!s.path?.startsWith(`${root}/`) || !norm(s.name)) continue;
        const k = `${norm(s.name)}|${norm(s.artistName)}`;
        groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const out: HiddenCopy[] = [];
    for (const g of groups.values()) {
        g.sort((a, b) => a.duration - b.duration);
        let run: PlanSong[] = [];
        const flush = () => {
            const [keep, ...rest] = run.sort(better);
            for (const r of rest) out.push({ hide: rel(r), same: rel(keep) });
        };
        for (const s of g) {
            if (run.length && s.duration - run[run.length - 1].duration > 2000) {
                flush();
                run = [];
            }
            run.push(s);
        }
        flush();
    }
    return out;
};

// A folder whose songs all come from one album named like the folder is that album, not a playlist.
export const isAlbumFolder = (name: string, albums: (null | string)[]) => {
    const set = new Set(albums.map(norm).filter(Boolean));
    if (set.size !== 1) return false;
    const [album] = set;
    const n = norm(name);
    return !!n && (album.includes(n) || n.includes(album));
};

export type FolderPlaylist = { name: string; songIds: string[] };

export const planFolderPlaylists = (
    folders: { files: string[]; name: string }[],
    songs: PlanSong[],
    hidden: HiddenCopy[],
    root: string,
): FolderPlaylist[] => {
    const byPath = new Map(songs.filter((s) => s.path).map((s) => [s.path!, s]));
    const same = new Map(hidden.map((h) => [`${root}/${h.hide}`, `${root}/${h.same}`]));
    return folders.flatMap((f) => {
        const found = f.files
            .map((p) => byPath.get(same.get(p) ?? p))
            .filter((s): s is PlanSong => !!s);
        const songIds = [...new Set(found.map((s) => s.id))];
        return !songIds.length ||
            isAlbumFolder(
                f.name,
                found.map((s) => s.album),
            )
            ? []
            : [{ name: f.name, songIds }];
    });
};
