// BolBeats: playlist covers drawn in code. Six generative styles, each seeded by a string (the playlist name plus a
// variation number) so a playlist always gets the same picture until you ask for another; emoji covers; and photos
// cropped to a square. Everything becomes a 600 px image (data URL) so it shows like any other cover.

export const STYLES = ['waves', 'rings', 'tiles', 'bloom', 'bars', 'rays'] as const;
export type CoverStyle = (typeof STYLES)[number];

const SIZE = 600;

// Small seeded random numbers (mulberry32), so the same seed draws the same cover.
const rng = (seed: string) => {
    let h = 1779033703;
    for (const ch of seed) {
        h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        const t = (h ^= h >>> 16) >>> 0;
        return t / 4294967296;
    };
};

const canvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    return [c, c.getContext('2d')!] as const;
};

const hsl = (h: number, s: number, l: number, a = 1) =>
    `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;

export const drawCover = (style: CoverStyle, seed: string) => {
    const r = rng(`${style}:${seed}`);
    const [c, g] = canvas();
    const h1 = Math.floor(r() * 360);
    const h2 = h1 + 40 + Math.floor(r() * 110);
    const h3 = h2 + 60 + Math.floor(r() * 60);
    const dark = '#140a1c';

    if (style === 'waves') {
        const bg = g.createLinearGradient(0, 0, SIZE, SIZE);
        bg.addColorStop(0, hsl(h1, 80, 58));
        bg.addColorStop(1, hsl(h2, 70, 30));
        g.fillStyle = bg;
        g.fillRect(0, 0, SIZE, SIZE);
        for (let k = 0; k < 7; k++) {
            const amp = 20 + r() * 60;
            const freq = 1 + r() * 2.5;
            const phase = r() * Math.PI * 2;
            const base = SIZE * (0.25 + k * 0.1);
            g.beginPath();
            g.moveTo(0, SIZE);
            for (let x = 0; x <= SIZE; x += 6)
                g.lineTo(x, base + amp * Math.sin((x / SIZE) * Math.PI * 2 * freq + phase));
            g.lineTo(SIZE, SIZE);
            g.closePath();
            g.fillStyle = hsl(k % 2 ? h2 : h3, 75, 40 + k * 5, 0.28);
            g.fill();
        }
    } else if (style === 'rings') {
        g.fillStyle = dark;
        g.fillRect(0, 0, SIZE, SIZE);
        const cx = SIZE * (0.35 + r() * 0.3);
        const cy = SIZE * (0.35 + r() * 0.3);
        g.lineCap = 'round';
        for (let k = 0; k < 9; k++) {
            const rad = 40 + k * 34;
            g.lineWidth = 10;
            g.strokeStyle = hsl(h1, 30, 70, 0.14);
            g.beginPath();
            g.arc(cx, cy, rad, 0, Math.PI * 2);
            g.stroke();
            const a0 = r() * Math.PI * 2;
            g.strokeStyle = hsl(k % 3 === 0 ? h2 : h1, 90, 66);
            g.shadowColor = g.strokeStyle;
            g.shadowBlur = 18;
            g.beginPath();
            g.arc(cx, cy, rad, a0, a0 + 0.4 + r() * 1.6);
            g.stroke();
            g.shadowBlur = 0;
        }
    } else if (style === 'tiles') {
        const n = 5 + Math.floor(r() * 4);
        const t = SIZE / n;
        g.fillStyle = hsl(h1, 70, 22);
        g.fillRect(0, 0, SIZE, SIZE);
        g.lineWidth = t * 0.22;
        g.lineCap = 'round';
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
                const x = i * t;
                const y = j * t;
                g.strokeStyle = r() < 0.5 ? hsl(h2, 85, 62) : hsl(h3, 80, 55);
                g.beginPath();
                if (r() < 0.5) {
                    g.arc(x, y, t / 2, 0, Math.PI / 2);
                    g.moveTo(x + t, y + t / 2);
                    g.arc(x + t, y + t, t / 2, -Math.PI / 2, Math.PI, true);
                } else {
                    g.arc(x + t, y, t / 2, Math.PI / 2, Math.PI);
                    g.moveTo(x + t / 2, y + t);
                    g.arc(x, y + t, t / 2, -Math.PI / 2, 0);
                }
                g.stroke();
            }
    } else if (style === 'bloom') {
        g.fillStyle = hsl(h1, 60, 18);
        g.fillRect(0, 0, SIZE, SIZE);
        g.filter = 'blur(60px)';
        for (const [h, k] of [
            [h1, 0],
            [h2, 1],
            [h3, 2],
            [h2 + 20, 3],
        ] as const) {
            g.fillStyle = hsl(h, 85, 60, 0.85);
            g.beginPath();
            g.arc(
                SIZE * (0.15 + r() * 0.7),
                SIZE * (0.15 + r() * 0.7),
                120 + r() * 140 - k * 10,
                0,
                Math.PI * 2,
            );
            g.fill();
        }
        g.filter = 'none';
    } else if (style === 'bars') {
        const bg = g.createLinearGradient(0, 0, 0, SIZE);
        bg.addColorStop(0, dark);
        bg.addColorStop(1, hsl(h1, 60, 20));
        g.fillStyle = bg;
        g.fillRect(0, 0, SIZE, SIZE);
        const n = 18 + Math.floor(r() * 10);
        const w = SIZE / n;
        const lit = Math.floor(r() * (n - 6));
        for (let i = 0; i < n; i++) {
            const h =
                SIZE * (0.15 + 0.7 * Math.abs(Math.sin(i * 0.5 + r() * 0.8)) * (0.5 + r() * 0.5));
            const on = i >= lit && i < lit + 5;
            g.fillStyle = on ? hsl(h2, 95, 68) : hsl(h1, 40, 70, 0.35);
            g.beginPath();
            g.roundRect(i * w + w * 0.2, (SIZE - h) / 2, w * 0.6, h, w * 0.3);
            g.fill();
        }
    } else {
        // rays
        const cx = SIZE * (0.2 + r() * 0.6);
        const cy = SIZE * (0.2 + r() * 0.6);
        const n = 12 + Math.floor(r() * 12);
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2;
            const a1 = ((i + 1) / n) * Math.PI * 2;
            g.fillStyle = i % 2 ? hsl(h1, 80, 55) : hsl(h2, 80, 45);
            g.beginPath();
            g.moveTo(cx, cy);
            g.arc(cx, cy, SIZE * 1.5, a0, a1);
            g.closePath();
            g.fill();
        }
        const glow = g.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.35);
        glow.addColorStop(0, hsl(h3, 100, 80, 0.9));
        glow.addColorStop(1, hsl(h3, 100, 60, 0));
        g.fillStyle = glow;
        g.fillRect(0, 0, SIZE, SIZE);
    }
    return c.toDataURL('image/jpeg', 0.9);
};

export const drawEmoji = (emoji: string, hue: number) => {
    const [c, g] = canvas();
    const bg = g.createLinearGradient(0, 0, SIZE, SIZE);
    bg.addColorStop(0, hsl(hue, 85, 62));
    bg.addColorStop(1, hsl(hue + 50, 70, 32));
    g.fillStyle = bg;
    g.fillRect(0, 0, SIZE, SIZE);
    g.font = `${SIZE * 0.52}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgb(0 0 0 / 30%)';
    g.shadowBlur = 30;
    g.fillText(emoji, SIZE / 2, SIZE * 0.54);
    return c.toDataURL('image/png');
};

// A photo from the Mac, cropped to its middle square and scaled to 600 px.
export const drawPicture = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const [c, g] = canvas();
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            g.drawImage(
                img,
                (img.naturalWidth - side) / 2,
                (img.naturalHeight - side) / 2,
                side,
                side,
                0,
                0,
                SIZE,
                SIZE,
            );
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('That file isn’t a picture BolBeats can read.'));
        };
        img.src = url;
    });
