import { handleApiRequest } from "../../../server/router.ts";
import { getEnv } from "../../../server/runtime.ts";

export const dynamic = "force-dynamic";

/** Все серверные операции проходят через один роутер: права, CSRF и ошибки — в одном месте */
async function handle(request: Request): Promise<Response> {
    return handleApiRequest(request, getEnv());
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
