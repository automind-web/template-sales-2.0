/**
 * Защищённый интерфейс интеграции для загрузки утверждённых редакций
 * материалов обучения. Доступ — только по секрету INTEGRATION_TOKEN
 * (заголовок Authorization: Bearer <токен>). Каждая редакция сохраняется
 * отдельной неизменяемой версией; повторная доставка не создаёт дубль.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { companies, courses, courseVersions, trainingFiles } from "../../db/schema.ts";
import type { Ctx } from "../context.ts";
import { sha256Hex, timingSafeEqual } from "../crypto.ts";
import { isUniqueViolation, newId } from "../db.ts";
import { AppError, clientIp, readJson } from "../http.ts";
import { enforceRateLimit } from "../rate-limit.ts";
import { getSecret } from "../runtime.ts";
import { ContentError, parseCourseContent } from "../training.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const COURSE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function integrationError(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { code: "integration", message } }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
}

async function requireIntegration(ctx: Ctx): Promise<void> {
    await enforceRateLimit(ctx.env.DB, `integration:${clientIp(ctx.request)}`, 120, 60_000, ctx.now);
    const secret = getSecret(ctx.env, "INTEGRATION_TOKEN");
    if (!secret) throw new AppError(503, "integration.notConfigured");
    const header = ctx.request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !timingSafeEqual(await sha256Hex(token), await sha256Hex(secret))) throw new AppError(401, "integration.unauthorized");
}

/** Компания: из параметра companyId, а при одной компании на сайте — она */
async function resolveCompany(ctx: Ctx, requested: string | null): Promise<string> {
    if (requested) {
        const company = await ctx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, requested)).get();
        if (!company) throw new AppError(404, "error.noCompany");
        return company.id;
    }
    const rows = await ctx.db.select({ id: companies.id }).from(companies).limit(2).all();
    if (rows.length === 0) throw new AppError(409, "error.noCompany");
    if (rows.length > 1) throw new AppError(400, "integration.companyRequired");
    return rows[0]!.id;
}

async function ensureCourse(ctx: Ctx, companyId: string, key: string, title: string) {
    const existing = await ctx.db.select().from(courses).where(and(eq(courses.companyId, companyId), eq(courses.key, key))).get();
    if (existing) return existing;
    try {
        await ctx.db.insert(courses).values({ id: newId(), companyId, key, title, createdAt: ctx.now });
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
    }
    const created = await ctx.db.select().from(courses).where(and(eq(courses.companyId, companyId), eq(courses.key, key))).get();
    if (!created) throw new AppError(500, "error.internal");
    return created;
}

function readCourseKey(ctx: Ctx): string {
    const key = (ctx.params["key"] ?? "").toLowerCase();
    if (!COURSE_KEY.test(key)) throw new AppError(400, "integration.badCourseKey");
    return key;
}

/** POST /api/integration/training/courses/:key/versions — новая утверждённая редакция */
export async function publishCourseVersion(ctx: Ctx) {
    await requireIntegration(ctx);
    const key = readCourseKey(ctx);
    const body = await readJson(ctx.request);
    if (body["approved"] !== true) return integrationError(400, "Принимаются только утверждённые редакции: передайте \"approved\": true.");
    const title = typeof body["title"] === "string" ? body["title"].trim().slice(0, 200) : "";
    if (!title) return integrationError(400, "title: обязательное поле.");
    const description = typeof body["description"] === "string" ? body["description"].trim().slice(0, 2000) || null : null;
    const externalRef = typeof body["externalRef"] === "string" && body["externalRef"].trim() ? body["externalRef"].trim().slice(0, 200) : null;

    let content;
    try {
        content = parseCourseContent(body);
    } catch (error) {
        if (error instanceof ContentError) return integrationError(400, error.message);
        throw error;
    }

    const companyId = await resolveCompany(ctx, typeof body["companyId"] === "string" ? body["companyId"] : null);
    const course = await ensureCourse(ctx, companyId, key, title);

    const fileIds = [...new Set(content.lessons.flatMap((lesson) => lesson.fileIds))];
    if (fileIds.length) {
        const known = await ctx.db
            .select({ id: trainingFiles.id })
            .from(trainingFiles)
            .where(and(eq(trainingFiles.courseId, course.id), inArray(trainingFiles.id, fileIds)))
            .all();
        const knownIds = new Set(known.map((row) => row.id));
        const missing = fileIds.filter((id) => !knownIds.has(id));
        if (missing.length) return integrationError(400, `Файлы не найдены в курсе «${key}»: ${missing.join(", ")}. Сначала загрузите их.`);
    }

    const serialized = JSON.stringify(content);
    const checksum = await sha256Hex(`${title}\n${description ?? ""}\n${serialized}`);

    if (externalRef) {
        const same = await ctx.db
            .select()
            .from(courseVersions)
            .where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.externalRef, externalRef)))
            .get();
        if (same) {
            if (same.checksum !== checksum) return integrationError(409, `Редакция externalRef=«${externalRef}» уже загружена с другим содержимым. Утверждённые версии не изменяются — передайте новый externalRef.`);
            return { created: false, courseId: course.id, courseKey: key, versionId: same.id, version: same.version };
        }
    } else {
        const latest = await ctx.db.select().from(courseVersions).where(eq(courseVersions.courseId, course.id)).orderBy(desc(courseVersions.version)).limit(1).get();
        if (latest && latest.checksum === checksum) {
            return { created: false, courseId: course.id, courseKey: key, versionId: latest.id, version: latest.version };
        }
    }

    const id = newId();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await ctx.env.DB.prepare(
                `INSERT INTO course_versions (id, company_id, course_id, version, title, description, content, checksum, external_ref, source, created_at)
                 SELECT ?1, ?2, ?3, COALESCE(MAX(version), 0) + 1, ?4, ?5, ?6, ?7, ?8, 'integration', ?9
                 FROM course_versions WHERE course_id = ?3`
            )
                .bind(id, companyId, course.id, title, description, serialized, checksum, externalRef, ctx.now)
                .run();
            break;
        } catch (error) {
            // Параллельная доставка: та же редакция по externalRef уже записана — отвечаем ей.
            if (isUniqueViolation(error) && externalRef) {
                const same = await ctx.db.select().from(courseVersions).where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.externalRef, externalRef))).get();
                if (same) return { created: false, courseId: course.id, courseKey: key, versionId: same.id, version: same.version };
            }
            if (!isUniqueViolation(error) || attempt === 2) throw error;
        }
    }
    const saved = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, id)).get();
    if (!saved) throw new AppError(500, "error.internal");
    await ctx.db.update(courses).set({ title }).where(eq(courses.id, course.id));
    return { created: true, courseId: course.id, courseKey: key, versionId: saved.id, version: saved.version };
}

