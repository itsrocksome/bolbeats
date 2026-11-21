import clsx from 'clsx';
import { lazy, MouseEvent, Suspense, useRef } from 'react';

import styles from './playerbar.module.css';

import { MixBarControls, MixBarNow } from '/@/renderer/features/best-parts/components/shared';
import { useMixPlayer } from '/@/renderer/features/best-parts/mix-player';
import { CenterControls } from '/@/renderer/features/player/components/center-controls';
import { LeftControls } from '/@/renderer/features/player/components/left-controls';
import { RightControls } from '/@/renderer/features/player/components/right-controls';
import { useIsMobile } from '/@/renderer/hooks/use-is-mobile';
import { Spinner } from '/@/shared/components/spinner/spinner';

const MobilePlayerbar = lazy(() =>
    import('./mobile-playerbar').then((module) => ({
        default: module.MobilePlayerbar,
    })),
);
import { useFullScreenPlayerStore, useSetFullScreenPlayerStore } from '/@/renderer/store';
import { usePlayerbarOpenDrawer } from '/@/renderer/store';
import { PlaybackSelectors } from '/@/shared/constants/playback-selectors';

export const Playerbar = () => {
    const playerbarOpenDrawer = usePlayerbarOpenDrawer();
    const { expanded: isFullScreenPlayerExpanded } = useFullScreenPlayerStore();
    const setFullScreenPlayerStore = useSetFullScreenPlayerStore();
    const isMobile = useIsMobile();
    const mixOn = useMixPlayer((s) => s.status !== 'idle'); // BolBeats: a playing best-parts playlist takes over the bar

    const mouseDownTarget = useRef<EventTarget | null>(null);

    const handleToggleFullScreenPlayer = (e?: KeyboardEvent | MouseEvent<HTMLDivElement>) => {
        e?.stopPropagation();
        if (e && e.target !== mouseDownTarget.current) return;
        setFullScreenPlayerStore({ expanded: !isFullScreenPlayerExpanded });
    };

    if (isMobile) {
        return (
            <Suspense fallback={<Spinner />}>
                <MobilePlayerbar />
            </Suspense>
        );
    }

    return (
        <div
            className={clsx(styles.container, PlaybackSelectors.mediaPlayer)}
            onClick={playerbarOpenDrawer ? handleToggleFullScreenPlayer : undefined}
            onMouseDownCapture={(e) => {
                mouseDownTarget.current = e.target;
            }}
        >
            <div className={styles.controlsGrid}>
                <div className={styles.leftGridItem}>
                    {mixOn ? <MixBarNow /> : <LeftControls />}
                </div>
                <div className={styles.centerGridItem}>
                    {mixOn ? <MixBarControls /> : <CenterControls />}
                </div>
                <div className={styles.rightGridItem}>
                    <RightControls />
                </div>
            </div>
        </div>
    );
};
