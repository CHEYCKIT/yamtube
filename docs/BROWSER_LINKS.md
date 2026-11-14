# Opening YouTube links from Zen in LokTube

LokTube 1.5.1 registers the `loktube:` desktop protocol. Its companion
Firefox / Zen WebExtension redirects ordinary clicked YouTube URLs to new
internal LokTube tabs, without replacing existing playback.

## Zen installation (signed .xpi)

1. Install LokTube 1.5.1 with the Windows installer and launch it once.
2. Download the **Mozilla-signed** `LokTube-Zen-signed.xpi` add-on from the
   release assets, if present. **Do not install the UNSIGNED development XPI.**
3. In Zen, open `about:addons` (Add-ons and Themes).
4. Open the gear/settings menu and select **Install Add-on From File…**.
5. Select the signed `.xpi`, approve the listed site permissions, and choose
   to open LokTube if Zen prompts for an external app.

The extension stays installed across Zen restarts. Disable/remove it from
`about:addons` to stop redirection.

## Signing and distribution

Mozilla requires a valid add-on signature for normal persistent installation,
including via **Install Add-on From File**. Zen inherits Firefox's signing
behavior. The unsigned XPI in the release is for source review / add-on
developer testing only, and is **not a usable substitute for the signed XPI**.

The source under `browser-extension/` is ready for Mozilla AMO **unlisted
signing**. For maintainers, configure GitHub Actions secrets
`AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. The release workflow uses Mozilla's
signing service and attaches the signed XPI when credentials are available.
Without these credentials it cannot produce an installable file.

## Behavior

Only normal left-clicks on supported YouTube, youtu.be and YouTube Music
links are redirected. Videos, Shorts, live videos, playlists, channel IDs,
searches, Home and account history/subscriptions are supported. Channel
@handles open a search until full ID lookup is available. Ctrl, Shift, Alt,
Meta, and middle clicks, downloaded links, and URLs entered directly in
Zen's address bar are not intercepted.

The add-on needs to read link destinations on sites where you click them.
It does not read YouTube cookies, passwords or account history, and does not
send data to a network service. All received links are validated in LokTube
before they become internal routes. The browser or OS can ask you to confirm
external-application launches.
