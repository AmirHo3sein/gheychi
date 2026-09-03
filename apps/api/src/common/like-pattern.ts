/**
 * Escaping for caller-supplied text used inside a `LIKE`/`ILIKE` pattern.
 *
 * Every free-text filter in this codebase interpolates the user's input into `%...%` (see
 * `admin-salons.controller.ts`'s `name`/`city` filters, `admin-users.controller.ts`'s
 * `phone`/`name`, `content.service.ts`'s `title`). None of them escape the pattern
 * metacharacters, which means the input is not a substring search at all -- it is a pattern
 * the caller gets to write:
 *
 *   - `%` matches any run of characters, so a search for `%` returns EVERY row, and a search
 *     for `10%` returns every row containing "10" anywhere followed by anything.
 *   - `_` matches any single character, so `09_2` quietly matches phone numbers the searcher
 *     never typed.
 *   - `\` is `LIKE`'s own escape character, so a trailing backslash makes Postgres reject the
 *     pattern outright (`invalid pattern`) -- a 500 from a search box.
 *
 * None of that is a SQL-injection vector (the value is still a bound parameter), but it is a
 * correctness and least-surprise problem, and `%`-prefixed patterns additionally defeat any
 * index the column has.
 *
 * PostgreSQL's `LIKE` already treats backslash as its escape character by default, but every
 * call site still writes an explicit `ESCAPE '\'` clause so the contract is readable at the
 * query rather than inherited from a server setting. **Note for anyone editing those
 * queries:** a TS template literal needs `ESCAPE '\\'` in the source to emit a single
 * backslash into the SQL text.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * The bound parameter a "contains this text" `ILIKE` takes, wildcards escaped -- the form
 * every call site actually wants, so nobody has to remember to wrap the escaped value in
 * `%` themselves.
 */
export function likeContains(input: string): string {
  return `%${escapeLikePattern(input)}%`;
}
