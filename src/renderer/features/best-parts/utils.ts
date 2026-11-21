import { useAuthStore } from '/@/renderer/store/auth.store';

export const formatClock = (t: number, tenths = false) => {
    if (!Number.isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${(tenths ? s.toFixed(1) : String(Math.floor(s))).padStart(tenths ? 4 : 2, '0')}`;
};

// Cover art straight from the library by song id: always current (even after re-tagging) and port-proof.
export const coverUrl = (songId: string) => {
    const s = useAuthStore.getState().currentServer;
    return s
        ? `${s.url}/rest/getCoverArt?id=${encodeURIComponent(songId)}&size=300&c=BolBeats&v=1.16.1&${s.credential}`
        : undefined;
};
