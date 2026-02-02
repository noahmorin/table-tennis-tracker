import type { MatchFormat } from '../lib/data/types';

const readEnvNumber = (key: keyof ImportMetaEnv, fallback: number) => {
  const raw = import.meta.env[key];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const formatWeights: Record<MatchFormat, number> = {
  bo1: readEnvNumber('VITE_ELO_WEIGHT_BO1', 0.75),
  bo3: readEnvNumber('VITE_ELO_WEIGHT_BO3', 1),
  bo5: readEnvNumber('VITE_ELO_WEIGHT_BO5', 1.25),
  bo7: readEnvNumber('VITE_ELO_WEIGHT_BO7', 1.5)
};

export const eloConfig = {
  baseline: readEnvNumber('VITE_ELO_BASELINE', 1000),
  floor: readEnvNumber('VITE_ELO_FLOOR', 100),
  scale: readEnvNumber('VITE_ELO_SCALE', 400),
  kMax: readEnvNumber('VITE_ELO_K_MAX', 72),
  kMin: readEnvNumber('VITE_ELO_K_MIN', 24),
  halfLife: readEnvNumber('VITE_ELO_HALF_LIFE', 20),
  formatWeights
};
