import { companyConfig } from "../config/company.ts";
import { ru, type MessageKey, type Messages } from "./ru.ts";

export type { MessageKey } from "./ru.ts";

/** Подключённые словари. Для нового языка добавьте сюда импорт его файла. */
const dictionaries: Partial<Record<string, Messages>> = { ru };

const active: Messages = dictionaries[companyConfig.locale] ?? ru;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const template = active[key] ?? ru[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = vars[name];
        return value === undefined ? match : String(value);
    });
}

export function isMessageKey(value: string): value is MessageKey {
    return Object.prototype.hasOwnProperty.call(ru, value);
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Дата и время в часовом поясе компании */
export function formatDateTime(ms: number | null | undefined, timeZone: string = companyConfig.timezone): string {
    if (ms === null || ms === undefined) return "—";
    let formatter = dateTimeFormatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("ru-RU", {
            timeZone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
        dateTimeFormatters.set(timeZone, formatter);
    }
    return formatter.format(new Date(ms));
}

const shortFormatters = new Map<string, Intl.DateTimeFormat>();

/** Коротко, как в списках: «24 нояб., 23:59» */
export function formatShort(ms: number, timeZone: string = companyConfig.timezone): string {
    let formatter = shortFormatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        shortFormatters.set(timeZone, formatter);
    }
    return formatter.format(new Date(ms));
}

/** Сумма с разделителями разрядов и валютой */
export function formatMoney(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return `${new Intl.NumberFormat("ru-RU").format(value)} ${companyConfig.currency}`;
}
