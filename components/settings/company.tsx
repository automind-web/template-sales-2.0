"use client";

import { Building } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { CompanyMark } from "../app-shell.tsx";
import { useSession } from "../session.tsx";
import { Card } from "../ui/card.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";

/** Часовые пояса понятными названиями городов */
const ZONES: Array<[string, string]> = [
    ["Asia/Almaty", "Алматы"],
    ["Asia/Qostanay", "Костанай"],
    ["Asia/Aqtobe", "Актобе"],
    ["Asia/Aqtau", "Актау"],
    ["Asia/Oral", "Уральск"],
    ["Asia/Tashkent", "Ташкент"],
    ["Asia/Bishkek", "Бишкек"],
    ["Asia/Dushanbe", "Душанбе"],
    ["Asia/Yekaterinburg", "Екатеринбург"],
    ["Asia/Novosibirsk", "Новосибирск"],
    ["Europe/Moscow", "Москва"],
    ["Europe/Minsk", "Минск"],
    ["Asia/Baku", "Баку"],
    ["Asia/Tbilisi", "Тбилиси"],
    ["Asia/Dubai", "Дубай"],
    ["Europe/Istanbul", "Стамбул"],
    ["Europe/Berlin", "Берлин"],
    ["Europe/London", "Лондон"],
];

function zoneTime(zone: string, now: number) {
    try {
        return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(now));
    } catch {
        return "—";
    }
}

export function CompanySettings() {
    const { me, reload } = useSession();
    const [name, setName] = useState(me.company.name);
    const [timezone, setTimezone] = useState(me.company.timezone);
    const [saved, setSaved] = useState(false);
    const [now] = useState(() => Date.now());
    const action = useAction();
    const changed = name !== me.company.name || timezone !== me.company.timezone;
    const known = ZONES.some(([zone]) => zone === timezone);

    return (
        <Card className="max-w-3xl overflow-hidden p-0">
            <div className="flex items-center gap-4 border-b border-border bg-gradient-to-r from-primary/8 to-transparent p-5">
                <CompanyMark name={name || me.company.name} className="size-14 rounded-2xl text-2xl" />
                <div className="min-w-0">
                    <div className="text-lg font-bold break-anywhere">{name || me.company.name}</div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Building className="size-4" />
                        {t("settings.nowTime", { time: zoneTime(timezone, now) })}
                    </div>
                </div>
            </div>
            <Form
                className="p-5"
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
                <Field label={t("settings.companyName")} hint={t("settings.companyIntro")} error={action.fields["name"]}>
                    <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label={t("settings.timezone")} hint={t("settings.timezoneHint")} error={action.fields["timezone"]}>
                    <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                        {!known ? <option value={timezone}>{t("settings.otherZone", { zone: timezone })}</option> : null}
                        {ZONES.map(([zone, city]) => (
                            <option key={zone} value={zone}>
                                {city} · {zoneTime(zone, now)}
                            </option>
                        ))}
                    </Select>
                </Field>
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {saved && !changed ? <FormMessage kind="success">{t("settings.saved")}</FormMessage> : null}
            </Form>
        </Card>
    );
}
