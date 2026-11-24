"use client";

import { useEffect } from "react";

/** Отметка «интерфейс готов к вводу» — для автотестов и диагностики */
export function HydrationMark() {
    useEffect(() => {
        document.documentElement.dataset["hydrated"] = "1";
    }, []);
    return null;
}
