// BolBeats: Navidrome sends its own stand-in pictures when there is no artwork (a white star on light grey for
// artists, a blue record on a transparent square for albums and songs). They glare on a dark app, so spot them by a few pixels
// and show the app's own placeholder instead. Reads a 64 px copy; never touches real covers.
let canvas: HTMLCanvasElement | null = null;

const near = (px: Uint8ClampedArray, i: number, v: number) =>
    Math.abs(px[i] - v) < 4 && Math.abs(px[i + 1] - v) < 4 && Math.abs(px[i + 2] - v) < 4;

export const isServerPlaceholder = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    if (!w || w !== img.naturalHeight) return false;
    try {
        canvas ??= document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) return false;
        g.clearRect(0, 0, 64, 64);
        g.drawImage(img, 0, 0, 64, 64);
        const px = g.getImageData(0, 0, 64, 64).data;
        const at = (x: number, y: number) => (y * 64 + x) * 4;
        const corners = [at(2, 2), at(61, 61), at(2, 61), at(61, 2)];
        // artist: flat 235 grey all round, white star in the middle
        if (
            corners.every((i) => near(px, i, 235)) &&
            near(px, at(16, 32), 235) &&
            near(px, at(32, 32), 255)
        )
            return true;
        // album: the blue record on a transparent square (any size; real covers are opaque)
        const m = at(16, 32);
        return (
            corners.every((i) => px[i + 3] < 10) && px[m + 2] > 180 && px[m] < 40 && px[m + 1] < 130
        );
    } catch {
        return false; // a cross-origin image can't be read; leave it alone
    }
};

// Loads a cover URL and says whether the server sent its stand-in picture (false if it can't be loaded or read).
export const loadsAsPlaceholder = (src: string) =>
    new Promise<boolean>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(isServerPlaceholder(img));
        img.onerror = () => resolve(false);
        img.src = src;
    });
