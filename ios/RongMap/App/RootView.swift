import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case map
    case places
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .map: return "地图"
        case .places: return "地点"
        case .settings: return "我的"
        }
    }

    var icon: String {
        switch self {
        case .map: return "map.fill"
        case .places: return "list.bullet.rectangle.fill"
        case .settings: return "person.crop.circle"
        }
    }
}

struct RootView: View {
    @State private var session = SessionStore()
    @State private var store = PlacesStore()
    @State private var location = LocationProvider()
    @State private var tab: AppTab = .map
    @State private var visitedTabs: Set<AppTab> = [.map]
    @State private var mapPath = NavigationPath()
    @State private var placesPath = NavigationPath()
    @State private var settingsPath = NavigationPath()

    private var showsTabBar: Bool {
        switch tab {
        case .map: return mapPath.isEmpty
        case .places: return placesPath.isEmpty
        case .settings: return settingsPath.isEmpty
        }
    }

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                launchScreen
            case .loggedOut:
                LoginView()
            case .ready:
                content
            }
        }
        .environment(session)
        .environment(store)
        .environment(location)
        .background(PaperBackground())
        .preferredColorScheme(.light)
        .tint(MapTheme.ink)
        .task {
            await session.bootstrap()
        }
        // 目标页首次可见时才构建，避免三个 NavigationStack 同时初始化。
        .onChange(of: tab) { _, next in
            visitedTabs.insert(next)
        }
        .onChange(of: session.phase) { _, phase in
            if phase == .ready {
                Task { await store.load(session: session) }
            }
        }
        .onOpenURL { url in
            handle(url: url)
        }
        // 冷启动时 URL 可能先于数据加载被处理，首次可用时补一次消费。
        .onChange(of: store.places.count) { _, _ in consumePendingNavigation() }
    }

    private var launchScreen: some View {
        VStack(spacing: 14) {
            MapMark(size: 56)
            Text("RongMap")
                .font(MapTheme.heading(22))
                .foregroundStyle(MapTheme.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var content: some View {
        ZStack {
            MapView(path: $mapPath)
                .opacity(tab == .map ? 1 : 0)
                .allowsHitTesting(tab == .map)
                .accessibilityHidden(tab != .map)
            if visitedTabs.contains(.places) {
                PlacesView(path: $placesPath)
                    .opacity(tab == .places ? 1 : 0)
                    .allowsHitTesting(tab == .places)
                    .accessibilityHidden(tab != .places)
            }
            if visitedTabs.contains(.settings) {
                SettingsView(path: $settingsPath)
                    .opacity(tab == .settings ? 1 : 0)
                    .allowsHitTesting(tab == .settings)
                    .accessibilityHidden(tab != .settings)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsTabBar {
                AppTabBar(selection: $tab)
                    .padding(.horizontal, 20)
                    .padding(.top, 5)
                    .padding(.bottom, 2)
            }
        }
    }

    private func handle(url: URL) {
        guard url.scheme == "rongmap" else { return }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        // rongmap://tab?name=places|settings|map 直接切换标签；
        // rongmap://locate 回到地图并发起一次定位。
        if url.host == "tab" {
            if let name = components?.queryItems?.first(where: { $0.name == "name" })?.value,
               let target = AppTab(rawValue: name) {
                tab = target
            }
            return
        }
        if url.host == "locate" {
            tab = .map
            location.request()
            return
        }
        let id = components?.queryItems?.first { $0.name == "id" }?.value
        let name = components?.queryItems?.first { $0.name == "name" }?.value
        if let id {
            store.pendingPlaceName = nil
            store.pendingPlaceID = id
        } else if let name {
            let keyword = name.trimmingCharacters(in: .whitespacesAndNewlines)
            // 冷启动时列表还没到，先记住关键词，加载完成后由 PlacesStore 再匹配。
            store.pendingPlaceName = keyword
            store.pendingPlaceID = store.places.first { $0.name == keyword }?.id
                ?? store.places.first { $0.name.localizedCaseInsensitiveContains(keyword) }?.id
        }
        consumePendingNavigation()
    }

    private func consumePendingNavigation() {
        guard let place = store.consumeDeepLink() else { return }
        tab = .places
        placesPath = NavigationPath()
        visitedTabs.insert(.places)
        placesPath.append(place)
    }
}

struct AppTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var selectionAnimation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    guard selection != tab else { return }
                    Haptics.tap()
                    withAnimation(MapMotion.smooth) { selection = tab }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 17, weight: selection == tab ? .semibold : .regular))
                        Text(tab.title)
                            .font(MapTheme.fixed(12, weight: selection == tab ? .semibold : .medium))
                    }
                    .foregroundStyle(selection == tab ? MapTheme.ink : MapTheme.inkMuted)
                    .padding(.vertical, 7)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background {
                        if selection == tab {
                            if reduceMotion {
                                Capsule().fill(MapTheme.accent)
                            } else {
                                Capsule().fill(MapTheme.accent)
                                    .matchedGeometryEffect(id: "tab-selection", in: selectionAnimation)
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(6)
        .modifier(GlassSurface())
        .frame(maxWidth: 430)
    }
}
