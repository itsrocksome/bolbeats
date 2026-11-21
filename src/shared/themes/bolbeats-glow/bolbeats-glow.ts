// BolBeats Glow: the playing song's cover is the room. Its colours blur across the whole window (now-playing-glow.ts
// sets --bb-cover and --bb-glow), the sidebar and player float on it as glass, and the one bright accent marks best parts.
import overridesCss from './bolbeats-glow.css?inline';

import { AppThemeConfiguration } from '/@/shared/themes/app-theme-types';

export const bolbeatsGlow: AppThemeConfiguration = {
    app: {
        'overlay-header': 'linear-gradient(transparent 0%, rgb(14 6 20 / 70%) 100%)',
        'overlay-subheader': 'linear-gradient(180deg, transparent 0%, transparent 100%)',
        'scrollbar-handle-background': 'rgb(255 255 255 / 14%)',
        'scrollbar-handle-border-radius': '8px',
        'scrollbar-handle-hover-background': 'rgb(255 255 255 / 28%)',
    },
    colors: {
        background: 'rgb(18, 8, 24)',
        'background-alternate': 'rgb(14, 6, 19)',
        black: 'rgb(8, 3, 12)',
        foreground: 'rgb(251, 247, 255)',
        'foreground-muted': 'rgb(214, 202, 226)',
        primary: 'rgb(255, 122, 209)',
        'state-error': 'rgb(255, 120, 130)',
        'state-info': 'rgb(150, 200, 255)',
        'state-success': 'rgb(120, 222, 170)',
        'state-warning': 'rgb(255, 205, 110)',
        surface: 'rgb(255, 255, 255, 0.07)',
        'surface-foreground': 'rgb(244, 236, 250)',
        white: 'rgb(255, 252, 255)',
    },
    mantineOverride: {
        autoContrast: true, // dark text on the pink accent
        primaryShade: { dark: 4, light: 6 },
    },
    mode: 'dark',
    stylesheets: [overridesCss],
};
