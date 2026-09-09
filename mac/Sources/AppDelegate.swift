import AppKit
import PDFKit
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler,
                         WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {

    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: StaticServer!
    /// Files handed to us by Finder before the web app was ready to take them.
    private var queuedOpens: [URL] = []
    private var webReady = false
    private var documentEdited = false
    /// The file the current document came from, for the title bar's proxy icon.
    private var documentURL: URL?
    /// Most recent file handed to the web app, matched against the title it reports.
    private var lastOpenedURL: URL?
    /// Size of the most recent document handed over for saving (diagnostics only).
    private var lastSaveBytes = 0

    // MARK: - launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let webRoot = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            fail("The application bundle is missing its web resources.")
            return
        }

        server = StaticServer(root: webRoot)
        let entry: URL
        do {
            entry = try server.start()
        } catch {
            fail("Paperlane could not start its local view server.\n\n\(error.localizedDescription)")
            return
        }

        buildMenu()
        buildWindow()
        webView.load(URLRequest(url: entry))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard documentEdited else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "You have unsaved changes."
        alert.informativeText =
            "Annotations and form entries that have not been saved to a PDF will be lost."
        alert.addButton(withTitle: "Save…")
        alert.addButton(withTitle: "Discard")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            send(command: "save")
            return .terminateCancel
        case .alertSecondButtonReturn:
            return .terminateNow
        default:
            return .terminateCancel
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.isFileURL { deliver(url, purpose: "open") }
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Paperlane can’t start"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    // MARK: - window

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "paperlane")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860),
                            configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = false
        if #available(macOS 13.3, *) {
            webView.isInspectable = ProcessInfo.processInfo.environment["PAPERLANE_INSPECT"] != nil
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = "Paperlane"
        window.titlebarAppearsTransparent = false
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = webView
        window.delegate = self
        window.setFrameAutosaveName("PaperlaneMain")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - bridge: JS -> native

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "ready":
            webReady = true
            let pending = queuedOpens
            queuedOpens = []
            pending.forEach { deliver($0, purpose: "open") }

        case "openPanel":
            let purpose = (body["purpose"] as? String) ?? "open"
            showOpenPanel(purpose: purpose)

        case "save":
            guard let base64 = body["data"] as? String,
                  let data = Data(base64Encoded: base64) else { return }
            lastSaveBytes = data.count
            showSavePanel(data: data, suggested: (body["name"] as? String) ?? "Document.pdf")

        case "print":
            guard let base64 = body["data"] as? String,
                  let data = Data(base64Encoded: base64) else { return }
            printPDF(data: data, jobName: (body["name"] as? String) ?? "Document")

        case "title":
            let name = (body["name"] as? String) ?? ""
            documentEdited = (body["dirty"] as? Bool) ?? false
            // Only show a proxy icon when the open document really is the file we
            // handed over; one dropped onto the window has no file of its own.
            if let opened = lastOpenedURL, !name.isEmpty,
               opened.lastPathComponent == name {
                documentURL = opened
            } else {
                documentURL = nil
            }
            window.title = name.isEmpty ? "Paperlane" : name
            // Assigning `title` drops the proxy icon, so restore it afterwards.
            window.representedURL = documentURL
            window.isDocumentEdited = documentEdited

        case "notify":
            if let text = body["message"] as? String { presentInfo(text) }

        default:
            break
        }
    }

    // MARK: - bridge: native -> JS

    private func send(command: String) {
        run("window.__paperlane && window.__paperlane.command(\(jsString(command)))")
    }

    private func deliver(_ url: URL, purpose: String) {
        guard webReady else {
            queuedOpens.append(url)
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            presentInfo("Could not read \(url.lastPathComponent).")
            return
        }
        if purpose == "open" {
            lastOpenedURL = url
            documentURL = url
            window.representedURL = url
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
        }
        let js = "window.__paperlane.openFile(\(jsString(url.lastPathComponent)), "
            + "\(jsString(data.base64EncodedString())), \(jsString(purpose)))"
        run(js)
    }

    private func run(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        guard let data, let text = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(text.dropFirst().dropLast())
    }

    // MARK: - panels

    private func showOpenPanel(purpose: String) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = false
        panel.message = purpose == "insert"
            ? "Choose a PDF to insert after the current pages."
            : "Choose a PDF to open."
        panel.prompt = purpose == "insert" ? "Insert" : "Open"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.deliver(url, purpose: purpose)
        }
    }

    private func showSavePanel(data: Data, suggested: String) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = suggested
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
                NSDocumentController.shared.noteNewRecentDocumentURL(url)
                self.run("window.__paperlane.saved(\(self.jsString(url.path)))")
            } catch {
                self.presentInfo("Could not save: \(error.localizedDescription)")
            }
        }
    }

    private func printPDF(data: Data, jobName: String) {
        guard let document = PDFDocument(data: data) else {
            presentInfo("The document could not be prepared for printing.")
            return
        }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit
        info.verticalPagination = .fit
        guard let operation = document.printOperation(for: info,
                                                      scalingMode: .pageScaleDownToFit,
                                                      autoRotate: true) else {
            presentInfo("The document could not be prepared for printing.")
            return
        }
        operation.jobTitle = jobName
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    private func presentInfo(_ text: String) {
        let alert = NSAlert()
        alert.messageText = text
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window, completionHandler: nil)
    }

    // MARK: - navigation policy

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // Keep the app itself in the web view; send anything else to the browser.
        if url.host == "127.0.0.1" || url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
        } else if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                 withError error: Error) {
        presentInfo("The interface failed to load: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        runDebugHooks()
    }

    /// The interface lives entirely in the web process, so if it dies the
    /// document goes with it. Reload rather than leaving a blank window, and
    /// say so plainly instead of letting the work disappear silently.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webReady = false
        documentEdited = false
        documentURL = nil
        window.isDocumentEdited = false
        window.representedURL = nil
        window.title = "Paperlane"
        webView.reload()
        presentInfo("Paperlane ran out of memory and restarted. "
                    + "Any unsaved annotations or form entries were lost.")
    }

    // MARK: - debug hooks
    //
    // Driven entirely by environment variables, so they are inert unless you
    // launch the binary yourself with them set:
    //
    //   PAPERLANE_OPEN=<file.pdf>   open a document at launch
    //   PAPERLANE_EVAL=<js>         run JS (top-level await allowed), print the result
    //   PAPERLANE_SNAPSHOT=<a.png>  write a PNG of the window
    //   PAPERLANE_DELAY=<seconds>   settle time before the two above (default 3)
    //   PAPERLANE_COMMAND=<name>    fire a menu command through the bridge
    //   PAPERLANE_QUIT=1            exit once they are done
    //   PAPERLANE_INSPECT=1         enable the Web Inspector

    private func runDebugHooks() {
        let env = ProcessInfo.processInfo.environment
        if let path = env["PAPERLANE_OPEN"] {
            deliver(URL(fileURLWithPath: path), purpose: "open")
        }
        guard env["PAPERLANE_EVAL"] != nil || env["PAPERLANE_SNAPSHOT"] != nil
                || env["PAPERLANE_COMMAND"] != nil else { return }
        let delay = Double(env["PAPERLANE_DELAY"] ?? "") ?? 3
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.evaluateThenSnapshot(env)
        }
    }

    private func evaluateThenSnapshot(_ env: [String: String]) {
        if let command = env["PAPERLANE_COMMAND"] { send(command: command) }
        guard let script = env["PAPERLANE_EVAL"] else { return snapshot(env) }
        webView.callAsyncJavaScript(script, arguments: [:], in: nil,
                                    in: .page) { [weak self] result in
            switch result {
            case .success(let value):
                let printable = (value as? CustomStringConvertible)?.description
                    ?? String(describing: value)
                print("EVAL: \(printable)")
            case .failure(let error):
                print("EVAL ERROR: \(error.localizedDescription)")
            }
            fflush(stdout)
            let extra = Double(env["PAPERLANE_DELAY2"] ?? "") ?? 1
            DispatchQueue.main.asyncAfter(deadline: .now() + extra) {
                self?.snapshot(env)
            }
        }
    }

    private func snapshot(_ env: [String: String]) {
        guard let path = env["PAPERLANE_SNAPSHOT"] else { return finishDebug(env) }
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        webView.takeSnapshot(with: config) { [weak self] image, error in
            if let image,
               let tiff = image.tiffRepresentation,
               let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: path))
                print("SNAPSHOT: \(path)")
            } else {
                print("SNAPSHOT ERROR: \(error?.localizedDescription ?? "unknown")")
            }
            fflush(stdout)
            self?.finishDebug(env)
        }
    }

    private func finishDebug(_ env: [String: String]) {
        if env["PAPERLANE_REPORT"] != nil {
            let sheet = window.attachedSheet.map { String(describing: type(of: $0)) } ?? "none"
            print("REPORT: title=\(window.title) edited=\(window.isDocumentEdited) "
                  + "represented=\(window.representedURL?.lastPathComponent ?? "none") "
                  + "sheet=\(sheet) saveBytes=\(lastSaveBytes) "
                  + "menus=\(NSApp.mainMenu?.items.count ?? 0)")
            fflush(stdout)
        }
        if env["PAPERLANE_QUIT"] != nil {
            if let sheet = window.attachedSheet { window.endSheet(sheet, returnCode: .cancel) }
            documentEdited = false
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    // MARK: - menu actions

    @objc private func menuOpen() { send(command: "open") }
    @objc private func menuInsert() { send(command: "insert") }
    @objc private func menuSave() { send(command: "save") }
    @objc private func menuSaveFlat() { send(command: "saveFlat") }
    @objc private func menuExtract() { send(command: "extract") }
    @objc private func menuPrint() { send(command: "print") }
    @objc private func menuClose() { send(command: "close") }
    @objc private func menuUndo() { send(command: "undo") }
    @objc private func menuRedo() { send(command: "redo") }
    @objc private func menuFind() { send(command: "find") }
    @objc private func menuSign() { send(command: "sign") }
    @objc private func menuZoomIn() { send(command: "zoomIn") }
    @objc private func menuZoomOut() { send(command: "zoomOut") }
    @objc private func menuFitWidth() { send(command: "fitWidth") }
    @objc private func menuFitPage() { send(command: "fitPage") }
    @objc private func menuSidebar() { send(command: "sidebar") }
    @objc private func menuNextPage() { send(command: "nextPage") }
    @objc private func menuPrevPage() { send(command: "prevPage") }

    private func buildMenu() {
        let mainMenu = NSMenu()

        // App
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Paperlane",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        let services = NSMenu()
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        appMenu.addItem(servicesItem)
        NSApp.servicesMenu = services
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Paperlane",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others",
                                    action: #selector(NSApplication.hideOtherApplications(_:)),
                                    keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All",
                        action: #selector(NSApplication.unhideAllApplications(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Paperlane",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // File
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(item("Open…", #selector(menuOpen), "o"))
        let recentItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Open Recent")
        recentMenu.delegate = recentDelegate
        recentItem.submenu = recentMenu
        fileMenu.addItem(recentItem)
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("Insert PDF…", #selector(menuInsert), ""))
        fileMenu.addItem(item("Extract Pages…", #selector(menuExtract), ""))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("Save a Copy…", #selector(menuSave), "s"))
        let flat = item("Save Flattened Copy…", #selector(menuSaveFlat), "s")
        flat.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(flat)
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("Print…", #selector(menuPrint), "p"))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("Close Document", #selector(menuClose), "w"))
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // Edit
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(item("Undo", #selector(menuUndo), "z"))
        let redo = item("Redo", #selector(menuRedo), "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: NSSelectorFromString("cut:"), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: NSSelectorFromString("copy:"), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: NSSelectorFromString("paste:"), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: NSSelectorFromString("selectAll:"),
                         keyEquivalent: "a")
        editMenu.addItem(.separator())
        editMenu.addItem(item("Find in Document…", #selector(menuFind), "f"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // View
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Zoom In", #selector(menuZoomIn), "+"))
        viewMenu.addItem(item("Zoom Out", #selector(menuZoomOut), "-"))
        viewMenu.addItem(item("Fit Width", #selector(menuFitWidth), "0"))
        let fitPage = item("Fit Page", #selector(menuFitPage), "0")
        fitPage.keyEquivalentModifierMask = [.command, .option]
        viewMenu.addItem(fitPage)
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("Next Page", #selector(menuNextPage), Self.functionKey(NSDownArrowFunctionKey)))
        viewMenu.addItem(item("Previous Page", #selector(menuPrevPage), Self.functionKey(NSUpArrowFunctionKey)))
        viewMenu.addItem(.separator())
        let sidebar = item("Toggle Sidebar", #selector(menuSidebar), "s")
        sidebar.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(sidebar)
        viewMenu.addItem(.separator())
        let fullScreen = NSMenuItem(title: "Enter Full Screen",
                                    action: #selector(NSWindow.toggleFullScreen(_:)),
                                    keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullScreen)
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Tools
        let toolsItem = NSMenuItem()
        let toolsMenu = NSMenu(title: "Tools")
        toolsMenu.addItem(item("Add Signature…", #selector(menuSign), ""))
        toolsItem.submenu = toolsMenu
        mainMenu.addItem(toolsItem)

        // Window
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize",
                           action: #selector(NSWindow.performMiniaturize(_:)),
                           keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)),
                           keyEquivalent: "")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    private static func functionKey(_ code: Int) -> String {
        guard let scalar = UnicodeScalar(UInt32(code)) else { return "" }
        return String(Character(scalar))
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: key)
        menuItem.target = self
        return menuItem
    }

    /// Fills in File ▸ Open Recent from the shared document controller.
    private lazy var recentDelegate = RecentMenuDelegate { [weak self] url in
        self?.deliver(url, purpose: "open")
    }
}

final class RecentMenuDelegate: NSObject, NSMenuDelegate {
    private let onPick: (URL) -> Void
    init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let recents = NSDocumentController.shared.recentDocumentURLs
        if recents.isEmpty {
            let empty = NSMenuItem(title: "No Recent Documents", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
            return
        }
        for url in recents {
            let entry = NSMenuItem(title: url.lastPathComponent, action: #selector(pick(_:)),
                                   keyEquivalent: "")
            entry.target = self
            entry.representedObject = url
            entry.image = NSWorkspace.shared.icon(forFile: url.path)
            entry.image?.size = NSSize(width: 16, height: 16)
            menu.addItem(entry)
        }
        menu.addItem(.separator())
        let clear = NSMenuItem(title: "Clear Menu", action: #selector(clear(_:)),
                               keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }

    @objc private func pick(_ sender: NSMenuItem) {
        if let url = sender.representedObject as? URL { onPick(url) }
    }

    @objc private func clear(_ sender: NSMenuItem) {
        NSDocumentController.shared.clearRecentDocuments(nil)
    }
}
