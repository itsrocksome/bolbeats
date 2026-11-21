import clsx from 'clsx';

import styles from './player-bar.module.css';

import { Playerbar } from '/@/renderer/features/player/components/playerbar';
import { usePlayerbarOpenDrawer } from '/@/renderer/store';

export const PlayerBar = () => {
    const playerbarOpenDrawer = usePlayerbarOpenDrawer();

    return (
        <div
            aria-label="Player" // BolBeats: a named landmark, so screen readers can jump to it
            className={clsx({
                [styles.container]: true,
                [styles.openDrawer]: playerbarOpenDrawer,
            })}
            id="player-bar"
            role="region"
        >
            <Playerbar />
        </div>
    );
};
