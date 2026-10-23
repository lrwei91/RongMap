import SwiftUI

/// 我的：账号信息、数据刷新与退出登录。
struct SettingsView: View {
    @Binding var path: NavigationPath
    @Environment(SessionStore.self) private var session
    @Environment(PlacesStore.self) private var store
    @State private var showLogoutConfirm = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    HStack(spacing: 14) {
                        MapMark(size: 46)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.displayName)
                                .font(MapTheme.body(17, weight: .semibold))
                                .foregroundStyle(MapTheme.ink)
                            Text("用户名：\(session.session?.username ?? "—")")
                                .font(MapTheme.body(13))
                                .foregroundStyle(MapTheme.inkMuted)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("数据") {
                    Button {
                        Task { await store.load(session: session) }
                    } label: {
                        Label {
                            Text("刷新地点数据")
                        } icon: {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    LabeledContent("已加载地点", value: "\(store.places.count) 个")
                }

                Section("关于") {
                    LabeledContent("服务", value: "map-sigma-swart.vercel.app")
                    LabeledContent("版本", value: appVersion)
                    LabeledContent("坐标系", value: "高德 GCJ-02（地图自动换算）")
                }

                Section {
                    Button(role: .destructive) {
                        showLogoutConfirm = true
                    } label: {
                        Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PaperBackground())
            .navigationTitle("我的")
            .confirmationDialog("退出登录？", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) {
                    session.logout()
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("退出后需重新输入用户名，本机缓存的地点列表会清空。")
            }
        }
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        let bundleID = Bundle.main.bundleIdentifier ?? "—"
        return "\(short)（\(build)）· \(bundleID)"
    }
}
