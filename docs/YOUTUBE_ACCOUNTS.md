# YouTube accounts and ad protection

This fork replaces the local account/password UI with a real YouTube session.
You can also browse as a guest without creating anything.

## Connecting an account (1.3.0)

1. Open **Account & privacy** and select **Sign in with Google**.
2. On Windows, the installer includes the same Microsoft Edge WebView2-style
   native sign-in window used by Lokal. Sign in on Google's site, select your
   desired YouTube channel and complete verification. Passkeys/Windows Hello
   are supported by the WebView2 runtime.
3. On Linux and macOS, LokTube attempts an isolated sandboxed Electron sign-in
   window. Some Google accounts may reject embedded Chromium authentication.
4. The app checks YouTube's authenticated account endpoints before changing
   accounts. When verified, it closes the window and encrypts the session if
   the operating system provides secure storage.

**Other sign-in methods** retains the previous external browser and cookie
import workflows. Choose Zen/Firefox/LibreWolf/Waterfox/Floorp, sign in to
youtube.com in the isolated temporary profile and close that browser window.
You can also import Netscape cookies.txt or Cookie-Editor JSON from an already
signed-in browser. Only youtube.com cookies enter the app. Treat exported
cookies as credentials and delete the export after importing.

The Windows WebView2 helper receives its own temporary profile and talks to
the Electron main process over local standard streams. The helper is built
during Windows packaging and shipped with the installer. It does not use
the user's normal browser profile. Neither cookies nor Google credentials are
exposed to the renderer, backup/export files, or diagnostic logs.

`/liked` keeps its existing route and remote YouTube LL playlist;
the visible navigation/page/tab label is now **Likes**.

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
A separate browser sign-in normally contains one Google identity. Connect the desired primary account; there is no
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
with YouTube access. The release notes distinguish fixture coverage from live-account validation.

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

## 1.0 history management and window chrome

Account history is read in response order instead of through the video memo,
which groups renderer classes. Legacy videos, modern lockups and Shorts are
flattened into the same ordered list. Feed continuations are kept separate from
Shorts carousel continuations.

**Remove** on a signed-in history entry uses the removal feedback action
provided by YouTube for that entry. Only an acknowledged `isProcessed` response
removes the row and local cache entry; errors retain the row. Opaque removal IDs
are scoped to the originating account revision and profile, expire after 30
minutes, and never expose feedback tokens to the renderer. Guest deletion affects
only the current local profile. Pending playback history writes are drained and
suppressed during deletion, then invalidated after success so later progress
cannot immediately re-add the removed watch. An explicit new playback can create
a new watch. A failed removal resumes tracking.

The app uses an integrated draggable header and window controls. Theater mode
hides that header along with search and tabs. The sidebar starts at the window's
top edge with no reserved header gap; the two hover overlays can overlap at the
corner. Interactive controls are excluded from the drag region, which is also
disabled during video fullscreen. Window actions apply only to their sender's
window. Existing storage/keyring/installer IDs stay unchanged.

1.0.0 is a stable release. Both stable update metadata and aliases for older beta
clients are published so previous installations can discover this upgrade.

## Account libraries (1.1)

When signed in, Playlists reads the connected YouTube account, Saved reads
Watch Later, and Music reads the YouTube Music library, including playlists,
albums and liked songs. Playlist creation is private by default. Add/remove
actions use YouTube's playlist commands or Music library feedback actions,
with account-revision checks around requests. Service and pagination tokens
stay in the main process. Remote errors never fall back to local writes.

The save dialog reads membership per video rather than downloading every
playlist's contents. Collection contents load in pages; playback queues read
the selected playlist. Unsupported Music library actions are disabled while
playlist saving remains available. Albums and liked songs are read-only.

Guest collections remain on disk. Existing account-local saves are retained
for backups; this release does not migrate or merge them into YouTube. Local
backups do not include the remote account library. Live account-library
requests cannot be verified in the build environment because YouTube access
is blocked there.


## 1.4.0 personalized home

A signed-in YouTube home needs the same channel-selection context as the
browser sign-in, not only its cookie header. Earlier versions lost the selected
SESSION_INDEX, DELEGATED_SESSION_ID, VISITOR_DATA and geographic context;
YouTube.js then defaulted to a random visitor, account index 0 and US locale.
This could appear as an unrelated generic US news feed despite being signed in.

1.4.0 captures those fields at native/Electron sign-in, scopes them to the
main-process encrypted credential, and supplies them to YouTube.js for browse,
account and personalized Home requests. Older encrypted sessions first try
recovering the selected context from the authenticated youtube.com homepage
using a bounded HTTPS request that never follows redirects. If unavailable,
reconnecting Google sign-in records the context again. No session secrets or
visitor identifiers are sent to the renderer or diagnostics.

Home also inspects the raw YouTube browse response. If YouTube explicitly
reports a signed-out response, it displays an actionable reconnect error rather
than claiming a generic feed is personal. Guest discovery remains supported.
No channel-name blacklist or artificial news filtering is used.
