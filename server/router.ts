import type { Ctx } from "./context.ts";
import { createDb } from "./db.ts";
import { AppError, errorResponse, json, parseCookies } from "./http.ts";
import type { Env, WaitUntil } from "./runtime.ts";
import * as analyticsApi from "./handlers/analytics.ts";
import * as authApi from "./handlers/auth.ts";
import * as crmApi from "./handlers/crm.ts";
import * as invitationsApi from "./handlers/invitations.ts";
import * as integrationApi from "./handlers/integration.ts";
import * as orgApi from "./handlers/organization.ts";
import * as trainingApi from "./handlers/training.ts";
import * as waApi from "./handlers/whatsapp.ts";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Handler = (ctx: Ctx) => Promise<unknown>;

type Route = {
    method: Method;
    pattern: string;
    handler: Handler;
    /**
     * Точки входа интеграций (загрузка материалов, webhook) проверяют свой
     * токен/подпись и не требуют заголовка защиты от CSRF.
     */
    external?: boolean;
};

export const routes: Route[] = [
    // Вход и профиль
    { method: "POST", pattern: "/api/auth/login", handler: authApi.login },
    { method: "POST", pattern: "/api/auth/logout", handler: authApi.logout },
    { method: "POST", pattern: "/api/auth/reset", handler: authApi.resetPassword },
    { method: "GET", pattern: "/api/me", handler: authApi.me },
    { method: "PATCH", pattern: "/api/me", handler: authApi.updateMe },
    { method: "PUT", pattern: "/api/me/branch", handler: authApi.selectBranch },
    { method: "POST", pattern: "/api/me/password", handler: authApi.changePassword },
    { method: "GET", pattern: "/api/me/sessions", handler: authApi.listSessions },
    { method: "DELETE", pattern: "/api/me/sessions/:id", handler: authApi.revokeSession },
    { method: "GET", pattern: "/api/sections/:section", handler: authApi.sectionCheck },

    // Владелец сайта и приглашения
    { method: "POST", pattern: "/api/owner/activation-links", handler: invitationsApi.ownerIssueActivation },
    { method: "GET", pattern: "/api/invitations/by-token/:token", handler: invitationsApi.viewInvitation },
    { method: "POST", pattern: "/api/invitations/by-token/:token/accept", handler: invitationsApi.acceptInvitation },
    { method: "GET", pattern: "/api/invitations", handler: invitationsApi.listInvitations },
    { method: "POST", pattern: "/api/invitations", handler: invitationsApi.createInvitation },
    { method: "POST", pattern: "/api/invitations/:id/revoke", handler: invitationsApi.revokeInvitation },

    // Компания, филиалы, сотрудники
    { method: "GET", pattern: "/api/company", handler: orgApi.getCompany },
    { method: "PATCH", pattern: "/api/company", handler: orgApi.updateCompany },
    { method: "GET", pattern: "/api/company/connections", handler: orgApi.connections },
    { method: "GET", pattern: "/api/branches", handler: orgApi.listBranches },
    { method: "POST", pattern: "/api/branches", handler: orgApi.createBranch },
    { method: "PATCH", pattern: "/api/branches/:id", handler: orgApi.updateBranch },
    { method: "GET", pattern: "/api/users", handler: orgApi.listUsers },
    { method: "PATCH", pattern: "/api/users/:id", handler: orgApi.updateUser },
    { method: "POST", pattern: "/api/users/:id/reset-code", handler: orgApi.issueResetCode },
    { method: "PUT", pattern: "/api/users/:id/admission", handler: orgApi.setAdmission },

    // Обучение
    { method: "GET", pattern: "/api/training/courses", handler: trainingApi.myCourses },
    { method: "GET", pattern: "/api/training/courses/:id", handler: trainingApi.courseDetail },
    { method: "POST", pattern: "/api/training/courses/:id/lessons/:lessonKey/complete", handler: trainingApi.completeLesson },
    { method: "POST", pattern: "/api/training/courses/:id/attempts", handler: trainingApi.startAttempt },
    { method: "GET", pattern: "/api/training/attempts/:id", handler: trainingApi.getAttempt },
    { method: "PUT", pattern: "/api/training/attempts/:id/answers", handler: trainingApi.saveAnswers },
    { method: "POST", pattern: "/api/training/attempts/:id/submit", handler: trainingApi.submitAttempt },
    { method: "GET", pattern: "/api/training/files/:id", handler: trainingApi.downloadFile },
    { method: "GET", pattern: "/api/training/progress", handler: trainingApi.teamProgress },
    { method: "GET", pattern: "/api/training/catalog", handler: trainingApi.catalog },
    { method: "GET", pattern: "/api/training/assignments", handler: trainingApi.listAssignments },
    { method: "POST", pattern: "/api/training/assignments", handler: trainingApi.createAssignment },
    { method: "DELETE", pattern: "/api/training/assignments/:id", handler: trainingApi.removeAssignment },
    { method: "GET", pattern: "/api/training/admission-rules", handler: trainingApi.getAdmissionRules },
    { method: "PUT", pattern: "/api/training/admission-rules", handler: trainingApi.saveAdmissionRules },

    // CRM
    { method: "GET", pattern: "/api/crm/config", handler: crmApi.crmConfig },
    { method: "GET", pattern: "/api/crm/leads", handler: crmApi.crmList },
    { method: "POST", pattern: "/api/crm/leads", handler: crmApi.crmCreate },
    { method: "GET", pattern: "/api/crm/export", handler: crmApi.crmExport },
    { method: "GET", pattern: "/api/crm/leads/:id", handler: crmApi.crmGet },
    { method: "PATCH", pattern: "/api/crm/leads/:id", handler: crmApi.crmUpdate },
    { method: "GET", pattern: "/api/settings/process", handler: crmApi.getProcess },
    { method: "PUT", pattern: "/api/settings/process", handler: crmApi.saveProcess },

    // KPI и статистика (одна функция расчёта)
    { method: "GET", pattern: "/api/stats", handler: analyticsApi.stats },
    { method: "GET", pattern: "/api/stats/leads", handler: analyticsApi.statsLeads },
    { method: "GET", pattern: "/api/kpi/methodology", handler: analyticsApi.methodology },
    { method: "POST", pattern: "/api/kpi/methodology", handler: analyticsApi.saveMethodology },
    { method: "POST", pattern: "/api/kpi/methodology/:id/approve", handler: analyticsApi.approveMethodology },
    { method: "GET", pattern: "/api/kpi/report", handler: analyticsApi.kpiReport },

    // WhatsApp Studio
    { method: "GET", pattern: "/api/whatsapp/studio", handler: waApi.studio },
    { method: "POST", pattern: "/api/whatsapp/agent", handler: waApi.createAgent },
    { method: "PATCH", pattern: "/api/whatsapp/agent", handler: waApi.updateAgent },
    { method: "POST", pattern: "/api/whatsapp/materials", handler: waApi.addMaterial },
    { method: "DELETE", pattern: "/api/whatsapp/materials/:id", handler: waApi.deleteMaterial },
    { method: "POST", pattern: "/api/whatsapp/test", handler: waApi.testDialog },
    { method: "POST", pattern: "/api/whatsapp/channel/connect", handler: waApi.connectChannel },
    { method: "POST", pattern: "/api/whatsapp/channel/check", handler: waApi.checkChannelState },
    { method: "POST", pattern: "/api/whatsapp/channel/disconnect", handler: waApi.disconnectChannel },
    { method: "POST", pattern: "/api/whatsapp/messages/retry", handler: waApi.retryMessages },
    // Входящие сообщения Whapi: секрет в адресе, проверяется по хэшу
    { method: "POST", pattern: "/api/whatsapp/webhook/:token", handler: waApi.webhook, external: true },

    // Интерфейс интеграции (Authorization: Bearer INTEGRATION_TOKEN)
    { method: "GET", pattern: "/api/integration/training/courses", handler: integrationApi.listIntegrationCourses, external: true },
    { method: "POST", pattern: "/api/integration/training/courses/:key/versions", handler: integrationApi.publishCourseVersion, external: true },
    { method: "POST", pattern: "/api/integration/training/files", handler: integrationApi.uploadTrainingFile, external: true },
];

