<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { getProfileById, listProfiles } from '../lib/data/profiles';
import { listMatches } from '../lib/data/matches';
import { listGamesByMatchIds } from '../lib/data/games';
import type { GameRow, MatchRow, ProfileRow } from '../lib/data/types';
import {
  buildMatchGameTotals,
  calculateEloDeltasForPlayer,
  calculateEloRatings
} from '../lib/elo';
import { eloConfig } from '../config/eloConfig';
import { useMatchMode } from '../stores/matchMode';

type TabId = 'overview' | 'matches' | 'elo' | 'streaks' | 'points';
type DateFilterOption = 'all' | '30' | '60' | '90';
const MIN_MATCHES_FOR_ELO_DISPLAY = 3;
const MIN_MATCHES_FOR_MATCHUP = 3;
const MIN_GAMES_FOR_PARTNER = 3;
const gamesByFormat: Record<MatchRow['match_format'], number> = {
  bo1: 1,
  bo3: 3,
  bo5: 5,
  bo7: 7
};

const resolveMaxGames = (format: MatchRow['match_format']) => gamesByFormat[format] ?? 3;

const isDeuceGame = (game: GameRow) => {
  const minScore = Math.min(game.side_a_score, game.side_b_score);
  const maxScore = Math.max(game.side_a_score, game.side_b_score);
  return minScore >= 10 && maxScore - minScore === 2;
};

type PlayerLinkPart = {
  id: string;
  label: string;
};

type OpponentSummary = {
  id: string;
  label: string;
  memberIds: string[];
  wins: number;
  losses: number;
  matches: number;
  winPct: number;
};

type PartnerSummary = {
  id: string;
  name: string;
  gamesPlayed: number;
  matches: number;
  wins: number;
  losses: number;
  winPct: number;
  avgPointDiff: number;
};

type RecentMatchSummary = {
  id: string;
  date: string;
  opponentIds: string[];
  opponentLabel: string;
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

type EloDeltaHighlight = {
  matchId: string;
  delta: number;
  matchDate: string;
};

type StatTile = {
  label: string;
  value: string | PlayerLinkPart[];
  valueSeparator?: string;
  meta?: string;
  to?: RouteLocationRaw;
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
const { matchMode, isDoubles, setMatchMode } = useMatchMode();

const loading = ref(false);
const error = ref<string | null>(null);
const profile = ref<ProfileRow | null>(null);
const profiles = ref<ProfileRow[]>([]);
const matches = ref<MatchRow[]>([]);
const games = ref<GameRow[]>([]);

const targetPlayerId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));

const matchDetailsLink = (matchId: string): RouteLocationRaw => ({
  path: `/players/${targetPlayerId.value}/matches`,
  query: { matchId }
});

const openMatchDetails = (matchId: string) => {
  router.push(matchDetailsLink(matchId));
};

const playerProfileLink = (playerId: string): RouteLocationRaw => ({
  path: `/players/${playerId}`
});

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

const buildPlayerLinkParts = (ids: string[]): PlayerLinkPart[] =>
  ids.filter(Boolean).map((id) => ({
    id,
    label: resolveOpponentName(id)
  }));

const buildPartnerLinkParts = (partners: PartnerSummary[]): PlayerLinkPart[] =>
  partners.map((partner) => ({
    id: partner.id,
    label: partner.name
  }));

const playerDisplayName = computed(() => profile.value?.display_name?.trim() || 'Player');
const playerUsername = computed(() => profile.value?.username?.trim() || '');

const resolveTeamIds = (match: MatchRow, side: 'A' | 'B') =>
  side === 'A' ? match.team_a ?? [] : match.team_b ?? [];

const resolvePlayerSide = (match: MatchRow, playerId: string) => {
  const teamA = match.team_a ?? [];
  if (teamA.includes(playerId)) {
    return 'A' as const;
  }
  const teamB = match.team_b ?? [];
  if (teamB.includes(playerId)) {
    return 'B' as const;
  }
  return null;
};

const resolveOpponentTeamIds = (match: MatchRow, playerId: string) => {
  const side = resolvePlayerSide(match, playerId);
  if (side === 'A') {
    return resolveTeamIds(match, 'B');
  }
  if (side === 'B') {
    return resolveTeamIds(match, 'A');
  }
  return [];
};

