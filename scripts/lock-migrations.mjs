// Фиксирует контрольные суммы миграций в db/migration-lock.json.
// Запускайте ТОЛЬКО после добавления новой миграции: уже записанные суммы
// не перезаписываются, и тест упадёт, если применённую миграцию изменили.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const lockPath = "db/migration-lock.json";
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
for (const entry of journal.entries) {
    const file = `${entry.tag}.sql`;
    const sha = createHash("sha256").update(readFileSync(`drizzle/${file}`)).digest("hex");
    if (lock[file] && lock[file] !== sha) {
        console.error(`Миграция ${file} изменена после фиксации. Применённые миграции не правятся — создайте новую.`);
        process.exit(1);
    }
    lock[file] = sha;
}
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log(`Зафиксировано миграций: ${Object.keys(lock).length}`);
