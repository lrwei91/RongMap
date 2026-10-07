// Common chains are an optional display filter, never a quality judgement.
const COMMON_CHAINS = /^(?:肯德基|麦当劳|汉堡王|必胜客|海底捞|星巴克|瑞幸咖啡|蜜雪冰城|古茗|茶百道|喜茶|霸王茶姬|塔斯汀)(?:\s|[（(]|$)/;

export function filterRestaurants(items, { category = 'all', maximum = '', includeUnknown = true, hideChains = false, keyword = '' } = {}) {
  const limit = maximum === '' ? null : Number(maximum);
  const term = keyword.trim().toLocaleLowerCase('zh-CN');
  return items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (term && !`${item.name} ${item.address} ${item.poiType}`.toLocaleLowerCase('zh-CN').includes(term)) return false;
    if (hideChains && COMMON_CHAINS.test(item.name)) return false;
    if (limit !== null && (item.averageCost === null ? !includeUnknown : item.averageCost > limit)) return false;
    return true;
  });
}

export function restaurantToLocation(item) {
  return {
    name: item.name, address: item.address, category: item.category, latitude: item.latitude, longitude: item.longitude,
    sourceId: item.sourceId, sourceType: 'manual', sourcePlatform: 'amap', matchType: 'manual_search',
    poiType: item.poiType, city: item.city, district: item.district, tags: [], reason: ''
  };
}
