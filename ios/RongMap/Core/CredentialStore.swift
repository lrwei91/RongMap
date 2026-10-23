import Foundation
import Security

/// 登录只需用户名（服务端以共享密码换 Supabase 会话）。
/// 用户名与会话令牌都落 Keychain：401 时能静默重登，不打扰用户。
/// 凭据只存在钥匙串，不进 UserDefaults、日志或明文文件。
struct StoredSession: Codable {
    let session: Session
}

enum CredentialStore {
    private static let service = "cn.lrwei91.rongmap.credentials"
    private static let account = "member"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    @discardableResult
    static func save(_ session: Session) -> Bool {
        guard let data = try? JSONEncoder().encode(StoredSession(session: session)) else { return false }
        var query = baseQuery
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        // 设备重启后首次解锁即可读取，满足冷启动静默续登。
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> Session? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let stored = try? JSONDecoder().decode(StoredSession.self, from: data),
              !stored.session.username.isEmpty else {
            return nil
        }
        return stored.session
    }

    static func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    static var hasStoredSession: Bool { load() != nil }
}
