import { importUploadText } from "./import-upload";

// Texts of the import screen (step 10). Kept out of `ru`, which the menu ships on every screen;
// the first view needs only ./import-upload.ts.
// STUB(D-04): Russian only; Kazakh will be a sibling file.

const rowsWord = (count: number) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "строк";
  if (last === 1) return "строка";
  if (last >= 2 && last <= 4) return "строки";
  return "строк";
};

export const importText = {
  ...importUploadText,
  columns: {
    title: "Столбцы",
    hint: "Проверьте, из какого столбца берётся каждое поле.",
    missing: "Не нашли некоторые столбцы. Выберите их вручную.",
    fields: {
      lastName: "Фамилия",
      firstName: "Имя",
      phone: "Телефон",
      group: "Группа",
      endsOn: "Дата окончания абонемента",
    },
    none: "Нет в файле",
    column: (index: number, header: string) =>
      header === ""
        ? `Столбец ${index + 1}`
        : `Столбец ${index + 1}: ${header}`,
    required: "обязательно",
  },
  summary: {
    title: "Что получится",
    new: "Новые",
    duplicate: "Уже есть",
    error: "С ошибками",
    importedBefore: (date: string) =>
      `Этот файл уже импортировали ${date}. Повторный импорт не создаст дублей: такие клиенты будут пропущены.`,
  },
  filter: {
    label: "Показать строки",
    all: "Все",
    new: "Новые",
    duplicate: "Уже есть",
    error: "Ошибки",
    empty: "Таких строк нет.",
  },
  row: {
    line: (line: number) => `Строка ${line}`,
    status: {
      new: "Новый",
      duplicate: "Уже есть",
      error: "Ошибка",
    },
    repeatOf: (line: number) => `Повтор строки ${line}`,
    onFile: "Такой клиент уже есть в системе",
    noDate: "Без даты окончания",
    endsOn: (date: string) => `Абонемент до ${date}`,
    noGroup: "Без группы",
    groupMissing: (name: string) =>
      `Группа «${name}» не найдена — будет создана?`,
    errors: {
      last_name_missing: "Нет фамилии",
      first_name_missing: "Нет имени",
      name_too_long: "Фамилия или имя длиннее 100 символов",
      phone_missing: "Нет телефона",
      phone_invalid: "Неверный телефон: нужен номер +7 7XX XXX XX XX",
      date_invalid: "Неверная дата: нужен формат 18.11.2025",
    },
  },
  groups: {
    title: "Новые группы",
    hint: "Этих групп нет в системе. Решите, что с ними сделать.",
    choice: (name: string) => `Группа «${name}»`,
    create: "Создать группу",
    none: "Записать без группы",
    existing: (name: string) => `В группу «${name}»`,
    coach: "Тренер",
    coachPlaceholder: "Выберите тренера",
    price: "Цена в месяц, ₸",
    priceHint: "Расписание и лимит мест можно добавить потом в «Группах».",
  },
  submit: (count: number) => `Импортировать клиентов: ${count}`,
  submitting: "Импортируем…",
  nothingToImport: "Новых клиентов в файле нет.",
  unresolved: "Выберите, что делать с каждой новой группой.",
  report: {
    title: "Импорт завершён",
    created: (count: number) => `Добавлено клиентов: ${count}`,
    duplicates: (count: number) => `Пропущено как уже существующие: ${count}`,
    groups: (count: number) => `Создано групп: ${count}`,
    skipped: (count: number) =>
      `Не импортированы из-за ошибок: ${count} ${rowsWord(count)}. Скачайте их, исправьте и загрузите снова.`,
    download: "Скачать строки с ошибками",
    toClients: "К списку клиентов",
    again: "Импортировать ещё файл",
    note: "Статус абонемента считается по дате окончания из файла. В истории оплат будет запись «Перенос из тетради» без суммы.",
    errorColumn: "Ошибка",
  },
  template: {
    fileName: "shablon-import-klientov.csv",
    headers: ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"],
    example: [
      "Иванов",
      "Алихан",
      "+7 701 000 00 00",
      "Дети 7-9 лет",
      "18.11.2025",
    ],
  },
  skippedFileName: "oshibki-importa.csv",
} as const;
