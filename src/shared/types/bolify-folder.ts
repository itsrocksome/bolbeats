// BolBeats: shapes for the music-folder IPC (bring songs in, write playlist files, read the backup).
export type BringInResult = { copied: number; failed: string[]; skipped: number };

// One line of a playlist file. start/end (seconds) make it a best part.
export type FolderEntry = {
    artist: string;
    end?: number;
    path: string;
    seconds: number;
    start?: number;
    title: string;
};
export type FolderExport = { backup: string; bestParts: FolderList[]; playlists: FolderList[] };
// Top-level folders of the music folder with the songs directly inside (absolute paths, file-name order), and the copies
// BolBeats hides (gone: one of the two files isn't there any more).
export type FolderLayout = {
    folders: { files: string[]; name: string }[];
    hidden: (HiddenCopy & { gone: boolean })[];
    root: string;
};

export type FolderList = { entries: FolderEntry[]; name: string };
// A song saved twice: `hide` is kept out of the library (the file stays), `same` is the copy everything points at.
// Both are paths relative to the music folder.
export type HiddenCopy = { hide: string; same: string };
