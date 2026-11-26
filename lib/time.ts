/**
 * Время в часовом поясе компании без сторонних библиотек (сервер и браузер).
 * Все отметки в БД — миллисекунды UTC; границы дней и периодов считаются
 * в поясе компании (по умолчанию Asia/Almaty).
 */

const DAY_MS = 24 * 60 * 60_000;

/** Смещение пояса относительно UTC в момент ms (мс) */
export function zoneOffsetMs(timeZone: string, ms: number): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Локальная дата-время в поясе → мс UTC */
export function zonedToUtc(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = guess - zoneOffsetMs(timeZone, guess);
    // Повторная поправка на случай перехода на летнее время между guess и first.
    return guess - zoneOffsetMs(timeZone, first);
}

export type LocalDate = { year: number; month: number; day: number };

export function parseLocalDate(value: string): LocalDate | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
}

/** Календарная дата момента ms в поясе */
export function localDateOf(timeZone: string, ms: number): LocalDate {
    const shifted = new Date(ms + zoneOffsetMs(timeZone, ms));
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function formatLocalDate(date: LocalDate): string {
    return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Начало дня (00:00) в поясе */
export function startOfDay(timeZone: string, date: LocalDate): number {
    return zonedToUtc(timeZone, date.year, date.month, date.day);
}

export function addDays(date: LocalDate, days: number): LocalDate {
    const ms = Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS;
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Полуинтервал [from, to) в мс для дат «с» и «по» включительно */
export function periodBounds(timeZone: string, from: LocalDate, to: LocalDate): { from: number; to: number } {
    return { from: startOfDay(timeZone, from), to: startOfDay(timeZone, addDays(to, 1)) };
}

/** Сегодня [начало, конец) в поясе */
export function todayBounds(timeZone: string, now: number): { from: number; to: number } {
    const today = localDateOf(timeZone, now);
    return periodBounds(timeZone, today, today);
}

/** Дата «ГГГГ-ММ-ДД» и время «ЧЧ:ММ» момента ms в поясе (для полей ввода) */
export function localInputParts(timeZone: string, ms: number): { date: string; time: string } {
    const shifted = new Date(ms + zoneOffsetMs(timeZone, ms));
    const pad = (value: number) => String(value).padStart(2, "0");
    return {
        date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
        time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    };
}

/** Поля ввода «дата» и «время» в поясе → мс UTC; null, если дата не задана */
export function inputsToUtc(timeZone: string, date: string, time: string): number | null {
    const parsed = parseLocalDate(date);
    if (!parsed) return null;
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    const hour = match ? Number(match[1]) : 10;
    const minute = match ? Number(match[2]) : 0;
    return zonedToUtc(timeZone, parsed.year, parsed.month, parsed.day, hour, minute);
}

/** Текущий месяц: даты с первого по последний день */
export function currentMonth(timeZone: string, now: number): { from: LocalDate; to: LocalDate } {
    const today = localDateOf(timeZone, now);
    const first = { year: today.year, month: today.month, day: 1 };
    const nextFirst = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
    return { from: first, to: addDays(nextFirst, -1) };
}
