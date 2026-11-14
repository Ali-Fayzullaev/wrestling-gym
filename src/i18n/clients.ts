// Texts of the client screens (step 06). Kept out of `ru`, which the menu ships on every screen,
// so only the client screens carry them.
// STUB(D-04): Russian only; Kazakh will be a sibling file.
import { clientErrorText, clientFormText } from "./client-form";
import { clientsListText } from "./clients-list";

export const clientsText = {
  create: "Новый клиент",
  edit: "Изменить",
  archive: "В архив",
  restore: "Вернуть из архива",
  delete: "Удалить",
  back: "Клиенты",
  list: clientsListText,
  card: {
    contacts: "Данные",
    phone: "Телефон",
    phoneOwnerSelf: "свой",
    phoneOwnerParent: "родителя",
    parentName: "Родитель",
    birthDate: "Дата рождения",
    startedOn: "Занимается с",
    group: "Группа",
    noGroup: "Не записан в группу",
    coach: "Тренер",
    groupArchived:
      "Группа в архиве: занятий в ней нет. Переведите клиента в действующую группу.",
    moveToGroup: "Выбрать группу",
    subscription: "Абонемент",
    period: "Период",
    endsOn: "Действует до",
    daysLeft: (days: number) =>
      days >= 0 ? `Осталось дней: ${days}` : `Просрочен на ${-days} дн.`,
    noPayments: "Оплат пока не было.",
    payments: "История оплат",
    paymentsEmpty: "Раздел в разработке",
    paymentsEmptyText: "Здесь будут оплаты и сторно клиента.",
    reminders: "Напоминания",
    remindersEmpty: "Раздел в разработке",
    remindersEmptyText: "Здесь будут открытые чаты WhatsApp с напоминаниями.",
    consents: "Согласия",
    consentGiven: (date: string, by: string) =>
      `${date}, зафиксировал(а) ${by}`,
    consentMissing: "Не получено",
    note: "Заметка",
    noNote: "Заметки нет.",
    archivedNotice: "Клиент в архиве и не показывается в списке по умолчанию.",
  },
  form: clientFormText,
  archiveDialog: {
    title: "Отправить клиента в архив?",
    text: "Клиент пропадёт из списка, напоминаний и счётчиков. Оплаты и данные сохранятся, вернуть можно в любой момент.",
    confirm: "В архив",
    done: "Клиент в архиве",
  },
  restoreDialog: {
    title: "Вернуть клиента из архива?",
    text: "Клиент снова появится в списке, напоминаниях и счётчиках.",
    confirm: "Вернуть",
    done: "Клиент возвращён из архива",
  },
  deleteDialog: {
    title: "Удалить клиента полностью?",
    text: "Это нельзя отменить. Если у клиента есть оплаты или согласия, они останутся, а имя, телефон и другие данные будут стёрты.",
    reason: "Причина",
    reasonPlaceholder: "Выберите причину",
    reasons: {
      duplicate: "Дубль: клиент записан дважды",
      created_by_mistake: "Создан по ошибке",
      client_request: "Клиент попросил удалить данные",
      other: "Другая причина",
    },
    confirmLabel: (lastName: string) =>
      `Для подтверждения введите фамилию: ${lastName}`,
    confirm: "Удалить навсегда",
    deleting: "Удаляем…",
    deleted: "Клиент удалён",
    anonymized: "Данные клиента стёрты, оплаты сохранены",
  },
  errors: clientErrorText,
} as const;
