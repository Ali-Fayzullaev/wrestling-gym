// Texts of the Today screen (step 08). Kept out of `ru`, which ships on every screen.
// STUB(D-04): Russian only; Kazakh will be a sibling file.

export const todayText = {
  counters: {
    label: "Счётчики на сегодня",
    remindToday: "Напомнить сегодня",
    debtors: "Должники",
    expiringWeek: "Заканчивается на неделе",
    paidToday: "Оплатили сегодня",
  },
  lists: {
    label: "Списки на сегодня",
    remind: "Напомнить сегодня",
    paid: "Оплатили сегодня",
  },
  noGroup: "Без группы",
  endsOn: "Окончание",
  remindEmptyTitle: "Сегодня напоминать некому",
  remindEmptyText:
    "Здесь появятся клиенты, у которых абонемент скоро заканчивается или заканчивается сегодня.",
  paidEmptyTitle: "Сегодня оплат пока нет",
  paidEmptyText: "После отметки «Оплатил» клиент появится в этом списке.",
} as const;
