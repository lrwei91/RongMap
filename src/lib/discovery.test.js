import { describe, it, expect } from 'vitest';
import { filterRestaurants, restaurantToLocation } from './discovery';
const items = [
  { sourceId: 'one', name: '瑞幸咖啡(福州店)', address: '福州', category: 'cafe_bar', averageCost: 20, rating: 4.9 },
  { sourceId: 'two', name: '榕城面馆', address: '鼓楼', category: 'food', averageCost: null },
  { sourceId: 'three', name: '家常菜', address: '台江', category: 'food', averageCost: 80 }
];
describe('discovery filters and collection', () => {
  it('treats unknown prices separately and only hides chains when requested', () => {
    expect(filterRestaurants(items)).toHaveLength(3);
    expect(filterRestaurants(items, { maximum: '30', includeUnknown: true })).toHaveLength(2);
    expect(filterRestaurants(items, { maximum: '30', includeUnknown: false })).toHaveLength(1);
    expect(filterRestaurants(items, { hideChains: true, category: 'food', keyword: '鼓楼' }).map((item) => item.sourceId)).toEqual(['two']);
  });
  it('saves POI identity for existing duplicate protection without treating a candidate score as a user review', () => {
    expect(restaurantToLocation(items[0])).toMatchObject({ sourceId: 'one', sourcePlatform: 'amap', reason: '', tags: [] });
    expect(restaurantToLocation(items[0])).not.toHaveProperty('rating');
  });
});
