"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { formatDateTime, t } from "../../i18n/index.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { Button } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { FormMessage } from "../ui/field.tsx";
import { Table, Td, Th, THead, Tr } from "../ui/table.tsx";
import { useBranchQuery } from "./members.tsx";

type Entry = { id: string; at: number; action: string; actorName: string | null; text: string };
type Page = { entries: Entry[]; nextBefore: number | null };

/** Журнал действий по правам: только чтение */
export function AccessLog() {
    const { me } = useSession();
    const query = useBranchQuery();
    const first = useApiData(`access-log${query}`, (signal) => api<Page>(`/api/access-log${query}`, { signal }));
    const [more, setMore] = useState<{ base: unknown; entries: Entry[]; next: number | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (first.error && !first.data) return <ErrorRetry message={first.error} onRetry={first.reload} />;
    if (!first.data) return <Spinner label={t("common.loading")} />;
    const extra = more && more.base === first.data ? more : null;
    const entries = [...first.data.entries, ...(extra?.entries ?? [])];
    const next = extra ? extra.next : first.data.nextBefore;
    const canMore = next !== null && (extra ? extra.entries.length > 0 : first.data.entries.length >= 20);

    async function loadMore() {
        if (next === null) return;
        setBusy(true);
        setError(null);
        try {
            const sep = query ? "&" : "?";
            const page = await api<Page>(`/api/access-log${query}${sep}before=${next}`);
            setMore({ base: first.data, entries: [...(extra?.entries ?? []), ...page.entries], next: page.nextBefore });
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid max-w-6xl gap-3">
            <p className="text-sm text-muted-foreground">{t("access.hint")}</p>
            {entries.length === 0 ? (
                <Card>
                    <EmptyState icon={ShieldCheck} title={t("access.empty")} />
                </Card>
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <Th>{t("access.col.when")}</Th>
                            <Th>{t("access.col.who")}</Th>
                            <Th>{t("access.col.what")}</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {entries.map((entry) => (
                            <Tr key={entry.id}>
                                <Td className="text-[13px] whitespace-nowrap text-muted-foreground">{formatDateTime(entry.at, me.company.timezone)}</Td>
                                <Td className="min-w-40 font-semibold break-anywhere">{entry.actorName ?? t("access.system")}</Td>
                                <Td className="min-w-64 break-anywhere">{entry.text}</Td>
                            </Tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            {canMore ? (
                <div>
                    <Button variant="secondary" disabled={busy} onClick={() => void loadMore()}>
                        {t("access.more")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
