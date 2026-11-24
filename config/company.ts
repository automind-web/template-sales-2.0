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
        background: "#f5f6f8",
        foreground: "#14181f",
        surface: "#ffffff",
        muted: "#eef0f3",
        mutedForeground: "#5b6472",
        border: "#d9dde3",
        primary: "#1d4ed8",
        primaryForeground: "#ffffff",
        danger: "#b42318",
        dangerForeground: "#ffffff",
        success: "#067647",
        warning: "#b54708",
        selected: "#e0e9ff",
        selectedForeground: "#102a72",
        focus: "#2563eb",
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
    activationLinkTtlHours: 72,
    invitationTtlHours: 72,
    resetCodeTtlHours: 24,
    sessionTtlDays: 30,
};
