# LokTube

A desktop YouTube client with browser sign-in, account recommendations and
history, app-wide ad protection, independent tabs and persistent players. Not affiliated with Google or YouTube.

[Spanish development notes](README.es.md)

## Demo

Watch the short [LokTube demo on YouTube](https://youtu.be/ccULEv3KD28).

## Installation

Download installers from the [LokTube download page](https://github.com/lokal-music/loktube/releases)
or [GitHub Releases](https://github.com/lokal-music/loktube/releases).
Downloads become available only after a release is successfully published.

Initial public release: [v0.0.3](https://github.com/lokal-music/loktube/releases/tag/v0.0.3),
with Windows x64 and Linux x64 installers plus corresponding source.

The release configuration prepares Windows NSIS x64 and Linux AppImage/DEB x64.
macOS DMG/ZIP ARM64 is opt-in and requires signing credentials. See
[Packaging and Updates](docs/UPDATES.md) for setup and outstanding work.

Windows: download the x64 `.exe` and follow the installer.
Linux: download the x64 `.AppImage`, make it executable (`chmod +x LokTube-*.AppImage`),
then run it. Debian/Ubuntu users can instead install the `.deb` from Releases.
AppImage may require FUSE 2; `--appimage-extract-and-run` is an alternative on
systems without it. Windows packages are initially unsigned; verify the source
and download location. macOS downloads remain unavailable until signed builds exist.

## 1.1.2

Fix account playlist loading by using YouTube's playlist aggregation browse
endpoint. A failed playlist request no longer displays an empty-library message.

## 1.1.1

In theater mode, moving below the visible header and tabs now hides them after
just a short transition allowance. The invisible hold-open strip below the
header is removed. The larger reveal area and access to search and menus remain.

## 1.1.0

Signed-in **Playlists** now comes from your YouTube account. Create private
playlists and add/remove videos directly on YouTube. The save dialog shows
YouTube's editable playlists and their current membership for the selected video.
**Saved** becomes **Watch Later**, including account additions and removals.

**Music** shows your YouTube Music library songs, liked songs, saved playlists
and albums. Saving a supported track to Music uses YouTube Music's own
**Add to library** action; playlist changes also update the account. Albums and
liked-song collections are read-only here. Unsupported tracks can still be
added to playlists. Large collections load additional pages on demand.

The theater header has a larger 36px reveal zone, a grace period when moving
away, and stays visible while using search, menus or tabs. The reveal trigger
no longer covers the header's controls once open.

Guest libraries remain local. Existing local account collections are retained
in local backups and are not automatically uploaded or merged into YouTube.
Account errors are shown for retry without creating local-only saves.

## 1.0.0

Shorts appear in the normal history order instead of being grouped above
other videos. Each entry has **Remove**: signed-in users remove it from their
YouTube watch history and local cache; guests remove it from local history.
Failed account removals stay visible for retry. Ongoing playback cannot
immediately recreate a removed watch.

Theater mode reveals the integrated window header—including minimize,
maximize/restore and close—at the top edge. The sidebar fills the entire left
edge. Both overlays can overlap at the corner without reserving space for one
another. The app remains draggable and resizable in normal mode.

1.0.0 is published as a stable release. Existing account sessions, libraries
and preferences are retained on upgrade from the earlier beta releases.

## Beta 5

Fixes repeatable five-second skips caused by media-segment delivery metadata
getting ahead of the bytes actually buffered. UMP responses are processed one
complete part at a time, independently of HTTP chunk boundaries. Truncated or
empty media responses fail for retry instead of leaving silent holes. Rewinding
and replaying the affected positions is covered by a real segmented-playback test.

## Beta 4 — LokTube

The app is now **LokTube**, with a large blue play icon for the Windows taskbar.
Existing sessions, libraries and preferences stay in place when upgrading.
**Theater mode** in the player controls (or **T**) expands the video across the
window and moves recommendations below it. Hover the top or left edge to reveal
search/tabs or navigation; keyboard focus reveals them too. Your theater choice
is remembered for watch pages. Sidebar labels fit laptop screens and higher zoom.

Entering native Picture-in-Picture opens Home with a playback footer. Clicking
the footer or **Return to video**, or leaving the native PiP window, restores
the owning video page with PiP off. The inline mini player also has a one-click
return button. Fullscreen works from its player button or **F**; **Escape** exits
and restores the previous layout. These changes retain playback position.

## Beta 3

Sign in with Zen, Firefox, LibreWolf, Waterfox or Floorp. Installed browsers
are detected automatically; select one in **Account & privacy → Sign-in
browser**. Custom/portable browsers only need to be added once. Cookie import
accepts Netscape cookies.txt and Cookie-Editor JSON from any browser.
Account verification handles YouTube responses without a selected flag and
uses an active-account fallback for multiple identities. Failed imports keep
your existing session and library.

## Beta 2

Beta 2 fixes an installer-only parser warning crash that interrupted
playback and home feeds. Video context menus now offer **Open in new tab**,
**Open in new tab and switch**, and **Play in mini player**. Player settings
include a persistent **Autoplay next video** toggle. Mouse Back/Forward buttons
navigate the active tab. English labels cover search filters, music and
collections. **Account & privacy → Logs** displays and exports redacted logs.
Existing account cookies, libraries and settings are retained on upgrade.

## Features

- Real YouTube session sign-in through Zen, Firefox and other Firefox-based browsers, with guest browsing and no local login.
- Account home recommendations, watch history and subscriptions.
- App-wide EasyList/EasyPrivacy protection with bundled filters and automatic updates.
- Account playlists, Watch Later and YouTube Music library; local guest collections and account-separated search history.
- Full local data export/import, including global volume and application settings.
- Independent tabs with per-tab navigation and persistent playback sessions.
- Draggable mini player that minimizes into a bottom playback bar and restores
  without recreating its video element.
- Channel sections, available filters, public playlists and channel search.
- Three automatic continuation loads followed by a Load more button.
- Vertical Shorts dialog with animated navigation and automatic progression
  through loaded Shorts.
- Search suggestions and recent searches per profile.
- English interface by default, with Spanish selectable in Account > Application.
- Centralized theme variables, local fonts and consistent 3px corner radii.

The updater is integrated for packaged builds: optional startup checks, explicit
downloads and confirmed installation from published GitHub releases. The complete
installation/update cycle is not validated yet.

YouTube is queried directly using the local extraction method. An Invidious
fallback is not implemented or configured in LokTube yet. External YouTube
changes can require a compatibility update.

See [YouTube accounts and protection](docs/YOUTUBE_ACCOUNTS.md) for sign-in steps,
security/storage behavior, test coverage and current limitations. The desktop shell
still uses Electron/Chromium; blocking does not use Chrome extensions.

## Playback Shortcuts

Space/K toggle playback; J/L seek 10 seconds; Left/Right seek 5 seconds;
Up/Down adjust volume; M toggles mute; F toggles fullscreen; C toggles captions.
Digits seek by percentage; Home/End seek to the beginning/end; < and > adjust
speed; comma/period step frames while paused.

Shift+N/P navigate loaded Shorts. Shift+N in Watch opens the first recommendation.
Shortcuts respect text fields and act on the player represented in the interface.

## Local Data

The existing local data file is stored in Electron's user-data directory. Account exposes
its path, data totals and full-data export/import. Local library contents
are not uploaded to a LokTube server or GitHub. Signed-in save, playlist and
Music actions update the connected YouTube account. Local exports do not back
up the remote YouTube library.

Exports include local users, password hashes, the active session, profile photos,
subscriptions, playlists, saved videos, history, search history and settings.
Treat exported files as private. YouTube session credentials are encrypted separately
and never included in exports. They do not include video downloads, temporary
playback tokens, build files or open tabs.

## Development

Use Node.js compatible with the project tools and Corepack/pnpm. The release
workflow uses Node.js 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm build` compiles the app only. `pnpm package` creates local installers.
`pnpm release` packages and uploads a draft release; use it only intentionally.
The version-tag workflow publishes after all enabled packaging jobs succeed,
including a matching corresponding-source archive. Failed jobs leave a draft.
Ordinary commits do not trigger release builds.

During collaborative iterations, builds, typechecks and automated test suites
are run only when requested. Main/preload changes require restarting Electron;
renderer HMR alone cannot update the desktop APIs.

Stack: Electron, electron-vite, React, TypeScript, Tailwind, @ghostery/adblocker, youtubei.js,
bgutils-js, googlevideo, Shaka Player, electron-builder and electron-updater.

## Documentation

- [Languages](docs/I18N.md)
- [Packaging and Updates](docs/UPDATES.md)
- [Source and License Review](docs/LICENSE_REVIEW.md)
- [Tabs](docs/TABS.md)
- [Theme](docs/THEME.md)
- [Earlier Distribution Research](docs/DISTRIBUTION.md)
- [Development Handoff](HANDOFF.md)

Earlier technical documents contain Spanish development history.

## License

LokTube's own code is licensed under [AGPL-3.0-only](LICENSE).
Copyright (c) 2026 Juanca Ribero. Third-party notices and official local font
origins are recorded in [Third-Party Notices](THIRD_PARTY_NOTICES.md).
The actionable technical review is closed in
[Distribution Review](.github/DISTRIBUTION_REVIEW.md); historical findings remain
recorded in [Source Review](docs/LICENSE_REVIEW.md).
