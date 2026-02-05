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
  bo1: readEnvNumber('VITE_ELO_WEIGHT_BO1', 0.5),
  bo3: readEnvNumber('VITE_ELO_WEIGHT_BO3', 1),
  bo5: readEnvNumber('VITE_ELO_WEIGHT_BO5', 1.5),
  bo7: readEnvNumber('VITE_ELO_WEIGHT_BO7', 2)
};

const doublesFormatWeights: Record<MatchFormat, number> = {
  bo1: readEnvNumber('VITE_ELO_DOUBLES_WEIGHT_BO1', 0.75),
  bo3: readEnvNumber('VITE_ELO_DOUBLES_WEIGHT_BO3', 1),
  bo5: readEnvNumber('VITE_ELO_DOUBLES_WEIGHT_BO5', 1.5),
  bo7: readEnvNumber('VITE_ELO_DOUBLES_WEIGHT_BO7', 2)
};

const scoreWeights = {
  outcome: readEnvNumber('VITE_ELO_SCORE_WEIGHT_OUTCOME', 1),
  games: readEnvNumber('VITE_ELO_SCORE_WEIGHT_GAMES', 1),
  points: readEnvNumber('VITE_ELO_SCORE_WEIGHT_POINTS', 1)
};

export const eloConfig = {
  baseline: readEnvNumber('VITE_ELO_BASELINE', 1000),
  floor: readEnvNumber('VITE_ELO_FLOOR', 400),
  scale: readEnvNumber('VITE_ELO_SCALE', 1000),
  kFactor: readEnvNumber('VITE_ELO_K', 40),
  doublesMultiplier: readEnvNumber('VITE_ELO_DOUBLES_MULTIPLIER', 1),
  formatWeights,
  doublesFormatWeights,
  scoreWeights
};
