import type { MessageKey } from "../i18n/index.ts";
import { badRequest, str } from "./http.ts";

export const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function normalizeLogin(value: string): string {
    return value.trim().toLowerCase();
}

export function readLogin(body: Record<string, unknown>, key = "login"): string {
    const login = normalizeLogin(str(body, key, { max: 64 }));
    if (!LOGIN_PATTERN.test(login)) throw badRequest("validation.invalidInput", { [key]: "validation.loginFormat" });
    return login;
}

export function passwordProblem(password: string): MessageKey | null {
    if (password.length < PASSWORD_MIN) return "validation.passwordShort";
    if (password.length > PASSWORD_MAX) return "validation.passwordLong";
    return null;
}

export function readNewPassword(body: Record<string, unknown>, key = "password"): string {
    const value = body[key];
    if (typeof value !== "string" || value.length === 0) throw badRequest("validation.invalidInput", { [key]: "validation.required" });
    const problem = passwordProblem(value);
    if (problem) throw badRequest("validation.invalidInput", { [key]: problem });
    return value;
}

export function readDisplayName(body: Record<string, unknown>, key = "displayName"): string {
    const name = str(body, key, { max: 200 }).replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) throw badRequest("validation.invalidInput", { [key]: "validation.nameLength" });
    return name;
}

export function isValidTimezone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}
