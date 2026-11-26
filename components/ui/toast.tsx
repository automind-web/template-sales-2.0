"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";

export type ToastMessage = { kind: "success" | "error"; text: string };

/** Короткое сообщение внизу экрана; читается экранным диктором (aria-live) */
export function useToast() {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const show = useCallback((message: ToastMessage) => {
        setToast(message);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(null), message.kind === "error" ? 7000 : 3500);
    }, []);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);
    const view = (
        <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
            {toast ? (
                <div className={cn("pointer-events-auto max-w-xl rounded-xl px-4 py-3 text-sm font-semibold shadow-xl break-anywhere", toast.kind === "error" ? "bg-danger text-danger-foreground" : "bg-foreground text-background")}>{toast.text}</div>
            ) : null}
        </div>
    );
    return { show, view };
}
