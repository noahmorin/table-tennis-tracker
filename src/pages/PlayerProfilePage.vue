<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getProfileById, listProfiles } from '../lib/data/profiles';
import { listMatches } from '../lib/data/matches';
import { listGamesByMatchIds } from '../lib/data/games';
import type { GameRow, MatchRow, ProfileRow } from '../lib/data/types';
import {
  buildMatchGameTotals,
  calculateEloDeltasForPlayer,
  calculateEloMatchStates,
  calculateEloRatings
} from '../lib/elo';
import { eloConfig } from '../config/eloConfig';

type TabId = 'overview' | 'matches' | 'elo' | 'streaks' | 'points';
type DateFilterOption = 'all' | '30' | '60' | '90';
const MIN_MATCHES_FOR_ELO_DISPLAY = 3;
const gamesByFormat: Record<MatchRow['match_format'], number> = {
  bo1: 1,
  bo3: 3,
  bo5: 5,
  bo7: 7
};

const resolveMaxGames = (format: MatchRow['match_format']) => gamesByFormat[format] ?? 3;

const isDeuceGame = (game: GameRow) => {
  const minScore = Math.min(game.player1_score, game.player2_score);
  const maxScore = Math.max(game.player1_score, game.player2_score);
  return minScore >= 10 && maxScore - minScore === 2;
};

type OpponentSummary = {
  id: string;
  wins: number;
  losses: number;
  matches: number;
  winPct: number;
};

type RecentMatchSummary = {
  id: string;
  date: string;
  opponentId: string;
  opponentName: string;
  outcome: 'W' | 'L';
  score: string;
};

type EloPoint = {
  matchId: string;
  date: string;
  value: number;
};

type RecentOutcome = {
  outcome: 'W' | 'L';
  date: string;
};

type StatTile = {
  label: string;
  value: string;
  meta?: string;
};

const route = useRoute();
const router = useRouter();

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
  { id: 'elo', label: 'Elo Trend' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'points', label: 'Points' }
];

const activeTab = ref<TabId>('overview');
const dateFilter = ref<DateFilterOption>('all');

const loading = ref(false);
const error = ref<string | null>(null);
const profile = ref<ProfileRow | null>(null);
const profiles = ref<ProfileRow[]>([]);
const matches = ref<MatchRow[]>([]);
const games = ref<GameRow[]>([]);

const targetPlayerId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));

const playerMap = computed(() => {
  const map = new Map<string, ProfileRow>();
  profiles.value.forEach((player) => {
    map.set(player.id, player);
  });
  return map;
});

const formatPlayerLabel = (player: ProfileRow) => {
  const base = player.display_name?.trim() || player.username;
  return player.is_active ? base : `${base} (inactive)`;
};

const resolveOpponentName = (id: string) => {
  const player = playerMap.value.get(id);
  if (!player) {
    return 'Unknown player';
  }
  return formatPlayerLabel(player);
};

const playerDisplayName = computed(() => profile.value?.display_name?.trim() || 'Player');
const playerUsername = computed(() => profile.value?.username?.trim() || '');

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

const formatDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateRange = computed(() => {
  if (dateFilter.value === 'all') {
    return { from: null as string | null, to: null as string | null };
  }
  const days = Number(dateFilter.value);
  const today = new Date();
  const fromDate = new Date();
  fromDate.setDate(today.getDate() - days);
  return { from: formatDateInput(fromDate), to: formatDateInput(today) };
});

