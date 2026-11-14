# Open YouTube links from Zen in LokTube (1.5.1)

The installed desktop app handles the **loktube:** URL scheme. The included
Violentmonkey userscript intercepts ordinary clicks on YouTube links in Zen and
forwards them to **new LokTube tabs**. The active tab and playback are preserved.

## Install once in Zen

1. Install or update to **LokTube 1.5.1** using the normal Windows installer.
   Launch LokTube once so the OS knows the loktube: protocol handler.
2. In Zen, install the **Violentmonkey** add-on from Mozilla Add-ons.
3. Open this userscript in Zen (after the v1.5.1 release is published):
   https://raw.githubusercontent.com/lokal-music/loktube/v1.5.1/browser-integration/loktube-zen.user.js
   Violentmonkey should offer an Install prompt. Alternatively copy the file
   contents into a new Violentmonkey script and enable it.
4. Click a YouTube video link on any webpage, and approve Zen's external-app
   prompt to open LokTube. Select Always allow if Zen offers the option.

The script is persistent through browser restarts, unlike a temporary
unsigned Firefox extension loaded via about:debugging. You can disable the
script in Violentmonkey to stop the handoff at any time.

## Scope and limitations

- Normal mouse-clicked links to YouTube, YouTube Music and youtu.be are
  supported: watch, Shorts, live, playlist, channel IDs, @handles, search,
  subscriptions, history and Home.
- The script does **not** intercept YouTube addresses typed or pasted into
  Zen's address bar, middle-click, Ctrl-click, Shift-click or Alt-click.
- @handles use a LokTube handle search until channel IDs can be resolved.
- The script needs permission to run on webpages to detect links on any
  website. It does not read browser cookies or transfer Google credentials;
  it only sends the clicked YouTube URL to the locally installed app.
- Zen/Windows may ask which app handles loktube: links. Pick LokTube. Some
  Linux desktop environments need a manual protocol association.
