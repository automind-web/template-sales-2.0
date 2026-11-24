"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n/index.ts";
import { api, errorMessage } from "../lib/api.ts";
import { Card, CardContent } from "./ui/card.tsx";
import type { Section } from "./session.tsx";

/** Заглушка раздела следующего этапа. Доступ всё равно подтверждается сервером. */
export function ComingSoon({ section }: { section: Section }) {
    const [state, setState] = useState<"checking" | "ok" | string>("checking");
    useEffect(() => {
        api(`/api/sections/${section}`)
            .then(() => setState("ok"))
            .catch((caught: unknown) => setState(errorMessage(caught)));
    }, [section]);
    return (
        <Card>
            <CardContent className="text-sm text-muted-foreground">
                {state === "checking" ? t("common.loading") : state === "ok" ? t("shell.comingSoon") : <span role="alert" className="text-danger">{state}</span>}
            </CardContent>
        </Card>
    );
}
