/** Идентификатор операции: повтор нажатия или доставки с ним не создаёт второго события */
export function newOpId(): string {
    return crypto.randomUUID().replace(/-/g, "");
}
