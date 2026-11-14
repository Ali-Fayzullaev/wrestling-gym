// Texts of reminders: the WhatsApp button, the Reminders screen and the owner's reminder settings
// (step 09). Kept out of `ru`, which ships on every screen.
// STUB(D-04): Russian only; Kazakh will be a sibling file.
// Never say a WhatsApp message was sent or delivered: the app only knows the chat was opened.

function daysWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

export const remindersText = {
  whatsapp: "WhatsApp",
  /** Followed by the time: "Чат открыт 14:32". */
  chatOpened: "Чат открыт",
  chatOpenedAt: (when: string) => `Чат открыт ${when}`,
  markSent: "Отметить отправленным",
  marking: "Отмечаем…",
  markedSent: (when: string, by: string) =>
    `Отмечено вручную как отправленное ${when}, ${by}`,
  openedBy: (by: string) => `Открыл(а): ${by}`,
  recordFailed: "Не удалось записать, что чат открыт.",
  markFailed: "Не удалось сохранить отметку. Попробуйте ещё раз.",
  retry: "Повторить",
  kinds: {
    first: (days: number) =>
      `Первое напоминание (за ${days} ${daysWord(days)})`,
    second: (days: number) => `Второе (за ${days} ${daysWord(days)})`,
    overdue: "В день окончания",
  },
  /** Short kind names for lists, where the days are not repeated. */
  kindShort: {
    before_7: "Первое напоминание",
    before_1: "Второе напоминание",
    overdue: "В день окончания",
  },
  screen: {
    title: "Напоминания",
    hint: "Отправляйте только с номера зала через WhatsApp Business.",
    tabsLabel: "Разделы напоминаний",
    tabs: { today: "Сегодня", overdue: "Просроченные", history: "История" },
    settingsLink: "Шаблоны и дни",
    dueTitle: "Напомнить сегодня",
    openedTitle: "Чаты, открытые сегодня",
    dueEmptyTitle: "Сегодня напоминать некому",
    dueEmptyText:
      "Здесь появятся клиенты, у которых абонемент скоро заканчивается или заканчивается сегодня.",
    openedEmpty: "Сегодня чатов ещё не открывали.",
    overdueEmptyTitle: "Должников нет",
    overdueEmptyText:
      "Здесь появятся клиенты, у которых абонемент закончился и не продлён.",
    endedOn: "Закончился",
    endsOn: "Окончание",
    noGroup: "Без группы",
    historyDate: "Дата",
    historyStaff: "Сотрудник",
    historyAllStaff: "Все сотрудники",
    historyShow: "Показать",
    historyEmptyTitle: "За этот день событий нет",
    historyEmptyText: "Выберите другую дату или другого сотрудника.",
    cut: (shown: number) =>
      `Показаны первые ${shown}. Уточните дату или сотрудника.`,
  },
  settings: {
    title: "Напоминания",
    description:
      "За сколько дней напоминать и что написать. Сообщение открывается в WhatsApp, сотрудник проверяет его и отправляет сам.",
    days: "Когда напоминать",
    firstDays: "Первое напоминание, за сколько дней до окончания",
    firstDaysHint: "По умолчанию за 7 дней. От 1 до 60.",
    secondDays: "Второе напоминание, за сколько дней до окончания",
    secondDaysHint:
      "По умолчанию за 1 день. Меньше, чем для первого. Оставьте пустым, если второе не нужно.",
    lastDayNote:
      "В день окончания абонемента напоминание есть всегда, его текст ниже.",
    templates: "Тексты сообщений",
    variablesTitle: "Что подставляется в текст",
    variables: {
      имя: "имя клиента, а у ребёнка имя родителя",
      дата_окончания: "дата окончания абонемента, например «15 ноября»",
      сумма: "цена группы, например «15 000»; без группы пусто",
      группа: "название группы",
      название_зала: "название зала",
    },
    preview: "Как увидит клиент",
    previewFor: (name: string) => `Пример для клиента ${name}`,
    previewNoClient:
      "Нет клиента с абонементом и группой, поэтому пример собран на вымышленных данных.",
    unknown: (tokens: string) =>
      `Неизвестная переменная ${tokens}: она останется в тексте как есть.`,
    bodyHint: "До 1000 символов.",
    unused: "Второе напоминание выключено, этот текст сейчас не используется.",
    save: "Сохранить",
    saving: "Сохраняем…",
    saved: "Сохранено",
    errors: {
      firstDays: "Введите целое число от 1 до 60.",
      secondDays:
        "Введите целое число от 1 до 60, меньше, чем для первого напоминания, или оставьте поле пустым.",
      body: "Текст не может быть пустым и длиннее 1000 символов.",
      forbidden: "Менять напоминания может только владелец.",
      unavailable:
        "Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.",
    },
  },
} as const;
