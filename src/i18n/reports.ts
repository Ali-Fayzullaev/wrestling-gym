// Texts of the reports screen and the exported files (step 11). Kept out of `ru`, which ships on
// every screen.
// STUB(D-04): Russian only; Kazakh will be a sibling file.

export const reportsText = {
  months: [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ],
  monthNav: {
    label: "Месяц отчёта",
    previous: "Предыдущий месяц",
    next: "Следующий месяц",
  },
  total: {
    title: "Пришло за месяц",
    count: (count: number) => `${count} ${paymentsWord(count)}`,
    reversedTitle: "Отменено сторно",
    reversedHint:
      "Оплаты этого месяца, которые потом отменили. В сумму выше не входят.",
  },
  byMethod: {
    title: "По способам оплаты",
    methods: { cash: "Наличные", kaspi: "Kaspi", transfer: "Перевод" },
  },
  byGroup: {
    title: "По группам",
    hint: "Оплата считается в группе, где клиент сейчас.",
  },
  noGroup: "Без группы",
  emptyTitle: "В этом месяце оплат нет",
  emptyText: "Когда администратор отметит оплату, она появится здесь.",
  debtors: {
    title: "Должники на сегодня",
    hint: "Абонемент закончился, новой оплаты нет. Ожидается по цене группы.",
    expected: "Ожидается",
    count: (count: number) => `${count} ${peopleWord(count)}`,
    endedOn: "Закончился",
    noPrice: "Цена неизвестна",
    total: "всего ожидается",
    emptyTitle: "Должников нет",
    emptyText: "У всех клиентов абонемент действует или ещё не оформлен.",
  },
  export: {
    title: "Выгрузка в файл",
    hint: "Файлы открываются в Excel. В файле есть телефоны клиентов: не пересылайте его посторонним.",
    payments: "Оплаты за месяц",
    clients: "Все клиенты",
    xlsx: "Excel",
    csv: "CSV",
    download: (what: string, format: string) => `Скачать: ${what}, ${format}`,
  },
  file: {
    paymentsSheet: "Оплаты",
    clientsSheet: "Клиенты",
    paymentsHeader: [
      "Дата и время",
      "Вид",
      "Фамилия",
      "Имя",
      "Группа",
      "Сумма, тенге",
      "Способ",
      "Период с",
      "Период по",
      "Отменена сторно",
      "Причина",
      "Принял(а)",
    ],
    clientsHeader: [
      "Фамилия",
      "Имя",
      "Телефон",
      "Чей телефон",
      "Имя родителя",
      "Дата рождения",
      "Группа",
      "Начало занятий",
      "Статус",
      "Абонемент до",
      "В архиве",
      "Заметка",
    ],
    kinds: { payment: "Оплата", reversal: "Сторно" },
    phoneOwners: { self: "Свой", parent: "Родителя" },
    statuses: {
      active: "Активен",
      expiring: "Скоро закончится",
      expired: "Долг",
      none: "Нет абонемента",
    },
    yes: "Да",
    no: "Нет",
  },
  errors: {
    title: "Не удалось выгрузить файл",
    forbidden: "Выгрузка доступна только владельцу зала.",
    rate_limited: "Слишком много выгрузок за час. Попробуйте позже.",
    invalid: "Неверный запрос выгрузки.",
    unavailable: "Не удалось выгрузить файл. Попробуйте ещё раз.",
  },
} as const;

function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function paymentsWord(count: number): string {
  return plural(count, "оплата", "оплаты", "оплат");
}

function peopleWord(count: number): string {
  return plural(count, "человек", "человека", "человек");
}
