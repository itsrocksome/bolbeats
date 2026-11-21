import { useCallback } from 'react';

import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useCurrentServerId } from '/@/renderer/store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

interface PlayActionProps {
    ids: string[];
    itemType: LibraryItem;
    songs?: Song[];
}

export const PlayAction = ({ ids, itemType, songs }: PlayActionProps) => {
    const player = usePlayer();
    const serverId = useCurrentServerId();

    const handlePlay = useCallback(
        (playType: Play) => {
            if (ids.length === 0 || !serverId) return;

            if (
                itemType === LibraryItem.SONG ||
                itemType === LibraryItem.PLAYLIST_SONG ||
                itemType === LibraryItem.QUEUE_SONG
            ) {
                player.addToQueueByData(songs || [], playType);
            } else {
                player.addToQueueByFetch(serverId, ids, itemType, playType);
            }
        },
        [ids, itemType, player, serverId, songs],
    );

    const handlePlayNow = useCallback(() => {
        handlePlay(Play.NOW);
    }, [handlePlay]);

    const handlePlayNext = useCallback(() => {
        handlePlay(Play.NEXT);
    }, [handlePlay]);

    const handlePlayLast = useCallback(() => {
        handlePlay(Play.LAST);
    }, [handlePlay]);

    const handlePlayShuffled = useCallback(() => {
        handlePlay(Play.SHUFFLE);
    }, [handlePlay]);

    const handlePlayNextShuffled = useCallback(() => {
        handlePlay(Play.NEXT_SHUFFLE);
    }, [handlePlay]);

    const handlePlayLastShuffled = useCallback(() => {
        handlePlay(Play.LAST_SHUFFLE);
    }, [handlePlay]);

    if (ids.length === 0) return null;

    // BolBeats: the everyday choices sit at the top of the menu in plain words; shuffled variants live in a submenu
    return (
        <>
            <ContextMenu.Item leftIcon="mediaPlay" onSelect={handlePlayNow}>
                Play now
            </ContextMenu.Item>
            <ContextMenu.Item leftIcon="mediaPlayNext" onSelect={handlePlayNext}>
                Play next
            </ContextMenu.Item>
            <ContextMenu.Item leftIcon="mediaPlayLast" onSelect={handlePlayLast}>
                Add to queue
            </ContextMenu.Item>
            <ContextMenu.Submenu>
                <ContextMenu.SubmenuTarget>
                    <ContextMenu.Item
                        leftIcon="mediaShuffle"
                        onSelect={handlePlayShuffled}
                        rightIcon="arrowRightS"
                    >
                        Shuffle
                    </ContextMenu.Item>
                </ContextMenu.SubmenuTarget>
                <ContextMenu.SubmenuContent>
                    <ContextMenu.Item leftIcon="mediaShuffle" onSelect={handlePlayShuffled}>
                        Shuffle and play now
                    </ContextMenu.Item>
                    <ContextMenu.Item leftIcon="mediaPlayNext" onSelect={handlePlayNextShuffled}>
                        Shuffle and play next
                    </ContextMenu.Item>
                    <ContextMenu.Item leftIcon="mediaPlayLast" onSelect={handlePlayLastShuffled}>
                        Shuffle and add to queue
                    </ContextMenu.Item>
                </ContextMenu.SubmenuContent>
            </ContextMenu.Submenu>
        </>
    );
};
