// BolBeats: the private on-device library, built into the app (local-library/ in main), on 127.0.0.1 only.
export type LocalLibraryInfo = {
    folder: string;
    password: string;
    url: string;
    username: string;
};

// Starter songs BolBeats copied into the music folder (`folders` = top-level folder names, one playlist each).
export type StarterStatus = { bytes: number; count: number; folders: string[]; songs: number };
