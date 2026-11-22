import type { LocalLibraryInfo } from '/@/shared/types/local-library';

// BolBeats: signs the app into the private on-device library on every launch (no login screen),
// and lets the user change the music folder or rescan it.
import { nanoid } from 'nanoid/non-secure';
import { createWithEqualityFn } from 'zustand/traditional';

import { api } from '/@/renderer/api';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { toast } from '/@/shared/components/toast/toast';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';
import { ServerType } from '/@/shared/types/types';

export const LOCAL_LIBRARY_NAME = 'This Mac';

export const useLocalLibrary = createWithEqualityFn<{ folder: string; scanning: boolean }>(() => ({
    folder: '',
    scanning: false,
}));

const signIn = async (info: LocalLibraryInfo) => {
    const { actions, serverList } = useAuthStore.getState();
    const existing = Object.values(serverList).find((s) => s.name === LOCAL_LIBRARY_NAME);
    const data = await api.controller.authenticate(
        info.url,
        { legacy: false, password: info.password, username: info.username },
        ServerType.NAVIDROME,
    );
    if (!data) throw new Error('Could not open the music library on this Mac.');

    const server: ServerListItemWithCredential = {
        credential: data.credential,
        id: existing?.id ?? nanoid(),
        isAdmin: data.isAdmin,
        name: LOCAL_LIBRARY_NAME,
        ndCredential: data.ndCredential,
        type: ServerType.NAVIDROME,
        url: info.url, // the port can change between launches
        userId: data.userId,
        username: data.username,
    };
    if (existing) actions.updateServer(server.id, server);
    else actions.addServer(server);
    actions.setCurrentServer(useAuthStore.getState().serverList[server.id]);
    useLocalLibrary.setState({ folder: info.folder });
    return info;
};

export const connectLocalLibrary = async () => {
    return signIn(await window.api.localLibrary.start());
};

const subsonic = async (endpoint: string, extra = '') => {
    const s = useAuthStore.getState().currentServer;
    if (!s) throw new Error('Your music library is not connected.');
    const res = await fetch(
        `${s.url}/rest/${endpoint}?f=json&v=1.16.1&c=BolBeats&${s.credential}${extra}`,
    );
    return (await res.json())['subsonic-response'];
};

// Asks the library to pick up new, removed or re-tagged files, waits for it, then refreshes every list.
export const rescanLibrary = async (full = false) => {
    useLocalLibrary.setState({ scanning: true });
    try {
        await subsonic('startScan', full ? '&fullScan=true' : '');
        for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            if (!(await subsonic('getScanStatus')).scanStatus?.scanning) break;
        }
        await queryClient.invalidateQueries();
    } finally {
        useLocalLibrary.setState({ scanning: false });
    }
};

// Returns false when the user cancels the folder picker.
export const changeMusicFolder = async (testPath?: string) => {
    const info = await window.api.localLibrary.chooseFolder(testPath);
    if (!info) return false;
    await signIn(info);
    await rescanLibrary();
    window.dispatchEvent(new Event('bolbeats:library-changed')); // folder playlists, song details for the new folder
    return true;
};

// The library's folder watcher picks up songs dropped straight into the music folder by itself (a moment later).
// This notices when it has, refreshes every list and says how many arrived. Local requests only, every 10 s.
let lastScan = '';
let lastCount = -1;
let lastFolder = '';
setInterval(async () => {
    const { folder, scanning } = useLocalLibrary.getState();
    if (!useAuthStore.getState().currentServer || scanning) return;
    const s = (await subsonic('getScanStatus').catch(() => null))?.scanStatus;
    if (!s || s.scanning) return;
    const sameFolder = folder === lastFolder; // a folder switch is not "new music"
    const changed = sameFolder && lastScan && s.lastScan !== lastScan;
    const added = sameFolder && lastCount >= 0 ? s.count - lastCount : 0;
    lastScan = s.lastScan;
    lastCount = s.count;
    lastFolder = folder;
    if (!changed) return;
    await queryClient.invalidateQueries();
    if (added > 0) {
        toast.success({
            message: `${added} new ${added === 1 ? 'song' : 'songs'} in your music folder.`,
            title: 'New music',
        });
        window.dispatchEvent(new Event('bolbeats:library-changed')); // e.g. fill in their details (auto-details.ts)
    }
}, 10_000);
