// BolBeats: the room takes the colour of what's playing. Sets --bb-cover (the cover itself, blurred into the window
// by the Glow theme) and --bb-glow (its dominant colour, lifted) from the current song's cover, or the current part's
// cover while a best-parts mix plays.
import { useMixPlayer } from '/@/renderer/features/best-parts/mix-player';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { coverUrl } from '/@/renderer/features/best-parts/utils';
import { lift } from '/@/renderer/features/now-playing-glow/lift';
import { getFastAverageColor } from '/@/renderer/hooks/use-fast-average-color';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { subscribeCurrentTrack, usePlayerStoreBase } from '/@/renderer/store/player.store';
import { loadsAsPlaceholder } from '/@/shared/components/image/server-placeholder';

let shown: null | string = null;

const glowFrom = async (src: null | string) => {
    if (src === shown) return;
    shown = src;
    // Navidrome's stand-in picture for songs without artwork would paint the whole room its blue; skip it.
    const real = src && !(await loadsAsPlaceholder(src)) ? src : null;
    if (shown !== src) return;
    const measured = real ? await getFastAverageColor({ src: real }).catch(() => null) : null;
    if (shown !== src) return; // a newer cover arrived while this one was measured
    const color = measured && lift(measured);
    const root = document.documentElement.style;
    if (color) root.setProperty('--bb-glow', color);
    else root.removeProperty('--bb-glow'); // back to the default
    if (src && measured) root.setProperty('--bb-cover', `url("${src}")`);
    else root.removeProperty('--bb-cover');
};

const update = () => {
    const mix = useMixPlayer.getState();
    if (mix.status !== 'idle' && mix.index >= 0) {
        const part = useBestPartsStore.getState().parts[mix.partIds[mix.index]];
        if (part) return glowFrom(coverUrl(part.songId) ?? null);
    }
    const song = usePlayerStoreBase.getState().getCurrentSong();
    return glowFrom(song ? (coverUrl(song.id) ?? null) : null);
};

subscribeCurrentTrack(update);
useMixPlayer.subscribe(update);
useAuthStore.subscribe(update); // cover URLs need the library's address, known once it has started
update();
