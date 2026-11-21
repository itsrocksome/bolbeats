// BolBeats: counts listening time, songs, best-parts playlists and parts as they play. Imported once by app.tsx.
import { useMixPlayer } from '/@/renderer/features/best-parts/mix-player';
import { counted, listened } from '/@/renderer/features/listening/listening.store';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { PlayerStatus } from '/@/shared/types/types';

const TICK = 15;

// A song counts once it has really played for a tick (restoring the queue at launch or a quick skip doesn't).
let lastCounted: string | undefined;
setInterval(() => {
    const player = usePlayerStoreBase.getState();
    const playing = player.player.status === PlayerStatus.PLAYING;
    if (playing || useMixPlayer.getState().status === 'playing') listened(TICK);
    const song = playing ? player.getCurrentSong() : undefined;
    if (song && song._uniqueId !== lastCounted) {
        lastCounted = song._uniqueId;
        counted('songs', song.id);
    }
}, TICK * 1000);

useMixPlayer.subscribe((s, prev) => {
    if (s.preview) return;
    if (s.status === 'playing' && prev.status === 'loading' && s.mixId) counted('mixes', s.mixId);
    if (s.status !== 'idle' && s.index >= 0 && s.index !== prev.index)
        counted('parts', s.partIds[s.index]);
});
