# YamTube

A fork of WorldTube with browser sign-in, account recommendations and
history, app-wide ad protection, independent tabs and persistent players. Not affiliated with Google or YouTube.

[Spanish development notes](README.es.md)

## Demo

Watch the short [WorldTube demo on YouTube](https://youtu.be/ccULEv3KD28).

## Installation

Download installers from the [YamTube download page](https://github.com/CHEYCKIT/yamtube/releases)
or [GitHub Releases](https://github.com/CHEYCKIT/yamtube/releases).
Downloads become available only after a release is successfully published.

Initial public release: [v0.0.3](https://github.com/CHEYCKIT/yamtube/releases/tag/v0.0.3),
with Windows x64 and Linux x64 installers plus corresponding source.

The release configuration prepares Windows NSIS x64 and Linux AppImage/DEB x64.
macOS DMG/ZIP ARM64 is opt-in and requires signing credentials. See
[Packaging and Updates](docs/UPDATES.md) for setup and outstanding work.

Windows: download the x64 `.exe` and follow the installer.
Linux: download the x64 `.AppImage`, make it executable (`chmod +x YamTube-*.AppImage`),
then run it. Debian/Ubuntu users can instead install the `.deb` from Releases.
AppImage may require FUSE 2; `--appimage-extract-and-run` is an alternative on
systems without it. Windows packages are initially unsigned; verify the source
and download location. macOS downloads remain unavailable until signed builds exist.

## Beta 3

Sign in with Zen, Firefox, LibreWolf, Waterfox or Floorp. Installed browsers
are detected automatically; select one in **Account & privacy → Sign-in
browser**. Custom/portable browsers only need to be added once. Cookie import
accepts Netscape cookies.txt and Cookie-Editor JSON from any browser.
Account verification handles YouTube responses without a selected flag and
uses an active-account fallback for multiple identities. Failed imports keep
your existing session and library.

## Beta 2

YamTube beta 2 fixes an installer-only parser warning crash that interrupted
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
- Local saved videos/playlists and search history, kept separately for each account.
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
fallback is not implemented or configured in YamTube yet. External YouTube
changes can require a compatibility update.

See [YouTube accounts and protection](docs/YOUTUBE_ACCOUNTS.md) for sign-in steps,
security/storage behavior, test coverage and beta limitations. The desktop shell
still uses Electron/Chromium; blocking does not use Chrome extensions.

## Playback Shortcuts

Space/K toggle playback; J/L seek 10 seconds; Left/Right seek 5 seconds;
Up/Down adjust volume; M toggles mute; F toggles fullscreen; C toggles captions.
Digits seek by percentage; Home/End seek to the beginning/end; < and > adjust
speed; comma/period step frames while paused.

Shift+N/P navigate loaded Shorts. Shift+N in Watch opens the first recommendation.
Shortcuts respect text fields and act on the player represented in the interface.

## Local Data

`worldtube-data.json` is stored in Electron's user-data directory. Account exposes
its path, data totals and full-data export/import. Local library contents
are not uploaded to a YamTube server or GitHub.

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

WorldTube's own code is licensed under [AGPL-3.0-only](LICENSE).
Copyright (c) 2026 Juanca Ribero. Third-party notices and official local font
origins are recorded in [Third-Party Notices](THIRD_PARTY_NOTICES.md).
The actionable technical review is closed in
[Distribution Review](.github/DISTRIBUTION_REVIEW.md); historical findings remain
recorded in [Source Review](docs/LICENSE_REVIEW.md).
