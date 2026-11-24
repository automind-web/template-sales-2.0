"use client";

import { useEffect } from "react";
import { Spinner } from "../components/ui/card.tsx";
import { t } from "../i18n/index.ts";
import { api } from "../lib/api.ts";

type Me = { user: { role: string; admitted: boolean } };

/** Стартовая страница: направляет в первый доступный раздел по роли */
export default function Home() {
    useEffect(() => {
        api<Me>("/api/me")
            .then((me) => {
                const target = me.user.role === "employee" ? (me.user.admitted ? "/crm" : "/training") : "/team";
                window.location.replace(target);
            })
            .catch(() => window.location.replace("/login"));
    }, []);
    return (
        <main className="mx-auto max-w-md p-6">
            <Spinner label={t("common.loading")} />
        </main>
    );
}
