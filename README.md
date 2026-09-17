# Paperlane

A PDF Expert–style reader, form filler, signer and annotator, packaged as a
native macOS app. The PDF is read with `pdf.js`, edited in memory, and written
back out with `pdf-lib` — all on your own machine. No account, no upload, and
no network access at all once it is built.

## Install it on your Mac

Get the files, then run one command. It takes a couple of minutes the first
time, and you do not need to understand any of it.

### 1. Get the files

**Without the Terminal:** click the green **Code** button at the top of
[this page](https://github.com/davronakil/paperlane) → **Download ZIP**, then
double-click the downloaded file to unzip it. You will get a folder called
`paperlane-main`, probably in your Downloads.

**Or in the Terminal:**

```bash
git clone https://github.com/davronakil/paperlane.git
```

### 2. Run the installer

Open **Terminal** (press ⌘-Space, type `Terminal`, hit return). Type `cd`
followed by a space, then **drag the folder onto the Terminal window** — that
fills in the path for you — and press return:

```bash
cd ~/Downloads/paperlane-main     # or wherever the folder ended up
./install.sh
```

That's it. Paperlane will open when it finishes, and from then on it lives in
your Applications folder, shows up in Spotlight, and appears under **Open With**
for any PDF.

### If it stops and asks for something

The installer checks everything up front and prints the exact command to fix
whatever is missing. There are only three possibilities:

| It says | Run this, then `./install.sh` again |
|---|---|
| developer tools are not installed | `xcode-select --install` — click Install in the window that appears and wait for it to finish |
| Xcode's licence has not been accepted | `sudo xcodebuild -license accept` — it will ask for your Mac password |
| Node.js is not installed | install the **LTS** version from [nodejs.org](https://nodejs.org), or `brew install node` |

The developer tools are a one-time download of about 1.5 GB. The full Xcode
app, which is many times larger, is **not** needed.

### Updating later

```bash
cd ~/Downloads/paperlane-main
git pull        # or download the ZIP again
./install.sh
```

### Why there is no ready-made download

The app is signed ad-hoc, which means it is trusted on the machine that built
it and nowhere else. Handing out a prebuilt copy would mean either paying for
an Apple Developer ID and notarising it, or telling you to switch off the check
that stops unidentified apps from running — and that is not advice worth
giving. Building it yourself takes a couple of minutes and sidesteps the whole
problem.

## Working on it

The interface also runs as a plain web app, which is a much quicker loop than
rebuilding the shell:

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run app      # just the .app, without installing it
npm run fixtures # regenerate the test PDFs
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

**Edit the text that is already there** — not a text box placed on top: the
words baked into the page are rewritten in the file itself. Pick the *Edit
existing text* tool, click a line, retype it. Where the page's own font can
spell the new text it is used, so the result is indistinguishable from the
original; where it cannot, the line is redrawn in a metric-matched stand-in.
Either way the old text is removed from the content stream, not painted over —
it cannot be selected, searched or recovered afterwards.

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
| `src/lib/textedit/` | rewriting the text a page already draws (see below) |
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

## Editing existing text

PDF has no notion of a paragraph. A page is a list of drawing operators, and a
line of prose is usually one `Tj` or `TJ` showing bytes in whatever encoding
its font happens to use. Editing that text means finding the operator
responsible and rewriting it.

`src/lib/textedit/` does exactly that:

| | |
|---|---|
| `tokenizer.ts` | walks the content stream and records each operator's byte span — including skipping inline image payloads, which would otherwise parse as garbage |
| `fonts.ts` | reads a font well enough to go both ways: `/ToUnicode` CMaps, `/Encoding` with `/Differences`, WinAnsi, CID widths, and the AFM tables for the standard 14 (which ship with no `/Widths` at all) |
| `scan.ts` | replays the graphics and text state — `cm`, `q/Q`, `Tm/Td/TD/T*`, `Tf`, `Tc/Tw/Tz/Ts`, fill colour — to place every run on the page and measure it |
| `apply.ts` | splices replacement operators into the stream |

Measured runs agree with pdf.js to the decimal place, which is what lets the
edit box sit exactly on the text.

Three things can happen when you retype a line:

1. **The page's own font can spell it.** The string is re-encoded through the
   font's own mapping and the operator is replaced. The result is the original
   typeface, unchanged.
2. **It cannot** — subset fonts only carry the glyphs the document already
   used, so a new letter may simply not exist. The run is removed and redrawn
   in a stand-in matched on serif/fixed/bold/italic, at the same size, colour
   and position.
3. **Nothing available can draw it** — typing Japanese into a Latin subset, for
   instance. The edit is refused and the original text is left exactly as it
   was, because deleting a line and failing to replace it is worse than not
   editing it.

### What it will not do

Each run is edited on its own; there is no reflow. Make a line longer and it
grows to the right rather than pushing words onto the next line, so it can run
into whatever sits beside it. Text drawn inside a Form XObject, and text set at
an angle, are shown but not offered for editing. Rewriting a paragraph as a
paragraph would mean reconstructing the original line-breaking decisions, which
is a much larger problem than this solves.

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
