import type { ArtistRelease, ChartSong, LookupCandidate } from '/@/shared/types/online-lookup';

import { ipcRenderer } from 'electron';

// BolBeats: free metadata + release lookups, done in the main process (no CORS, generic client name).
export const onlineLookup = {
    artistReleases: (artist: string): Promise<ArtistRelease[]> =>
        ipcRenderer.invoke('online-artist-releases', artist),
    artistUpcoming: (artist: string): Promise<ArtistRelease[]> =>
        ipcRenderer.invoke('online-artist-upcoming', artist),
    backupFiles: (files: string[]): Promise<string> => ipcRenderer.invoke('backup-files', files),
    chart: (country: string): Promise<ChartSong[]> => ipcRenderer.invoke('online-chart', country),
    country: (): Promise<string> => ipcRenderer.invoke('online-country'),
    fetchImage: (url: string): Promise<null | { bytes: Uint8Array; mimeType: string }> =>
        ipcRenderer.invoke('online-fetch-image', url),
    restoreBackupFile: (backupDir: string, target: string): Promise<boolean> =>
        ipcRenderer.invoke('restore-backup-file', backupDir, target),
    songLookup: (term: string, parts?: string[]): Promise<LookupCandidate[]> =>
        ipcRenderer.invoke('online-song-lookup', term, parts),
};