const formatDate = (value: string) => {
  if (!value) {
    return '';
  }
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const formatNumber = (value: number, decimals = 0) => {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(decimals);
};

const formatSigned = (value: number, decimals = 0) => {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
};

const formatPct = (value: number, total: number) => {
  if (!total) {
    return '-';
  }
  return `${(value * 100).toFixed(1)}%`;
};

const dateRangeLabel = computed(() => {
  if (dateFilter.value === 'all') {
    return 'All time';
  }
  const range = dateRange.value;
  if (!range.from || !range.to) {
    return 'All time';
  }
  return `${formatDate(range.from)} - ${formatDate(range.to)}`;
});

const filteredMatches = computed(() => {
  const range = dateRange.value;
  if (!range.from || !range.to) {
    return matches.value;
  }
  return matches.value.filter(
    (match) => match.match_date >= range.from! && match.match_date <= range.to!
  );
});

const stats = computed(() => {
  const targetId = targetPlayerId.value;
  if (!targetId) {
    return {
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winPct: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesDiff: 0,
      gamesWinPct: 0,
      straightGameWins: 0,
      decidingGameWins: 0,
      decidingGameLosses: 0,
      decidingMatches: 0,
      comebackWins: 0,
      blownLeads: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      avgPointDiffPerGame: Number.NaN,
      avgPointDiffPerMatch: Number.NaN,
      avgMarginVictory: Number.NaN,
      avgMarginLoss: Number.NaN,
      avgPointsForPerGame: Number.NaN,
      avgPointsAgainstPerGame: Number.NaN,
      maxPointDiff: Number.NaN,
      bestWinMargin: Number.NaN,
      worstLossMargin: Number.NaN,
      deuceGames: 0,
      deuceWins: 0,
      currentStreakType: null as 'W' | 'L' | null,
      currentStreakCount: 0,
      currentWinStreak: 0,
      currentLossStreak: 0,
      longestWinStreak: 0,
      longestLossStreak: 0,
      winsLast5: 0,
      winsLast10: 0,
      bestOpponent: null as OpponentSummary | null,
      worstOpponent: null as OpponentSummary | null,
      recentMatches: [] as RecentMatchSummary[],
      recentOutcomes: [] as RecentOutcome[],
      eloSeries: [] as EloPoint[],
      eloDeltas: new Map<string, number>(),
      eloByPlayer: new Map<string, number>(),
      matchCountsByPlayer: new Map<string, number>(),
      currentElo: Number.NaN,
      highestElo: Number.NaN,
      lowestElo: Number.NaN,
      lastMatchEloChange: Number.NaN,
      lastTenMatchEloChange: Number.NaN,
      avgEloChange: Number.NaN,
      totalMatchesRated: 0,
      lastMatchDate: ''
    };
  }

  const matchList = filteredMatches.value;
  const totalsByMatch = buildMatchGameTotals(matchList, games.value);
  const seededPlayerIds = profiles.value.map((player) => player.id);
  const eloByPlayer = calculateEloRatings(matchList, totalsByMatch, seededPlayerIds);
  const eloMatchStates = calculateEloMatchStates(matchList, totalsByMatch, seededPlayerIds);
  const eloStateByMatchId = new Map(eloMatchStates.map((state) => [state.matchId, state]));
  const matchCountsByPlayer = new Map<string, number>();
  const gamesByMatchId = new Map<string, GameRow[]>();

  matchList.forEach((match) => {
    const totals = totalsByMatch.get(match.id);
    if (!totals || totals.totalGames <= 0) {
      return;
    }
    matchCountsByPlayer.set(match.player1_id, (matchCountsByPlayer.get(match.player1_id) ?? 0) + 1);
    matchCountsByPlayer.set(match.player2_id, (matchCountsByPlayer.get(match.player2_id) ?? 0) + 1);
  });

  games.value.forEach((game) => {
    const list = gamesByMatchId.get(game.match_id);
    if (list) {
      list.push(game);
    } else {
      gamesByMatchId.set(game.match_id, [game]);
    }
  });
  gamesByMatchId.forEach((list) => list.sort((a, b) => a.game_number - b.game_number));
  const targetMatches = matchList.filter(
    (match) => match.player1_id === targetId || match.player2_id === targetId
  );
  const orderedTargetMatches = [...targetMatches].sort(compareMatches);

  let matchesPlayed = 0;
  let wins = 0;
  let losses = 0;
  let gamesWon = 0;
  let gamesLost = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let totalGames = 0;
  let winPointDiffTotal = 0;
  let lossPointDiffTotal = 0;
  let maxPointDiff = Number.NEGATIVE_INFINITY;
  let bestWinMargin = Number.NEGATIVE_INFINITY;
  let worstLossMargin = Number.POSITIVE_INFINITY;
  let straightGameWins = 0;
  let decidingGameWins = 0;
  let decidingGameLosses = 0;
  let decidingMatches = 0;
  let comebackWins = 0;
  let blownLeads = 0;
  let deuceGames = 0;
  let deuceWins = 0;
  let deuceMarginTotal = 0;

  const opponentMap = new Map<
    string,
    {
      id: string;
      wins: number;
      losses: number;
      matches: number;
      gamesWon: number;
      gamesLost: number;
      pointsFor: number;
      pointsAgainst: number;
    }
  >();
  const opponentStrength = new Map<string, { maxElo: number; minElo: number }>();

  const results: Array<{
    match: MatchRow;
    outcome: 'W' | 'L';
    wins: number;
    losses: number;
    pointsFor: number;
    pointsAgainst: number;
  }> = [];

  orderedTargetMatches.forEach((match) => {
    const totals = totalsByMatch.get(match.id);
    if (!totals || totals.totalGames <= 0) {
      return;
    }

    const isPlayer1 = match.player1_id === targetId;
    const matchWins = isPlayer1 ? totals.p1Wins : totals.p2Wins;
    const matchLosses = isPlayer1 ? totals.p2Wins : totals.p1Wins;
    const matchPointsFor = isPlayer1 ? totals.p1Points : totals.p2Points;
    const matchPointsAgainst = isPlayer1 ? totals.p2Points : totals.p1Points;

    matchesPlayed += 1;
    gamesWon += matchWins;
    gamesLost += matchLosses;
    pointsFor += matchPointsFor;
    pointsAgainst += matchPointsAgainst;
    totalGames += totals.totalGames;

    const pointDiff = matchPointsFor - matchPointsAgainst;
    maxPointDiff = Math.max(maxPointDiff, pointDiff);

    const outcome: 'W' | 'L' = matchWins >= matchLosses ? 'W' : 'L';
    const maxGames = resolveMaxGames(match.match_format);
    const isDecidingMatch = totals.totalGames === maxGames;
    if (outcome === 'W') {
      wins += 1;
      winPointDiffTotal += pointDiff;
      bestWinMargin = Math.max(bestWinMargin, pointDiff);
      if (matchLosses === 0) {
        straightGameWins += 1;
      }
    } else {
      losses += 1;
      worstLossMargin = Math.min(worstLossMargin, pointDiff);
      lossPointDiffTotal += pointDiff;
    }

    if (isDecidingMatch) {
      decidingMatches += 1;
      if (outcome === 'W') {
        decidingGameWins += 1;
      } else {
        decidingGameLosses += 1;
      }
    }

    results.push({
      match,
      outcome,
      wins: matchWins,
      losses: matchLosses,
      pointsFor: matchPointsFor,
      pointsAgainst: matchPointsAgainst
    });

    const matchGames = gamesByMatchId.get(match.id);
    if (matchGames && matchGames.length) {
      const firstGame = matchGames[0];
      const firstGameWon = isPlayer1
        ? firstGame.player1_score > firstGame.player2_score
        : firstGame.player2_score > firstGame.player1_score;
      if (outcome === 'W' && !firstGameWon) {
        comebackWins += 1;
      }
      if (outcome === 'L' && firstGameWon) {
        blownLeads += 1;
      }

      matchGames.forEach((game) => {
        if (!isDeuceGame(game)) {
          return;
        }
        deuceGames += 1;
        const deuceWin = isPlayer1
          ? game.player1_score > game.player2_score
          : game.player2_score > game.player1_score;
        if (deuceWin) {
          deuceWins += 1;
        }
        const margin = isPlayer1
          ? game.player1_score - game.player2_score
          : game.player2_score - game.player1_score;
        deuceMarginTotal += margin;
      });
    }

    const opponentId = isPlayer1 ? match.player2_id : match.player1_id;
    const record =
      opponentMap.get(opponentId) ?? {
        id: opponentId,
        wins: 0,
        losses: 0,
        matches: 0,
        gamesWon: 0,
        gamesLost: 0,
        pointsFor: 0,
        pointsAgainst: 0
      };

    record.matches += 1;
    if (outcome === 'W') {
      record.wins += 1;
    } else {
      record.losses += 1;
    }
    record.gamesWon += matchWins;
    record.gamesLost += matchLosses;
    record.pointsFor += matchPointsFor;
    record.pointsAgainst += matchPointsAgainst;

    opponentMap.set(opponentId, record);

    const eloState = eloStateByMatchId.get(match.id);
    if (eloState) {
      const opponentElo = isPlayer1 ? eloState.pre2 : eloState.pre1;
      const opponentPreMatches = isPlayer1 ? eloState.preMatches2 : eloState.preMatches1;
      if (opponentPreMatches < MIN_MATCHES_FOR_ELO_DISPLAY) {
        return;
      }
      const strength = opponentStrength.get(opponentId) ?? {
        maxElo: opponentElo,
        minElo: opponentElo
      };
      strength.maxElo = Math.max(strength.maxElo, opponentElo);
      strength.minElo = Math.min(strength.minElo, opponentElo);
      opponentStrength.set(opponentId, strength);
    }
  });

  const winPct = matchesPlayed ? wins / matchesPlayed : 0;
  const gamesPlayed = gamesWon + gamesLost;
  const gamesWinPct = gamesPlayed ? gamesWon / gamesPlayed : 0;
  const gamesDiff = gamesWon - gamesLost;
  const pointDiff = pointsFor - pointsAgainst;

  const avgPointDiffPerGame = totalGames ? pointDiff / totalGames : Number.NaN;
  const avgPointDiffPerMatch = matchesPlayed ? pointDiff / matchesPlayed : Number.NaN;
  const avgMarginVictory = wins ? winPointDiffTotal / wins : Number.NaN;
  const avgMarginLoss = losses ? lossPointDiffTotal / losses : Number.NaN;
  const avgPointsForPerGame = totalGames ? pointsFor / totalGames : Number.NaN;
  const avgPointsAgainstPerGame = totalGames ? pointsAgainst / totalGames : Number.NaN;
  const safeBestWinMargin = Number.isFinite(bestWinMargin) ? bestWinMargin : Number.NaN;
  const safeWorstLossMargin = Number.isFinite(worstLossMargin) ? worstLossMargin : Number.NaN;

  let currentStreakType: 'W' | 'L' | null = null;
  let currentStreakCount = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let runningType: 'W' | 'L' | null = null;
  let runningCount = 0;

  results.forEach(({ outcome }) => {
    if (runningType === outcome) {
      runningCount += 1;
    } else {
      runningType = outcome;
      runningCount = 1;
    }

    if (runningType === 'W') {
      longestWinStreak = Math.max(longestWinStreak, runningCount);
    } else if (runningType === 'L') {
      longestLossStreak = Math.max(longestLossStreak, runningCount);
    }
  });

  if (runningType) {
    currentStreakType = runningType;
    currentStreakCount = runningCount;
  }

  const currentWinStreak = currentStreakType === 'W' ? currentStreakCount : 0;
  const currentLossStreak = currentStreakType === 'L' ? currentStreakCount : 0;
  const recentResults = results.slice(-10);
  const winsLast10 = recentResults.filter((entry) => entry.outcome === 'W').length;
  const winsLast5 = recentResults.slice(-5).filter((entry) => entry.outcome === 'W').length;

  const opponentSummaries: OpponentSummary[] = Array.from(opponentMap.values()).map((record) => ({
    id: record.id,
    wins: record.wins,
    losses: record.losses,
    matches: record.matches,
    winPct: record.matches ? record.wins / record.matches : 0
  }));

  const bestOpponent = opponentSummaries.reduce<OpponentSummary | null>((best, current) => {
    const currentStrength = opponentStrength.get(current.id);
    if (!currentStrength) {
      return best;
    }
    if (!best) {
      return current;
    }
    const bestStrength = opponentStrength.get(best.id);
    if (!bestStrength) {
      return current;
    }
    if (currentStrength.maxElo > bestStrength.maxElo) {
      return current;
    }
    if (currentStrength.maxElo === bestStrength.maxElo && current.matches > best.matches) {
      return current;
    }
    if (
      currentStrength.maxElo === bestStrength.maxElo &&
      current.matches === best.matches &&
      current.id < best.id
    ) {
      return current;
    }
    return best;
  }, null);

  const worstOpponent = opponentSummaries.reduce<OpponentSummary | null>((worst, current) => {
    const currentStrength = opponentStrength.get(current.id);
    if (!currentStrength) {
      return worst;
    }
    if (!worst) {
      return current;
    }
    const worstStrength = opponentStrength.get(worst.id);
    if (!worstStrength) {
      return current;
    }
    if (currentStrength.minElo < worstStrength.minElo) {
      return current;
    }
    if (currentStrength.minElo === worstStrength.minElo && current.matches > worst.matches) {
      return current;
    }
    if (
      currentStrength.minElo === worstStrength.minElo &&
      current.matches === worst.matches &&
      current.id < worst.id
    ) {
      return current;
    }
    return worst;
  }, null);

  const hasElo = matchesPlayed >= MIN_MATCHES_FOR_ELO_DISPLAY;
  const deltas = hasElo
    ? calculateEloDeltasForPlayer(matchList, totalsByMatch, targetId)
    : new Map<string, number>();
  let rating = eloConfig.baseline;
  const eloSeries: EloPoint[] = [];

  if (hasElo) {
    const orderedAllMatches = [...matchList].sort(compareMatches);

    orderedAllMatches.forEach((match) => {
      const delta = deltas.get(match.id);
      if (delta === undefined) {
        return;
      }
      rating += delta;
      eloSeries.push({
        matchId: match.id,
        date: match.match_date,
        value: rating
      });
    });
  }

  const currentElo = eloSeries.length ? eloSeries[eloSeries.length - 1].value : Number.NaN;
  const highestElo = eloSeries.length ? Math.max(...eloSeries.map((point) => point.value)) : Number.NaN;
  const lowestElo = eloSeries.length ? Math.min(...eloSeries.map((point) => point.value)) : Number.NaN;
  let lastMatchEloChange = Number.NaN;
  let lastTenMatchEloChange = Number.NaN;
  let avgEloChange = Number.NaN;
  let totalMatchesRated = Number.NaN;

  if (hasElo) {
    const ratedTargetMatches = orderedTargetMatches
      .map((match) => ({ match, delta: deltas.get(match.id) }))
      .filter((entry): entry is { match: MatchRow; delta: number } => entry.delta !== undefined);
    totalMatchesRated = ratedTargetMatches.length;
    if (ratedTargetMatches.length) {
      const totalDelta = ratedTargetMatches.reduce((sum, entry) => sum + entry.delta, 0);
      avgEloChange = totalDelta / ratedTargetMatches.length;
      lastMatchEloChange = ratedTargetMatches[ratedTargetMatches.length - 1].delta;
      const lastTen = ratedTargetMatches.slice(-10);
      lastTenMatchEloChange = lastTen.reduce((sum, entry) => sum + entry.delta, 0);
    }
  }

  const recentMatches: RecentMatchSummary[] = [...results]
    .reverse()
    .slice(0, 5)
    .map((entry) => {
      const opponentId =
        entry.match.player1_id === targetId ? entry.match.player2_id : entry.match.player1_id;
      return {
        id: entry.match.id,
        date: formatDate(entry.match.match_date),
        opponentId,
        opponentName: resolveOpponentName(opponentId),
        outcome: entry.outcome,
        score: `${entry.wins}-${entry.losses}`
      };
    });

  const recentOutcomes: RecentOutcome[] = [...results]
    .reverse()
    .slice(0, 8)
    .map((entry) => ({
      outcome: entry.outcome,
      date: formatDate(entry.match.match_date)
    }));

  const lastMatchDate = results.length
    ? formatDate(results[results.length - 1].match.match_date)
    : '';

  return {
    matchesPlayed,
    wins,
    losses,
    winPct,
    gamesWon,
    gamesLost,
    gamesDiff,
    gamesWinPct,
    straightGameWins,
    decidingGameWins,
    decidingGameLosses,
    decidingMatches,
    comebackWins,
    blownLeads,
    pointsFor,
    pointsAgainst,
    pointDiff,
    avgPointDiffPerGame,
    avgPointDiffPerMatch,
    avgMarginVictory,
    avgMarginLoss,
    avgPointsForPerGame,
    avgPointsAgainstPerGame,
    maxPointDiff: Number.isFinite(maxPointDiff) ? maxPointDiff : Number.NaN,
    bestWinMargin: safeBestWinMargin,
    worstLossMargin: safeWorstLossMargin,
    deuceGames,
    deuceWins,
    currentStreakType,
    currentStreakCount,
    currentWinStreak,
    currentLossStreak,
    longestWinStreak,
    longestLossStreak,
    winsLast5,
    winsLast10,
    bestOpponent,
    worstOpponent,
    recentMatches,
    recentOutcomes,
    eloSeries,
    eloDeltas: deltas,
    eloByPlayer,
    matchCountsByPlayer,
    currentElo,
    highestElo,
    lowestElo,
    lastMatchEloChange,
    lastTenMatchEloChange,
    avgEloChange,
    totalMatchesRated,
    lastMatchDate
  };
});

const currentStreakLabel = computed(() => {
  if (!stats.value.currentStreakCount || !stats.value.currentStreakType) {
    return '-';
  }
  return `${stats.value.currentStreakType}${stats.value.currentStreakCount}`;
});

const matchEloDelta = (matchId: string) => stats.value.eloDeltas.get(matchId);

const matchEloDeltaLabel = (matchId: string) => {
  const delta = matchEloDelta(matchId);
  if (delta === undefined) {
    return null;
  }
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? '+' : '';
  return `Elo ${sign}${rounded}`;
};

const matchEloDeltaClass = (matchId: string) => {
  const delta = matchEloDelta(matchId);
  if (delta === undefined) {
    return '';
  }
  const rounded = Math.round(delta);
  if (rounded > 0) {
    return 'is-gain';
  }
  if (rounded < 0) {
    return 'is-loss';
  }
  return 'is-flat';
};

const opponentMetaLabel = (summary: OpponentSummary | null) => {
  if (!summary) {
    return '';
  }
  const matchesPlayed = stats.value.matchCountsByPlayer.get(summary.id) ?? 0;
  if (matchesPlayed < MIN_MATCHES_FOR_ELO_DISPLAY) {
    return `Elo - · ${summary.wins}-${summary.losses}`;
  }
  const eloValue = stats.value.eloByPlayer.get(summary.id);
  const eloLabel = Number.isFinite(eloValue ?? NaN)
    ? `Elo ${formatNumber(Math.round(eloValue as number))}`
    : 'Elo -';
  return `${eloLabel} · ${summary.wins}-${summary.losses}`;
};

const heroRecordLabel = computed(() => `${stats.value.wins}-${stats.value.losses}`);
const heroEloLabel = computed(() => formatNumber(Math.round(stats.value.currentElo)));
const heroMatchesLabel = computed(() => formatNumber(stats.value.matchesPlayed));
const hasEloForDisplay = computed(() => stats.value.matchesPlayed >= MIN_MATCHES_FOR_ELO_DISPLAY);

const overviewTiles = computed<StatTile[]>(() => {
  const best = stats.value.bestOpponent;
  const worst = stats.value.worstOpponent;
  const decidingWinRate = stats.value.decidingMatches
    ? stats.value.decidingGameWins / stats.value.decidingMatches
    : 0;

  return [
    {
      label: 'Matches played',
      value: formatNumber(stats.value.matchesPlayed)
    },
    {
      label: 'Match W-L',
      value: heroRecordLabel.value
    },
    {
      label: 'Win %',
      value: formatPct(stats.value.winPct, stats.value.matchesPlayed)
    },
    {
      label: 'Current Elo',
      value: formatNumber(Math.round(stats.value.currentElo))
    },
    {
      label: 'Peak Elo',
      value: formatNumber(Math.round(stats.value.highestElo))
    },
    {
      label: 'Game diff',
      value: formatSigned(stats.value.gamesDiff)
    },
    {
      label: 'Point diff',
      value: formatSigned(stats.value.pointDiff)
    },
    {
      label: 'Deciding-game win %',
      value: formatPct(decidingWinRate, stats.value.decidingMatches)
    },
    {
      label: 'Best opponent',
      value: best ? resolveOpponentName(best.id) : '-'
    },
    {
      label: 'Worst opponent',
      value: worst ? resolveOpponentName(worst.id) : '-'
    },
    {
      label: 'Last match',
      value: stats.value.lastMatchDate || '-'
    }
  ];
});

const matchesSummaryTiles = computed<StatTile[]>(() => {
  const decidingRate = stats.value.matchesPlayed
    ? stats.value.decidingMatches / stats.value.matchesPlayed
    : 0;

  return [
    {
      label: 'Games W-L',
      value: `${stats.value.gamesWon}-${stats.value.gamesLost}`
    },
    {
      label: 'Straight-game wins',
      value: formatNumber(stats.value.straightGameWins)
    },
    {
      label: 'Deciding-game wins',
      value: formatNumber(stats.value.decidingGameWins)
    },
    {
      label: 'Deciding-game losses',
      value: formatNumber(stats.value.decidingGameLosses)
    },
    {
      label: 'Deciding-game rate',
      value: formatPct(decidingRate, stats.value.matchesPlayed)
    },
    {
      label: 'Comeback wins',
      value: formatNumber(stats.value.comebackWins)
    },
    {
      label: 'Blown leads',
      value: formatNumber(stats.value.blownLeads)
    }
  ];
});

const eloTiles = computed<StatTile[]>(() => [
  {
    label: 'Current Elo',
    value: formatNumber(Math.round(stats.value.currentElo))
  },
  {
    label: 'Peak Elo',
    value: formatNumber(Math.round(stats.value.highestElo))
  },
  {
    label: 'Lowest Elo',
    value: formatNumber(Math.round(stats.value.lowestElo))
  },
  {
    label: 'Elo change (last match)',
    value: formatSigned(stats.value.lastMatchEloChange, 1)
  },
  {
    label: 'Elo change (last 10)',
    value: formatSigned(stats.value.lastTenMatchEloChange, 1)
  },
  {
    label: 'Avg Elo change / match',
    value: formatSigned(stats.value.avgEloChange, 1)
  },
  {
    label: 'Matches rated',
    value: formatNumber(stats.value.totalMatchesRated)
  }
]);

const streakTiles = computed<StatTile[]>(() => [
  {
    label: 'Current streak',
    value: currentStreakLabel.value
  },
  {
    label: 'Current win streak',
    value: stats.value.currentWinStreak ? formatNumber(stats.value.currentWinStreak) : '-'
  },
  {
    label: 'Current losing streak',
    value: stats.value.currentLossStreak ? formatNumber(stats.value.currentLossStreak) : '-'
  },
  {
    label: 'Longest win streak',
    value: stats.value.longestWinStreak ? formatNumber(stats.value.longestWinStreak) : '-'
  },
  {
    label: 'Longest losing streak',
    value: stats.value.longestLossStreak ? formatNumber(stats.value.longestLossStreak) : '-'
  },
  {
    label: 'Wins (last 5)',
    value: formatNumber(stats.value.winsLast5)
  },
  {
    label: 'Wins (last 10)',
    value: formatNumber(stats.value.winsLast10)
  }
]);

  const pointsTiles = computed<StatTile[]>(() => {
  const gamesPlayed = stats.value.gamesWon + stats.value.gamesLost;
  const deuceRate = gamesPlayed ? stats.value.deuceGames / gamesPlayed : 0;
  const deuceWinRate = stats.value.deuceGames ? stats.value.deuceWins / stats.value.deuceGames : 0;

  return [
    {
      label: 'Points won',
      value: formatNumber(stats.value.pointsFor)
    },
    {
      label: 'Points lost',
      value: formatNumber(stats.value.pointsAgainst)
    },
    {
      label: 'Point diff',
      value: formatSigned(stats.value.pointDiff)
    },
    {
      label: 'Avg points won / game',
      value: formatNumber(stats.value.avgPointsForPerGame, 1)
    },
    {
      label: 'Avg points lost / game',
      value: formatNumber(stats.value.avgPointsAgainstPerGame, 1)
    },
    {
      label: 'Avg point margin / game',
      value: formatSigned(stats.value.avgPointDiffPerGame, 1)
    },
    {
      label: 'Avg point margin / match',
      value: formatSigned(stats.value.avgPointDiffPerMatch, 1)
    },
    {
      label: 'Avg margin (wins)',
      value: formatSigned(stats.value.avgMarginVictory, 1)
    },
    {
      label: 'Avg margin (losses)',
      value: formatSigned(stats.value.avgMarginLoss, 1)
    },
    {
      label: 'Deuce games',
      value: formatNumber(stats.value.deuceGames)
    },
    {
      label: 'Deuce rate',
      value: formatPct(deuceRate, gamesPlayed)
    },
    {
      label: 'Deuce win rate',
      value: formatPct(deuceWinRate, stats.value.deuceGames)
    },
    {
      label: 'Best win margin',
      value: formatSigned(stats.value.bestWinMargin)
    },
    {
      label: 'Worst loss margin',
      value: formatSigned(stats.value.worstLossMargin)
    }
  ];
});

const sparkline = computed(() => {
  const series = stats.value.eloSeries;
  if (!series.length) {
    return null;
  }

  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const range = Math.max(max - min, 1);

  const width = 120;
  const height = 48;
  const padding = 6;
  const span = Math.max(series.length - 1, 1);
  const step = (width - padding * 2) / span;

  const points = series.map((point, index) => {
    const x = padding + step * index;
    const normalized = (point.value - min) / range;
    const y = padding + (1 - normalized) * (height - padding * 2);
    return { x, y };
  });

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' ');

  const area = `${line} L${points[points.length - 1].x},${height - padding} L${points[0].x},${
    height - padding
  } Z`;

  const startLabel = formatDate(series[0].date);
  const endLabel = formatDate(series[series.length - 1].date);

  return {
    width,
    height,
    line,
    area,
    gridYTop: padding,
    gridYMid: padding + (height - padding * 2) / 2,
    gridYBottom: height - padding,
    minLabel: formatNumber(Math.round(min)),
    midLabel: formatNumber(Math.round(mid)),
    maxLabel: formatNumber(Math.round(max)),
    startLabel,
    endLabel,
    rangeLabel: `Date range: ${startLabel} - ${endLabel}`
  };
});

