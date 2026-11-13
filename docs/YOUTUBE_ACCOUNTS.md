# YouTube accounts and ad protection

This fork replaces the local account/password UI with a real YouTube session.
You can also browse as a guest without creating anything.

## Connecting an account

1. Install Zen, Firefox, LibreWolf, Waterfox or Floorp on the same computer.
2. Open **Account & privacy**. The **Sign-in browser** dropdown lists detected
   installations; Zen is preferred initially when available. Your selection is saved.
3. Click **Sign in with [browser]**, then sign in with Google on youtube.com
   in the opened window. Complete any Google verification, and make sure
   YouTube shows your account avatar.
4. Close that sign-in window. The app imports and verifies its YouTube session,
   then reloads its tabs under your account.

The app opens a separate, ordinary temporary browser profile. It does not
use WebDriver, a remote debugging port, an embedded Google login, or your
existing browser profile. No Google password is entered into LokTube.
Windows detection covers standard/per-user installation directories and registered
browser commands. macOS application bundles and Linux PATH/common locations
are also checked. **Refresh browsers** detects newly installed browsers.
**Add portable browser…** is a one-time fallback for portable/custom installs;
ordinary sign-in never opens an executable picker. The selection and custom
paths are saved separately from library backups and contain no credentials.
Snap/Flatpak installations may restrict access to the temporary profile;
use a native installation or the cookie-file option in that case.

**Import YouTube cookies** accepts Netscape cookies.txt or Cookie-Editor JSON
(array or a `cookies` wrapper) from an existing signed-in browser, including
Zen, Chrome and Edge. Open youtube.com and choose the desired account before
exporting. Only cookies valid for www.youtube.com are accepted; expired cookies
are dropped. The export contains session credentials: delete it after import.
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

Account verification reads authenticated account endpoints directly rather than
relying on an optional parser flag. A single enabled identity is accepted even
without `isSelected`. For multiple identities, a selected entry or YouTube's
active-account menu header is required; ambiguous responses are rejected.
A failed import leaves the existing account and local library intact. Diagnostic
logs record endpoint names and identity counts, never the account response or cookies.
A separate browser sign-in normally contains one Google identity. In this beta, connect the desired primary account; there is no
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
  Netscape/JSON imports, single and multiple account response layouts, ambiguous
  identity rejection, browser discovery, playback deduplication/throttling,
  account races, retries and guest behavior.
- `pnpm typecheck` and `pnpm build`.
- On Linux with a display: `DISPLAY=:99 pnpm test:desktop`. This starts the real
  Electron app, tests actual request blocking, imports a synthetic cookie jar
  through the real IPC/InnerTube parser, checks account-isolated libraries,
  authenticated history/subscriptions, secret-free storage and sign-out.
  Optional `WORLDTUBE_SMOKE_FIREFOX=/path/to/firefox` exercises native browser
  selection persistence and launch/cancellation; `YAMTUBE_SMOKE_BROWSER` and
  `YAMTUBE_SMOKE_BROWSER_NAME` can test Zen or another supported browser.
  It never uses a real Google credential.

The build environment's outbound proxy denies youtube.com. Live Google login,
remote history persistence, recommendation changes and real video playback
could not be verified here. These require manual validation on a machine
with YouTube access; the release is marked beta for this reason.

## Beta 2 playback and controls

Electron-builder removes optional dependency `bugs` metadata. YouTube.js 18
used that metadata while reporting recoverable parser errors, turning a
malformed optional renderer into `Cannot read properties of undefined
(reading 'url')`. The reproducible packaged failure is fixed by the locked
compatibility patch in `patches/youtubei.js@18.0.0.patch`; it also protects the
streaming-format warning path. The desktop suite deliberately parses a bad
thumbnail beside a valid video inside the packaged app. Stream information
is fetched separately from optional watch-next metadata.

Right-click a video to open a background/foreground tab or play it in the
existing mini player. Playing from a browsing page keeps that page open. From
a full watch page the app returns to Home to make room for the mini player.
**Player settings → Autoplay next video** is saved across restarts and applies
to automatic video/Short advancement. Explicit play actions still start the
selected video.

Windows browser-backward/browser-forward application commands and mouse
buttons 3/4 are routed through the active tab history. Duplicate native/DOM
events from one press are suppressed.

**Account & privacy → Logs** shows recent application, playback and network
messages and exports the retained logs. Three files are bounded to roughly
512 KiB each. The viewer shows the latest 128 KiB; export includes all retained
entries. Cookies, authentication tokens and signed stream URLs are redacted.
Nothing is automatically uploaded.

The public product/window/installer/executable name is LokTube. The legacy
internal application ID, storage directory and keyring identity are retained
so beta 1 sessions and libraries remain usable.

## Beta 4 theater, PiP and fullscreen

LokTube retains the legacy application/storage/keyring identity when upgrading
from WorldTube or YamTube. The window, desktop entry, installers and executable
use LokTube. Taskbar/application icons use the large blue play symbol; the
existing globe artwork remains in the wordmark.

**Theater mode** in the player controls, or **T**, gives the video the available
window width and height. Details and recommendations remain below it. Hover the
top edge for search and tabs, or the left edge for navigation. The edge controls
and hidden navigation also reveal themselves on keyboard focus. Theater mode
is remembered in renderer local storage and only applies to watch pages. It does
not reload the video or change playback position. Sidebar labels allow wrapping;
nav items cannot shrink vertically when the sidebar needs to scroll.

Native PiP opens Home. The footer title, **Return to video**, and native PiP exit
restore the owning tab's video page and end PiP in one action. A playlist query
is retained when returning to the same video. The persistent player is parked
before its old watch page is removed; state-preserving DOM moves avoid closing
native PiP or reloading media. Returning from the inline mini player also takes
one click.

Fullscreen requests are allowed for the trusted main app frame. Other
permissions remain denied. The fullscreen exception is scoped to the main app
frame’s permission requests. The player button and **F**
toggle fullscreen; **Escape** explicitly exits it. The desktop suite tests these
real APIs using local media, including exit back into theater mode, in addition
to PiP, footer return, sidebar geometry at laptop/narrow sizes and 150% zoom.

## Beta 5 stream continuity

A single HTTP chunk can contain multiple complete UMP media segments. The
upstream processor resolved its promise with the first segment's bytes while
continuing to parse and overwrite delivery metadata with later segments. That
made the SABR adapter report a segment as buffered even though its bytes never
reached the player. The resulting multi-second holes recurred during replay.

The response framer now feeds one complete UMP part at a time and stops at the
first terminal result. It also retains incomplete part headers across HTTP
chunks. Truncated media and empty responses fail for retry rather than satisfying
a segment request. Complete control-only responses still reach the protocol
interceptor for redirects and context updates.

Core tests cover coalesced segments, every split boundary, byte-by-byte input,
repeated forward/backward requests, truncation and mixed audio/video/control
parts. A desktop regression serves generated fragmented MP4 audio/video through
the real SABR/UMP path, honors the client's buffered-segment claims and verifies
continuous buffered ranges, playback across several five-second boundaries and
ArrowLeft rewinds. It uses no Google credentials or YouTube media.
