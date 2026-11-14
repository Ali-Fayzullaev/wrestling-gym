// Texts of the clients list. Apart from the other client texts because the list is a client
// island on a first-load route: it ships only what it shows.
// STUB(D-04): Russian only; Kazakh will be a sibling file.
export const clientsListText = {
  search: "Поиск",
  searchPlaceholder: "Фамилия, имя или телефон",
  clearSearch: "Очистить поиск",
  filters: "Фильтры",
  group: "Группа",
  allGroups: "Все группы",
  noActiveGroup: "Без активной группы",
  archivedGroup: "в архиве",
  noGroup: "Без группы",
  status: "Статус",
  allStatuses: "Все статусы",
  coach: "Тренер",
  allCoaches: "Все тренеры",
  archive: "Архив",
  archiveOff: "Текущие клиенты",
  archiveOn: "Только архив",
  sort: "Порядок",
  sortName: "По фамилии",
  sortEnds: "По дате окончания",
  reset: "Сбросить фильтры",
  found: (count: number) => `Найдено: ${count}`,
  endsOnPrefix: "до",
  noSubscription: "оплат не было",
  nothingFound: "Никого не нашли",
  nothingFoundHint: "Проверьте написание или сбросьте фильтры.",
  emptyTitle: "Клиентов пока нет",
  emptyText: "Добавьте первого клиента. Импорт списка из Excel появится позже.",
  truncated: (shown: number, total: number) =>
    `Показаны первые ${shown} из ${total}. Поиск и фильтры работают только по ним.`,
} as const;
