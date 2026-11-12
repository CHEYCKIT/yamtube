# YouTube accounts and ad protection

This fork replaces the local account/password UI with a real YouTube session.
You can also browse as a guest without creating anything.

## Connecting an account

1. Install Firefox on the same computer.
2. Open **Account & privacy → Sign in with Firefox**.
3. Sign in with Google on youtube.com in the Firefox window. Complete any
   Google verification, and make sure YouTube shows your account avatar.
4. Close that Firefox window. The app imports and verifies its YouTube
   session, then reloads its tabs under your account.

The app opens a separate, ordinary temporary Firefox profile. It does not
use WebDriver, a remote debugging port, an embedded Google login, or your
existing browser profile. No Google password is entered into WorldTube.
If Firefox is installed at a custom path, choose its executable when asked.
Snap/Flatpak installations may restrict access to the temporary profile;
use a native Firefox installation or the cookie-file option in that case.

**Import YouTube cookies.txt** accepts a Netscape cookie export from an
existing signed-in browser. Only cookies valid for www.youtube.com are
accepted. The export contains session credentials: delete it after import.
This is session-based sign-in, not Google's public OAuth/Data API (which
cannot provide personalized home recommendations or write watch history).

The verified account name and avatar come from YouTube. Credentials are
held in the main process and persisted with Electron safeStorage only when
a secure system backend is available. Linux's `basic_text` backend is
explicitly refused; sign-in then lasts until you quit. Credentials are
excluded from library backups and are not exposed over the renderer API.
Signing out removes this app's credentials without revoking browser logins.
Temporary sign-in profiles are deleted on completion/cancellation and
abandoned profiles are removed on next startup.

## Account behavior

- Home and related recommendations use the authenticated InnerTube client.
- History displays YouTube's history, including continuation loading. A paused
  YouTube history setting stays paused; the app does not change it.
- Subscription lists, feeds, subscribe and unsubscribe use your account.
- A watch is recorded after one second of observed playback, including music
  and Shorts. Fetching metadata, hovering a card and preloading do not add a
  watch. Progress is sent about every 30 seconds and on pause/end.
- Account changes reload all players. Account revisions and playback tokens
  prevent stale requests from adding watches to another account.
- Saved videos/playlists, search history and the playback cache remain local
  and are isolated by account. They are not YouTube playlist synchronization.
  Earlier local libraries are preserved in full backups.
- History sync errors appear in Account, Home and History. A local watch is
  retained on sync failure; remote progress is retried during playback.

Accounts with multiple Google identities/channels use the account YouTube
reports as selected. A separate Firefox sign-in normally contains one Google
identity. In this beta, connect the desired primary account; there is no
in-app Brand Account selector. Sessions can expire and require reconnecting.

## Blocking and playback

`@ghostery/adblocker` applies bundled EasyList and EasyPrivacy network filters
to every Electron session (including hidden attestation sessions), renderer
media/image requests, and background InnerTube fetches. No Chrome extension
or Manifest V3 API is involved. Both lists update after four days, or through
the manual update button; failures retain the installed filters.

The app renders its own interface and extracts direct content streams instead
of embedding YouTube's website/player and its advertising UI. Filtering keeps
media, captions, attestation, account APIs and the two explicit watch-history
endpoints working. Cookies/authorization are restricted to YouTube's API and
history endpoints and stripped on cross-origin redirects.

**The desktop shell and existing BotGuard interpreter still use Electron
(Chromium).** This release is not a migration to a non-Chromium runtime.
Protection is independent of extensions, but no client can promise immunity
to future YouTube detection or protocol changes. Playback extraction uses an
anonymous visitor separately from account browsing/history. Premium,
members-only and other authentication-required media are not implemented.
Sponsor segments embedded in a creator's video are not automatically skipped.

## Validation

- `pnpm test`: production-list blocking/allow rules, credential scoping,
  Netscape imports, playback deduplication/throttling, account races, retries
  and guest behavior.
- `pnpm typecheck` and `pnpm build`.
- On Linux with a display: `DISPLAY=:99 pnpm test:desktop`. This starts the real
  Electron app, tests actual request blocking, imports a synthetic cookie jar
  through the real IPC/InnerTube parser, checks account-isolated libraries,
  authenticated history/subscriptions, secret-free storage and sign-out.
  Optional `WORLDTUBE_SMOKE_FIREFOX=/path/to/firefox` exercises native browser
  launch/cancellation. It never uses a real Google credential.

The build environment's outbound proxy denies youtube.com. Live Google login,
remote history persistence, recommendation changes and real video playback
could not be verified here. These require manual validation on a machine
with YouTube access; the release is marked beta for this reason.
