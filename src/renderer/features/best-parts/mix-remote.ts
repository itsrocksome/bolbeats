// BolBeats: the Mac's media keys, the menu bar and Dock menus, and Now Playing control a best-parts playlist while one
// is on (it plays outside the main player, so they used to resume the last regular song instead). Side-effect import in
// app.tsx; the key and menu listeners (use-main-player-listener, use-media-session) ask `mixCommand` first.
import {
    skipMixPart,
    stopMix,
    toggleMixPause,
    useMixPlayer,
} from '/@/renderer/features/best-parts/mix-player';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { PlayerStatus } from '/@/shared/types/types';

export type MixCommand = 'next' | 'pause' | 'play' | 'previous' | 'stop' | 'toggle';

export const mixActive = () => {
    const s = useMixPlayer.getState();
    return s.status !== 'idle' && !s.preview;
};

// true when a best-parts playlist took the command (the main player must then leave it alone)
export const mixCommand = (cmd: MixCommand): boolean => {
    if (!mixActive()) return false;
    const { status } = useMixPlayer.getState();
    if (
        cmd === 'toggle' ||
        (cmd === 'play' && status === 'paused') ||
        (cmd === 'pause' && status === 'playing')
    )
        void toggleMixPause();
    else if (cmd === 'next') skipMixPart(1);
    else if (cmd === 'previous') skipMixPart(-1);
    else if (cmd === 'stop') stopMix();
    return true;
};

// Menus show Play or Pause from this, and Now Playing shows the playing part.
const report = () => {
    const s = useMixPlayer.getState();
    const api = (window as any).api?.mpris;
    if (s.preview) return;
    if (s.status === 'idle') {
        api?.updateStatus?.(usePlayerStoreBase.getState().player.status);
        return;
    }
    api?.updateStatus?.(s.status === 'paused' ? PlayerStatus.PAUSED : PlayerStatus.PLAYING);
    const part = useBestPartsStore.getState().parts[s.partIds[s.index]];
    if (part && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
            album: s.label ? `Best parts: ${s.label}` : 'Best parts',
            artist: part.artist,
            artwork: part.imageUrl ? [{ src: part.imageUrl }] : [],
            title: part.title,
        });
        navigator.mediaSession.playbackState = s.status === 'paused' ? 'paused' : 'playing';
    }
};
useMixPlayer.subscribe((s, prev) => {
    if (s.status !== prev.status || s.index !== prev.index || s.mixId !== prev.mixId) report();
});
