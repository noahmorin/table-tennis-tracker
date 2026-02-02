import type { GameRow, MatchFormat, MatchRow } from './data/types';
import { eloConfig } from '../config/eloConfig';

export type MatchGameTotals = {
  p1Wins: number;
  p2Wins: number;
  p1Points: number;
  p2Points: number;
  totalGames: number;
};

type EloState = {
  rating: number;
  matchesPlayed: number;
};

const compareMatches = (a: MatchRow, b: MatchRow) => {
  if (a.match_date !== b.match_date) {
    return a.match_date < b.match_date ? -1 : 1;
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
};

const resolveFormatWeight = (format: MatchFormat) => {
  const weight = eloConfig.formatWeights[format];
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
};

const resolveScale = () => (eloConfig.scale > 0 ? eloConfig.scale : 400);

const resolveKRange = () => {
  const kMax = Math.max(eloConfig.kMax, eloConfig.kMin);
  const kMin = Math.min(eloConfig.kMax, eloConfig.kMin);
  return { kMax, kMin };
};

const kForMatchesPlayed = (matchesPlayed: number) => {
  const { kMax, kMin } = resolveKRange();
  if (eloConfig.halfLife <= 0) {
    return kMax;
  }
  return kMin + (kMax - kMin) * Math.pow(0.5, matchesPlayed / eloConfig.halfLife);
};

const expectedScore = (rating: number, opponentRating: number) => {
  const scale = resolveScale();
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / scale));
};

export const buildMatchGameTotals = (matches: MatchRow[], games: GameRow[]) => {
  const matchMap = new Map<string, MatchRow>();
  const totalsByMatch = new Map<string, MatchGameTotals>();

  matches.forEach((match) => {
    matchMap.set(match.id, match);
  });

  games.forEach((game) => {
    if (!matchMap.has(game.match_id)) {
      return;
    }

    const current =
      totalsByMatch.get(game.match_id) ?? {
        p1Wins: 0,
        p2Wins: 0,
        p1Points: 0,
        p2Points: 0,
        totalGames: 0
      };

    current.p1Points += game.player1_score;
    current.p2Points += game.player2_score;

    if (game.player1_score > game.player2_score) {
      current.p1Wins += 1;
      current.totalGames += 1;
    } else if (game.player2_score > game.player1_score) {
      current.p2Wins += 1;
      current.totalGames += 1;
    }

    totalsByMatch.set(game.match_id, current);
  });

  return totalsByMatch;
};

export const calculateEloRatings = (
  matches: MatchRow[],
  matchTotals: Map<string, MatchGameTotals>,
  seedPlayerIds: string[] = []
) => {
  const states = new Map<string, EloState>();

  const ensureState = (playerId: string) => {
    const existing = states.get(playerId);
    if (existing) {
      return existing;
    }
    const state = {
      rating: eloConfig.baseline,
      matchesPlayed: 0
    };
    states.set(playerId, state);
    return state;
  };

  seedPlayerIds.forEach((playerId) => {
    ensureState(playerId);
  });

  const orderedMatches = [...matches].sort(compareMatches);

  orderedMatches.forEach((match) => {
    const totals = matchTotals.get(match.id);
    if (!totals || totals.totalGames <= 0) {
      return;
    }

    const player1 = ensureState(match.player1_id);
    const player2 = ensureState(match.player2_id);

    const score1 = totals.p1Wins / totals.totalGames;
    const score2 = totals.p2Wins / totals.totalGames;
    const expected1 = expectedScore(player1.rating, player2.rating);
    const expected2 = 1 - expected1;
    const formatWeight = resolveFormatWeight(match.match_format);

    const k1 = kForMatchesPlayed(player1.matchesPlayed) * formatWeight;
    const k2 = kForMatchesPlayed(player2.matchesPlayed) * formatWeight;

    player1.rating = Math.max(
      eloConfig.floor,
      player1.rating + k1 * (score1 - expected1)
    );
    player2.rating = Math.max(
      eloConfig.floor,
      player2.rating + k2 * (score2 - expected2)
    );

    player1.matchesPlayed += 1;
    player2.matchesPlayed += 1;
  });

  const ratings = new Map<string, number>();
  states.forEach((state, playerId) => {
    ratings.set(playerId, state.rating);
  });

  return ratings;
};

export const calculateEloDeltasForPlayer = (
  matches: MatchRow[],
  matchTotals: Map<string, MatchGameTotals>,
  playerId: string,
  seedPlayerIds: string[] = []
) => {
  const states = new Map<string, EloState>();
  const deltas = new Map<string, number>();

  const ensureState = (id: string) => {
    const existing = states.get(id);
    if (existing) {
      return existing;
    }
    const state = {
      rating: eloConfig.baseline,
      matchesPlayed: 0
    };
    states.set(id, state);
    return state;
  };

  seedPlayerIds.forEach((id) => {
    ensureState(id);
  });

  if (playerId) {
    ensureState(playerId);
  }

  const orderedMatches = [...matches].sort(compareMatches);

  orderedMatches.forEach((match) => {
    const totals = matchTotals.get(match.id);
    if (!totals || totals.totalGames <= 0) {
      return;
    }

    const player1 = ensureState(match.player1_id);
    const player2 = ensureState(match.player2_id);

    const score1 = totals.p1Wins / totals.totalGames;
    const score2 = totals.p2Wins / totals.totalGames;
    const expected1 = expectedScore(player1.rating, player2.rating);
    const expected2 = 1 - expected1;
    const formatWeight = resolveFormatWeight(match.match_format);

    const k1 = kForMatchesPlayed(player1.matchesPlayed) * formatWeight;
    const k2 = kForMatchesPlayed(player2.matchesPlayed) * formatWeight;

    const next1 = Math.max(eloConfig.floor, player1.rating + k1 * (score1 - expected1));
    const next2 = Math.max(eloConfig.floor, player2.rating + k2 * (score2 - expected2));

    if (match.player1_id === playerId) {
      deltas.set(match.id, next1 - player1.rating);
    } else if (match.player2_id === playerId) {
      deltas.set(match.id, next2 - player2.rating);
    }

    player1.rating = next1;
    player2.rating = next2;
    player1.matchesPlayed += 1;
    player2.matchesPlayed += 1;
  });

  return deltas;
};