const loadData = async () => {
  if (!targetPlayerId.value) {
    return;
  }

  loading.value = true;
  error.value = null;
  profile.value = null;

  try {
    const profileResult = await getProfileById(targetPlayerId.value);
    if (profileResult.error) {
      error.value = profileResult.error;
      loading.value = false;
      return;
    }
    profile.value = profileResult.data;

    const profilesResult = await listProfiles({ includeInactive: true });
    if (profilesResult.error) {
      error.value = profilesResult.error;
      loading.value = false;
      return;
    }
    profiles.value = profilesResult.data ?? [];

    const matchesResult = await listMatches({ includeInactive: false });
    if (matchesResult.error) {
      error.value = matchesResult.error;
      loading.value = false;
      return;
    }
    matches.value = matchesResult.data ?? [];

    const matchIds = matches.value.map((match) => match.id);
    const gamesResult = await listGamesByMatchIds(matchIds, { includeInactive: false });
    if (gamesResult.error) {
      error.value = gamesResult.error;
      loading.value = false;
      return;
    }
    games.value = gamesResult.data ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unable to load profile.';
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (!targetPlayerId.value) {
    router.replace('/leaderboard');
    return;
  }
  loadData();
});

watch(
  () => route.params.id,
  () => {
    activeTab.value = 'overview';
    if (!targetPlayerId.value) {
      router.replace('/leaderboard');
      return;
    }
    loadData();
  }
);
</script>

