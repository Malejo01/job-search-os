export const ROOT: string;
export const LOCAL_DATABASE_URL: string;
export const LOCAL_APP_DATABASE_URL: string;
export const E2E_EMAIL: string;
export const E2E_PASSWORD: string;
export function assertLocalDatabaseUrl(url: string | undefined): void;
export function assertLocalEnv(env: NodeJS.ProcessEnv): void;
export function buildLocalEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function specFilters(args: string[]): string[];
