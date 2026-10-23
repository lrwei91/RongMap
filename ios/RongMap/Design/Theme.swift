import SwiftUI
import UIKit

enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}

/// 动画入口：系统开启「减弱动效」后统一退化为瞬时切换。
enum MapMotion {
    static var isReduced: Bool { UIAccessibility.isReduceMotionEnabled }

    static var smooth: Animation? {
        isReduced ? nil : .smooth(duration: 0.26)
    }

    static var press: Animation? {
        isReduced ? nil : .spring(response: 0.24, dampingFraction: 0.86)
    }
}

/// 视觉令牌来自网页端 `src/styles.css` 的 `:root`：白纸、黑墨、荧光黄。
/// 与 Atlas / 鲤鱼片单同源的「纸面 + 黄记号」语言，固定浅色。
enum MapTheme {
    static let paper = Color(hex: 0xFFFFFF)
    static let paperWarm = Color(hex: 0xFFFDF7)
    static let surfaceSubtle = Color(hex: 0xF7F7F3)
    static let ink = Color(hex: 0x1A1A1A)
    static let inkMuted = Color(hex: 0x656565)
    static let accent = Color(hex: 0xFFE28A)
    static let accentSoft = Color(hex: 0xFFF6D6)
    static let line = Color(hex: 0xE3E3DF)
    static let controlLine = Color(hex: 0x82827C)
    static let success = Color(hex: 0x28704B)
    static let warning = Color(hex: 0x8A6410)
    static let danger = Color(hex: 0xA33D36)
    static let mapPaper = Color(hex: 0xF9F0D8)

    static let cardRadius: CGFloat = 12
    static let controlRadius: CGFloat = 10

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: scaled(size), weight: weight)
    }

    static func heading(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: scaled(size), weight: weight)
    }

    /// 导航类元素（底栏、标签）字号固定，避免放大字号撑坏固定高度。
    static func fixed(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight)
    }

    private static func scaled(_ size: CGFloat) -> CGFloat {
        UIFontMetrics(forTextStyle: .body).scaledValue(for: size)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension PlaceCategory {
    var tint: Color {
        switch self {
        case .food: return Color(hex: 0xC2410C)
        case .spot: return MapTheme.success
        case .cafe_bar: return Color(hex: 0x6D28D9)
        }
    }
}

/// 品牌标记：黄色地图钉 + 黑色街网线，与 App 图标同源。
struct MapMark: View {
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                .fill(MapTheme.accentSoft)
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                        .strokeBorder(MapTheme.ink.opacity(0.12), lineWidth: 1)
                )
            Path { path in
                path.move(to: CGPoint(x: size * 0.28, y: size * 0.74))
                path.addLine(to: CGPoint(x: size * 0.28, y: size * 0.3))
                path.move(to: CGPoint(x: size * 0.5, y: size * 0.78))
                path.addLine(to: CGPoint(x: size * 0.5, y: size * 0.24))
                path.move(to: CGPoint(x: size * 0.72, y: size * 0.74))
                path.addLine(to: CGPoint(x: size * 0.72, y: size * 0.36))
            }
            .stroke(MapTheme.ink.opacity(0.28), lineWidth: size * 0.05)
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: size * 0.52, weight: .bold))
                .foregroundStyle(MapTheme.ink, MapTheme.accent)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// iOS 26 用液态玻璃，低版本回退到超薄材质；减少透明度时改用实色纸面。
struct GlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    var cornerRadius: CGFloat = 999

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        Group {
            if reduceTransparency || contrast == .increased {
                content.background(MapTheme.paper, in: shape)
            } else if #available(iOS 26.0, *) {
                content
                    .background(MapTheme.paper.opacity(0.72), in: shape)
                    .glassEffect(.regular.interactive(), in: shape)
            } else {
                content
                    .background(MapTheme.paper.opacity(0.66), in: shape)
                    .background(.regularMaterial, in: shape)
            }
        }
        .overlay {
            shape.strokeBorder(MapTheme.line, lineWidth: 0.75)
        }
        .shadow(color: MapTheme.ink.opacity(0.1), radius: 16, x: 0, y: 5)
    }
}

struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(reduceMotion ? nil : MapMotion.press, value: configuration.isPressed)
    }
}

/// 纸面背景：静态，不参与滚动动画。
struct PaperBackground: View {
    var body: some View {
        MapTheme.paperWarm
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}
