// BolBeats: player-bar button to mark a best part while a song plays (also the B key).
import { toggleMarkMoment, useMarkMoment } from '/@/renderer/features/best-parts/mix-player';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';

export const MarkMomentButton = () => {
    const marking = useMarkMoment((s) => s.songId !== null);
    return (
        <ActionIcon
            aria-pressed={marking}
            icon="bestParts"
            iconProps={{ color: marking ? 'primary' : undefined, size: 'lg' }}
            onClick={(e) => {
                e.stopPropagation();
                toggleMarkMoment();
            }}
            size="sm"
            tooltip={{
                label: marking
                    ? 'Press again where the part ends (B)'
                    : 'Mark a best part from here (B)',
                openDelay: 500,
            }}
            variant="subtle"
        />
    );
};
