// Texts of the payment dialog, the payment history and its actions (step 07). Kept out of `ru`,
// which ships on every screen; the dialogs load lazily and bring these with them.
// STUB(D-04): Russian only; Kazakh will be a sibling file.

export const paymentsText = {
  pay: "Оплатил",
  dialog: {
    title: "Отметить оплату",
    amount: "Сумма, ₸",
    // STUB(D-02): monthly subscription only, the amount is edited by hand for anything else.
    amountHint: (price: string) => `Цена группы: ${price}. Можно изменить.`,
    amountNoPrice: "У клиента нет группы: введите сумму.",
    amountError: "Введите сумму целым числом больше нуля.",
    method: "Способ оплаты",
    methods: { cash: "Наличные", kaspi: "Kaspi", transfer: "Перевод" },
    period: "Период",
    periodMonth: "1 месяц",
    preview: (from: string, to: string) => `Абонемент с ${from} до ${to}`,
    confirm: "Подтвердить",
    saving: "Сохраняем…",
  },
  saved: (until: string) => `Оплата сохранена. Абонемент до ${until}`,
  undo: "Отменить",
  cancelled: "Оплата отменена",
  network: "Нет связи с сервером. Оплата не сохранена, попробуйте ещё раз.",
  history: {
    emptyTitle: "Оплат пока нет",
    emptyText:
      "После первой оплаты здесь появятся дата, сумма, способ и период.",
    paidAt: (date: string, time: string) => `${date}, ${time}`,
    period: (from: string, to: string) => `${from} – ${to}`,
    by: (name: string) => `Внёс(ла): ${name}`,
    reversed: (date: string, name: string) => `Сторно ${date}, ${name}`,
    reason: (reason: string) => `Причина: ${reason}`,
    reversedBadge: "Сторно",
    importBalance: "Перенос из тетради",
    importBalanceNote: "Без оплаты в системе",
  },
  cancel: "Отменить",
  reverse: "Сторно",
  cancelDialog: {
    title: "Отменить оплату?",
    text: "Отменить можно в течение 10 минут после отметки. Оплата останется в истории с пометкой «Отменено сразу», абонемент пересчитается.",
    confirm: "Отменить оплату",
    keep: "Не отменять",
    done: "Оплата отменена",
  },
  reverseDialog: {
    title: "Сделать сторно оплаты?",
    text: "Оплата останется в истории, рядом появится сторно с причиной. Абонемент пересчитается. Отменить сторно нельзя.",
    reason: "Причина сторно",
    reasonPlaceholder: "Например: оплата отмечена не тому клиенту",
    reasonError: "Напишите причину.",
    confirm: "Сделать сторно",
    done: "Сторно сохранено",
  },
  errors: {
    forbidden: "Недостаточно прав для этого действия.",
    client_not_found: "Клиент не найден. Возможно, его данные уже удалены.",
    payment_not_found: "Оплата не найдена. Обновите страницу.",
    already_reversed: "Эта оплата уже отменена.",
    cancel_window_passed:
      "Прошло больше 10 минут: отменить нельзя. Сторно делает владелец.",
    idempotency_conflict:
      "Эта форма уже использована. Закройте её и откройте заново.",
    invalid: "Проверьте введённые данные.",
    unavailable: "Не удалось сохранить. Попробуйте ещё раз.",
  },
} as const;