<template>
  <section class="page">
    <header class="page-header profile-header">
      <div>
        <p class="eyebrow">Player profile</p>
        <h2>{{ playerDisplayName }}</h2>
        <p v-if="playerUsername" class="profile-username">@{{ playerUsername }}</p>
      </div>
      <router-link class="primary-btn profile-match-btn" :to="`/players/${targetPlayerId}/matches`">
        Match History
      </router-link>
    </header>

    <div class="profile-filters">
      <label class="field">
        <span>Stats range</span>
        <select v-model="dateFilter">
          <option value="all">All time</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </label>
    </div>

    <div v-if="loading" class="form-message">Loading profile...</div>
    <div v-else-if="error" class="form-message is-error">{{ error }}</div>

    <div v-else class="profile-body">
      <section class="profile-hero card">
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="hero-stat__label">Record</span>
            <span class="hero-stat__value">{{ heroRecordLabel }}</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat__label">Elo</span>
            <span class="hero-stat__value">{{ heroEloLabel }}</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat__label">Matches</span>
            <span class="hero-stat__value">{{ heroMatchesLabel }}</span>
          </div>
        </div>
        <div class="hero-subtext">
          <span>Win {{ formatPct(stats.winPct, stats.matchesPlayed) }}</span>
          <span>Games {{ stats.gamesWon }}-{{ stats.gamesLost }}</span>
          <span>Point diff {{ formatSigned(stats.pointDiff) }}</span>
        </div>
      </section>

      <nav class="profile-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-button"
          :class="{ 'is-active': activeTab === tab.id }"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <section v-if="activeTab === 'overview'" class="tab-panel">
        <div class="stat-grid">
          <article v-for="tile in overviewTiles" :key="tile.label" class="stat-tile">
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">{{ tile.value }}</p>
            <p v-if="tile.meta" class="stat-tile__meta">{{ tile.meta }}</p>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'matches'" class="tab-panel">
        <div class="stat-grid stat-grid--compact">
          <article v-for="tile in matchesSummaryTiles" :key="tile.label" class="stat-tile">
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">{{ tile.value }}</p>
          </article>
        </div>

        <article class="card">
          <header class="card-header">
            <h3>Recent matches</h3>
            <p class="card-subtext">Latest results for this player.</p>
          </header>

          <div v-if="!stats.recentMatches.length" class="form-message">No matches recorded yet.</div>

          <div v-else class="recent-list">
            <div v-for="match in stats.recentMatches" :key="match.id" class="recent-item">
              <div>
                <p class="recent-date">{{ match.date }}</p>
                <p class="recent-opponent">vs {{ match.opponentName }}</p>
              </div>
              <div class="recent-result">
                <span class="recent-score">{{ match.score }}</span>
                <div class="recent-pills">
                  <span
                    v-if="matchEloDeltaLabel(match.id)"
                    class="recent-elo"
                    :class="matchEloDeltaClass(match.id)"
                  >
                    {{ matchEloDeltaLabel(match.id) }}
                  </span>
                  <span class="recent-outcome" :class="match.outcome === 'W' ? 'is-win' : 'is-loss'">
                    {{ match.outcome === 'W' ? 'Win' : 'Loss' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'elo'" class="tab-panel">
        <article class="card">
          <header class="card-header">
            <h3>Elo over time</h3>
            <p class="card-subtext">Ordered by match date.</p>
          </header>

          <div class="elo-chart">
            <div v-if="sparkline" class="elo-chart__meta">
              <span class="elo-chart__range">{{ sparkline.rangeLabel }}</span>
              <span class="elo-chart__range">Elo values</span>
            </div>

            <div v-if="!hasEloForDisplay" class="form-message">Elo appears after 3 matches.</div>

            <div v-else-if="!sparkline" class="form-message">Not enough matches to plot Elo yet.</div>

            <div v-else class="elo-chart__frame">
              <div class="elo-axis elo-axis--y">
                <span>{{ sparkline.maxLabel }}</span>
                <span>{{ sparkline.midLabel }}</span>
                <span>{{ sparkline.minLabel }}</span>
              </div>
              <div class="elo-chart__plot">
                <svg :viewBox="`0 0 ${sparkline.width} ${sparkline.height}`" class="elo-chart__svg">
                  <defs>
                    <linearGradient id="eloFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stop-color="var(--brand-primary)" stop-opacity="0.35" />
                      <stop offset="100%" stop-color="var(--brand-primary)" stop-opacity="0.04" />
                    </linearGradient>
                  </defs>
                  <line
                    class="elo-chart__grid"
                    x1="0"
                    :y1="sparkline.gridYTop"
                    :x2="sparkline.width"
                    :y2="sparkline.gridYTop"
                  />
                  <line
                    class="elo-chart__grid"
                    x1="0"
                    :y1="sparkline.gridYMid"
                    :x2="sparkline.width"
                    :y2="sparkline.gridYMid"
                  />
                  <line
                    class="elo-chart__grid"
                    x1="0"
                    :y1="sparkline.gridYBottom"
                    :x2="sparkline.width"
                    :y2="sparkline.gridYBottom"
                  />
                  <path class="elo-chart__area" :d="sparkline.area" fill="url(#eloFill)" />
                  <path class="elo-chart__line" :d="sparkline.line" />
                </svg>
                <div class="elo-axis elo-axis--x">
                  <span>{{ sparkline.startLabel }}</span>
                  <span>{{ sparkline.endLabel }}</span>
                </div>
              </div>
            </div>
          </div>
        </article>

        <div class="stat-grid stat-grid--compact">
          <article v-for="tile in eloTiles" :key="tile.label" class="stat-tile">
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">{{ tile.value }}</p>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'streaks'" class="tab-panel">
        <div class="stat-grid stat-grid--compact">
          <article v-for="tile in streakTiles" :key="tile.label" class="stat-tile">
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">{{ tile.value }}</p>
          </article>
        </div>

        <article class="card">
          <header class="card-header">
            <h3>Recent results</h3>
            <p class="card-subtext">Last eight matches in order.</p>
          </header>

          <div v-if="!stats.recentOutcomes.length" class="form-message">No matches recorded yet.</div>

          <div v-else class="streak-row">
            <span
              v-for="(item, index) in stats.recentOutcomes"
              :key="`${item.date}-${index}`"
              class="streak-chip"
              :class="item.outcome === 'W' ? 'is-win' : 'is-loss'"
              :title="item.date"
            >
              {{ item.outcome }}
            </span>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'points'" class="tab-panel">
        <div class="stat-grid">
          <article v-for="tile in pointsTiles" :key="tile.label" class="stat-tile">
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">{{ tile.value }}</p>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}

.profile-filters {
  display: grid;
  gap: var(--space-xs);
  max-width: 240px;
}

.profile-filters__hint {
  font-size: 12px;
  color: var(--text-muted);
}

.profile-username {
  color: var(--text-muted);
  font-size: 14px;
}

.profile-match-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.profile-body {
  display: grid;
  gap: var(--space-xl);
}

.profile-hero {
  display: grid;
  gap: var(--space-sm);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-sm);
}

.hero-stat {
  background: var(--brand-tint-08);
  border-radius: var(--radius-control);
  padding: var(--space-sm) var(--space-md);
  display: grid;
  gap: 4px;
}

.hero-stat__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.hero-stat__value {
  font-size: 20px;
  font-weight: 700;
}

.hero-subtext {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  color: var(--text-muted);
  font-size: 13px;
}

.profile-tabs {
  display: flex;
  gap: var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-xs);
  overflow-x: auto;
}

