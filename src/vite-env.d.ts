/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_SHORT_NAME: string;
  readonly VITE_APP_LEAGUE_LABEL: string;
  readonly VITE_APP_STATUS_LABEL: string;
  readonly VITE_BASE_PATH: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
