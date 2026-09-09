import Foundation
import Network

/// Serves the built web app to the embedded WKWebView over loopback.
///
/// A real http:// origin (rather than file:// or a custom scheme) is what makes
/// localStorage, module workers and fetch behave exactly as they do in a
/// browser. The listener binds to 127.0.0.1 on an ephemeral port, only ever
/// reads from the read-only `web` directory inside the app bundle, and requires
/// a random per-launch path prefix so nothing else on the machine can guess it.
final class StaticServer {
    private let root: URL
    private let token: String
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "paperlane.http")

    init(root: URL) {
        self.root = root.standardizedFileURL
        var raw = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, raw.count, &raw)
        self.token = raw.map { String(format: "%02x", $0) }.joined()
    }

    /// Starts listening and returns the URL of the app's entry point.
    func start() throws -> URL {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback),
                                                           port: .any)
        params.allowLocalEndpointReuse = true
        let listener = try NWListener(using: params)
        self.listener = listener

        let ready = DispatchSemaphore(value: 0)
        var failure: Error?
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: ready.signal()
            case .failed(let error), .waiting(let error):
                failure = error
                ready.signal()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: self?.queue ?? .global())
            self?.receive(on: connection, buffer: Data())
        }
        listener.start(queue: queue)

        if ready.wait(timeout: .now() + 5) == .timedOut {
            throw ServerError.timedOut
        }
        if let failure { throw failure }
        guard let port = listener.port?.rawValue else { throw ServerError.noPort }
        return URL(string: "http://127.0.0.1:\(port)/\(token)/index.html")!
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    enum ServerError: LocalizedError {
        case timedOut, noPort
        var errorDescription: String? {
            switch self {
            case .timedOut: return "The local server did not start in time."
            case .noPort: return "The local server could not claim a port."
            }
        }
    }

    // MARK: - request handling

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) {
            [weak self] chunk, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let chunk { buffer.append(chunk) }

            if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<range.lowerBound], as: UTF8.self)
                self.respond(to: head, on: connection)
                return
            }
            if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: buffer)
        }
    }

    private func respond(to head: String, on connection: NWConnection) {
        guard let requestLine = head.split(separator: "\r\n").first else {
            return send(status: "400 Bad Request", body: Data(), type: "text/plain",
                        on: connection)
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            return send(status: "405 Method Not Allowed", body: Data(),
                        type: "text/plain", on: connection)
        }

        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path

        let prefix = "/\(token)/"
        guard path.hasPrefix(prefix) else {
            return send(status: "404 Not Found", body: Data("not found".utf8),
                        type: "text/plain", on: connection)
        }

        var relative = String(path.dropFirst(prefix.count))
        if relative.isEmpty { relative = "index.html" }

        let target = root.appendingPathComponent(relative).standardizedFileURL
        guard target.path == root.path || target.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: target)
        else {
            return send(status: "404 Not Found", body: Data("not found".utf8),
                        type: "text/plain", on: connection)
        }

        send(status: "200 OK",
             body: parts[0] == "HEAD" ? Data() : data,
             type: Self.contentType(for: target.pathExtension),
             length: data.count,
             on: connection)
    }

    private func send(status: String, body: Data, type: String, length: Int? = nil,
                      on connection: NWConnection) {
        let header = """
        HTTP/1.1 \(status)\r
        Content-Type: \(type)\r
        Content-Length: \(length ?? body.count)\r
        Cache-Control: no-store\r
        Connection: close\r
        \r

        """
        var out = Data(header.utf8)
        out.append(body)
        connection.send(content: out, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func contentType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "pdf": return "application/pdf"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
