// BolBeats: the "best parts" entry points for a playlist: opening the maker, and the playlist page button.
import { openContextModal } from '@mantine/modals';
import { generatePath, useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { playMixById } from '/@/renderer/features/best-parts/mix-player';
import {
    mixForPlaylist,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { toast } from '/@/shared/components/toast/toast';

export const openPlaylistHooks = async (playlistId: string, name: string) => {
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return;
    const res = await api.controller.getPlaylistSongList({
        apiClientProps: { serverId },
        query: { id: playlistId },
    });
    if (!res?.items?.length) {
        toast.info({ message: 'Add some songs to this playlist first.' });
        return;
    }
    openContextModal({
        innerProps: { name, playlistId, songs: res.items },
        modal: 'bestPartsFromPlaylist',
        size: 'lg',
        title: `Best-parts version of “${name}”`,
    });
};

// On a playlist page: play its best-parts version, or make one.
export const PlaylistBestPartsButton = ({
    name,
    playlistId,
}: {
    name: string;
    playlistId: string;
}) => {
    const navigate = useNavigate();
    const version = useBestPartsStore((s) => mixForPlaylist(s.mixes, playlistId));
    if (!version) {
        return (
            <Button
                leftSection={<Icon icon="bestParts" />}
                onClick={() => openPlaylistHooks(playlistId, name)}
                variant="default"
            >
                Make best-parts version
            </Button>
        );
    }
    return (
        <Group gap={6} wrap="nowrap">
            <Button
                leftSection={<Icon icon="bestParts" />}
                onClick={() => playMixById(version.id)}
                variant="filled"
            >
                Play best parts
            </Button>
            <ActionIcon
                aria-label="Open the best-parts version"
                icon="arrowRightS"
                iconProps={{ size: 'md' }}
                onClick={() =>
                    navigate(generatePath(AppRoute.BEST_PARTS_MIX, { mixId: version.id }))
                }
                size="input-sm"
                tooltip={{ label: 'Open the best-parts version' }}
                variant="default"
            />
        </Group>
    );
};
