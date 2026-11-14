// Texts of the import screen's first view: the file picker and the errors (step 10). The preview,
// group decisions and report load with their own texts (./import.ts) once a file is chosen.
// STUB(D-04): Russian only; Kazakh will be a sibling file.

export const importUploadText = {
  title: "Импорт из тетради",
  description:
    "Перенесите клиентов из Excel или CSV. Сначала покажем, что получится, и только потом сохраним.",
  open: "Импорт",
  file: {
    label: "Файл .xlsx или .csv",
    hint: "До 2 МБ. Первая строка: заголовки столбцов. Нужны фамилия, имя и телефон; группа и дата окончания абонемента по желанию.",
    template: "Скачать шаблон",
    choose: "Выбрать файл",
    another: "Другой файл",
    reading: "Читаем файл…",
  },
  errors: {
    empty: "Файл пустой.",
    too_large: "Файл больше 2 МБ. Разделите его на части.",
    old_excel:
      "Это старый формат Excel (.xls). Откройте файл в Excel и сохраните как .xlsx или CSV.",
    unsupported: "Подходят только файлы .xlsx и .csv.",
    unreadable:
      "Не удалось прочитать файл. Сохраните его в Excel заново и попробуйте ещё раз.",
    no_rows: "В файле нет строк с клиентами под заголовками.",
    too_many_rows: "В файле больше 2000 строк. Разделите его на части.",
    forbidden: "Импорт доступен только владельцу зала.",
    invalid: "Проверьте выбор столбцов и новых групп.",
    mapping_incomplete: "Выберите столбцы для фамилии, имени и телефона.",
    groups_unresolved: "Выберите, что делать с каждой новой группой.",
    group_not_found:
      "Одна из выбранных групп больше не существует. Обновите страницу.",
    coach_not_found:
      "Выбранный тренер больше не работает в зале. Выберите другого.",
    rate_limited: "Слишком много импортов за час. Попробуйте позже.",
    unavailable: "Не удалось выполнить импорт. Попробуйте ещё раз.",
    network: "Нет связи с сервером. Ничего не сохранено, попробуйте ещё раз.",
  },
} as const;