type Compiled = Route & { regex: RegExp; keys: string[] };

const compiled: Compiled[] = routes.map((route) => {
    const keys: string[] = [];
    const source = route.pattern
        .split("/")
        .map((segment) => {
            if (segment.startsWith(":")) {
                keys.push(segment.slice(1));
                return "([^/]+)";
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");
    return { ...route, regex: new RegExp(`^${source}/?$`), keys };
});

/** Заголовок, без которого изменяющие запросы отклоняются (простая защита от CSRF) */
export const CSRF_HEADER = "x-asc-request";

export async function handleApiRequest(request: Request, env: Env, waitUntil: WaitUntil | null = null): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const candidates = compiled.filter((route) => route.regex.test(url.pathname));
    if (candidates.length === 0) return errorResponse(new AppError(404, "error.notFound"));
    const route = candidates.find((candidate) => candidate.method === method);
    if (!route) return errorResponse(new AppError(405, "error.methodNotAllowed"));

    const match = route.regex.exec(url.pathname);
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match?.[index + 1] ?? "");
    });

    const ctx: Ctx = {
        request,
        env,
        db: createDb(env.DB),
        url,
        params,
        now: Date.now(),
        cookies: parseCookies(request.headers.get("cookie")),
        setCookies: [],
        waitUntil,
    };

    try {
        if (method !== "GET" && !route.external && request.headers.get(CSRF_HEADER) !== "1") {
            throw new AppError(403, "auth.csrf");
        }
        const result = await route.handler(ctx);
        if (result instanceof Response) {
            for (const cookie of ctx.setCookies) result.headers.append("set-cookie", cookie);
            return result;
        }
        return json(result ?? { ok: true }, { cookies: ctx.setCookies });
    } catch (error) {
        if (error instanceof AppError) {
            const response = errorResponse(error);
            for (const cookie of ctx.setCookies) response.headers.append("set-cookie", cookie);
            return response;
        }
        // В журнал — только тип и текст ошибки, без тела запроса и секретов.
        console.error(`[api] ${method} ${url.pathname} failed:`, error instanceof Error ? error.message : String(error));
        return errorResponse(new AppError(500, "error.internal"));
    }
}