/** POST /api/integration/training/files — файл материала в R2 (multipart: file, courseKey) */
export async function uploadTrainingFile(ctx: Ctx) {
    await requireIntegration(ctx);
    if (!ctx.env.BUCKET) throw new AppError(503, "integration.noBucket");
    const length = Number(ctx.request.headers.get("content-length") ?? "0");
    if (length > MAX_FILE_BYTES + 64 * 1024) return integrationError(413, `Файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ.`);
    let form: FormData;
    try {
        form = await ctx.request.formData();
    } catch {
        return integrationError(400, "Ожидается multipart/form-data с полями file и courseKey.");
    }
    const file = form.get("file");
    const courseKey = String(form.get("courseKey") ?? "").toLowerCase();
    if (!(file instanceof File)) return integrationError(400, "file: обязательное поле.");
    if (!COURSE_KEY.test(courseKey)) return integrationError(400, "courseKey: латиница в нижнем регистре, цифры, точка, дефис, подчёркивание.");
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return integrationError(413, `Размер файла: от 1 байта до ${MAX_FILE_BYTES / 1024 / 1024} МБ.`);

    const companyId = await resolveCompany(ctx, typeof form.get("companyId") === "string" ? String(form.get("companyId")) : null);
    const courseTitle = String(form.get("courseTitle") ?? "").trim().slice(0, 200) || courseKey;
    const course = await ensureCourse(ctx, companyId, courseKey, courseTitle);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = newId();
    const objectKey = `training/${companyId}/${course.id}/${id}`;
    const contentType = (file.type || "application/octet-stream").slice(0, 100);
    const filename = (file.name || "file").replace(/[\r\n"\\/]/g, "_").slice(0, 200);

    // Порядок: сначала содержимое в R2, затем метаданные в D1; при ошибке D1 удаляем объект.
    await ctx.env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType } });
    try {
        await ctx.db.insert(trainingFiles).values({ id, companyId, courseId: course.id, objectKey, filename, contentType, size: bytes.byteLength, sha256: sha, createdAt: ctx.now });
    } catch (error) {
        await ctx.env.BUCKET.delete(objectKey);
        throw error;
    }
    return { fileId: id, courseKey, filename, contentType, size: bytes.byteLength, sha256: sha };
}

/** GET /api/integration/training/courses — какие курсы и версии уже загружены */
export async function listIntegrationCourses(ctx: Ctx) {
    await requireIntegration(ctx);
    const companyId = await resolveCompany(ctx, ctx.url.searchParams.get("companyId"));
    const rows = await ctx.db.select().from(courses).where(eq(courses.companyId, companyId)).orderBy(courses.key).all();
    const versions = rows.length
        ? await ctx.db
              .select({ courseId: courseVersions.courseId, version: courseVersions.version, externalRef: courseVersions.externalRef, createdAt: courseVersions.createdAt })
              .from(courseVersions)
              .where(inArray(courseVersions.courseId, rows.map((row) => row.id)))
              .orderBy(courseVersions.version)
              .all()
        : [];
    return {
        companyId,
        courses: rows.map((row) => ({
            id: row.id,
            key: row.key,
            title: row.title,
            archived: row.archivedAt !== null,
            versions: versions.filter((version) => version.courseId === row.id).map((version) => ({ version: version.version, externalRef: version.externalRef, createdAt: version.createdAt })),
        })),
    };
}
