"use client";

import { useEffect } from "react";
import { Spinner } from "../components/ui/card.tsx";
import { t } from "../i18n/index.ts";
import { api } from "../lib/api.ts";

type Me = { user: { role: string; admitted: boolean }; branches: unknown[] };

/** Стартовая страница: первый раздел по роли. Директор без филиалов — сразу к их созданию. */
export default function Home() {
    useEffect(() => {
        api<Me>("/api/me")
            .then((me) => {
                let target = "/training";
                if (me.user.role === "director" && me.branches.length === 0) target = "/settings?tab=branches";
                else if (me.user.role === "employee" && me.user.admitted) target = "/crm";
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
