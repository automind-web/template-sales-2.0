import type { ReactNode } from "react";

/**
 * Безопасный вывод текста урока без HTML: абзацы через пустую строку,
 * строки «- » — список, «# » — заголовок. Разметка не интерпретируется как HTML.
 */
export function RichText({ text }: { text: string }) {
    const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    const out: ReactNode[] = [];
    blocks.forEach((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
            out.push(
                <ul key={index} className="ml-5 list-disc space-y-1">
                    {lines.map((line, i) => (
                        <li key={i}>{line.replace(/^\s*[-*•]\s+/, "")}</li>
                    ))}
                </ul>
            );
        } else if (/^#{1,3}\s+/.test(block) && lines.length === 1) {
            out.push(
                <h3 key={index} className="text-base font-semibold">
                    {block.replace(/^#{1,3}\s+/, "")}
                </h3>
            );
        } else {
            out.push(
                <p key={index} className="whitespace-pre-line">
                    {block}
                </p>
            );
        }
    });
    return <div className="grid gap-2 text-sm leading-relaxed break-anywhere">{out}</div>;
}
