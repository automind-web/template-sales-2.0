/**
 * Криптография на Web Crypto (работает и в Workers, и в Node 22).
 *
 * Пароли: PBKDF2-SHA256, уникальная соль 16 байт, 100 000 итераций —
 * это максимум, который допускает Web Crypto в Cloudflare Workers.
 * Формат хранения: pbkdf2-sha256$<итерации>$<соль b64url>$<хэш b64url>,
 * поэтому число итераций можно поднять позже без миграции: старые хэши
 * проверяются по своему числу и перехешируются при входе.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

/** Непредсказуемый токен для ссылок и сессий (256 бит) */
export function randomToken(): string {
    return toBase64Url(randomBytes(32));
}

/** Короткий код из цифр и букв без похожих символов (для восстановления пароля) */
export function randomCode(length = 10): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(length);
    let code = "";
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    return code;
}

export async function sha256Hex(value: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Сравнение строк за постоянное время */
export function timingSafeEqual(a: string, b: string): boolean {
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    let diff = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
        diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
        key,
        HASH_BYTES * 8
    );
    return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const hash = await pbkdf2(password, salt, iterations);
    return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export type PasswordCheck = { ok: boolean; needsRehash: boolean };

export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return { ok: false, needsRehash: false };
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) {
        return { ok: false, needsRehash: false };
    }
    const salt = fromBase64Url(parts[2] ?? "");
    const expected = parts[3] ?? "";
    const actual = toBase64Url(await pbkdf2(password, salt, iterations));
    const ok = timingSafeEqual(actual, expected);
    return { ok, needsRehash: ok && iterations < PBKDF2_ITERATIONS };
}

/** Хэш-заглушка, чтобы проверка несуществующего логина занимала столько же времени */
export const DUMMY_PASSWORD_HASH =
    "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