const formatTeamLabel = (ids: string[]) => {
  const labels = ids.map((id) => resolveOpponentName(id)).filter(Boolean);
  return labels.length ? labels.join(' & ') : 'Unknown team';
};

const buildTeamKey = (ids: string[]) => ids.slice().sort().join('|');

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
      partnerSummaries: [] as PartnerSummary[],
      mostFrequentPartner: null as PartnerSummary | null,
      bestPartner: null as PartnerSummary | null,
      worstPartner: null as PartnerSummary | null,
      mostSuccessfulPartner: null as PartnerSummary | null,
      positivePartners: [] as PartnerSummary[],
      negativePartners: [] as PartnerSummary[],
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
  const matchCountsByPlayer = new Map<string, number>();
  const gamesByMatchId = new Map<string, GameRow[]>();

  matchList.forEach((match) => {
    const totals = totalsByMatch.get(match.id);
    if (!totals || totals.totalGames <= 0) {
      return;
    }
    const teamA = match.team_a ?? [];
    const teamB = match.team_b ?? [];
    [...teamA, ...teamB].forEach((playerId) => {
      matchCountsByPlayer.set(playerId, (matchCountsByPlayer.get(playerId) ?? 0) + 1);
    });
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
  const targetMatches = matchList.filter((match) => Boolean(resolvePlayerSide(match, targetId)));
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
      label: string;
      memberIds: string[];
      wins: number;
      losses: number;
      matches: number;
      gamesWon: number;
      gamesLost: number;
      pointsFor: number;
      pointsAgainst: number;
    }
  >();
  const partnerMap = new Map<
    string,
    {
      id: string;
      gamesPlayed: number;
      matches: number;
      wins: number;
      losses: number;
      pointDiffTotal: number;
    }
  >();

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

    const side = resolvePlayerSide(match, targetId);
    if (!side) {
      return;
    }
    const isSideA = side === 'A';
    const matchWins = isSideA ? totals.sideAWins : totals.sideBWins;
    const matchLosses = isSideA ? totals.sideBWins : totals.sideAWins;
    const matchPointsFor = isSideA ? totals.sideAPoints : totals.sideBPoints;
    const matchPointsAgainst = isSideA ? totals.sideBPoints : totals.sideAPoints;

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
      const firstGameWon = isSideA
        ? firstGame.side_a_score > firstGame.side_b_score
        : firstGame.side_b_score > firstGame.side_a_score;
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
        const deuceWin = isSideA
          ? game.side_a_score > game.side_b_score
          : game.side_b_score > game.side_a_score;
        if (deuceWin) {
          deuceWins += 1;
        }
        const margin = isSideA
          ? game.side_a_score - game.side_b_score
          : game.side_b_score - game.side_a_score;
        deuceMarginTotal += margin;
      });
    }

    const opponentIds = resolveOpponentTeamIds(match, targetId);
    const opponentKey =
      opponentIds.length <= 1 ? opponentIds[0] ?? 'unknown' : buildTeamKey(opponentIds);
    const opponentSingleId = opponentIds[0] ?? '';
    const opponentLabel =
      opponentIds.length <= 1 ? resolveOpponentName(opponentSingleId) : formatTeamLabel(opponentIds);
    const record =
      opponentMap.get(opponentKey) ?? {
        id: opponentKey,
        label: opponentLabel,
        memberIds: opponentIds,
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

    opponentMap.set(opponentKey, record);

    if (isDoubles.value) {
      const teamIds = resolveTeamIds(match, side);
      teamIds
        .filter((id) => id !== targetId)
        .forEach((partnerId) => {
          const partner =
            partnerMap.get(partnerId) ?? {
              id: partnerId,
              gamesPlayed: 0,
              matches: 0,
              wins: 0,
              losses: 0,
              pointDiffTotal: 0
            };
          partner.gamesPlayed += totals.totalGames;
          partner.matches += 1;
          if (outcome === 'W') {
            partner.wins += 1;
          } else {
            partner.losses += 1;
          }
          partner.pointDiffTotal += pointDiff;
          partnerMap.set(partnerId, partner);
        });
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
    label: record.label,
    memberIds: record.memberIds,
    wins: record.wins,
    losses: record.losses,
    matches: record.matches,
    winPct: record.matches ? record.wins / record.matches : 0
  }));

  const matchupOpponents = opponentSummaries.filter((summary) => summary.matches >= MIN_MATCHES_FOR_MATCHUP);

  const bestOpponent = matchupOpponents.reduce<OpponentSummary | null>((best, current) => {
    if (!best) {
      return current;
    }
    if (current.winPct > best.winPct) {
      return current;
    }
    if (current.winPct === best.winPct && current.matches > best.matches) {
      return current;
    }
    if (
      current.winPct === best.winPct &&
      current.matches === best.matches &&
      current.label < best.label
    ) {
      return current;
    }
    return best;
  }, null);

  const worstOpponentPool = bestOpponent
    ? matchupOpponents.filter((summary) => summary.id !== bestOpponent.id)
    : matchupOpponents;

  const worstOpponent = worstOpponentPool.reduce<OpponentSummary | null>((worst, current) => {
    if (!worst) {
      return current;
    }
    if (current.winPct < worst.winPct) {
      return current;
    }
    if (current.winPct === worst.winPct && current.matches > worst.matches) {
      return current;
    }
    if (
      current.winPct === worst.winPct &&
      current.matches === worst.matches &&
      current.label < worst.label
    ) {
      return current;
    }
    return worst;
  }, null);

  const partnerSummaries: PartnerSummary[] = Array.from(partnerMap.values()).map((record) => ({
    id: record.id,
    name: resolveOpponentName(record.id),
    gamesPlayed: record.gamesPlayed,
    matches: record.matches,
    wins: record.wins,
    losses: record.losses,
    winPct: record.matches ? record.wins / record.matches : 0,
    avgPointDiff: record.matches ? record.pointDiffTotal / record.matches : 0
  }));

  const eligiblePartners = partnerSummaries.filter(
    (partner) => partner.gamesPlayed >= MIN_GAMES_FOR_PARTNER
  );

  const mostFrequentPartner = eligiblePartners.reduce<PartnerSummary | null>(
    (best, current) => {
      if (!best) {
        return current;
      }
      if (current.matches > best.matches) {
        return current;
      }
      if (current.matches === best.matches && current.name < best.name) {
        return current;
      }
      return best;
    },
    null
  );

  const bestPartner = eligiblePartners.reduce<PartnerSummary | null>((best, current) => {
    if (!best) {
      return current;
    }
    if (current.winPct > best.winPct) {
      return current;
    }
    if (current.winPct === best.winPct && current.matches > best.matches) {
      return current;
    }
    if (current.winPct === best.winPct && current.matches === best.matches && current.name < best.name) {
      return current;
    }
    return best;
  }, null);

  const worstPartner = eligiblePartners.reduce<PartnerSummary | null>(
    (worst, current) => {
      if (!worst) {
        return current;
      }
      if (current.winPct < worst.winPct) {
        return current;
      }
      if (current.winPct === worst.winPct && current.matches > worst.matches) {
        return current;
      }
      if (current.winPct === worst.winPct && current.matches === worst.matches && current.name < worst.name) {
        return current;
      }
      return worst;
    },
    null
  );

  const mostSuccessfulPartner = eligiblePartners.reduce<PartnerSummary | null>(
    (best, current) => {
      if (!best) {
        return current;
      }
      if (current.avgPointDiff > best.avgPointDiff) {
        return current;
      }
      if (current.avgPointDiff === best.avgPointDiff && current.matches > best.matches) {
        return current;
      }
      if (
        current.avgPointDiff === best.avgPointDiff &&
        current.matches === best.matches &&
        current.name < best.name
      ) {
        return current;
      }
      return best;
    },
    null
  );

  const positivePartners = eligiblePartners.filter((partner) => partner.winPct > winPct);
  const negativePartners = eligiblePartners.filter((partner) => partner.winPct < winPct);

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
  let biggestEloGain: EloDeltaHighlight | null = null;
  let biggestEloLoss: EloDeltaHighlight | null = null;

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

      let gainMatch: MatchRow | null = null;
      let gainDelta = Number.NEGATIVE_INFINITY;
      let lossMatch: MatchRow | null = null;
      let lossDelta = Number.POSITIVE_INFINITY;

      ratedTargetMatches.forEach(({ match, delta }) => {
        if (
          delta > 0 &&
          (gainMatch === null || delta > gainDelta || (delta === gainDelta && compareMatches(gainMatch, match) < 0))
        ) {
          gainMatch = match;
          gainDelta = delta;
        }

        if (
          delta < 0 &&
          (lossMatch === null || delta < lossDelta || (delta === lossDelta && compareMatches(lossMatch, match) < 0))
        ) {
          lossMatch = match;
          lossDelta = delta;
        }
      });

      if (gainMatch) {
        biggestEloGain = { matchId: gainMatch.id, delta: gainDelta, matchDate: gainMatch.match_date };
      }

      if (lossMatch) {
        biggestEloLoss = { matchId: lossMatch.id, delta: lossDelta, matchDate: lossMatch.match_date };
      }
    }
  }

  const recentMatches: RecentMatchSummary[] = [...results]
    .reverse()
    .slice(0, 5)
    .map((entry) => {
      const opponentIds = resolveOpponentTeamIds(entry.match, targetId).filter(Boolean);
      const opponentSingleId = opponentIds[0] ?? '';
      return {
        id: entry.match.id,
        date: formatDate(entry.match.match_date),
        opponentIds,
        opponentLabel:
          opponentIds.length <= 1
            ? resolveOpponentName(opponentSingleId)
            : formatTeamLabel(opponentIds),
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
    partnerSummaries,
    mostFrequentPartner,
    bestPartner,
    worstPartner,
    mostSuccessfulPartner,
    positivePartners,
    negativePartners,
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
    biggestEloGain,
    biggestEloLoss,
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
  if (summary.id.includes('|') || isDoubles.value) {
    return `${summary.wins}-${summary.losses}`;
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

  const tiles: StatTile[] = [
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
      label: 'Best matchup',
      value: best ? buildPlayerLinkParts(best.memberIds) : '-',
      valueSeparator: ' & ',
      meta: opponentMetaLabel(best)
    },
    {
      label: 'Worst matchup',
      value: worst ? buildPlayerLinkParts(worst.memberIds) : '-',
      valueSeparator: ' & ',
      meta: opponentMetaLabel(worst)
    },
    {
      label: 'Last match',
      value: stats.value.lastMatchDate || '-'
    }
  ];
 
  if (isDoubles.value) {
    const mostFrequent = stats.value.mostFrequentPartner;
    const bestPartner = stats.value.bestPartner;
    const worstPartner = stats.value.worstPartner;
    const mostSuccessful = stats.value.mostSuccessfulPartner;
    const positivePartners = buildPartnerLinkParts(stats.value.positivePartners);
    const negativePartners = buildPartnerLinkParts(stats.value.negativePartners);

    tiles.push(
      {
        label: 'Most frequent partner',
        value: mostFrequent ? [{ id: mostFrequent.id, label: mostFrequent.name }] : '-',
        meta: mostFrequent ? `${mostFrequent.matches} matches` : undefined
      },
      {
        label: 'Best partner',
        value: bestPartner ? [{ id: bestPartner.id, label: bestPartner.name }] : '-',
        meta: bestPartner ? `Win ${formatPct(bestPartner.winPct, bestPartner.matches)}` : undefined
      },
      {
        label: 'Worst partner',
        value: worstPartner ? [{ id: worstPartner.id, label: worstPartner.name }] : '-',
        meta: worstPartner ? `Win ${formatPct(worstPartner.winPct, worstPartner.matches)}` : undefined
      },
      {
        label: 'Most successful partnership',
        value: mostSuccessful ? [{ id: mostSuccessful.id, label: mostSuccessful.name }] : '-',
        meta: mostSuccessful ? `Avg ${formatSigned(mostSuccessful.avgPointDiff, 1)} pts` : undefined
      },
      {
        label: 'Positive diff partners',
        value: positivePartners.length ? positivePartners : '-',
        valueSeparator: ', '
      },
      {
        label: 'Negative diff partners',
        value: negativePartners.length ? negativePartners : '-',
        valueSeparator: ', '
      }
    );
  }

  return tiles;
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

const eloTiles = computed<StatTile[]>(() => {
  const biggestGain = stats.value.biggestEloGain;
  const biggestLoss = stats.value.biggestEloLoss;

  return [
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
    },
    {
      label: 'Biggest Elo gain',
      value: biggestGain ? formatSigned(Math.round(biggestGain.delta)) : '-',
      meta: biggestGain ? formatDate(biggestGain.matchDate) : undefined,
      to: biggestGain ? matchDetailsLink(biggestGain.matchId) : undefined
    },
    {
      label: 'Biggest Elo loss',
      value: biggestLoss ? formatSigned(Math.round(biggestLoss.delta)) : '-',
      meta: biggestLoss ? formatDate(biggestLoss.matchDate) : undefined,
      to: biggestLoss ? matchDetailsLink(biggestLoss.matchId) : undefined
    }
  ];
});

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

    const matchesResult = await listMatches({ includeInactive: false, matchType: matchMode.value });
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

watch(matchMode, () => {
  if (!targetPlayerId.value) {
    return;
  }
  loadData();
});
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
      <div class="mode-toggle auth-toggle" role="tablist" aria-label="Match type">
        <button
          type="button"
          class="auth-toggle__btn"
          :class="{ 'is-active': matchMode === 'doubles' }"
          role="tab"
          :aria-selected="matchMode === 'doubles'"
          @click="setMatchMode('doubles')"
        >
          Doubles
        </button>
        <button
          type="button"
          class="auth-toggle__btn"
          :class="{ 'is-active': matchMode === 'singles' }"
          role="tab"
          :aria-selected="matchMode === 'singles'"
          @click="setMatchMode('singles')"
        >
          Singles
        </button>
      </div>
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
          <component
            :is="tile.to ? 'router-link' : 'article'"
            v-for="tile in overviewTiles"
            :key="tile.label"
            class="stat-tile"
            :class="{ 'stat-tile--link': Boolean(tile.to) }"
            v-bind="tile.to ? { to: tile.to } : {}"
          >
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">
              <template v-if="Array.isArray(tile.value)">
                <template v-for="(part, index) in tile.value" :key="`${tile.label}-${part.id}-${index}`">
                  <router-link
                    v-if="part.id"
                    class="player-link"
                    :to="playerProfileLink(part.id)"
                    @click.stop
                  >
                    {{ part.label }}
                  </router-link>
                  <span v-else>{{ part.label }}</span>
                  <span v-if="index < tile.value.length - 1">{{ tile.valueSeparator ?? ' & ' }}</span>
                </template>
              </template>
              <template v-else>
                {{ tile.value }}
              </template>
            </p>
            <p v-if="tile.meta" class="stat-tile__meta">{{ tile.meta }}</p>
          </component>
        </div>
      </section>

      <section v-else-if="activeTab === 'matches'" class="tab-panel">
        <div class="stat-grid stat-grid--compact">
          <component
            :is="tile.to ? 'router-link' : 'article'"
            v-for="tile in matchesSummaryTiles"
            :key="tile.label"
            class="stat-tile"
            :class="{ 'stat-tile--link': Boolean(tile.to) }"
            v-bind="tile.to ? { to: tile.to } : {}"
          >
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">
              <template v-if="Array.isArray(tile.value)">
                <template v-for="(part, index) in tile.value" :key="`${tile.label}-${part.id}-${index}`">
                  <router-link
                    v-if="part.id"
                    class="player-link"
                    :to="playerProfileLink(part.id)"
                    @click.stop
                  >
                    {{ part.label }}
                  </router-link>
                  <span v-else>{{ part.label }}</span>
                  <span v-if="index < tile.value.length - 1">{{ tile.valueSeparator ?? ' & ' }}</span>
                </template>
              </template>
              <template v-else>
                {{ tile.value }}
              </template>
            </p>
          </component>
        </div>

        <article class="card">
          <header class="card-header">
            <h3>Recent matches</h3>
            <p class="card-subtext">Latest results for this player.</p>
          </header>

          <div v-if="!stats.recentMatches.length" class="form-message">No matches recorded yet.</div>

          <div v-else class="recent-list">
            <article
              v-for="match in stats.recentMatches"
              :key="match.id"
              class="recent-item recent-item--link"
              role="button"
              tabindex="0"
              @click="openMatchDetails(match.id)"
              @keydown.enter.prevent="openMatchDetails(match.id)"
              @keydown.space.prevent="openMatchDetails(match.id)"
            >
              <div>
                <p class="recent-date">{{ match.date }}</p>
                <p class="recent-opponent">
                  vs
                  <template v-if="match.opponentIds.length">
                    <template
                      v-for="(opponentId, index) in match.opponentIds"
                      :key="`${match.id}-${opponentId}-${index}`"
                    >
                      <router-link
                        class="player-link"
                        :to="playerProfileLink(opponentId)"
                        @click.stop
                      >
                        {{ resolveOpponentName(opponentId) }}
                      </router-link>
                      <span v-if="index < match.opponentIds.length - 1"> & </span>
                    </template>
                  </template>
                  <template v-else>
                    {{ match.opponentLabel }}
                  </template>
                </p>
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
            </article>
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
          <component
            :is="tile.to ? 'router-link' : 'article'"
            v-for="tile in eloTiles"
            :key="tile.label"
            class="stat-tile"
            :class="{ 'stat-tile--link': Boolean(tile.to) }"
            v-bind="tile.to ? { to: tile.to } : {}"
          >
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">
              <template v-if="Array.isArray(tile.value)">
                <template v-for="(part, index) in tile.value" :key="`${tile.label}-${part.id}-${index}`">
                  <router-link
                    v-if="part.id"
                    class="player-link"
                    :to="playerProfileLink(part.id)"
                    @click.stop
                  >
                    {{ part.label }}
                  </router-link>
                  <span v-else>{{ part.label }}</span>
                  <span v-if="index < tile.value.length - 1">{{ tile.valueSeparator ?? ' & ' }}</span>
                </template>
              </template>
              <template v-else>
                {{ tile.value }}
              </template>
            </p>
            <p v-if="tile.meta" class="stat-tile__meta">{{ tile.meta }}</p>
          </component>
        </div>
      </section>

      <section v-else-if="activeTab === 'streaks'" class="tab-panel">
        <div class="stat-grid stat-grid--compact">
          <component
            :is="tile.to ? 'router-link' : 'article'"
            v-for="tile in streakTiles"
            :key="tile.label"
            class="stat-tile"
            :class="{ 'stat-tile--link': Boolean(tile.to) }"
            v-bind="tile.to ? { to: tile.to } : {}"
          >
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">
              <template v-if="Array.isArray(tile.value)">
                <template v-for="(part, index) in tile.value" :key="`${tile.label}-${part.id}-${index}`">
                  <router-link
                    v-if="part.id"
                    class="player-link"
                    :to="playerProfileLink(part.id)"
                    @click.stop
                  >
                    {{ part.label }}
                  </router-link>
                  <span v-else>{{ part.label }}</span>
                  <span v-if="index < tile.value.length - 1">{{ tile.valueSeparator ?? ' & ' }}</span>
                </template>
              </template>
              <template v-else>
                {{ tile.value }}
              </template>
            </p>
            <p v-if="tile.meta" class="stat-tile__meta">{{ tile.meta }}</p>
          </component>
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
          <component
            :is="tile.to ? 'router-link' : 'article'"
            v-for="tile in pointsTiles"
            :key="tile.label"
            class="stat-tile"
            :class="{ 'stat-tile--link': Boolean(tile.to) }"
            v-bind="tile.to ? { to: tile.to } : {}"
          >
            <p class="stat-tile__label">{{ tile.label }}</p>
            <p class="stat-tile__value">
              <template v-if="Array.isArray(tile.value)">
                <template v-for="(part, index) in tile.value" :key="`${tile.label}-${part.id}-${index}`">
                  <router-link
                    v-if="part.id"
                    class="player-link"
                    :to="playerProfileLink(part.id)"
                    @click.stop
                  >
                    {{ part.label }}
                  </router-link>
                  <span v-else>{{ part.label }}</span>
                  <span v-if="index < tile.value.length - 1">{{ tile.valueSeparator ?? ' & ' }}</span>
                </template>
              </template>
              <template v-else>
                {{ tile.value }}
              </template>
            </p>
            <p v-if="tile.meta" class="stat-tile__meta">{{ tile.meta }}</p>
          </component>
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
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-sm);
}

.profile-filters .field {
  min-width: 180px;
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

.stat-tile--link {
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.stat-tile--link:hover {
  border-color: var(--brand-tint-16, var(--brand-tint-08));
}

.stat-tile--link:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
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

.recent-item--link {
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.recent-item--link:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
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