.tab-button {
  background: transparent;
  border: none;
  padding: var(--space-xs) 0;
  font-weight: 600;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}

.tab-button.is-active {
  color: var(--text-primary);
  border-bottom-color: var(--brand-primary);
}

.tab-panel {
  display: grid;
  gap: var(--space-lg);
}

.stat-grid {
  display: grid;
  gap: var(--space-md);
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.stat-grid--compact {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.stat-tile {
  background: var(--surface-card);
  border-radius: var(--radius-control);
  padding: var(--space-md);
  border: 1px solid var(--brand-tint-08);
  display: grid;
  gap: 4px;
}

.stat-tile__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.stat-tile__value {
  font-size: 18px;
  font-weight: 700;
}

.stat-tile__meta {
  font-size: 12px;
  color: var(--text-muted);
}

.card-header {
  display: grid;
  gap: 4px;
  margin-bottom: var(--space-sm);
}

.card-subtext {
  color: var(--text-muted);
  font-size: 13px;
}

.recent-list {
  display: grid;
  gap: var(--space-sm);
}

.recent-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-date {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.recent-opponent {
  font-size: 14px;
  font-weight: 600;
}

.recent-result {
  text-align: right;
  display: grid;
  gap: 4px;
  justify-items: end;
}

.recent-pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.recent-score {
  font-size: 16px;
  font-weight: 700;
}

.recent-outcome {
  order: 2;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}

.recent-outcome.is-win {
  color: var(--status-success);
  background: var(--status-success-bg);
  border-color: var(--status-success-border);
}

.recent-outcome.is-loss {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}

.recent-elo {
  order: 1;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}

.recent-elo.is-gain {
  color: var(--status-success);
  background: var(--status-success-bg);
  border-color: var(--status-success-border);
}

.recent-elo.is-loss {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}

.recent-elo.is-flat {
  color: var(--text-muted);
  background: var(--surface-input);
  border-color: var(--border-subtle);
}

.elo-chart {
  background: var(--surface-input);
  border-radius: var(--radius-control);
  padding: var(--space-md);
  border: 1px dashed var(--brand-tint-20);
  display: grid;
  gap: var(--space-sm);
}

.elo-chart__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
}

.elo-chart__range {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.elo-chart__frame {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-sm);
  align-items: stretch;
}

.elo-chart__plot {
  display: grid;
  gap: var(--space-xs);
}

.elo-axis {
  font-size: 12px;
  color: var(--text-muted);
}

.elo-axis--y {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 44px;
  text-align: right;
  padding: 4px 0;
}

.elo-axis--x {
  display: flex;
  justify-content: space-between;
  padding: 0 var(--space-xs);
}

.elo-chart__svg {
  width: 100%;
  height: 180px;
}

.elo-chart__line {
  fill: none;
  stroke: var(--brand-primary);
  stroke-width: 2;
}

.elo-chart__area {
  stroke: none;
}

.elo-chart__grid {
  stroke: var(--border-subtle);
  stroke-dasharray: 4 4;
  stroke-width: 1;
  opacity: 0.6;
}

.streak-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.streak-chip {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.streak-chip.is-win {
  color: var(--status-success);
  background: var(--status-success-bg);
  border-color: var(--status-success-border);
}

.streak-chip.is-loss {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}

@media (min-width: 720px) {
  .profile-header {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .hero-stat__value {
    font-size: 22px;
  }
}
</style>
