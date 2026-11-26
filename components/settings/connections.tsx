"use client";

import { t, type MessageKey } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { StatusDot } from "../ui/badge.tsx";
import { Card, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";

type Connections = { integration: boolean; storage: boolean; whapi: boolean; model: boolean; ownerCode: boolean };

const ITEMS: Array<{ key: keyof Connections; title: MessageKey; ok: MessageKey; fail: MessageKey; fix: MessageKey; note?: MessageKey }> = [
    { key: "integration", title: "connections.integration", ok: "connections.integrationOk", fail: "connections.integrationFail", fix: "connections.integrationFix" },
    { key: "storage", title: "connections.storage", ok: "connections.storageOk", fail: "connections.storageFail", fix: "connections.storageFix" },
    { key: "whapi", title: "connections.whapi", ok: "connections.whapiOk", fail: "connections.whapiFail", fix: "connections.whapiFix", note: "connections.whapiNote" },
    { key: "model", title: "connections.model", ok: "connections.modelOk", fail: "connections.modelFail", fix: "connections.modelFix" },
    { key: "ownerCode", title: "connections.owner", ok: "connections.ownerOk", fail: "connections.ownerFail", fix: "connections.ownerFix" },
];

/** Подключения: состояние секретов и привязок сайта. Значения секретов в браузер не передаются. */
export function ConnectionsSettings() {
    const data = useApiData("connections", (signal) => api<Connections>("/api/company/connections", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    const state = data.data;
    return (
        <div className="grid max-w-5xl gap-4">
            <Card className="divide-y divide-border">
                {ITEMS.map((item) => (
                    <div key={item.key} className="grid gap-1.5 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-[17px] font-bold">{t(item.title)}</h2>
                            <StatusDot tone={state[item.key] ? "success" : "danger"}>{t(state[item.key] ? item.ok : item.fail)}</StatusDot>
                        </div>
                        {!state[item.key] ? <p className="text-sm text-muted-foreground">{t(item.fix)}</p> : null}
                        {item.note ? <p className="text-sm text-muted-foreground">{t(item.note)}</p> : null}
                    </div>
                ))}
            </Card>
            <p className="text-[13px] text-muted-foreground">{t("connections.footer")}</p>
        </div>
    );
}
