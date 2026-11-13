# Third-Party Notices

WorldTube uses independently maintained open-source components and assets.
Their licenses remain separate from the project's AGPL-3.0-only license.
These notices do not grant rights to unrelated third parties'
code or certify WorldTube's entire historical provenance.

## Advertising and tracking protection

The network filtering engine is `@ghostery/adblocker` (MPL-2.0); its complete
upstream notices are included by the dependency-notice generator. EasyList
and EasyPrivacy are by The EasyList authors (https://easylist.to/). Their
unmodified snapshots, attribution and complete GPL-3.0-or-later license text
are included under `resources/filters` in the source and `filters` in packaged
applications. See `resources/filters/README.md` for source and license links.

## Fonts

Inter and Inter Tight are Copyright The Inter Project Authors and distributed
under SIL Open Font License 1.1. The owner authorized replacement of local
files of uncertain origin with official, unmodified local copies. Download
sources and SHA-256 hashes are recorded in `third-party/sources.json`.

Full texts: `third-party/Inter-OFL.txt` and `third-party/InterTight-OFL.txt`.
The SF preset is only a system fallback; no Apple SF font files are bundled.
The Google Fonts catalog is only used by the explicit maintenance download
script. The running application serves bundled font files, not cloud fonts.

## Icons and Application Mark

- `earth.svg` and `globe.svg` originate from Lucide. Preserve the complete
  upstream ISC/MIT notices in `third-party/Lucide-LICENSE.txt`.
- `world-solid.svg` uses Pictogrammers/Material Design earth geometry under
  Apache 2.0. Its SVG wrapper is customized for WorldTube.
- The wordmark in `resources/brand.svg` combines that earth geometry with
  WorldTube's layout and play shape. The monochrome buffering artwork also
  uses that mark. Both retain the applicable asset notices.
- The desktop application icon uses only the blue play symbol. PNG, ICO and
  ICNS files are generated from `resources/icon.svg`.
- Preserve `third-party/Pictogrammers-LICENSE.txt` and the complete
  `third-party/Apache-2.0.txt`, not only a link to the license.

## Player Styles

`shaka-controls.css` is customized third-party Shaka Player CSS, Copyright
2016 Google LLC, Apache 2.0. Its tooltip includes MIT-licensed work Copyright
2017 Felipe Fialho. Both original headers remain in the source stylesheet and
the complete tooltip notice is collected into installed asset notices.

## Runtime Components

The notice preparation script traverses installed production dependencies,
including their transitive dependencies, and also records bundled Shaka Player
and Electron. It copies license/notice files verbatim, not just SPDX labels.
The installed package's license declaration is recorded in the inventory.

Some npm packages omit a standalone license file:

- `lazy-val` 1.0.5 declares MIT and names Vladimir Krivosheev in its upstream
  package metadata. The exact upstream declaration and complete MIT terms are
  included, with author attribution. No missing copyright year is invented.
- Native `@esbuild/*` packages inherit the same version of esbuild's MIT
  license; the Go runtime BSD notice is included too.
- `@bufbuild/protobuf` 2.15.0 has Apache 2.0 and BSD 3-Clause material. The
  pinned upstream Apache text and the full Google notice from its installed
  varint source are included. An Apache-only notice would be incomplete.

Future missing required packages, license texts or unsupported fallback
versions stop notice preparation rather than silently dropping attribution.
Electron's MIT text and its complete `LICENSES.chromium.html` are copied from
the installed Electron distribution; these cover notices shipped with that
runtime, including its Chromium components. Actual installer contents still
need grouped package validation.

## Installed Location

`pnpm notices` prepares `build/third-party/` without building the application.
Electron Builder's `beforePack` hook also prepares these files, including for a
direct Builder invocation. `extraResources` places them in `resources/licenses`
on Linux/Windows and `Contents/Resources/licenses` inside the macOS application.
Fonts and icon notices are also kept beside their source assets.

The preparation step is offline. It verifies recorded asset hashes and uses
installed dependency notices plus the reviewed copies in `third-party/`.
Maintenance download scripts are explicit, not part of application startup or
packaging. No personal data or developer home-directory paths enter the inventory.

## YouTube.js compatibility patch

YouTube.js 18.0.0 (MIT) is distributed with the small compatibility patch in
`patches/youtubei.js@18.0.0.patch`. Diagnostic warning links fall back to the
upstream issue URL when optional `bugs` package metadata is absent in an
installer. Original upstream license notices are preserved.
