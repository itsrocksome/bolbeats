# Changelog

## 1.3.0

- Longer best parts: a part now starts with a phrase of build-up, plays the whole hook, and carries on through what
  follows while it is just as big. Every part is 25 seconds or more (on 92 test songs the typical part went from 22 to
  31 seconds).
- More songs get a second best part, and quiet intros or verses are no longer picked as one.
- Your older parts are checked once in the background: short parts BolBeats found are lengthened, and any other short
  part is only ever extended around itself, so nothing you picked is lost. Parts you make or edit are never changed.
- A smaller app: 395 MB installed instead of 657 MB, and a 179 MB download.
- Artists show the cover of one of their songs instead of a blank picture.
- Song titles get more room in track lists, and the filter panel floats over the list in small windows.
- Music news opens in under a second after the first visit.
- Fixed: the player bar showed an old time when nothing was playing.

## 1.2.0

- Best parts only: one switch in the player bar, and whatever you play (an album, an artist, search, your queue) plays
  just each song's best parts, then the next song. A song without parts gets them found on the fly. Switch it off for
  full songs.
- Several best parts by default: best-parts playlists and Let BolBeats pick use every part a song has, and the parts you
  already had are checked once in the background for more (BolBeats tells you when it finds some).
- Longer, complete parts: every part is at least 15 seconds, ends where its musical phrase ends, on a breath, and has no
  upper limit, so a part can be a whole section of the song.
- A song whose file was deleted, or that can't be played, is skipped instead of stopping the whole playlist; a
  best-parts playlist plays the rest of its parts.
- Fixed: the song you were on when you opened BolBeats sometimes wouldn't play.

## 1.1.0

- Every best part, not just one: BolBeats now finds each section of a song that stands out (the hook, plus a drop,
  a post-chorus or a second hook that sounds different). There is no fixed number; each song decides. A part that
  changes to a clearly different sound halfway is split into two.
- Best-parts playlists use all of them: when a song has several parts, songs take turns wherever their joins fit, and a
  song's parts always play in time order. This applies to Let BolBeats pick, your hand-picked parts, ticked parts and
  Play all.
- The part editor shows every suggested part as a chip, with Add all.
- Pick the parts yourself, then choose Let BolBeats arrange them or Keep my order; edit the result any way you like.

## 1.0.0

The first release of BolBeats.

- Best parts: the hook of every song found automatically (chorus detection with natural, phrase-length parts), or marked
  by hand with B or on the waveform; any number of parts per song.
- Best-parts playlists: parts mixed with tempo and key aware transitions, Smoothest flow and Mashup ordering, drag to
  reorder, add songs, preview and change any join, save as WAV.
- Made for you mixes, hook of the day, listening streaks and quick keys 1 to 6.
- Your folders are your library: folders become playlists, a song saved twice shows once, new songs join automatically,
  artists split properly.
- Song details and covers filled in from free lookups, with backups and undo.
- Custom playlist covers: generated art, emoji or your own picture.
- Music news for the artists you follow.
- The Glow design, real macOS full screen, and the player bar follows a playing best-parts playlist.
- Fast and light: parts are cut straight from MP3 frames, so a 22-part mix starts in under half a second.
- Private: no account, no analytics, no auto-updates; the bundled library listens on 127.0.0.1 only.
