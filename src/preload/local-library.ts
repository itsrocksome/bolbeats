import type { LocalLibraryInfo } from '/@/shared/types/local-library';

import { ipcRenderer } from 'electron';

// BolBeats: the private on-device library, built into the app (local-library/ in main), on 127.0.0.1 only.
export const localLibrary = {
    chooseFolder: (testPath?: string): Promise<LocalLibraryInfo | null> =>
        ipcRenderer.invoke('local-library-choose-folder', testPath),
    start: (): Promise<LocalLibraryInfo> => ipcRenderer.invoke('local-library-start'),
};
