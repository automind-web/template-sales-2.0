/**
 * Настройки компании по умолчанию.
 *
 * Один код обслуживает разные компании. Всё, что отличает одну компанию от
 * другой (название, оформление, воронка, правила допуска, часовой пояс),
 * задаётся здесь и в таблице `company_settings`. Значения из БД, которые
 * директор меняет в интерфейсе, имеют приоритет над этим файлом.
 */

export type Density = "compact" | "comfortable";

export type Palette = {
    /** Фон страницы */
    background: string;
    /** Основной текст */
    foreground: string;
    /** Фон карточек, панелей, полей */
    surface: string;
    /** Приглушённый фон (полосы таблиц, подложки) */
    muted: string;
    /** Второстепенный текст */
    mutedForeground: string;
    /** Границы */
    border: string;
    /** Основное действие */
    primary: string;
    primaryForeground: string;
    /** Ошибка и опасные действия */
    danger: string;
    dangerForeground: string;
    /** Успех */
    success: string;
    /** Предупреждение (просрочено, истекает) */
    warning: string;
    /** Выбранный элемент (строка, вкладка) */
    selected: string;
    selectedForeground: string;
    /** Кольцо фокуса */
    focus: string;
};

export type FunnelStage = {
    /** Неизменяемый ключ этапа, хранится в данных */
    key: string;
    /** Подпись этапа (можно переименовать без миграции данных) */
    label: string;
    /** Конечный этап: сделка закрыта успешно или неуспешно */
    terminal?: "won" | "lost";
    /** Поля, обязательные для перехода на этот этап */
    requiredFields?: Array<"amount" | "comment" | "nextContactAt" | "lostReason">;
};

export type FunnelConfig = {
    stages: FunnelStage[];
    /** Допустимые переходы: ключ этапа → список ключей, куда можно перейти */
    transitions: Record<string, string[]>;
};

export type AdmissionRule = {
    /** Роль, к которой применяется правило */
    role: "employee" | "manager";
    /** null — правило для всех филиалов */
    branchId: string | null;
    /** Ключ теста (курса), который нужно пройти */
    testKey: string;
    /** Минимальный результат в процентах */
    minScorePercent: number;
};

/** Стартовая программа обучения: директор правит её на сайте («Обучение» → «Программа») */
export type TrainingProgram = {
    key: string;
    title: string;
    description: string;
    passPercent: number;
    lessons: Array<{ title: string; body: string; minutes: number }>;
    questions: Array<{ text: string; options: string[]; correct: number[] }>;
};

export type CompanyConfig = {
    name: string;
    shortName: string;
    /** Путь к логотипу в /public или null — тогда показывается монограмма */
    logo: string | null;
    locale: "ru" | "kk" | "en";
    timezone: string;
    density: Density;
    fonts: { sans: string; mono: string };
    palette: Palette;
    funnel: FunnelConfig;
    admissionRules: AdmissionRule[];
    training: TrainingProgram;
    /** Валюта сумм сделок (подпись) */
    currency: string;
    /** Сотрудники видят лиды коллег своего филиала (иначе — только свои) */
    employeesSeeBranchLeads: boolean;
    /** Срок действия ссылки активации директора, часов */
    activationLinkTtlHours: number;
    /** Срок действия приглашения сотрудника, часов */
    invitationTtlHours: number;
    /** Срок действия кода восстановления пароля, часов */
    resetCodeTtlHours: number;
    /** Срок жизни сессии, дней */
    sessionTtlDays: number;
};

export const companyConfig: CompanyConfig = {
    name: "AI Sales Corp",
    shortName: "ASC",
    logo: null,
    locale: "ru",
    timezone: "Asia/Almaty",
    density: "compact",
    fonts: {
        sans: '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
        mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    },
    palette: {
        background: "#f4f5f8",
        foreground: "#1d2433",
        surface: "#ffffff",
        muted: "#f1f3f7",
        mutedForeground: "#6b7385",
        border: "#e2e5eb",
        primary: "#2f5bea",
        primaryForeground: "#ffffff",
        danger: "#d0312d",
        dangerForeground: "#ffffff",
        success: "#1f8a4c",
        warning: "#b8650a",
        selected: "#e4eafc",
        selectedForeground: "#1f3fae",
        focus: "#2f5bea",
    },

    funnel: {
        stages: [
            { key: "new", label: "Новый" },
            { key: "contact", label: "Контакт", requiredFields: ["nextContactAt"] },
            { key: "meeting", label: "Встреча", requiredFields: ["nextContactAt"] },
            { key: "proposal", label: "Предложение", requiredFields: ["amount"] },
            { key: "won", label: "Сделка", terminal: "won", requiredFields: ["amount"] },
            { key: "lost", label: "Отказ", terminal: "lost", requiredFields: ["lostReason"] },
        ],
        transitions: {
            new: ["contact", "lost"],
            contact: ["meeting", "proposal", "lost"],
            meeting: ["proposal", "contact", "lost"],
            proposal: ["won", "meeting", "lost"],
            won: [],
            lost: ["new"],
        },
    },
    admissionRules: [
        { role: "employee", branchId: null, testKey: "sales-basics", minScorePercent: 80 },
    ],
    training: {
        key: "sales-basics",
        title: "Старт в компании",
        description: "Короткое обучение для новых сотрудников. После теста откроется рабочее место.",
        passPercent: 80,
        lessons: [
            {
                title: "Как устроена работа",
                minutes: 5,
                body: "Каждое обращение клиента — это заявка в CRM. Заявка проходит этапы: Новый → Контакт → Встреча → Предложение → Сделка или Отказ.\n\nВсё, что происходит с клиентом, фиксируется в карточке заявки: звонки, договорённости, суммы. Так руководитель видит работу команды, а коллега может подхватить клиента.",
            },
            {
                title: "Первые 15 минут",
                minutes: 5,
                body: "На новую заявку отвечаем в течение 15 минут — чем быстрее ответ, тем выше шанс продажи.\n\nПосле каждого разговора назначаем следующий контакт: дату и время, когда напишем или позвоним снова. Заявка без следующего шага — потерянный клиент.",
            },
            {
                title: "Разговор с клиентом",
                minutes: 7,
                body: "Сначала задаём вопросы и слушаем: что нужно клиенту, к какому сроку, какой бюджет. Затем предлагаем подходящий вариант и объясняем, почему он подходит.\n\nНе обещаем того, чего нет: скидки, сроки и условия — только согласованные в компании. Если клиент отказался, обязательно записываем причину отказа.",
            },
        ],
        questions: [
            { text: "Где фиксируется вся работа с клиентом?", options: ["В личных заметках", "В карточке заявки в CRM", "В переписке с руководителем"], correct: [1] },
            { text: "За какое время нужно ответить на новую заявку?", options: ["В течение 15 минут", "До конца дня", "На следующий день"], correct: [0] },
            { text: "Что обязательно сделать после разговора с клиентом?", options: ["Ничего, клиент перезвонит сам", "Назначить следующий контакт", "Сразу закрыть заявку"], correct: [1] },
            { text: "Что нужно записать, если клиент отказался?", options: ["Причину отказа", "Ничего", "Номер другого клиента"], correct: [0] },
            { text: "Какие обещания можно давать клиенту?", options: ["Любые, чтобы закрыть сделку", "Только согласованные в компании условия", "Скидку на своё усмотрение"], correct: [1] },
        ],
    },
    currency: "₸",
    employeesSeeBranchLeads: false,
    activationLinkTtlHours: 72,
    invitationTtlHours: 72,
    resetCodeTtlHours: 24,
    sessionTtlDays: 30,
};
