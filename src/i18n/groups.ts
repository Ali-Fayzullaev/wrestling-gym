// Texts of the group screens (step 05). Kept out of `ru`, which the menu ships on every screen,
// so only the group screens carry them.
// STUB(D-04): Russian only; Kazakh will be a sibling file.
export const groupsText = {
  create: "Новая группа",
  edit: "Изменить",
  archive: "В архив",
  move: "Перевести",
  emptyTitle: "Групп пока нет",
  emptyOwner: "Создайте первую группу.",
  emptyAdmin: "Группы создаёт владелец зала.",
  coach: "Тренер",
  seats: "Места",
  seatsUnlimited: "без лимита",
  paid: "Оплатили",
  debtors: "Должники",
  members: "В группе",
  expiring: "Скоро закончится",
  unpaid: "Нет абонемента",
  price: "Цена",
  noSchedule: "Расписание не задано",
  archivedNotice: "Группа в архиве. Изменить её нельзя.",
  membersTitle: "Состав",
  membersEmpty: "В группе пока нет клиентов.",
  endsOnPrefix: "до",
  overCapacity: "Мест больше нет",
  daysShort: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  daysLong: [
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
  ],
  form: {
    createTitle: "Новая группа",
    editTitle: "Изменить группу",
    name: "Название",
    nameHint: "Например, «Дети 6–9 лет, утро».",
    coach: "Тренер",
    coachPlaceholder: "Выберите тренера",
    schedule: "Дни и время",
    scheduleHint: "Отметьте дни занятий и укажите время.",
    from: "с",
    to: "до",
    price: "Цена за месяц, ₸",
    priceHint: "Подставится в новые оплаты. Прошлые оплаты не изменятся.",
    capacity: "Мест в группе",
    capacityHint:
      "Пусто, если лимита нет. Перебор не запрещён, только предупреждение.",
    save: "Сохранить",
    saving: "Сохраняем…",
    created: "Группа создана",
    saved: "Изменения сохранены",
    errors: {
      name: "Введите название, до 100 символов.",
      coachId: "Выберите тренера.",
      schedule: "Проверьте время: конец занятия должен быть позже начала.",
      defaultPrice: "Цена: целое число больше нуля, без копеек.",
      capacity: "Мест: целое число от 1 до 500 или пусто.",
    },
  },
  archiveDialog: {
    title: "Отправить группу в архив?",
    text: "Группа исчезнет из списка и из выбора при записи клиентов. Прошлые оплаты останутся.",
    withClients: (count: number) =>
      `В группе ${count} ${clientsWord(count)}. Лучше сначала перевести их в другую группу. Если архивировать сейчас, они останутся записаны в архивную группу.`,
    confirm: "В архив",
    confirmAnyway: "Всё равно в архив",
    done: "Группа в архиве",
    clientsAppeared:
      "В группе появились клиенты. Проверьте состав и попробуйте ещё раз.",
  },
  moveDialog: {
    title: "Перевести в группу",
    selected: (count: number) => `Выбрано: ${count}`,
    selectAll: "Выбрать всех",
    clearSelection: "Снять выбор",
    selectClient: (name: string) => `Выбрать: ${name}`,
    target: "Куда перевести",
    noTargets: "Других групп нет. Сначала владелец создаёт группу.",
    overWarning: (members: number, capacity: number) =>
      `После перевода будет ${members} при лимите ${capacity}. Перевести всё равно можно.`,
    confirm: "Перевести",
    done: (count: number) => `Переведено: ${count}`,
  },
  errors: {
    forbidden: "Недостаточно прав для этого действия.",
    not_found: "Группа не найдена. Возможно, её уже архивировали.",
    coach_not_found: "Этот тренер больше не работает. Выберите другого.",
    target_not_found: "Группа для перевода не найдена. Обновите страницу.",
    client_not_found:
      "Кого-то из выбранных уже перевели или архивировали. Обновите страницу.",
    invalid: "Проверьте введённые данные.",
    unavailable: "Не удалось сохранить. Попробуйте ещё раз.",
  },
} as const;

function clientsWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "клиентов";
  if (last === 1) return "клиент";
  if (last >= 2 && last <= 4) return "клиента";
  return "клиентов";
}
