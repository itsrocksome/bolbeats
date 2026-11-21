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
    // BolBeats: share a best-parts playlist as a .bolbeats file (best-parts/share-mix.ts)
    mixOpen: (): Promise<null | string> => ipcRenderer.invoke('bolify-mix-open'),
    mixSave: (fileName: string, content: string): Promise<null | string> =>
        ipcRenderer.invoke('bolify-mix-save', fileName, content),
    mixShare: (fileName: string, content: string): Promise<boolean> =>
        ipcRenderer.invoke('bolify-mix-share', fileName, content),
    mixWaiting: (): Promise<string[]> => ipcRenderer.invoke('bolify-mix-waiting'),
    onBringInProgress: (cb: (p: { done: number; name: string }) => void) => {
        const fn = (_e: unknown, p: { done: number; name: string }) => cb(p);
        ipcRenderer.on('bolify-bring-in-progress', fn);
        return () => ipcRenderer.removeListener('bolify-bring-in-progress', fn);
    },
    onMixOpened: (cb: (content: string) => void) => {
        const fn = (_e: unknown, content: string) => cb(content);
        ipcRenderer.on('bolify-mix-opened', fn);
        return () => ipcRenderer.removeListener('bolify-mix-opened', fn);
    },
    openFolder: (): Promise<string> => ipcRenderer.invoke('bolify-open-folder'),
    readBackup: (folder?: string): Promise<null | string> =>
        ipcRenderer.invoke('bolify-read-backup', folder),
};
