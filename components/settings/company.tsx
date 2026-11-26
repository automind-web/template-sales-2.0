"use client";

import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSession } from "../session.tsx";
import { Card } from "../ui/card.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";

function timezoneOptions(current: string): string[] {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    const list = supported.length ? supported : ["Asia/Almaty", "Asia/Astana", "Asia/Tashkent", "Europe/Moscow", "UTC"];
    return list.includes(current) ? list : [current, ...list];
}

export function CompanySettings() {
    const { me, reload } = useSession();
    const [name, setName] = useState(me.company.name);
    const [timezone, setTimezone] = useState(me.company.timezone);
    const [saved, setSaved] = useState(false);
    const action = useAction();
    const changed = name !== me.company.name || timezone !== me.company.timezone;

    return (
        <Card className="max-w-5xl p-5">
            <Form
                onSubmit={async () => {
                    setSaved(false);
                    if (
                        await action.run(async () => {
                            await api("/api/company", { method: "PATCH", body: { name, timezone } });
                            await reload();
                        })
                    )
                        setSaved(true);
                }}
                busy={action.busy}
                canSubmit={changed && name.trim().length >= 2}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {saved && !changed ? <FormMessage kind="success">{t("settings.saved")}</FormMessage> : null}
                <FieldGrid>
                    <Field label={t("settings.companyName")} error={action.fields["name"]}>
                        <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field label={t("settings.timezone")} hint={t("settings.timezoneHint")} error={action.fields["timezone"]}>
                        <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                            {timezoneOptions(me.company.timezone).map((zone) => (
                                <option key={zone} value={zone}>
                                    {zone}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </FieldGrid>
            </Form>
        </Card>
    );
}
