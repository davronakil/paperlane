// Draws the app icon into an .iconset. Run via `swift mac/makeicon.swift <out.iconset>`.
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Paperlane.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func draw(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let ctx = NSGraphicsContext.current!.cgContext
    let s = size / 1024

    // rounded square, macOS-ish proportions
    let inset = 92 * s
    let rect = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let squircle = NSBezierPath(roundedRect: rect, xRadius: 200 * s, yRadius: 200 * s)

    let gradient = NSGradient(colors: [
        NSColor(srgbRed: 0.30, green: 0.50, blue: 1.00, alpha: 1),
        NSColor(srgbRed: 0.11, green: 0.32, blue: 0.90, alpha: 1),
    ])!
    ctx.saveGState()
    squircle.addClip()
    gradient.draw(in: rect, angle: -90)
    ctx.restoreGState()

    // sheet of paper with a folded corner
    let w = 380 * s, h = 470 * s
    let x = (size - w) / 2, y = (size - h) / 2
    let fold = 118 * s
    let page = NSBezierPath()
    page.move(to: CGPoint(x: x, y: y))
    page.line(to: CGPoint(x: x + w, y: y))
    page.line(to: CGPoint(x: x + w, y: y + h - fold))
    page.line(to: CGPoint(x: x + w - fold, y: y + h))
    page.line(to: CGPoint(x: x, y: y + h))
    page.close()
    NSColor.white.setFill()
    page.fill()

    let corner = NSBezierPath()
    corner.move(to: CGPoint(x: x + w - fold, y: y + h))
    corner.line(to: CGPoint(x: x + w - fold, y: y + h - fold))
    corner.line(to: CGPoint(x: x + w, y: y + h - fold))
    corner.close()
    NSColor(srgbRed: 0.80, green: 0.85, blue: 0.96, alpha: 1).setFill()
    corner.fill()

    // signature scrawl across the page
    let ink = NSBezierPath()
    ink.lineWidth = 26 * s
    ink.lineCapStyle = .round
    ink.lineJoinStyle = .round
    let baseY = y + 150 * s
    ink.move(to: CGPoint(x: x + 58 * s, y: baseY))
    ink.curve(to: CGPoint(x: x + 172 * s, y: baseY + 34 * s),
              controlPoint1: CGPoint(x: x + 92 * s, y: baseY + 150 * s),
              controlPoint2: CGPoint(x: x + 128 * s, y: baseY - 96 * s))
    ink.curve(to: CGPoint(x: x + 322 * s, y: baseY + 62 * s),
              controlPoint1: CGPoint(x: x + 232 * s, y: baseY + 190 * s),
              controlPoint2: CGPoint(x: x + 262 * s, y: baseY - 40 * s))
    NSColor(srgbRed: 0.09, green: 0.10, blue: 0.14, alpha: 1).setStroke()
    ink.stroke()

    // two ruled lines above it
    NSColor(srgbRed: 0.72, green: 0.76, blue: 0.85, alpha: 1).setFill()
    for i in 0..<2 {
        let lineY = y + h - (170 + CGFloat(i) * 66) * s
        NSBezierPath(roundedRect: CGRect(x: x + 58 * s, y: lineY,
                                         width: (i == 0 ? 210 : 264) * s, height: 24 * s),
                     xRadius: 12 * s, yRadius: 12 * s).fill()
    }

    image.unlockFocus()
    return image
}

let sizes: [(Int, String)] = [
    (16, "icon_16x16"), (32, "icon_16x16@2x"), (32, "icon_32x32"), (64, "icon_32x32@2x"),
    (128, "icon_128x128"), (256, "icon_128x128@2x"), (256, "icon_256x256"),
    (512, "icon_256x256@2x"), (512, "icon_512x512"), (1024, "icon_512x512@2x"),
]

for (px, name) in sizes {
    let image = draw(size: CGFloat(px))
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { continue }
    try png.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
}
print("wrote \(outDir)")
