import SwiftUI

/// 登录只需用户名：与网页端同一套账号，服务端以共享密码换会话。
struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @State private var username = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 18) {
                MapMark(size: 72)
                VStack(spacing: 6) {
                    Text("RongMap")
                        .font(MapTheme.heading(28))
                        .foregroundStyle(MapTheme.ink)
                    Text("亲友共享的地点地图")
                        .font(MapTheme.body(14))
                        .foregroundStyle(MapTheme.inkMuted)
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 12) {
                TextField("用户名", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .font(MapTheme.body(16))
                    .padding(14)
                    .background(MapTheme.surfaceSubtle, in: RoundedRectangle(cornerRadius: MapTheme.controlRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: MapTheme.controlRadius)
                            .strokeBorder(focused ? MapTheme.ink : MapTheme.line, lineWidth: 1)
                    )
                    .onSubmit { Task { await submit() } }

                if let error = session.lastError {
                    ErrorBanner(text: error)
                }

                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: 8) {
                        if session.isBusy {
                            ProgressView().tint(MapTheme.ink)
                        } else {
                            Text("进入地图")
                                .font(MapTheme.body(16, weight: .semibold))
                        }
                    }
                    .foregroundStyle(MapTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(MapTheme.accent, in: RoundedRectangle(cornerRadius: MapTheme.controlRadius))
                }
                .buttonStyle(PressableStyle())
                .disabled(session.isBusy || username.trimmingCharacters(in: .whitespaces).isEmpty)

                Text("与网页端相同的用户名，无需密码")
                    .font(MapTheme.body(12))
                    .foregroundStyle(MapTheme.inkMuted)
            }
            .padding(.horizontal, 28)
            Spacer(minLength: 60)
        }
        .onAppear { focused = true }
    }

    private func submit() async {
        focused = false
        await session.login(username: username)
    }
}
