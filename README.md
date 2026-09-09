# Paperlane

A PDF Expert–style reader, form filler, signer and annotator, packaged as a
native macOS app. The PDF is read with `pdf.js`, edited in memory, and written
back out with `pdf-lib` — all on your own machine. No account, no upload, and
no network access at all once it is built.

```bash
npm install
npm run app      # builds build/Paperlane.app  (~5 MB)
open build/Paperlane.app
```

To keep it around, drag `Paperlane.app` into `/Applications`. macOS then offers
it under **Open With** for any PDF, and double-clicking a PDF opens it here.

It also still runs as a plain web app, which is the quicker loop when working on
the interface:

```bash
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

## What it does

**Read** — continuous scroll, fit-width / fit-page / free zoom (⌘±, ⌘0,
⌘-scroll), page thumbnails, table of contents, text selection, and full-text
search across the document with hits highlighted in place.

**Fill** — real AcroForm fields (text, multiline, checkbox, radio group,
dropdown, list) are detected and rendered as native inputs positioned over the
page. Values are written back into the form on save, so the result is still a
fillable PDF — or flatten it to bake the values into the page.

**Sign** — draw a signature with the mouse/trackpad, type one in a handwriting
face, or upload an image. Signatures are stored locally for reuse, then placed,
dragged and resized anywhere on a page.

**Mark up** — highlight, underline and strike through real text (driven by the
text layer, so the boxes follow the glyphs), freehand pen, sticky notes, text
boxes with font/size/alignment, rectangles, ellipses, lines and arrows, plus an
eraser. Everything is undoable and listed in the annotations sidebar.

**Edit pages** — rotate, delete, restore and drag to reorder in the thumbnail
sidebar; insert another PDF; extract a page range to a new file.

**Save** — `⌘S` writes a copy with annotations drawn into the page content and
form values applied. Sticky notes are also written as real PDF text annotations
so other readers show the comment. `⌘P` prints a flattened copy.

## The macOS app

`mac/build.sh` assembles `Paperlane.app`: the built web bundle goes into
`Contents/Resources/web`, and `mac/Sources/*.swift` compiles to a small AppKit
shell that hosts it in a `WKWebView`. The shell is not just a window — it
provides the parts a web page cannot:

- a real menu bar, with the usual shortcuts wired to the app's own commands
- `NSOpenPanel` / `NSSavePanel` for opening and saving, and **Open Recent**
- opening PDFs from Finder, the Dock and *Open With*, with the document's name
  and proxy icon in the title bar and the edited dot in the close button
- printing through PDFKit's print panel rather than a browser dialog
- an unsaved-changes prompt on quit

The interface is served to the web view over a loopback HTTP server
(`mac/Sources/StaticServer.swift`) rather than `file://`, which is what makes
`localStorage`, module workers and `fetch` behave exactly as they do in a
browser. It binds to `127.0.0.1` on an ephemeral port, serves only the read-only
`web` directory inside the app bundle, and requires a random per-launch path
prefix.

The build is signed ad-hoc (`codesign -s -`), which is enough to run locally. To
give it to someone else you would need a Developer ID signature and
notarisation.

### Driving it from a script

The shell reads a few environment variables, so it can be launched and inspected
without a human at the keyboard — useful for checking a change actually renders:

```bash
npm run app:debug          # PAPERLANE_EVAL needs a debug build
PAPERLANE_OPEN=~/doc.pdf \
PAPERLANE_EVAL='return document.querySelectorAll(".field").length' \
PAPERLANE_SNAPSHOT=/tmp/shot.png PAPERLANE_REPORT=1 PAPERLANE_QUIT=1 \
build/Paperlane.app/Contents/MacOS/Paperlane
```

`PAPERLANE_COMMAND` fires a menu command and `PAPERLANE_DELAY` sets the settle
time. They do nothing unless you set them, and each is equivalent to something
you can do from the menus. `PAPERLANE_EVAL`, which runs arbitrary JavaScript in
the page, and `PAPERLANE_INSPECT`, which opens the Web Inspector, exist only in
debug builds — use `npm run app:debug` when you need them.

## Keyboard

| | |
|---|---|
| `V` `H` | select · pan |
| `A` `U` `S` | highlight · underline · strikethrough |
| `D` `E` `T` `N` | draw · erase · text · note |
| `R` `O` `L` | rectangle · ellipse · line |
| `⌘O` `⌘S` `⇧⌘S` | open · save a copy · save flattened |
| `⌘P` `⌘F` `⌃⌘S` | print · find · toggle sidebar |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `⌫` | delete the selected annotation |
| `Esc` | back to the select tool |

## How it fits together

| | |
|---|---|
| `src/lib/pdfjs.ts` | pdf.js worker + document loading |
| `src/lib/geom.ts` | the coordinate system (see below) |
| `src/lib/forms.ts` | AcroForm widget discovery and write-back |
| `src/lib/export.ts` | drawing annotations into the file, merge, extract |
| `src/lib/search.ts` | full-text index and hit rectangles |
| `src/state/store.ts` | document model, annotations, undo history |
| `src/components/Page.tsx` | canvas, text layer, and all page interaction |
| `src/lib/native.ts` | the bridge to the shell (inert in a browser) |
| `mac/Sources/AppDelegate.swift` | window, menus, panels, printing, bridge |
| `mac/Sources/StaticServer.swift` | loopback server for the bundled interface |

Annotation geometry is stored in **PDF user space** (points, origin at the
bottom-left, ignoring `/Rotate`), which is exactly what `pdf-lib` draws in. The
viewer converts to and from screen pixels through the pdf.js viewport, so zoom
and page rotation are handled in one place and a mark drawn on a rotated page
lands in the same spot in the exported file.

DOM overlays (form fields, text boxes, signatures) live in a `.pdf-space`
container that is sized to the *unrotated* page and CSS-rotated onto the canvas,
so their contents stay upright and correctly oriented on rotated pages.

## Security

The app's whole job is to open files that came from somebody else, so the
interface treats every document as hostile input and keeps its own surface as
small as it can.

**The page.** A strict `Content-Security-Policy` starts from `default-src
'none'`: script only from this origin, no inline script anywhere, no external
loads of any kind, `object-src`, `base-uri` and `form-action` all off. Nothing
in the app fetches from the network — CMaps, the standard fonts and the
signature faces are all local — so a document has no route to reach out even if
it could run something.

**Navigation.** The web view is pinned to the exact loopback origin it was
launched with. `file://` URLs and custom schemes are refused outright rather
than handed to the web view or to Launch Services, and an `http(s)` link shows
you where it goes and waits for you to agree before the browser opens it.

**The local server.** It binds `127.0.0.1` on an ephemeral port, answers only
`GET` and `HEAD`, and serves nothing but the read-only `web` directory inside
the app bundle. Every request must carry a random 128-bit path prefix minted at
launch, and a `Host` header naming that exact port — so another process cannot
reach it by guessing, and a browser elsewhere on the machine cannot be pointed
at it by a rebound hostname. Paths are resolved through symlinks before being
checked for containment, and a connection that never finishes its request is
dropped after 15 seconds. Verified: `200` for the real entry point, `403` for a
foreign `Host`, `404` for `../../../../etc/passwd` and for a wrong token.

**No code execution in the shipped app.** The scripting hooks above are limited
in release builds to things you can already do from the menus — open a file,
fire a command, take a screenshot, quit. The two that are not — running
arbitrary JavaScript in the page, and opening the Web Inspector — are compiled
into debug builds only.

**Your data.** Documents are read into memory and never leave the machine;
there is no telemetry, no analytics and no update check. Saved signatures are
the one thing that persists — they live unencrypted in the app's own WebKit
local storage, and the signature sheet has an × on each one to remove it.

**Not done.** The app does not run under App Sandbox; that would be the next
meaningful step and mostly means declaring the file access it already gets
through the open and save panels. The build is ad-hoc signed and not notarised,
so it runs only on the machine that built it.

## Notes and limits

- CMaps and the standard fonts are copied into `public/pdfjs` by `npm run
  assets`, which `dev` and `build` chain explicitly (npm's implicit `pre*`
  hooks are skipped when `ignore-scripts` is set), and the "Type" signature tab uses the script faces that ship with macOS,
  so nothing is ever fetched over the network.
- Encrypted PDFs open with a password prompt and can be read, searched and
  filled in, but **not saved**. `pdf-lib` cannot reapply encryption, so anything
  written into a protected file is plaintext inside a document that declares
  itself encrypted — every reader then renders the additions as nothing. The
  saved file would look untouched while quietly missing the work, so Paperlane
  refuses instead, and says why. Remove the password from the original first.
- Inserting another PDF copies its pages but not its interactive form fields —
  a `pdf-lib` limitation. Fill that document before inserting it, or flatten it.
- Editing the *existing* text of a page is not supported — the app adds content
  on top rather than reflowing the original. Text boxes, redaction-style filled
  rectangles and page surgery cover most of what that is used for.
- Page bitmaps and pdf.js's per-page caches are released as pages leave the
  render window, so memory plateaus rather than growing with how far you have
  scrolled: a 400-page document settles around 520 MB and stays there across
  repeated passes. Without that it reached 1.4 GB and took the web process down.
- Everything runs on the main thread except pdf.js rendering; very large
  documents (1000+ pages) will feel it in the thumbnail sidebar.

## Sample

`public/samples/membership-form.pdf` is a generated three-page document with a
real AcroForm, a page of prose for text markup and search, and a page with
`/Rotate 90` — handy for exercising every feature.
