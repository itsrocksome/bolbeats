<h1 align="center">BolBeats</h1>

<p align="center"><b>The Mac music player that plays the best part of every song.</b><br>
It finds the hook of each song in your library and mixes them back to back, like a DJ who only plays the good bits.</p>

<p align="center">
  <a href="https://github.com/itsrocksome/bolbeats/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/itsrocksome/bolbeats?label=download&color=ff5fa2"></a>
  <a href="https://github.com/itsrocksome/bolbeats/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/itsrocksome/bolbeats/total?color=ff5fa2"></a>
  <img alt="macOS on Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple">
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <a href="https://hits.sh/github.com/itsrocksome/bolbeats/"><img alt="Visitors" src="https://hits.sh/github.com/itsrocksome/bolbeats.svg?label=visitors&color=7a3cff"></a>
</p>

<p align="center"><img src="media/screenshots/mix.jpg" alt="BolBeats playing a best-parts playlist: the parts of each song joined with beat-matched transitions" width="900"></p>

You know the moment: the beat drops, the hook lands, the chorus you wait three minutes for. BolBeats finds that part in every
song on your Mac and plays them one after another as a single seamless mix. No account, no ads, no tracking. Your music
stays on your Mac.

## Download

**[Download BolBeats for Mac (Apple Silicon)](https://github.com/itsrocksome/bolbeats/releases/latest/download/BolBeats-mac-arm64.dmg)**

BolBeats needs a Mac with Apple Silicon (M1 or later). Not sure? Apple menu > About This Mac: it says "Chip" on Apple
Silicon Macs.

**First launch.** Open the DMG and drag BolBeats into Applications. BolBeats is free and is not yet signed with a paid
Apple developer certificate, so the first time you open it macOS may say it can't check the app. Go to
**System Settings > Privacy & Security**, scroll down and click **Open Anyway**. You only do this once.

BolBeats plays the music files on your Mac (MP3, M4A, FLAC, WAV, OGG and more). Put your songs in `~/Music` (folders are
fine) or pick any folder in **Your library**.

## What it does

### Best parts, found for you
- **Every best part of every song, found automatically.** BolBeats listens to each song and finds its hook (usually the
  chorus: the section that repeats, is loudest and busiest), then every other section that sounds different and stands
  out nearly as much, like a drop or a second hook. Some songs get one part, some get several; the song decides. Parts
  are cut on the beat at a quiet moment and are as long as the section really is, rounded to whole musical phrases.
- **Or mark your own.** Press <kbd>B</kbd> while a song plays to mark where your part starts and again where it ends, or drag
  across the song's waveform. A song can have as many parts as you like.
- **Make the best-parts version of any playlist** in about half a second per song, or pick the parts yourself song by
  song and let BolBeats arrange them.

### Mixed like a DJ
- **Best-parts playlists** play only the parts, joined with transitions chosen from each part's tempo and key: beat blend,
  filter sweep, bass swap, echo out, cut on the beat and more. Every join shows how well the two parts fit.
- **Smoothest flow** puts parts in the order that joins best. **Mashup** lets songs take turns (A1, B2, A2, B1...) wherever
  they fit, and never plays a song backwards. When songs have several parts, BolBeats arranges them this way by itself.
- Hear any join on its own, try another transition, drag parts into any order, add songs, and save the mix as a WAV file.
- **Made for you:** Daily hooks, Turn it up, Wind down and In tune are rebuilt from your parts every day, plus a hook of the day.

### Your folders are your library
- **Every folder of songs becomes a playlist** with the folder's name. New songs dropped in join it automatically.
- **No duplicates.** A song saved in two folders shows once and both playlists point to it. Nothing is moved or deleted.
- **Search everything**, and artists tagged like "Artist A/Artist B" are split into real artists.
- **Song details and covers filled in** for songs that miss them, from free lookups that send only the song title and
  artist. Every change is backed up and can be undone.

### And more
- Custom playlist covers: generated art, emoji, or your own picture.
- Quick keys: press 1 to 6 anywhere to play a best-parts playlist.
- Music news: new releases from the artists you listen to.
- The "Glow" look: the playing song's cover becomes the colour of the whole window.
- Everything from [Feishin](https://github.com/jeffvli/feishin), the open-source player BolBeats is built on: queue, lyrics,
  smart playlists, scrobbling, themes and more.

<p align="center">
  <img src="media/screenshots/home.jpg" alt="BolBeats home: hook of the day and made-for-you best-parts playlists" width="440">
  <img src="media/screenshots/best-parts.jpg" alt="Best parts page with daily mixes and your best-parts playlists" width="440">
</p>
<p align="center"><img src="media/screenshots/editor.jpg" alt="The best-part editor: the suggested hook highlighted on the song's waveform" width="680"></p>

## Private by design
- No account, no analytics, no ads, no auto-updates.
- Your music never leaves your Mac. BolBeats runs its own music library ([Navidrome](https://www.navidrome.org)) on
  `127.0.0.1` only, with its online features turned off.
- The only online requests are optional song-detail lookups (song title and artist) and release checks for your artists.

## How it works
- **Library.** BolBeats bundles Navidrome and points it at your music folder, so every song is searchable and folders,
  playlists and artists stay in sync.
- **Finding the hook.** Each song is turned into a timeline of harmony (chroma) and sound colour (MFCC) features. A
  self-similarity map shows which moments repeat (mutual nearest neighbours), a novelty curve shows where sections change,
  and beat tracking places the cut. It runs off the main thread, two songs at a time.
- **Mixing.** Each part is cut straight out of its MP3 by whole frames, with no re-encoding and sample-exact timing, so a
  22-part mix starts in under half a second. Transitions are scheduled with the Web Audio API, with a limiter so loud
  joins never clip.

## FAQ

**Is there a music player that plays only the chorus or best part of each song?**
Yes, that is exactly what BolBeats does. It finds the chorus of every song in your library and can play only those parts,
mixed together.

**Can I make a DJ mix or mashup from my own MP3s on a Mac?**
Yes. Make a best-parts playlist, choose Mashup order to let songs take turns, adjust any transition, and save it as a WAV file.

**Does it work with Spotify or Apple Music?**
No. Streaming services don't allow their music to be cut up and mixed by other apps. BolBeats plays music files you have
on your Mac.

**Is it free?** Yes, free and open source under the GPL-3.0 licence.

**Windows or Linux?** BolBeats is built and tested on macOS only for now.

## Build from source

You need Node.js 24 or later, [pnpm](https://pnpm.io) and, for the audio tests, ffmpeg.

```bash
git clone https://github.com/itsrocksome/bolbeats.git
cd bolbeats
pnpm install
node scripts/get-navidrome.mjs   # downloads and checks the bundled library server
pnpm run dev
```

Make the DMG:

```bash
pnpm run build
pnpm exec electron-builder --mac dmg --arm64 --publish never
```

Checks: `pnpm run lint` (types, code and styles) and `node --test test/*.test.ts`.

## Credits
- [Feishin](https://github.com/jeffvli/feishin) by jeffvli and contributors, the player BolBeats is built on (GPL-3.0).
- [Navidrome](https://github.com/navidrome/navidrome), bundled as the music library (GPL-3.0).
- Fonts: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and
  [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) (SIL Open Font License).
- Song details from [iTunes Search](https://performance-partners.apple.com/search-api), [MusicBrainz](https://musicbrainz.org)
  and the [Cover Art Archive](https://coverartarchive.org).

## License

[GPL-3.0](LICENSE). BolBeats is a fork of Feishin and keeps its licence.
