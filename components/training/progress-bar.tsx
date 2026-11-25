/** Полоса прогресса с текстовой подписью (значение читается не только по цвету) */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
    const value = Math.max(0, Math.min(100, percent));
    return (
        <div className="grid gap-1">
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span>{value}%</span>
            </div>
            <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${value}%` }} />
            </div>
        </div>
    );
}
