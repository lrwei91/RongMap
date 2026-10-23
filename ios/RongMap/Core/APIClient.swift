import Foundation

enum APIError: LocalizedError {
    case network(String)
    case http(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .network(let message): return message
        case .http(_, let message): return message
        }
    }

    var isUnauthorized: Bool {
        if case .http(let status, _) = self { return status == 401 }
        return false
    }
}

/// RongMap 生产 API 客户端。所有写操作带 Bearer 会话，
/// 错误统一转成 APIError，列表与分页语义见 lib/api-v2/locations.js。
struct APIClient {
    static let productionBaseURL = URL(string: "https://map-sigma-swart.vercel.app")!

    var baseURL: URL = APIClient.productionBaseURL
    var accessToken: String?

    // MARK: - 基础请求

    private func makeRequest(path: String, method: String = "GET", query: [URLQueryItem] = [], body: [String: Any]? = nil) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.network("服务地址无效")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.network("请求地址无效") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // 写操作按网页端习惯补 Origin，避免将来接入 CSRF 校验时被拒。
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let token = accessToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network("网络请求失败：\(error.localizedDescription)")
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network("响应异常")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.message ?? "请求失败（\(http.statusCode)）"
            throw APIError.http(status: http.statusCode, message: message)
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder.rongmap.decode(type, from: data)
        } catch {
            throw APIError.network("数据解析失败：\(error.localizedDescription)")
        }
    }

    // MARK: - 会话

    func login(username: String) async throws -> Session {
        let request = try makeRequest(path: "api/v2/session", method: "POST", body: ["username": username])
        return try await decode(Session.self, from: send(request))
    }

    // MARK: - 地点

    func listPlaces(q: String? = nil, category: String? = nil, sort: String? = nil, page: Int = 1, pageSize: Int = 200) async throws -> PageResponse<Place> {
        var query = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize))
        ]
        if let q, !q.isEmpty { query.append(URLQueryItem(name: "q", value: q)) }
        if let category, category != "all" { query.append(URLQueryItem(name: "category", value: category)) }
        if let sort, !sort.isEmpty { query.append(URLQueryItem(name: "sort", value: sort)) }
        let request = try makeRequest(path: "api/v2/locations", query: query)
        return try await decode(PageResponse<Place>.self, from: send(request))
    }

    func createPlace(_ payload: [String: Any]) async throws -> Place {
        let request = try makeRequest(path: "api/v2/locations", method: "POST", body: payload)
        return try await decode(Place.self, from: send(request))
    }

    func updatePlace(id: String, patch: [String: Any]) async throws -> Place {
        let request = try makeRequest(path: "api/v2/locations", method: "PUT", query: [URLQueryItem(name: "id", value: id)], body: patch)
        return try await decode(Place.self, from: send(request))
    }

    func softDeletePlace(id: String) async throws {
        let request = try makeRequest(path: "api/v2/locations", method: "DELETE", query: [URLQueryItem(name: "id", value: id)])
        _ = try await send(request)
    }
}

private struct ServerError: Decodable {
    let message: String
    enum CodingKeys: String, CodingKey { case message = "error", detail = "message" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        message = (try? c.decodeIfPresent(String.self, forKey: .message)) ?? (try? c.decodeIfPresent(String.self, forKey: .detail)) ?? ""
    }
}

extension JSONDecoder {
    static let rongmap: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = DateFormats.parse(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "无法解析时间：\(text)")
            }
            return date
        }
        return decoder
    }()
}
