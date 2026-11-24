"use client";

import { useState } from "react";
import { PageHeader, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { Card, CardContent } from "../../../components/ui/card.tsx";
import { Field, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { t } from "../../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../../lib/api.ts";

export default function SettingsPage() {
    return (
        <SectionGate section="settings">
            <Settings />
        </SectionGate>
    );
}

function Settings() {
    const { me, reload } = useSession();
    const [name, setName] = useState(me.company.name);
    const [timezone, setTimezone] = useState(me.company.timezone);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    async function submit() {
        setBusy(true);
        setMessage(null);
        setFields({});
        try {
            await api("/api/company", { method: "PATCH", body: { name, timezone } });
            await reload();
            setMessage({ kind: "success", text: t("settings.saved") });
        } catch (caught) {
            setMessage({ kind: "error", text: errorMessage(caught) });
            if (caught instanceof ApiError) setFields(caught.fields);
        } finally {
            setBusy(false);
        }
    }

    const changed = name !== me.company.name || timezone !== me.company.timezone;
    return (
        <>
            <PageHeader title={t("settings.title")} />
            <Card className="max-w-xl">
                <CardContent>
                    <Form onSubmit={submit} busy={busy} canSubmit={changed && name.trim().length >= 2}>
                        {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
                        <Field label={t("settings.companyName")} error={fields["name"]}>
                            <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                        </Field>
                        <Field label={t("settings.timezone")} hint={t("settings.timezoneHint")} error={fields["timezone"]}>
                            <Input value={timezone} maxLength={64} spellCheck={false} onChange={(event) => setTimezone(event.target.value)} />
                        </Field>
                    </Form>
                </CardContent>
            </Card>
        </>
    );
}
