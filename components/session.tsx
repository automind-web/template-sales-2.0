"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { t } from "../i18n/index.ts";
import { api, errorMessage, UNAUTHORIZED_EVENT } from "../lib/api.ts";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/card.tsx";
import { FormMessage } from "./ui/field.tsx";

export type Section = "training" | "profile" | "crm" | "kpi" | "stats" | "whatsapp" | "team" | "branches" | "settings";
export type Role = "director" | "manager" | "employee";

export type Me = {
    user: { id: string; displayName: string; login: string; role: Role; branchId: string | null; branchName: string | null; admitted: boolean };
    company: { id: string; name: string; timezone: string };
    branches: Array<{ id: string; name: string; city: string | null }>;
    selectedBranchId: string | null;
    canSelectAllBranches: boolean;
    sections: Record<Section, boolean>;
};

type SessionValue = {
    me: Me;
    reload: () => Promise<void>;
    selectBranch: (branchId: string) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
    const value = useContext(SessionContext);
    if (!value) throw new Error("useSession must be used inside SessionProvider");
    return value;
}

function goToLogin() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [me, setMe] = useState<Me | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            setMe(await api<Me>("/api/me"));
            setError(null);
        } catch (caught) {
            if ((caught as { status?: number }).status === 401) return goToLogin();
            setError(errorMessage(caught));
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        api<Me>("/api/me", { signal: controller.signal }).then(
            (value) => setMe(value),
            (caught: unknown) => {
                if (controller.signal.aborted) return;
                if ((caught as { status?: number }).status === 401) return goToLogin();
                setError(errorMessage(caught));
            }
        );
        const onUnauthorized = () => goToLogin();
        // Права меняются на сервере сразу; при возврате на вкладку перечитываем профиль.
        const onFocus = () => void reload();
        window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
        window.addEventListener("focus", onFocus);
        return () => {
            window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
            window.removeEventListener("focus", onFocus);
            controller.abort();
        };
    }, [reload]);

    const selectBranch = useCallback(
        async (branchId: string) => {
            await api("/api/me/branch", { method: "PUT", body: { branchId } });
            await reload();
        },
        [reload]
    );

    if (error && !me) {
        return (
            <main className="mx-auto grid max-w-md gap-3 p-6">
                <FormMessage kind="error">{error}</FormMessage>
                <Button variant="secondary" onClick={() => void reload()}>
                    {t("common.retry")}
                </Button>
            </main>
        );
    }
    if (!me) {
        return (
            <main className="mx-auto max-w-md p-6">
                <Spinner label={t("common.loading")} />
            </main>
        );
    }
    return <SessionContext.Provider value={{ me, reload, selectBranch }}>{children}</SessionContext.Provider>;
}
