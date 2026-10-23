import SwiftUI

/// 分类小标签：颜色、图标与网页端分类口径一致。
struct CategoryChip: View {
    let category: PlaceCategory?
    var compact = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: category?.icon ?? "mappin")
                .font(.system(size: compact ? 10 : 12, weight: .semibold))
            Text(category?.label ?? "未分类")
                .font(MapTheme.fixed(compact ? 11 : 12, weight: .semibold))
        }
        .foregroundStyle(category?.tint ?? MapTheme.inkMuted)
        .padding(.horizontal, compact ? 7 : 9)
        .padding(.vertical, compact ? 3 : 5)
        .background((category?.tint ?? MapTheme.inkMuted).opacity(0.12), in: Capsule())
    }
}

/// 列表行：固定高度结构，摘要两行截断，避免参差。
struct PlaceRow: View {
    let place: Place

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(place.name)
                    .font(MapTheme.body(16, weight: .semibold))
                    .foregroundStyle(MapTheme.ink)
                    .lineLimit(1)
                Text(place.address.isEmpty ? "地址待补充" : place.address)
                    .font(MapTheme.body(13))
                    .foregroundStyle(MapTheme.inkMuted)
                    .lineLimit(1)
                if !place.reason.isEmpty {
                    Text(place.reason)
                        .font(MapTheme.body(13))
                        .foregroundStyle(MapTheme.ink.opacity(0.72))
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            CategoryChip(category: place.categoryValue, compact: true)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

/// 空状态与错误提示，保持纸面语言。
struct EmptyStateView: View {
    let icon: String
    let title: String
    var hint: String = ""

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(MapTheme.inkMuted)
            Text(title)
                .font(MapTheme.body(15, weight: .semibold))
                .foregroundStyle(MapTheme.ink)
            if !hint.isEmpty {
                Text(hint)
                    .font(MapTheme.body(13))
                    .foregroundStyle(MapTheme.inkMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
    }
}

struct ErrorBanner: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(MapTheme.danger)
            Text(text)
                .font(MapTheme.body(13))
                .foregroundStyle(MapTheme.ink)
                .lineLimit(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MapTheme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// 分类筛选条：横向滚动胶囊，导航元素字号固定。
struct CategoryFilterBar: View {
    @Binding var selection: String

    private let options: [(value: String, label: String, icon: String)] =
        [("all", "全部", "square.grid.2x2")] + PlaceCategory.allCases.map { ($0.rawValue, $0.label, $0.icon) }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.value) { option in
                    Button {
                        guard selection != option.value else { return }
                        Haptics.tap()
                        withAnimation(MapMotion.smooth) { selection = option.value }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: option.icon)
                                .font(.system(size: 11, weight: .semibold))
                            Text(option.label)
                                .font(MapTheme.fixed(13, weight: .medium))
                        }
                        .foregroundStyle(selection == option.value ? MapTheme.ink : MapTheme.inkMuted)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background {
                            if selection == option.value {
                                Capsule().fill(MapTheme.accent)
                            } else {
                                Capsule().fill(MapTheme.surfaceSubtle)
                            }
                        }
                        .overlay(Capsule().strokeBorder(MapTheme.line, lineWidth: 0.75))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }
}
