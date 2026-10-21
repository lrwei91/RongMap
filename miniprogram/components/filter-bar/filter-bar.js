const { CATEGORIES } = require('../../utils/constants');
const { SOURCE_LABELS } = require('../../utils/constants');

const GEODEDED_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'yes', label: '已定位' },
  { value: 'no', label: '未定位' }
];

const SORT_OPTIONS = [
  { value: 'created', label: '最近添加' },
  { value: 'updated', label: '最近修改' },
  { value: 'name', label: '按名称' }
];

function indexOfValue(options, value) {
  for (let index = 0; index < options.length; index += 1) {
    if (options[index].value === value) return index;
  }
  return 0;
}

Component({
  properties: {
    filters: { type: Object, value: {} },
    members: { type: Array, value: [] },
    tags: { type: Array, value: [] }
  },

  data: {
    expanded: false,
    activeCount: 0,
    categoryOptions: [],
    sortOptions: SORT_OPTIONS,
    geocodedOptions: GEODEDED_OPTIONS,
    memberOptions: [],
    sourceOptions: [],
    tagOptions: [],
    categoryIndex: 0,
    sortIndex: 0,
    geocodedIndex: 0,
    memberIndex: 0,
    sourceIndex: 0,
    tagIndex: 0,
    categoryLabels: [],
    sortLabels: [],
    geocodedLabels: [],
    memberLabels: [],
    sourceLabels: [],
    tagLabels: []
  },

  observers: {
    'filters, members, tags': function (filters, members, tags) {
      const active = ['category', 'geocoded', 'member', 'source', 'tag'].filter(function (key) {
        return filters[key] !== 'all';
      }).length;

      const categoryOptions = [{ value: 'all', label: '全部分类' }].concat(
        Object.keys(CATEGORIES).map(function (key) {
          return { value: key, label: CATEGORIES[key].label };
        })
      );
      const memberOptions = [{ value: 'all', label: '全部' }].concat(
        (members || []).map(function (item) { return { value: item.id, label: item.name }; })
      );
      const sourceOptions = [{ value: 'all', label: '全部' }].concat(
        Object.keys(SOURCE_LABELS).map(function (key) {
          return { value: key, label: SOURCE_LABELS[key] };
        })
      );
      const tagOptions = [{ value: 'all', label: '全部' }].concat(
        (tags || []).map(function (item) { return { value: item.id, label: item.name }; })
      );

      this.setData({
        activeCount: active,
        categoryOptions: categoryOptions,
        memberOptions: memberOptions,
        sourceOptions: sourceOptions,
        tagOptions: tagOptions,
        categoryIndex: indexOfValue(categoryOptions, filters.category),
        sortIndex: indexOfValue(SORT_OPTIONS, filters.sort),
        geocodedIndex: indexOfValue(GEODEDED_OPTIONS, filters.geocoded),
        memberIndex: indexOfValue(memberOptions, filters.member),
        sourceIndex: indexOfValue(sourceOptions, filters.source),
        tagIndex: indexOfValue(tagOptions, filters.tag),
        categoryLabels: categoryOptions.map(function (item) { return item.label; }),
        sortLabels: SORT_OPTIONS.map(function (item) { return item.label; }),
        geocodedLabels: GEODEDED_OPTIONS.map(function (item) { return item.label; }),
        memberLabels: memberOptions.map(function (item) { return item.label; }),
        sourceLabels: sourceOptions.map(function (item) { return item.label; }),
        tagLabels: tagOptions.map(function (item) { return item.label; })
      });
    }
  },

  methods: {
    emit(patch) {
      this.triggerEvent('change', { filters: Object.assign({}, this.data.filters, patch) });
    },

    onCategory(event) {
      this.emit({ category: this.data.categoryOptions[Number(event.detail.value)].value });
    },

    onSort(event) {
      this.emit({ sort: SORT_OPTIONS[Number(event.detail.value)].value });
    },

    onGeocoded(event) {
      this.emit({ geocoded: GEODEDED_OPTIONS[Number(event.detail.value)].value });
    },

    onMember(event) {
      this.emit({ member: this.data.memberOptions[Number(event.detail.value)].value });
    },

    onSource(event) {
      this.emit({ source: this.data.sourceOptions[Number(event.detail.value)].value });
    },

    onTag(event) {
      this.emit({ tag: this.data.tagOptions[Number(event.detail.value)].value });
    },

    toggleExpanded() {
      this.setData({ expanded: !this.data.expanded });
    },

    clear() {
      this.triggerEvent('change', {
        filters: {
          keyword: this.data.filters.keyword,
          sort: this.data.filters.sort,
          category: 'all',
          geocoded: 'all',
          member: 'all',
          source: 'all',
          tag: 'all'
        }
      });
    }
  }
});
