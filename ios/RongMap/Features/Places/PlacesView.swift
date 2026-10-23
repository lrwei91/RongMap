import SwiftUI

/// 地点列表：关键词 + 分类 + 排序，语义与网页端列表一致。
struct PlacesView: View {
    @Binding var path: NavigationPath
    @Environment(SessionStore.self) private var session
    @Environment(PlacesStore.self) private var store
    @State private var showAdd = false
    @State private var searchDebounce: Task<Void, Never>?

    var body: some View {
        @Bindable var store = store
        return NavigationStack(path: $path) {
            VStack(spacing: 0) {
                CategoryFilterBar(selection: $store.category)
                listContent
            }
            .background(PaperBackground())
            .navigationTitle("地点")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAdd = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .accessibilityLabel("新增地点")
                }
                ToolbarItem(placement: .topBarLeading) {
                    sortMenu
                }
            }
            .searchable(
                text: $store.searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "搜索名称、地址、推荐理由"
            )
            .onChange(of: store.searchText) { _, _ in
                searchDebounce?.cancel()
                searchDebounce = Task {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    guard !Task.isCancelled else { return }
                    await store.load(session: session)
                }
            }
            .onChange(of: store.category) { _, _ in
                Task { await store.load(session: session) }
            }
            .onChange(of: store.sort) { _, _ in
                Task { await store.load(session: session) }
            }
            .navigationDestination(for: Place.self) { place in
                PlaceDetailView(place: place)
            }
            .sheet(isPresented: $showAdd) {
                AddPlaceView()
            }
        }
    }

    private var sortMenu: some View {
        @Bindable var store = store
        return Menu {
            Picker("排序", selection: $store.sort) {
                Text("最近添加").tag("created")
                Text("最近更新").tag("updated")
                Text("按名称").tag("name")
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 15, weight: .semibold))
        }
        .accessibilityLabel("排序方式")
    }

    @ViewBuilder
    private var listContent: some View {
        if store.isLoading && store.places.isEmpty {
            Spacer()
            ProgressView("加载中…")
            Spacer()
        } else if let error = store.errorMessage, store.places.isEmpty {
            Spacer()
            EmptyStateView(icon: "wifi.exclamationmark", title: "加载失败", hint: error)
            Spacer()
        } else if store.places.isEmpty {
            Spacer()
            EmptyStateView(icon: "mappin.slash", title: "还没有地点", hint: "点右上角 + 收藏第一个地点")
            Spacer()
        } else {
            List {
                if let error = store.errorMessage {
                    ErrorBanner(text: error)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                Section {
                    ForEach(store.places) { place in
                        Button {
                            Haptics.tap()
                            path.append(place)
                        } label: {
                            PlaceRow(place: place)
                        }
                        .buttonStyle(PressableStyle(scale: 0.99))
                    }
                } header: {
                    Text("\(store.places.count) 个地点")
                        .font(MapTheme.fixed(11, weight: .medium))
                        .foregroundStyle(MapTheme.inkMuted)
                }
            }
            .listStyle(.plain)
            .refreshable {
                await store.load(session: session)
            }
        }
    }
}
