import Foundation
import CoreLocation

// MARK: - 分类（与 lib/location-category.js 保持一致）

enum PlaceCategory: String, CaseIterable, Identifiable, Codable {
    case food
    case spot
    case cafe_bar

    var id: String { rawValue }

    var label: String {
        switch self {
        case .food: return "餐饮美食"
        case .spot: return "景点休闲"
        case .cafe_bar: return "日咖夜酒"
        }
    }

    var icon: String {
        switch self {
        case .food: return "fork.knife"
        case .spot: return "binoculars.fill"
        case .cafe_bar: return "cup.and.saucer.fill"
        }
    }
}

// MARK: - 地点记录（服务端 camelCase；坐标为高德 GCJ-02）

struct PlaceTag: Codable, Hashable, Identifiable {
    var id: String?
    var name: String
}

struct Place: Identifiable, Hashable {
    var id: String
    var name: String
    var address: String
    var reason: String
    var category: String
    var latitude: Double?
    var longitude: Double?
    var tags: [PlaceTag]
    var city: String?
    var district: String?
    var sourceType: String?
    var sourcePlatform: String?
    var createdBy: String?
    var createdByName: String?
    var createdAt: Date?
    var updatedAt: Date?
    var deletedAt: Date?

    var categoryValue: PlaceCategory? { PlaceCategory(rawValue: category) }
    var hasCoordinates: Bool { latitude != nil && longitude != nil }

    /// 服务端坐标是 GCJ-02（高德），MapKit 与 Apple 地图导航要 WGS-84。
    var wgsCoordinate: CLLocationCoordinate2D? {
        guard let lat = latitude, let lng = longitude else { return nil }
        let wgs = CoordinateTransform.gcj2wgs(lat: lat, lng: lng)
        return CLLocationCoordinate2D(latitude: wgs.lat, longitude: wgs.lng)
    }
}

extension Place: Decodable {
    enum CodingKeys: String, CodingKey {
        case id, name, address, reason, category, latitude, longitude, tags
        case city, district, sourceType, sourcePlatform
        case createdBy, createdByName, createdAt, updatedAt, deletedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeString(.id) ?? ""
        name = try c.decodeString(.name) ?? ""
        address = try c.decodeString(.address) ?? ""
        reason = try c.decodeString(.reason) ?? ""
        category = try c.decodeString(.category) ?? ""
        latitude = c.flexDouble(.latitude)
        longitude = c.flexDouble(.longitude)
        tags = (try? c.decodeIfPresent([PlaceTag].self, forKey: .tags)) ?? []
        city = try c.decodeString(.city)
        district = try c.decodeString(.district)
        sourceType = try c.decodeString(.sourceType)
        sourcePlatform = try c.decodeString(.sourcePlatform)
        createdBy = try c.decodeString(.createdBy)
        createdByName = try c.decodeString(.createdByName)
        createdAt = c.flexDate(.createdAt)
        updatedAt = c.flexDate(.updatedAt)
        deletedAt = c.flexDate(.deletedAt)
    }
}

// MARK: - 会话（session 接口混用 snake_case 与 camelCase）

struct Session: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date?
    var username: String
    var name: String
    var spaceId: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case username, name, spaceId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accessToken = try c.decodeString(.accessToken) ?? ""
        refreshToken = try c.decodeString(.refreshToken) ?? ""
        expiresAt = c.flexDate(.expiresAt)
        username = try c.decodeString(.username) ?? ""
        name = (try c.decodeString(.name)).flatMap { $0.isEmpty ? nil : $0 } ?? username
        spaceId = (try c.decodeString(.spaceId)) ?? ""
    }

    init(accessToken: String, refreshToken: String, expiresAt: Date?, username: String, name: String, spaceId: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.username = username
        self.name = name
        self.spaceId = spaceId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(accessToken, forKey: .accessToken)
        try c.encode(refreshToken, forKey: .refreshToken)
        try c.encode(expiresAt, forKey: .expiresAt)
        try c.encode(username, forKey: .username)
        try c.encode(name, forKey: .name)
        try c.encode(spaceId, forKey: .spaceId)
    }
}

// MARK: - 分页

struct PageResponse<Item: Decodable>: Decodable {
    let items: [Item]
    let page: Int
    let pageSize: Int
    let total: Int
}

// MARK: - 宽容解码助手（服务端数字可能以字符串落库）

extension KeyedDecodingContainer {
    func decodeString(_ key: Key) throws -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let n = try? decodeIfPresent(Double.self, forKey: key) {
            return n == n.rounded() ? String(Int(n)) : String(n)
        }
        return nil
    }

    func flexDouble(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    func flexDate(_ key: Key) -> Date? {
        guard let s = try? decodeIfPresent(String.self, forKey: key), !s.isEmpty else { return nil }
        return DateFormats.parse(s)
    }
}

enum DateFormats {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let display: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ text: String) -> Date? {
        fractional.date(from: text) ?? plain.date(from: text)
    }

    static func day(_ date: Date?) -> String {
        guard let date else { return "" }
        return display.string(from: date)
    }
}
