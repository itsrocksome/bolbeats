# Changelog

## 1.6.0

- BolBeats' music library is now built into the app. The separate library server it used to bundle (Navidrome) is gone,
  so the app is about 66 MB smaller, starts faster and runs nothing in the background. The first launch moves
  everything over by itself: every song keeps its id, so your best parts, playlists, play counts, favourites, ratings
  and play queue all stay as they were.
- Move or rename a song in Finder and it keeps its best parts and plays (it used to become a new song).
- New, changed and deleted songs show up a moment after you add them to the music folder.
- An artist without a photo shows their album cover instead of a blank placeholder, and "recently added" no longer
  reshuffles when files are copied to a new disk.
- Similar songs and artist radio now work offline, from your own library (same artists, then genre, then folder).
- Lyrics saved in your song files show up, synced when they have time stamps.
- BolBeats now shows in Control Centre's Now Playing and answers the Mac keyboard's play/pause, next and previous keys
  without asking for Accessibility permission, for songs and best-parts playlists alike. Now Playing shows the playing
  part and how far into the playlist you are.
- The last few places that still said Feishin now say BolBeats.

## 1.5.0

- Media keys, the menu bar and the Dock menu now control a playing best-parts playlist (they used to resume the last
  regular song instead), and next and previous work in every best-parts run: Made for you, Tune your own, a song's
  parts and Auto DJ, not only saved playlists.
- Previous works the usual way everywhere: more than 3 seconds into a song or part it starts it again, otherwise it goes
  back one; on the first song or part it starts it again instead of doing nothing.
- Smoother joins for songs full of vocals and rap: overlapping transitions swap the vocal range, so two songs' words
  don't talk over each other.
- More complete best parts: a part no longer stops or starts in the middle of a sung or rapped line. Your parts are
  checked once in the background for this.
- Update a best-parts playlist when its songs get new or longer parts, without making it again: the playlist page offers
  Update playlist, and its menu has Update with new parts. Your order, name and cover stay.
- Auto DJ explains what it does, prefers songs from the same folder, and keeps a best-parts playlist going with more
  best parts that fit when it ends.
- The part editor lets you listen first: click the song or drag the listen bar to hear it from anywhere, then press Start
  here and End here (or [ and ]).
- One menu: right-clicking a part or song on the Best parts pages opens the same ⋯ menu, which now also has Play the
  full song, Edit best parts and Remove.
- The best-parts progress bar is one solid line.
- The app now ships a third-party notices file with the source location of the bundled Navidrome, and identifies itself
  to MusicBrainz with the project page.

## 1.4.0

- BolBeats learns your taste in best parts. Give the playing part a thumbs up or down from the player bar, skip what
  you don't like, or trim and stretch a part it found: after a few edits, new parts follow your usual length and start.
  Thumbs down, or a part you keep skipping, is left out of what BolBeats plays for you; thumbs up parts get their own
  made-for-you playlist. Everything it learns stays on your Mac.
- "What BolBeats has learned" on the Best parts page says it in plain words, can re-pick the parts BolBeats found to
  fit, and can forget it all. Parts you made, edited or rated are never changed.
- Share a best-parts playlist: Share or Save playlist file in its menu makes a tiny .bolbeats file (no audio inside).
  Open it with Open a shared playlist, or double-click it, and BolBeats builds the same playlist from your own songs,
  keeping the joins and the cover, and tells you which songs you don't have.

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
