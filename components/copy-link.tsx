"use client";

import { useState } from "react";
import { t } from "../i18n/index.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

/** Поле со ссылкой и кнопкой «Скопировать» (ссылка доступна и для ручного выделения на телефоне) */
export function CopyLink({ url, label }: { url: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    }
    return (
        <div className="flex gap-2">
            <Input readOnly value={url} aria-label={label ?? url} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="secondary" onClick={copy} aria-live="polite">
                {copied ? t("common.copied") : t("common.copy")}
            </Button>
        </div>
    );
}
