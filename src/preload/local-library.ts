import type { LocalLibraryInfo, StarterStatus } from '/@/shared/types/local-library';

import { ipcRenderer } from 'electron';

// BolBeats: the private on-device library, built into the app (local-library/ in main), on 127.0.0.1 only.
export const localLibrary = {
    chooseFolder: (testPath?: string): Promise<LocalLibraryInfo | null> =>
        ipcRenderer.invoke('local-library-choose-folder', testPath),
    start: (): Promise<LocalLibraryInfo> => ipcRenderer.invoke('local-library-start'),
    // the starter songs that ship with the app: what is in the music folder now, add them, or delete them
    starter: (action: 'add' | 'remove' | 'status'): Promise<StarterStatus> =>
        ipcRenderer.invoke('local-library-starter', action),
};
