"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "../../lib/utils.ts";

export type TabItem<K extends string> = { key: K; label: string };

/**
 * Вкладки с подчёркиванием. Выбранная вкладка хранится в адресе (?tab=),
 * поэтому её можно открыть по ссылке и она сохраняется при возврате.
 */
export function useTab<K extends string>(items: ReadonlyArray<TabItem<K>>): [K, (key: K) => void] {
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname() ?? "/";
    const requested = params?.get("tab");
    const current = (items.find((item) => item.key === requested)?.key ?? items[0]!.key) as K;
    const select = (key: K) => router.replace(`${pathname}?tab=${key}`, { scroll: false });
    return [current, select];
}

export function Tabs<K extends string>({ items, value, onChange, label }: { items: ReadonlyArray<TabItem<K>>; value: K; onChange: (key: K) => void; label: string }) {
    return (
        <div role="tablist" aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
            {items.map((item) => (
                <button
                    key={item.key}
                    role="tab"
                    type="button"
                    aria-selected={value === item.key}
                    onClick={() => onChange(item.key)}
                    className={cn(
                        "-mb-px shrink-0 cursor-pointer border-b-2 px-4 py-3 text-[15px] font-semibold whitespace-nowrap transition-colors",
                        value === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
