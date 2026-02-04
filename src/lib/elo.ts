import type { GameRow, MatchFormat, MatchRow } from './data/types';
import { eloConfig } from '../config/eloConfig';

export type MatchGameTotals = {
  sideAWins: number;
  sideBWins: number;
  sideAPoints: number;
  sideBPoints: number;
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

const resolveK = () => (eloConfig.kFactor > 0 ? eloConfig.kFactor : 24);

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
        sideAWins: 0,
        sideBWins: 0,
        sideAPoints: 0,
        sideBPoints: 0,
        totalGames: 0
      };

    current.sideAPoints += game.side_a_score;
    current.sideBPoints += game.side_b_score;

    if (game.side_a_score > game.side_b_score) {
      current.sideAWins += 1;
      current.totalGames += 1;
    } else if (game.side_b_score > game.side_a_score) {
      current.sideBWins += 1;
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
      matchesPlayed: 0,
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

    const teamA = match.team_a ?? [];
    const teamB = match.team_b ?? [];
    if (!teamA.length || !teamB.length) {
      return;
    }

    const teamAStates = teamA.map((playerId) => ({
      id: playerId,
      state: ensureState(playerId)
    }));
    const teamBStates = teamB.map((playerId) => ({
      id: playerId,
      state: ensureState(playerId)
    }));

    const teamARating =
      teamAStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamAStates.length;
    const teamBRating =
      teamBStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamBStates.length;

    const scoreA = totals.sideAWins / totals.totalGames;
    const scoreB = totals.sideBWins / totals.totalGames;
    const expectedA = expectedScore(teamARating, teamBRating);
    const expectedB = 1 - expectedA;
    const formatWeight = resolveFormatWeight(match.match_format);
    const doublesMultiplier = match.match_type === 'doubles' ? eloConfig.doublesMultiplier : 1;

    const teamAK = resolveK() * formatWeight * doublesMultiplier;
    const teamBK = resolveK() * formatWeight * doublesMultiplier;

    const deltaA = teamAK * (scoreA - expectedA);
    const deltaB = teamBK * (scoreB - expectedB);

    teamAStates.forEach(({ state }) => {
      state.rating = Math.max(eloConfig.floor, state.rating + deltaA);
      state.matchesPlayed += 1;
    });
    teamBStates.forEach(({ state }) => {
      state.rating = Math.max(eloConfig.floor, state.rating + deltaB);
      state.matchesPlayed += 1;
    });
  });

  const ratings = new Map<string, number>();
  states.forEach((state, playerId) => {
    ratings.set(playerId, state.rating);
  });

  return ratings;
};

export type EloMatchState = {
  matchId: string;
  teamAIds: string[];
  teamBIds: string[];
  preRatings: Record<string, number>;
  preMatches: Record<string, number>;
  postRatings: Record<string, number>;
};

export const calculateEloMatchStates = (
  matches: MatchRow[],
  matchTotals: Map<string, MatchGameTotals>,
  seedPlayerIds: string[] = []
): EloMatchState[] => {
  const states = new Map<string, EloState>();
  const entries: EloMatchState[] = [];

  const ensureState = (playerId: string) => {
    const existing = states.get(playerId);
    if (existing) {
      return existing;
    }
    const state = {
      rating: eloConfig.baseline,
      matchesPlayed: 0,
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

    const teamA = match.team_a ?? [];
    const teamB = match.team_b ?? [];
    if (!teamA.length || !teamB.length) {
      return;
    }

    const teamAStates = teamA.map((playerId) => ({
      id: playerId,
      state: ensureState(playerId)
    }));
    const teamBStates = teamB.map((playerId) => ({
      id: playerId,
      state: ensureState(playerId)
    }));

    const preRatings: Record<string, number> = {};
    const preMatches: Record<string, number> = {};
    teamAStates.forEach(({ id, state }) => {
      preRatings[id] = state.rating;
      preMatches[id] = state.matchesPlayed;
    });
    teamBStates.forEach(({ id, state }) => {
      preRatings[id] = state.rating;
      preMatches[id] = state.matchesPlayed;
    });

    const teamARating =
      teamAStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamAStates.length;
    const teamBRating =
      teamBStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamBStates.length;

    const scoreA = totals.sideAWins / totals.totalGames;
    const scoreB = totals.sideBWins / totals.totalGames;
    const expectedA = expectedScore(teamARating, teamBRating);
    const expectedB = 1 - expectedA;
    const formatWeight = resolveFormatWeight(match.match_format);
    const doublesMultiplier = match.match_type === 'doubles' ? eloConfig.doublesMultiplier : 1;

    const teamAK = resolveK() * formatWeight * doublesMultiplier;
    const teamBK = resolveK() * formatWeight * doublesMultiplier;

    const deltaA = teamAK * (scoreA - expectedA);
    const deltaB = teamBK * (scoreB - expectedB);

    const postRatings: Record<string, number> = {};

    teamAStates.forEach(({ id, state }) => {
      const next = Math.max(eloConfig.floor, state.rating + deltaA);
      postRatings[id] = next;
      state.rating = next;
      state.matchesPlayed += 1;
    });
    teamBStates.forEach(({ id, state }) => {
      const next = Math.max(eloConfig.floor, state.rating + deltaB);
      postRatings[id] = next;
      state.rating = next;
      state.matchesPlayed += 1;
    });

    entries.push({
      matchId: match.id,
      teamAIds: teamA,
      teamBIds: teamB,
      preRatings,
      preMatches,
      postRatings
    });
  });

  return entries;
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
      matchesPlayed: 0,
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

    const teamA = match.team_a ?? [];
    const teamB = match.team_b ?? [];
    if (!teamA.length || !teamB.length) {
      return;
    }

    const teamAStates = teamA.map((id) => ({ id, state: ensureState(id) }));
    const teamBStates = teamB.map((id) => ({ id, state: ensureState(id) }));

    const teamARating =
      teamAStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamAStates.length;
    const teamBRating =
      teamBStates.reduce((sum, entry) => sum + entry.state.rating, 0) / teamBStates.length;

    const scoreA = totals.sideAWins / totals.totalGames;
    const scoreB = totals.sideBWins / totals.totalGames;
    const expectedA = expectedScore(teamARating, teamBRating);
    const expectedB = 1 - expectedA;
    const formatWeight = resolveFormatWeight(match.match_format);
    const doublesMultiplier = match.match_type === 'doubles' ? eloConfig.doublesMultiplier : 1;

    const teamAK = resolveK() * formatWeight * doublesMultiplier;
    const teamBK = resolveK() * formatWeight * doublesMultiplier;

    const deltaA = teamAK * (scoreA - expectedA);
    const deltaB = teamBK * (scoreB - expectedB);

    teamAStates.forEach(({ id, state }) => {
      const next = Math.max(eloConfig.floor, state.rating + deltaA);
      if (id === playerId) {
        deltas.set(match.id, next - state.rating);
      }
      state.rating = next;
      state.matchesPlayed += 1;
    });

    teamBStates.forEach(({ id, state }) => {
      const next = Math.max(eloConfig.floor, state.rating + deltaB);
      if (id === playerId) {
        deltas.set(match.id, next - state.rating);
      }
      state.rating = next;
      state.matchesPlayed += 1;
    });
  });

  return deltas;
};
