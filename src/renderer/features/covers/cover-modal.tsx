// BolBeats: "Change cover" for a playlist or best-parts playlist: generated designs, an emoji, or your own picture.
import type { ContextModalProps } from '@mantine/modals';

import { openContextModal } from '@mantine/modals';
import clsx from 'clsx';
import { useMemo, useRef, useState } from 'react';

import styles from './covers.module.css';

import { type Cover, useCovers } from '/@/renderer/features/covers/covers.store';
import { drawCover, drawEmoji, drawPicture, STYLES } from '/@/renderer/features/covers/generate';
import { Button } from '/@/shared/components/button/button';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

type Props = { coverKey: string; name: string };

const EMOJIS = [
    '🎧',
    '🎶',
    '🔥',
    '💃',
    '🕺',
    '🌙',
    '🚗',
    '🌧️',
    '☀️',
    '💜',
    '🪩',
    '🎸',
    '🥁',
    '🎹',
    '🪕',
    '🎤',
    '🌊',
    '✨',
    '❤️‍🔥',
    '🙏',
    '🏏',
    '🪔',
    '🌸',
    '🍵',
];
const HUES = [330, 280, 220, 180, 140, 40, 15, 0];

export const openCoverPicker = (coverKey: string, name: string) =>
    openContextModal({
        innerProps: { coverKey, name },
        modal: 'changeCover',
        size: 'lg',
        title: `Cover for “${name}”`,
    });

export const CoverModal = ({ context, id, innerProps }: ContextModalProps<Props>) => {
    const { coverKey, name } = innerProps;
    const current = useCovers((s) => s.covers[coverKey]);
    const [tab, setTab] = useState<'designs' | 'emoji' | 'picture'>('designs');
    const [round, setRound] = useState(0);
    const [emoji, setEmoji] = useState('🎧');
    const [hue, setHue] = useState(HUES[0]);
    const [picked, setPicked] = useState<Cover | null>(null);
    const file = useRef<HTMLInputElement>(null);

    const designs = useMemo(
        () => STYLES.map((style) => drawCover(style, `${name}#${round}`)),
        [name, round],
    );
    const emojiCover = useMemo(
        () => (tab === 'emoji' && emoji.trim() ? drawEmoji(emoji.trim(), hue) : null),
        [tab, emoji, hue],
    );
    const preview =
        picked?.dataUrl ?? (tab === 'emoji' ? emojiCover : null) ?? current?.dataUrl ?? null;

    const save = () => {
        const cover =
            picked ??
            (tab === 'emoji' && emojiCover
                ? { dataUrl: emojiCover, kind: 'emoji' as const }
                : null);
        if (!cover) return;
        useCovers.getState().setCover(coverKey, cover);
        context.closeModal(id);
    };

    return (
        <div className={styles.modal}>
            <div className={styles.top}>
                <div aria-label="Preview" className={styles.preview} role="img">
                    {preview ? (
                        <img alt="" src={preview} />
                    ) : (
                        <Text isMuted size="sm">
                            Pick a cover
                        </Text>
                    )}
                </div>
                <div className={styles.side}>
                    <SegmentedControl
                        aria-label="Kind of cover"
                        data={[
                            { label: 'Designs', value: 'designs' },
                            { label: 'Emoji', value: 'emoji' },
                            { label: 'Picture', value: 'picture' },
                        ]}
                        onChange={(v) => (setTab(v as typeof tab), setPicked(null))}
                        value={tab}
                    />
                    {tab === 'designs' && (
                        <Text isMuted size="sm">
                            Drawn from the playlist’s name. Press More for new ones.
                        </Text>
                    )}
                    {tab === 'emoji' && (
                        <Text isMuted size="sm">
                            Any emoji on a colour you like.
                        </Text>
                    )}
                    {tab === 'picture' && (
                        <Text isMuted size="sm">
                            A photo or image from your Mac, cropped to a square.
                        </Text>
                    )}
                </div>
            </div>

            {tab === 'designs' && (
                <>
                    <div className={styles.grid}>
                        {designs.map((url, i) => (
                            <button
                                aria-label={`Design ${i + 1}: ${STYLES[i]}`}
                                aria-pressed={picked?.dataUrl === url}
                                className={clsx(styles.tile, picked?.dataUrl === url && styles.on)}
                                key={url.slice(-40)}
                                onClick={() => setPicked({ dataUrl: url, kind: 'art' })}
                                type="button"
                            >
                                <img alt="" src={url} />
                            </button>
                        ))}
                    </div>
                    <Button
                        onClick={() => (setRound(round + 1), setPicked(null))}
                        variant="default"
                    >
                        More designs
                    </Button>
                </>
            )}

            {tab === 'emoji' && (
                <>
                    <div className={styles.emojis}>
                        {EMOJIS.map((e) => (
                            <button
                                aria-label={e}
                                aria-pressed={emoji === e}
                                className={clsx(styles.emoji, emoji === e && styles.on)}
                                key={e}
                                onClick={() => setEmoji(e)}
                                type="button"
                            >
                                {e}
                            </button>
                        ))}
                    </div>
                    <TextInput
                        label="Or type any emoji"
                        maxLength={8}
                        onChange={(e) => setEmoji(e.currentTarget.value)}
                        value={emoji}
                    />
                    <div aria-label="Background colour" className={styles.hues} role="radiogroup">
                        {HUES.map((h) => (
                            <button
                                aria-checked={hue === h}
                                aria-label={`Colour ${h}`}
                                className={clsx(styles.hue, hue === h && styles.on)}
                                key={h}
                                onClick={() => setHue(h)}
                                role="radio"
                                style={{
                                    background: `linear-gradient(135deg, hsl(${h} 85% 62%), hsl(${h + 50} 70% 32%))`,
                                }}
                                type="button"
                            />
                        ))}
                    </div>
                </>
            )}

            {tab === 'picture' && (
                <>
                    <input
                        accept="image/*"
                        hidden
                        onChange={async (e) => {
                            const f = e.currentTarget.files?.[0];
                            if (!f) return;
                            try {
                                setPicked({ dataUrl: await drawPicture(f), kind: 'picture' });
                            } catch (err) {
                                toast.error({
                                    message: (err as Error).message,
                                    title: 'Couldn’t use that picture',
                                });
                            }
                        }}
                        ref={file}
                        type="file"
                    />
                    <Button onClick={() => file.current?.click()} variant="default">
                        Choose a picture…
                    </Button>
                </>
            )}

            <div className={styles.actions}>
                {current && (
                    <Button
                        onClick={() => {
                            useCovers.getState().removeCover(coverKey);
                            context.closeModal(id);
                        }}
                        variant="subtle"
                    >
                        Use the automatic cover
                    </Button>
                )}
                <Button onClick={() => context.closeModal(id)} variant="default">
                    Cancel
                </Button>
                <Button
                    disabled={!(picked || (tab === 'emoji' && emojiCover))}
                    onClick={save}
                    variant="filled"
                >
                    Use this cover
                </Button>
            </div>
        </div>
    );
};
