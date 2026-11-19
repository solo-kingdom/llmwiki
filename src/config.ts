export const DATABASE_URL_ENV = "LLMWIKI_DATABASE_URL";

export interface ServeOptions {
  bindAddr: string;
  port: number;
  token: string;
  publicWiki: boolean;
  noMcp: boolean;
  mcpAllowWrite: boolean;
  workspace: string;
  databaseUrl: string;
  webRoot: string;
}

export function resolveDatabaseUrl(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = flag?.trim() || env[DATABASE_URL_ENV]?.trim();
  if (!value) {
    throw new Error(`database URL is required: pass --database-url or set ${DATABASE_URL_ENV}`);
  }
  return value;
}
