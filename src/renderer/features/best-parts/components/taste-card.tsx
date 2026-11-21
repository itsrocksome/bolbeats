// BolBeats: what BolBeats has learned about your best parts, in plain words, with a way to use it on the parts it
// already found and a way to forget it.
import { useState } from 'react';

import styles from './best-parts.module.css';

import { repickAutoParts } from '/@/renderer/features/best-parts/auto-hooks';
import { isDisliked, learn } from '/@/renderer/features/best-parts/engine/taste-learn';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { forgetTaste, useTaste } from '/@/renderer/features/best-parts/store/taste.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TasteCard = () => {
    const taste = useTaste();
    const parts = useBestPartsStore((s) => s.parts);
    const [busy, setBusy] = useState<null | string>(null);
    const t = learn(taste);
    const ids = Object.keys(parts);
    const up = ids.filter((id) => taste.votes[id] === 1).length;
    const down = ids.filter((id) => taste.votes[id] === -1).length;
    const skipped = ids.filter((id) => !taste.votes[id] && isDisliked(taste, id)).length;
    const nothing = !t.edits && !up && !down && !skipped;

    const lines = [
        t.minPart
            ? `You like parts of about ${Math.round(t.minPart / 0.9)} seconds, so new ones are at least ${t.minPart}.`
            : `Trim or stretch a few parts BolBeats found and it learns how long you like them (${t.edits} of 3 so far).`,
        t.leadIn
            ? t.leadIn > 0
                ? `You like to start ${plural(t.leadIn, 'second')} early, with the build-up.`
                : `You like to start ${plural(-t.leadIn, 'second')} in, right on the hook.`
            : null,
        up || down
            ? `${plural(up, 'part')} with a thumbs up, ${plural(down, 'part')} with a thumbs down.`
            : 'Use the thumbs in the player while a part plays: thumbs down leaves a part out of what BolBeats plays for you.',
        skipped
            ? `${plural(skipped, 'part')} left out because you keep skipping ${skipped === 1 ? 'it' : 'them'}.`
            : null,
    ].filter(Boolean);

    const repick = async () => {
        setBusy('Starting…');
        try {
            const n = await repickAutoParts((done, total) =>
                setBusy(`Song ${Math.min(done + 1, total)} of ${total}…`),
            );
            toast.success({
                message: n
                    ? `${plural(n, 'part')} picked again the way you like them. Playlists BolBeats made have them now.`
                    : 'The parts BolBeats found already fit what it learned.',
                title: 'Best parts updated',
            });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.tune}>
            <div>
                <Text fw={700}>What BolBeats has learned</Text>
                {lines.map((l) => (
                    <Text isMuted key={l} size="sm">
                        {l}
                    </Text>
                ))}
            </div>
            <Group gap="xs" wrap="nowrap">
                {(t.minPart || t.leadIn) && (
                    <Button disabled={!!busy} onClick={repick} variant="filled">
                        {busy ?? 'Re-pick the parts BolBeats found'}
                    </Button>
                )}
                {!nothing && (
                    <Button
                        disabled={!!busy}
                        onClick={() => {
                            forgetTaste();
                            toast.info({
                                message: 'BolBeats starts learning your taste from scratch.',
                            });
                        }}
                        variant="subtle"
                    >
                        Forget
                    </Button>
                )}
            </Group>
        </div>
    );
};
