/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_SHORT_NAME: string;
  readonly VITE_APP_LEAGUE_LABEL: string;
  readonly VITE_APP_STATUS_LABEL: string;
  readonly VITE_BASE_PATH: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ELO_BASELINE: string;
  readonly VITE_ELO_FLOOR: string;
  readonly VITE_ELO_SCALE: string;
  readonly VITE_ELO_K_MAX: string;
  readonly VITE_ELO_K_MIN: string;
  readonly VITE_ELO_HALF_LIFE: string;
  readonly VITE_ELO_WEIGHT_BO1: string;
  readonly VITE_ELO_WEIGHT_BO3: string;
  readonly VITE_ELO_WEIGHT_BO5: string;
  readonly VITE_ELO_WEIGHT_BO7: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
