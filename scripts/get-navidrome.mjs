// BolBeats: fetches the Navidrome server that BolBeats bundles (it is not kept in git).
// Downloads the official macOS builds of one pinned version, checks them against the release's checksums, and joins the
// Apple Silicon and Intel binaries into one universal file at resources/navidrome/navidrome.
// Usage: node scripts/get-navidrome.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.64.2';
const BASE = `https://github.com/navidrome/navidrome/releases/download/v${VERSION}`;
const ARCHES = ['arm64', 'amd64'];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'resources', 'navidrome');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'navidrome-'));

// a few tries: big downloads from GitHub sometimes drop
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JavaScript
const get = async (url, tries = 5) => {
    for (let i = 1; ; i++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        } catch (e) {
            if (i >= tries) throw e;
            await new Promise((r) => setTimeout(r, 2000 * i));
        }
    }
};

try {
    const sums = (await get(`${BASE}/navidrome_checksums.txt`)).toString();
    const parts = [];
    for (const arch of ARCHES) {
        const name = `navidrome_${VERSION}_darwin_${arch}.tar.gz`;
        const want = sums
            .split('\n')
            .find((l) => l.trim().endsWith(name))
            ?.split(/\s+/)[0];
        if (!want) throw new Error(`no checksum listed for ${name}`);
        const data = await get(`${BASE}/${name}`);
        const got = createHash('sha256').update(data).digest('hex');
        if (got !== want) throw new Error(`${name}: checksum mismatch`);
        const dir = path.join(tmp, arch);
        mkdirSync(dir);
        writeFileSync(path.join(dir, name), data);
        execFileSync('tar', ['-xzf', name, 'navidrome'], { cwd: dir });
        parts.push(path.join(dir, 'navidrome'));
        console.log(`ok ${name}`);
    }
    mkdirSync(out, { recursive: true });
    const target = path.join(out, 'navidrome');
    execFileSync('lipo', ['-create', ...parts, '-output', target]);
    chmodSync(target, 0o755);
    console.log(`universal Navidrome ${VERSION} written to ${path.relative(root, target)}`);
} finally {
    rmSync(tmp, { force: true, recursive: true });
}
