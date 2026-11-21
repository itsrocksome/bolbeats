// BolBeats: pure colour helper for now-playing-glow (no imports, so tests can load it).
// Dark covers still light the room (lightness and saturation floors); grey ones fall back to velvet (null).
export const lift = (rgb: string): null | string => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? []).map((n) => Number(n) / 255);
    if (b === undefined) return null;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.06) return null;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return `hsl(${Math.round(h * 60 + 360) % 360} ${Math.round(Math.max(s, 0.45) * 100)}% ${Math.round(Math.min(Math.max(l, 0.42), 0.62) * 100)}%)`;
};
