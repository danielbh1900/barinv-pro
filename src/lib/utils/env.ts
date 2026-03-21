function optionalEnv(key: string, fallback: string): string {
  return import.meta.env[key] ?? fallback
}

function boolEnv(key: string, fallback: boolean): boolean {
  const value = import.meta.env[key]
  if (value === undefined) return fallback
  return value === 'true'
}

function numberEnv(key: string, fallback: number): number {
  const value = import.meta.env[key]
  if (value === undefined) return fallback
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? fallback : parsed
}

export const env = {
  supabase: {
    url: optionalEnv('VITE_SUPABASE_URL', ''),
    anonKey: optionalEnv('VITE_SUPABASE_ANON_KEY', ''),
  },
  app: {
    name: optionalEnv('VITE_APP_NAME', 'BARINV Pro'),
    env: optionalEnv('VITE_APP_ENV', 'development') as 'development' | 'staging' | 'production',
    version: optionalEnv('VITE_APP_VERSION', '0.0.0'),
  },
  sentry: {
    enabled: boolEnv('VITE_ENABLE_SENTRY', false),
    dsn: optionalEnv('VITE_SENTRY_DSN', ''),
  },
  sync: {
    retryLimit: numberEnv('VITE_SYNC_RETRY_LIMIT', 5),
    staleMinutes: numberEnv('VITE_SYNC_STALE_MINUTES', 15),
  },
  features: {
    offline: boolEnv('VITE_FEATURE_OFFLINE', true),
    guestlist: boolEnv('VITE_FEATURE_GUESTLIST', false),
    purchasing: boolEnv('VITE_FEATURE_PURCHASING', false),
    recipes: boolEnv('VITE_FEATURE_RECIPES', false),
  },
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const
