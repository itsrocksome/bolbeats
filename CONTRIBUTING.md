# Contributing to BolBeats

Thanks for helping! Bug reports, ideas and pull requests are welcome in
[Issues](https://github.com/itsrocksome/bolbeats/issues).

## Getting started

You need Node.js 24 or later, pnpm and ffmpeg (for the audio tests).

```bash
pnpm install
node scripts/get-navidrome.mjs
pnpm run dev
```

## Before you open a pull request

- `pnpm run lint` passes (types, code and styles).
- `node --test test/` passes.
- Keep changes small and focused, and keep BolBeats private: no analytics, no tracking, nothing that sends a listener's
  music or data anywhere.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), for example `feat: add a fade
  transition` or `fix: keep the playlist order after a rescan`.

BolBeats is built on [Feishin](https://github.com/jeffvli/feishin); fixes that belong to Feishin itself are best sent there.
