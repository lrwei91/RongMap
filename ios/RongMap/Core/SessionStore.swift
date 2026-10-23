import Foundation
import Observation

/// 登录态管理：启动时用 Keychain 里的用户名静默重登；
/// 任何请求 401 都先补一次登录再重试，用户基本无感。
@MainActor
@Observable
final class SessionStore {
    enum Phase: Equatable {
        case loading
        case loggedOut
        case ready
    }

    private(set) var phase: Phase = .loading
    private(set) var session: Session?
    private(set) var isBusy = false
    var lastError: String?

    var displayName: String {
        guard let session else { return "" }
        return session.name.isEmpty ? session.username : session.name
    }

    var api: APIClient {
        var client = APIClient()
        client.accessToken = session?.accessToken
        return client
    }

    /// 冷启动：有缓存会话就先信它（首帧可直接渲染），后台校验失败再回登录页。
    func bootstrap() async {
        if let cached = CredentialStore.load() {
            session = cached
            phase = .ready
            do {
                let fresh = try await api.login(username: cached.username)
                apply(fresh)
            } catch {
                // 令牌已失效：回登录页，凭据保留（用户名还在，用户重新点一下即可）。
                session = nil
                phase = .loggedOut
            }
            return
        }
        phase = .loggedOut
    }

    func login(username: String) async {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            lastError = "请输入用户名"
            return
        }
        isBusy = true
        lastError = nil
        defer { isBusy = false }
        do {
            let fresh = try await APIClient().login(username: trimmed)
            apply(fresh)
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func logout() {
        CredentialStore.clear()
        session = nil
        phase = .loggedOut
        lastError = nil
    }

    /// 需要登录态的调用统一走这里：401 自动静默重登一次再重试。
    func withAuth<T: Sendable>(_ work: @Sendable (APIClient) async throws -> T) async throws -> T {
        do {
            return try await work(api)
        } catch let error as APIError where error.isUnauthorized {
            guard let username = session?.username else { throw error }
            let fresh = try await APIClient().login(username: username)
            apply(fresh)
            return try await work(api)
        }
    }

    private func apply(_ fresh: Session) {
        session = fresh
        CredentialStore.save(fresh)
        phase = .ready
        lastError = nil
    }
}
