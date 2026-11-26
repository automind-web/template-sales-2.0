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

export type WhatsappAgentConfig = {
    /** Имя базового агента, которое копируется в филиал */
    name: string;
    /** Базовая инструкция агента */
    instructions: string;
    /** Модель по умолчанию и список проверенных моделей */
    model: string;
    models: string[];
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
    /** Валюта сумм сделок (подпись) */
    currency: string;
    /** Сотрудники видят лиды коллег своего филиала (иначе — только свои) */
    employeesSeeBranchLeads: boolean;
    whatsappAgent: WhatsappAgentConfig;
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
    currency: "₸",
    employeesSeeBranchLeads: false,
    whatsappAgent: {
        name: "Помощник",
        instructions:
            "Ты — вежливый консультант компании в WhatsApp. Отвечай коротко и по делу, на языке клиента. Отвечай только по разрешённым материалам. Если ответа в материалах нет — скажи, что передашь вопрос менеджеру, и попроси удобное время для звонка. Не обещай скидок и сроков, которых нет в материалах.",
        model: "gpt-4.1-mini",
        models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    },
    activationLinkTtlHours: 72,
    invitationTtlHours: 72,
    resetCodeTtlHours: 24,
    sessionTtlDays: 30,
};
