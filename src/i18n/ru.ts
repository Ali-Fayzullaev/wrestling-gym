// STUB(D-01): название зала временное, до решения заказчика.
// STUB(D-04): интерфейс только на русском; казахский добавится файлом kk.ts.
export const ru = {
  app: {
    name: "Зал вольной борьбы",
    description: "Учёт абонементов, оплат и напоминаний",
  },
  auth: {
    email: "Email",
    password: "Пароль",
    login: {
      title: "Вход",
      subtitle: "Только для сотрудников зала",
      submit: "Войти",
      pending: "Входим…",
      forgot: "Забыли пароль?",
      invalidCredentials: "Неверный email или пароль.",
      accessDisabled: "Доступ к системе отключён. Обратитесь к владельцу зала.",
    },
    reset: {
      title: "Сброс пароля",
      subtitle: "Пришлём на email ссылку для нового пароля.",
      submit: "Отправить ссылку",
      pending: "Отправляем…",
      sent: "Если этот email есть в системе, письмо со ссылкой уже отправлено. Ссылка действует один час.",
      invalidEmail: "Введите email в формате name@example.kz.",
      linkInvalid: "Ссылка недействительна или устарела. Запросите новую.",
      backToLogin: "Вернуться ко входу",
    },
    update: {
      title: "Новый пароль",
      subtitle: "Не короче 8 символов.",
      password: "Новый пароль",
      confirm: "Повторите пароль",
      submit: "Сохранить пароль",
      pending: "Сохраняем…",
      tooShort: "Пароль должен быть не короче 8 символов и не длиннее 72.",
      mismatch: "Пароли не совпадают.",
      samePassword: "Новый пароль должен отличаться от старого.",
      weakPassword: "Пароль слишком простой. Выберите другой.",
    },
    logout: "Выйти",
    tooManyAttempts: (minutes: number) =>
      `Слишком много попыток, попробуйте через ${minutes} ${minutesWord(minutes)}.`,
    unavailable: "Не удалось выполнить запрос. Попробуйте ещё раз.",
  },
  common: {
    close: "Закрыть",
    cancel: "Отмена",
    retry: "Повторить",
    loading: "Загружаем…",
  },
  nav: {
    label: "Основное меню",
    skipToContent: "К содержимому",
    today: "Сегодня",
    clients: "Клиенты",
    groups: "Группы",
    reminders: "Напоминания",
    more: "Ещё",
    reports: "Отчёты",
    audit: "Журнал",
    staff: "Сотрудники",
    reminderSettings: "Настройки напоминаний",
  },
  theme: {
    label: "Тема",
    light: "Светлая",
    dark: "Тёмная",
    system: "Как в системе",
  },
  status: {
    active: "Активен",
    expiring: "Скоро закончится",
    expired: "Долг",
    none: "Нет абонемента",
  },
  errors: {
    pageTitle: "Не удалось открыть раздел",
    pageText: "Проверьте интернет и попробуйте ещё раз.",
  },
  roles: {
    owner: "Владелец",
    admin: "Администратор",
  },
  pages: {
    today: "Сегодня",
    clients: "Клиенты",
    groups: "Группы",
    reminders: "Напоминания",
    reminderSettings: "Настройки напоминаний",
    more: "Ещё",
    reports: "Отчёты",
    audit: "Журнал действий",
    staff: "Сотрудники",
    clientImport: "Импорт клиентов",
    placeholder: "Раздел появится в следующих шагах.",
    ownerSections: "Разделы владельца",
    workSections: "Разделы",
    account: "Учётная запись",
  },
  forbidden: {
    title: "Нет доступа",
    text: "Этот раздел доступен только владельцу зала.",
    back: "На главную",
  },
} as const;

function minutesWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "минут";
  if (last === 1) return "минуту";
  if (last >= 2 && last <= 4) return "минуты";
  return "минут";
}
