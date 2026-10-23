import Foundation
import Observation

/// 地点数据的单一真相源：列表、地图、详情都从这里取数。
/// 查询语义（关键词、分类、排序）与 lib/api-v2/locations.js 对齐。
@MainActor
@Observable
final class PlacesStore {
    var places: [Place] = []
    var searchText = ""
    var category = "all"
    var sort = "created"
    var isLoading = false
    var errorMessage: String?

    private(set) var total = 0

    /// 深链（rongmap://place?id=… / ?name=…）待跳转的记录，RootView 消费后清空。
    var pendingPlaceID: String?
    var pendingPlaceName: String?

    var filteredByQuery: [Place] { places }

    func place(id: String) -> Place? {
        places.first { $0.id == id }
    }

    /// 全量拉取（分页循环，保护性上限 1000 条）。
    /// 查询条件在进入异步前快照，避免请求途中改筛选导致结果串味。
    func load(session: SessionStore) async {
        let keyword = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedCategory = category
        let selectedSort = sort
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let collected: [Place] = try await session.withAuth { api in
                var all: [Place] = []
                var page = 1
                while all.count < 1000 {
                    let response = try await api.listPlaces(
                        q: keyword.isEmpty ? nil : keyword,
                        category: selectedCategory,
                        sort: selectedSort,
                        page: page,
                        pageSize: 200
                    )
                    all.append(contentsOf: response.items)
                    if all.count >= response.total || response.items.isEmpty { break }
                    page += 1
                }
                return all
            }
            // 条件已变化时丢弃这次结果，交给新请求。
            guard keyword == searchText.trimmingCharacters(in: .whitespacesAndNewlines),
                  selectedCategory == category,
                  selectedSort == sort else { return }
            places = collected
            total = collected.count
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func create(session: SessionStore, payload: [String: Any]) async -> Place? {
        do {
            let created: Place = try await session.withAuth { api in
                try await api.createPlace(payload)
            }
            places.insert(created, at: 0)
            total += 1
            return created
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    func softDelete(session: SessionStore, id: String) async -> Bool {
        do {
            try await session.withAuth { api in
                try await api.softDeletePlace(id: id)
            }
            places.removeAll { $0.id == id }
            total = max(0, total - 1)
            return true
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func update(session: SessionStore, id: String, patch: [String: Any]) async {
        do {
            let updated: Place = try await session.withAuth { api in
                try await api.updatePlace(id: id, patch: patch)
            }
            if let index = places.firstIndex(where: { $0.id == id }) {
                places[index] = updated
            }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// 数据还没到时保留待跳转条件，等列表加载完成后再消费；避免冷启动深链被丢弃。
    /// 名称深链在冷启动时还查不到 ID，因此保留关键词，加载完成后再匹配。
    func consumeDeepLink() -> Place? {
        let matched: Place?
        if let id = pendingPlaceID, let found = place(id: id) {
            matched = found
        } else if let name = pendingPlaceName, !name.isEmpty {
            matched = places.first { $0.name == name }
                ?? places.first { $0.name.localizedCaseInsensitiveContains(name) }
        } else {
            matched = nil
        }
        guard let matched else { return nil }
        pendingPlaceID = nil
        pendingPlaceName = nil
        return matched
    }
}
