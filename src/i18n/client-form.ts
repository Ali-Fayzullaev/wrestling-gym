// Texts of the client form and the errors client actions report. Apart from the other client
// texts because the form is a first-load client island: it ships only what it shows.
// STUB(D-04): Russian only; Kazakh will be a sibling file.
export const clientFormText = {
  createTitle: "Новый клиент",
  editTitle: "Изменить данные клиента",
  lastName: "Фамилия",
  firstName: "Имя",
  birthDate: "Дата рождения",
  birthDateHint: "Необязательно.",
  phone: "Телефон",
  phoneHint: "Например, 8 701 123 45 67. Сохранится как +7 701 123 45 67.",
  phoneOwner: "Чей это телефон",
  phoneOwnerSelf: "Свой",
  phoneOwnerParent: "Родителя (для ребёнка)",
  parentName: "Имя родителя",
  parentNameHint: "Так обратимся в напоминании.",
  group: "Группа",
  noGroup: "Пока без группы",
  archivedGroup: (name: string) => `${name} (в архиве)`,
  startedOn: "Дата начала занятий",
  note: "Заметка",
  noteHint: "Видят все сотрудники. До 2000 символов.",
  consents: "Согласия",
  // STUB(D-10): consent texts are placeholders until a lawyer checks them.
  consentsHint:
    "Отметьте, если согласие получено сейчас. Дата и кто зафиксировал сохранятся. Текст согласия на проверке у юриста.",
  consentKinds: {
    data_processing: "Согласие на хранение и обработку персональных данных",
    messaging: "Согласие на сообщения в WhatsApp",
  },
  consentOnFile: (date: string) => `получено ${date}`,
  duplicates: "Этот номер уже есть в базе:",
  duplicatesHint:
    "Сохранить можно: у братьев и сестёр бывает один телефон родителя.",
  duplicateArchived: "в архиве",
  save: "Сохранить",
  saving: "Сохраняем…",
  cancel: "Отмена",
  created: "Клиент добавлен",
  saved: "Изменения сохранены",
  errors: {
    lastName: "Введите фамилию, до 100 символов.",
    firstName: "Введите имя, до 100 символов.",
    birthDate: "Проверьте дату рождения.",
    phone: "Номер должен начинаться с +7 7 или 8 7 и содержать 11 цифр.",
    phoneOwner: "Выберите, чей это телефон.",
    parentName: "Введите имя родителя.",
    groupId: "Выберите группу из списка.",
    startedOn: "Укажите дату начала занятий.",
    note: "Заметка слишком длинная: до 2000 символов.",
    consents: "Отметьте согласия из списка.",
  },
} as const;

export const clientErrorText = {
  forbidden: "Недостаточно прав для этого действия.",
  not_found: "Клиент не найден. Возможно, его уже удалили.",
  group_not_found:
    "Эта группа больше недоступна. Выберите другую или обновите страницу.",
  confirmation_mismatch: "Фамилия введена неверно.",
  invalid: "Проверьте введённые данные.",
  unavailable: "Не удалось сохранить. Попробуйте ещё раз.",
} as const;
