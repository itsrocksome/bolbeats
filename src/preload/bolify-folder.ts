import type {
    BringInResult,
    FolderExport,
    FolderLayout,
    HiddenCopy,
} from '/@/shared/types/bolify-folder';

import { ipcRenderer } from 'electron';

// BolBeats: the music folder as the one home for songs, playlist files and the backup.
export const bolifyFolder = {
    // testPaths only works in development builds; people always get the file picker
    bringIn: (testPaths?: string[]): Promise<BringInResult | null> =>
        ipcRenderer.invoke('bolify-bring-in', testPaths),
    exportLists: (data: FolderExport): Promise<string> => ipcRenderer.invoke('bolify-export', data),
    hideCopies: (hidden: HiddenCopy[]): Promise<HiddenCopy[]> =>
        ipcRenderer.invoke('bolify-hide-copies', hidden),
    layout: (): Promise<FolderLayout> => ipcRenderer.invoke('bolify-folder-layout'),
    onBringInProgress: (cb: (p: { done: number; name: string }) => void) => {
        const fn = (_e: unknown, p: { done: number; name: string }) => cb(p);
        ipcRenderer.on('bolify-bring-in-progress', fn);
        return () => ipcRenderer.removeListener('bolify-bring-in-progress', fn);
    },
    openFolder: (): Promise<string> => ipcRenderer.invoke('bolify-open-folder'),
    readBackup: (folder?: string): Promise<null | string> =>
        ipcRenderer.invoke('bolify-read-backup', folder),
};
