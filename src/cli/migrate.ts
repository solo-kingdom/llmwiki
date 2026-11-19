export async function runMigrate(
  _dir: string | undefined,
  _name: string | undefined,
  _databaseUrl?: string,
): Promise<void> {
  throw new Error(
    "legacy SQLite import is not supported in the TypeScript rewrite; " +
      "use `llmwiki init <dir>` to import workspace files into PostgreSQL",
  );
}
