// BolBeats: one place to look after the library: the music folder (songs + playlist files + backup), song details,
// playlist cloning.
import { useEffect, useState } from 'react';

import styles from '../library-tools.module.css';

import {
    relinkParts,
    relinkPlaylists,
    restoreFromFolder,
    saveToFolder,
    useFolderSync,
} from '/@/renderer/features/bolify-folder/folder-sync';
import { PlaylistCloner } from '/@/renderer/features/library-tools/components/playlist-cloner';
import { SongDetailsFixer } from '/@/renderer/features/library-tools/components/song-details-fixer';
import { StarterSongs } from '/@/renderer/features/library-tools/components/starter-songs';
import {
    changeMusicFolder,
    rescanLibrary,
    useLocalLibrary,
} from '/@/renderer/features/local-library/connect-local-library';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const LibraryToolsRoute = () => {
    const { folder, scanning } = useLocalLibrary();
    const [changing, setChanging] = useState(false);

    const sync = useFolderSync();
    const [now] = useState(Date.now);
    const [bringing, setBringing] = useState<null | string>(null);
    const [, tick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 30_000); // keeps "saved N min ago" fresh
        return () => clearInterval(t);
    }, []);

    const bringIn = async () => {
        const off = window.api.bolifyFolder.onBringInProgress(({ done, name }) =>
            setBringing(`${done}: ${name}`),
        );
        setBringing('');
        try {
            const res = await window.api.bolifyFolder.bringIn();
            if (!res) return;
            if (res.copied) await rescanLibrary();
            toast.success({
                message: `${res.copied} copied${res.skipped ? `, ${res.skipped} already there` : ''}${res.failed.length ? `, ${res.failed.length} couldn’t be read` : ''}. Your originals weren’t touched.`,
                title: res.copied ? 'Songs brought in' : 'Nothing new to bring in',
            });
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t bring songs in' });
        } finally {
            off();
            setBringing(null);
        }
    };

    const restore = async () => {
        try {
            const res = await restoreFromFolder();
            if (!res) {
                toast.info({ message: 'There’s no BolBeats backup in this music folder yet.' });
                return;
            }
            toast.success({
                message: `${res.restored} best parts and ${res.playlists} playlists brought back${res.missing ? `; ${res.missing} parts’ songs aren’t in this folder` : ''}.`,
                title: 'Restored from your folder',
            });
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t restore' });
        }
    };

    const change = async () => {
        setChanging(true);
        try {
            await saveToFolder(true); // the old folder keeps an up-to-date copy
            if (await changeMusicFolder()) {
                const moved = await relinkParts();
                const res = await restoreFromFolder().catch(() => null);
                const fixed = await relinkPlaylists().catch(() => 0);
                toast.success({
                    message: `Your library now reads from the new folder.${moved ? ` ${moved} best parts found their songs there.` : ''}${fixed ? ` ${fixed} playlist songs found there.` : ''}${res?.restored ? ` ${res.restored} restored from its BolBeats folder.` : ''}`,
                    title: 'Music folder changed',
                });
                saveToFolder(true);
            }
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t switch folders' });
        } finally {
            setChanging(false);
        }
    };

    return (
        <AnimatedPage scroll>
            <div className={styles.page}>
                <header className={styles.hero}>
                    <h1>Your library</h1>
                    <Text isMuted>
                        Where your music lives, the details that make it look good, and playlists
                        brought over from other apps.
                    </Text>
                </header>

                <section aria-labelledby="lt-folder" className={styles.section}>
                    <h2 id="lt-folder">Music folder</h2>
                    <div className={styles.folder}>
                        <Icon icon="folder" size="xl" />
                        <code title={folder}>{folder || 'Starting…'}</code>
                        <Button loading={changing} onClick={change} variant="default">
                            Change folder
                        </Button>
                        <Button
                            leftSection={<Icon icon="refresh" />}
                            loading={scanning}
                            onClick={() => rescanLibrary()}
                            variant="subtle"
                        >
                            Rescan
                        </Button>
                    </div>
                    <Text isMuted size="sm">
                        New songs in this folder appear on their own; rescan if something is
                        missing.
                    </Text>

                    <div className={styles.home}>
                        <div>
                            <Text fw={700}>One home for your music</Text>
                            <Text isMuted size="sm">
                                Bring songs in from anywhere: they’re copied here and sorted by
                                artist and album, and your originals stay untouched (delete them
                                yourself if you like). Every playlist and best-parts playlist is
                                also saved as a file in the <b>BolBeats</b> folder inside, so they
                                stay with your music even without the app. VLC plays the best parts
                                straight from those files.
                            </Text>
                            <Text className={styles.saved} size="sm">
                                {sync.saving
                                    ? 'Saving playlists to the folder…'
                                    : sync.error
                                      ? `Couldn’t save to the folder: ${sync.error}`
                                      : sync.savedAt
                                        ? `Playlists and best parts saved to the folder ${Math.max(0, Math.round((now - sync.savedAt) / 60_000)) || 'less than 1'} min ago`
                                        : 'Playlists and best parts are saved to the folder automatically.'}
                            </Text>
                        </div>
                        <div className={styles.actions}>
                            <Button
                                leftSection={<Icon icon="add" />}
                                loading={bringing !== null}
                                onClick={bringIn}
                                variant="filled"
                            >
                                Bring songs in
                            </Button>
                            <Button
                                leftSection={<Icon icon="folder" />}
                                onClick={() => window.api.bolifyFolder.openFolder()}
                                variant="default"
                            >
                                Show in Finder
                            </Button>
                            <Button
                                loading={sync.saving}
                                onClick={() => saveToFolder(true)}
                                variant="default"
                            >
                                Save now
                            </Button>
                            <Button onClick={restore} variant="subtle">
                                Restore from this folder
                            </Button>
                        </div>
                        {bringing && (
                            <Text isMuted size="sm" truncate>
                                Copying {bringing}
                            </Text>
                        )}
                    </div>
                    <StarterSongs />
                </section>

                <section aria-labelledby="lt-details" className={styles.section}>
                    <h2 id="lt-details">Song details</h2>
                    <SongDetailsFixer />
                </section>

                <section aria-labelledby="lt-clone" className={styles.section}>
                    <h2 id="lt-clone">Bring a playlist over</h2>
                    <PlaylistCloner />
                </section>
            </div>
        </AnimatedPage>
    );
};

const LibraryToolsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <LibraryToolsRoute />
    </PageErrorBoundary>
);

export default LibraryToolsRouteWithBoundary;
