import { z } from 'zod';

export type Font = {
    label: string;
    value: string;
};

export const FONT_OPTIONS: Font[] = [
    { label: 'Instrument Sans', value: 'Instrument Sans' }, // BolBeats Glow's text face (bundled, OFL)
    { label: 'Inter', value: 'Inter' },
    { label: 'Poppins', value: 'Poppins' },
];

export const FontValueSchema = z.enum(
    FONT_OPTIONS.map((option) => option.value) as [string, ...string[]],
);
