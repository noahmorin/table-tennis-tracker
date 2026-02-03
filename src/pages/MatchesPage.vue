<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AgGridVue } from 'ag-grid-vue3';
import type { ColDef, GridApi, GridOptions } from 'ag-grid-community';
import { listMatches, updateMatch, voidMatch } from '../lib/data/matches';
import { listGamesByMatchId, listGamesByMatchIds } from '../lib/data/games';
import { listProfiles } from '../lib/data/profiles';
import type { GameInput, MatchFormat, MatchRow, MatchType, ProfileRow } from '../lib/data/types';
import { buildMatchGameTotals, calculateEloDeltasForPlayer, type MatchGameTotals } from '../lib/elo';
import { useAuth } from '../stores/auth';
import { useMatchMode } from '../stores/matchMode';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

const { profile, isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

const todayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type SortOption = 'date_desc' | 'date_asc' | 'created_desc' | 'created_asc';

type MatchGameRow = {
  gameNumber: number;
  sideAScore: number | string | null;
  sideBScore: number | string | null;
};

const buildGameRow = (
  gameNumber: number,
  scores?: { sideA: number; sideB: number }
): MatchGameRow => ({
  gameNumber,
  sideAScore: scores?.sideA ?? null,
  sideBScore: scores?.sideB ?? null
});

const formatOptions: Array<{ value: MatchFormat; label: string }> = [
  { value: 'bo1', label: 'Best of 1' },
  { value: 'bo3', label: 'Best of 3' },
  { value: 'bo5', label: 'Best of 5' },
  { value: 'bo7', label: 'Best of 7' }
];

const gamesByFormat: Record<MatchFormat, number> = {
  bo1: 1,
  bo3: 3,
  bo5: 5,
  bo7: 7
};

const includeInactive = ref(false);
const dateFrom = ref('');
const dateTo = ref('');
const sortOrder = ref<SortOption | ''>('date_desc');
const opponentId = ref('');
const filterWins = ref(true);
const filterLosses = ref(true);
const { matchMode, setMatchMode } = useMatchMode();

const matches = ref<MatchRow[]>([]);
const matchesLoading = ref(false);
const matchesError = ref<string | null>(null);
const matchTotalsById = ref<Map<string, MatchGameTotals>>(new Map());
const eloDeltasByMatchId = ref<Map<string, number>>(new Map());
const eloLoading = ref(false);

const profiles = ref<ProfileRow[]>([]);
const profilesLoading = ref(false);
const profilesError = ref<string | null>(null);

const dialogRef = ref<HTMLDialogElement | null>(null);
const filterDialogRef = ref<HTMLDialogElement | null>(null);
const editGridApi = ref<GridApi | null>(null);

const editMatch = ref<MatchRow | null>(null);
const editLoading = ref(false);
const editError = ref<string | null>(null);
const editValidationErrors = ref<string[]>([]);
const editCellErrors = ref<Record<string, string>>({});
const editSubmitting = ref(false);

const editMatchType = ref<MatchType>('doubles');
const isEditDoubles = computed(() => editMatchType.value === 'doubles');
const editTeamAPlayer1Id = ref('');
const editTeamAPlayer2Id = ref('');
const editTeamBPlayer1Id = ref('');
const editTeamBPlayer2Id = ref('');
const editMatchDate = ref(todayString());
const editMatchFormat = ref<MatchFormat>('bo3');
const editNotes = ref('');
const editRows = ref<MatchGameRow[]>([]);

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: 'date_desc', label: 'Match date (newest)' },
  { value: 'date_asc', label: 'Match date (oldest)' },
  { value: 'created_desc', label: 'Created (newest)' },
  { value: 'created_asc', label: 'Created (oldest)' }
];

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

const targetPlayerId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' ? raw : '';
});

const targetPlayer = computed(() => {
  const id = targetPlayerId.value;
  return id ? playerMap.value.get(id) ?? null : null;
});

const targetPlayerLabel = computed(() => {
  if (!targetPlayerId.value) {
    return '';
  }
  const player = targetPlayer.value;
  return player ? formatPlayerLabel(player) : 'Player';
});

const opponentOptions = computed(() => {
  const targetId = targetPlayerId.value;
  return profiles.value.filter((player) => player.id !== targetId);
});

const playerLabelForId = (id: string) => {
  if (!id) {
    return '';
  }
  const player = playerMap.value.get(id);
  return player ? formatPlayerLabel(player) : 'Unknown player';
};

const editTeamAIds = computed(() => {
  const ids = [editTeamAPlayer1Id.value];
  if (isEditDoubles.value) {
    ids.push(editTeamAPlayer2Id.value);
  }
  return ids.filter(Boolean);
});

const editTeamBIds = computed(() => {
  const ids = [editTeamBPlayer1Id.value];
  if (isEditDoubles.value) {
    ids.push(editTeamBPlayer2Id.value);
  }
  return ids.filter(Boolean);
});

const editSelectedIds = computed(
  () => new Set([...editTeamAIds.value, ...editTeamBIds.value].filter(Boolean))
);

const buildEditOptions = (currentId: string) =>
  profiles.value.filter((player) => player.id === currentId || !editSelectedIds.value.has(player.id));

const editTeamAPlayer1Options = computed(() => buildEditOptions(editTeamAPlayer1Id.value));
const editTeamAPlayer2Options = computed(() => buildEditOptions(editTeamAPlayer2Id.value));
const editTeamBPlayer1Options = computed(() => buildEditOptions(editTeamBPlayer1Id.value));
const editTeamBPlayer2Options = computed(() => buildEditOptions(editTeamBPlayer2Id.value));

const editTeamALabel = computed(() => {
  const labels = editTeamAIds.value.map((id) => playerLabelForId(id)).filter(Boolean);
  return labels.length ? `Team A: ${labels.join(' & ')}` : 'Team A';
});

const editTeamBLabel = computed(() => {
  const labels = editTeamBIds.value.map((id) => playerLabelForId(id)).filter(Boolean);
  return labels.length ? `Team B: ${labels.join(' & ')}` : 'Team B';
});

const matchFormatLabel = (format: MatchFormat) => {
  const option = formatOptions.find((item) => item.value === format);
  return option?.label ?? format.toUpperCase();
};

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

const resolveOpponentIds = (match: MatchRow, playerId: string) => {
  const side = resolvePlayerSide(match, playerId);
  if (side === 'A') {
    return resolveTeamIds(match, 'B');
  }
  if (side === 'B') {
    return resolveTeamIds(match, 'A');
  }
  return [];
};

const isParticipant = (match: MatchRow, playerId: string) => {
  if (!playerId) {
    return false;
  }
  const teamA = match.team_a ?? [];
  const teamB = match.team_b ?? [];
  return teamA.includes(playerId) || teamB.includes(playerId);
};

const formatTeamLabel = (ids: string[], highlightId?: string) => {
  const labels = ids
    .map((id) => (highlightId && id === highlightId ? 'You' : playerLabelForId(id)))
    .filter(Boolean);
  return labels.length ? labels.join(' & ') : 'Unknown team';
};

const matchTypeBadge = (match: MatchRow) => (match.match_type === 'doubles' ? 'D' : 'S');

const visibleMatches = computed(() => {
  let list = [...matches.value];

  if (!isAdmin.value) {
    list = list.filter((match) => match.is_active);
  }

  if (opponentId.value && targetPlayerId.value) {
    list = list.filter((match) => {
      const opponents = resolveOpponentIds(match, targetPlayerId.value);
      return opponents.includes(opponentId.value);
    });
  }

  if (targetPlayerId.value && !(filterWins.value && filterLosses.value)) {
    list = list.filter((match) => {
      const totals = matchTotalsById.value.get(match.id);
      if (!totals || totals.totalGames <= 0) {
        return false;
      }
      const side = resolvePlayerSide(match, targetPlayerId.value);
      if (!side) {
        return false;
      }
      const isWin =
        side === 'A' ? totals.sideAWins > totals.sideBWins : totals.sideBWins > totals.sideAWins;
      if (isWin && filterWins.value) {
        return true;
      }
      if (!isWin && filterLosses.value) {
        return true;
      }
      return false;
    });
  }

  if (!sortOrder.value) {
    return list;
  }

  const compare = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);

  list.sort((a, b) => {
    switch (sortOrder.value) {
      case 'date_asc':
        return (
          compare(a.match_date, b.match_date) ||
          compare(a.created_at, b.created_at) ||
          compare(a.id, b.id)
        );
      case 'date_desc':
        return (
          compare(b.match_date, a.match_date) ||
          compare(b.created_at, a.created_at) ||
          compare(b.id, a.id)
        );
      case 'created_asc':
        return compare(a.created_at, b.created_at) || compare(a.id, b.id);
      case 'created_desc':
        return compare(b.created_at, a.created_at) || compare(b.id, a.id);
      default:
        return 0;
    }
  });

  return list;
});

const matchDateLabel = (value: string) => {
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

const matchPlayersLabel = (match: MatchRow) => {
  const highlightId =
    profile.value && targetPlayerId.value === profile.value.id ? profile.value.id : undefined;
  const teamALabel = formatTeamLabel(resolveTeamIds(match, 'A'), highlightId);
  const teamBLabel = formatTeamLabel(resolveTeamIds(match, 'B'), highlightId);
  return `${teamALabel} vs ${teamBLabel}`;
};

const matchScoreLabel = (match: MatchRow) => {
  const totals = matchTotalsById.value.get(match.id);
  const sideAWins = totals?.sideAWins ?? match.side_a_games_won;
  const sideBWins = totals?.sideBWins ?? match.side_b_games_won;
  if (targetPlayerId.value) {
    const side = resolvePlayerSide(match, targetPlayerId.value);
    if (side === 'B') {
      return `${sideBWins}-${sideAWins}`;
    }
  }
  return `${sideAWins}-${sideBWins}`;
};

const matchOutcome = (match: MatchRow) => {
  if (!targetPlayerId.value) {
    return '';
  }
  const totals = matchTotalsById.value.get(match.id);
  if (!totals || totals.totalGames <= 0) {
    return '';
  }
  const side = resolvePlayerSide(match, targetPlayerId.value);
  if (!side) {
    return '';
  }
  const isWin =
    side === 'A' ? totals.sideAWins > totals.sideBWins : totals.sideBWins > totals.sideAWins;
  return isWin ? 'Win' : 'Loss';
};

const matchEloDelta = (match: MatchRow) => eloDeltasByMatchId.value.get(match.id);

const matchEloDeltaLabel = (match: MatchRow) => {
  const delta = matchEloDelta(match);
  if (delta === undefined) {
    return null;
  }
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}`;
};

const matchEloDeltaClass = (match: MatchRow) => {
  const delta = matchEloDelta(match);
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

const maxMatchDate = computed(() => todayString());
const editGameCount = computed(() => gamesByFormat[editMatchFormat.value]);
const canEditPlayers = computed(() => isAdmin.value);
const canEditDate = computed(() => isAdmin.value);
const canVoid = computed(() => isAdmin.value);
const canEditMatch = computed(() => {
  if (isAdmin.value) {
    return true;
  }
  if (!editMatch.value || !profile.value) {
    return false;
  }
  if (!editMatch.value.is_active) {
    return false;
  }
  return isParticipant(editMatch.value, profile.value.id);
});
const canEditScores = computed(() => canEditMatch.value);

const resetEditState = () => {
  editMatch.value = null;
  editLoading.value = false;
  editError.value = null;
  editValidationErrors.value = [];
  editCellErrors.value = {};
  editSubmitting.value = false;
  editMatchType.value = 'doubles';
  editTeamAPlayer1Id.value = '';
  editTeamAPlayer2Id.value = '';
  editTeamBPlayer1Id.value = '';
  editTeamBPlayer2Id.value = '';
  editMatchDate.value = todayString();
  editMatchFormat.value = 'bo3';
  editNotes.value = '';
  editRows.value = [];
};

const syncEditRows = (count: number) => {
  const next = editRows.value.slice(0, count);
  for (let i = next.length + 1; i <= count; i += 1) {
    next.push(buildGameRow(i));
  }
  editRows.value = next.map((row, index) => ({
    ...row,
    gameNumber: index + 1
  }));
};

const hydrateEditRows = (
  count: number,
  games: Array<{ game_number: number; side_a_score: number; side_b_score: number }>
) => {
  const gameMap = new Map<number, { sideA: number; sideB: number }>();
  games.forEach((game) => {
    gameMap.set(game.game_number, { sideA: game.side_a_score, sideB: game.side_b_score });
  });

  const next: MatchGameRow[] = [];
  for (let i = 1; i <= count; i += 1) {
    next.push(buildGameRow(i, gameMap.get(i)));
  }
  editRows.value = next;
};

const loadProfiles = async () => {
  profilesLoading.value = true;
  profilesError.value = null;

  const { data, error } = await listProfiles({ includeInactive: isAdmin.value });
  if (error) {
    profilesError.value = error;
    profiles.value = [];
  } else {
    profiles.value = data ?? [];
  }

  profilesLoading.value = false;
};

const loadMatches = async () => {
  if (!profile.value || !targetPlayerId.value) {
    return;
  }

  matchesLoading.value = true;
  matchesError.value = null;
  try {
    const { data, error } = await listMatches({
      includeInactive: isAdmin.value ? includeInactive.value : false,
      playerId: targetPlayerId.value,
      matchType: matchMode.value,
      dateFrom: dateFrom.value || undefined,
      dateTo: dateTo.value || undefined
    });

    if (error) {
      matchesError.value = error;
      matches.value = [];
      matchTotalsById.value = new Map();
    } else {
      matches.value = data ?? [];
      const matchIds = matches.value.map((match) => match.id);
      if (matchIds.length) {
        const { data: gamesData, error: gamesError } = await listGamesByMatchIds(matchIds, {
          includeInactive: isAdmin.value ? includeInactive.value : false
        });
        if (gamesError) {
          matchesError.value = gamesError;
          matchTotalsById.value = new Map();
        } else {
          matchTotalsById.value = buildMatchGameTotals(matches.value, gamesData ?? []);
        }
      } else {
        matchTotalsById.value = new Map();
      }
    }
  } catch (err) {
    matchesError.value = err instanceof Error ? err.message : 'Network error loading matches.';
    matches.value = [];
    matchTotalsById.value = new Map();
  } finally {
    matchesLoading.value = false;
    void loadEloDeltas();
  }
};

const loadEloDeltas = async () => {
  if (!targetPlayerId.value || eloLoading.value) {
    return;
  }

  eloLoading.value = true;

  const { data: allMatches, error: matchesError } = await listMatches({
    includeInactive: false,
    matchType: matchMode.value
  });
  if (matchesError) {
    eloDeltasByMatchId.value = new Map();
    eloLoading.value = false;
    return;
  }

  const matchIds = (allMatches ?? []).map((match) => match.id);
  const { data: gamesData, error: gamesError } = await listGamesByMatchIds(matchIds, {
    includeInactive: false
  });
  if (gamesError) {
    eloDeltasByMatchId.value = new Map();
    eloLoading.value = false;
    return;
  }

  const totals = buildMatchGameTotals(allMatches ?? [], gamesData ?? []);
  const targetId = targetPlayerId.value;
  const totalMatchesPlayed = (allMatches ?? []).reduce((sum, match) => {
    if (!isParticipant(match, targetId)) {
      return sum;
    }
    const matchTotals = totals.get(match.id);
    if (!matchTotals || matchTotals.totalGames <= 0) {
      return sum;
    }
    return sum + 1;
  }, 0);

  if (totalMatchesPlayed < 3) {
    eloDeltasByMatchId.value = new Map();
    eloLoading.value = false;
    return;
  }

  eloDeltasByMatchId.value = calculateEloDeltasForPlayer(allMatches ?? [], totals, targetId);
  eloLoading.value = false;
};

const openMatchDialog = async (match: MatchRow) => {
  resetEditState();
  editMatch.value = match;
  editMatchType.value = match.match_type;
  const teamA = match.team_a ?? [];
  const teamB = match.team_b ?? [];
  editTeamAPlayer1Id.value = teamA[0] ?? '';
  editTeamAPlayer2Id.value = teamA[1] ?? '';
  editTeamBPlayer1Id.value = teamB[0] ?? '';
  editTeamBPlayer2Id.value = teamB[1] ?? '';
  editMatchDate.value = match.match_date;
  editMatchFormat.value = match.match_format;
  editNotes.value = match.notes ?? '';
  syncEditRows(gamesByFormat[editMatchFormat.value]);
  dialogRef.value?.showModal();

  editLoading.value = true;
  const { data, error } = await listGamesByMatchId(match.id, { includeInactive: !match.is_active });
  if (error) {
    editError.value = error;
  } else {
    hydrateEditRows(gamesByFormat[editMatchFormat.value], data ?? []);
  }
  editLoading.value = false;
};

const closeMatchDialog = () => {
  dialogRef.value?.close();
  resetEditState();
};

const openFilterDialog = () => {
  filterDialogRef.value?.showModal();
};

const closeFilterDialog = () => {
  filterDialogRef.value?.close();
};

const parseScore = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 'invalid';
  }
  return Math.floor(parsed);
};

const validateEditMatch = () => {
  const errors: string[] = [];
  const nextCellErrors: Record<string, string> = {};
  const games: GameInput[] = [];

  if (!editMatchDate.value) {
    errors.push('Match date is required.');
  } else if (editMatchDate.value > maxMatchDate.value) {
    errors.push('Match date cannot be in the future.');
  }

  if (!editTeamAPlayer1Id.value) {
    errors.push('Team A player 1 is required.');
  }

  if (isEditDoubles.value && !editTeamAPlayer2Id.value) {
    errors.push('Team A player 2 is required.');
  }

  if (!editTeamBPlayer1Id.value) {
    errors.push('Team B player 1 is required.');
  }

  if (isEditDoubles.value && !editTeamBPlayer2Id.value) {
    errors.push('Team B player 2 is required.');
  }

  const selectedPlayers = [
    editTeamAPlayer1Id.value,
    isEditDoubles.value ? editTeamAPlayer2Id.value : '',
    editTeamBPlayer1Id.value,
    isEditDoubles.value ? editTeamBPlayer2Id.value : ''
  ].filter(Boolean);
  if (selectedPlayers.length !== new Set(selectedPlayers).size) {
    errors.push('Players must be unique across both teams.');
  }

  if (editMatch.value && !isAdmin.value && !editMatch.value.is_active) {
    errors.push('Deleted matches cannot be edited.');
  }

  if (!isAdmin.value && editMatch.value) {
    const currentTeamA = editMatch.value.team_a ?? [];
    const currentTeamB = editMatch.value.team_b ?? [];
    const nextTeamA = isEditDoubles.value
      ? [editTeamAPlayer1Id.value, editTeamAPlayer2Id.value]
      : [editTeamAPlayer1Id.value];
    const nextTeamB = isEditDoubles.value
      ? [editTeamBPlayer1Id.value, editTeamBPlayer2Id.value]
      : [editTeamBPlayer1Id.value];
    if (
      editMatchType.value !== editMatch.value.match_type ||
      currentTeamA[0] !== nextTeamA[0] ||
      (isEditDoubles.value && currentTeamA[1] !== nextTeamA[1]) ||
      currentTeamB[0] !== nextTeamB[0] ||
      (isEditDoubles.value && currentTeamB[1] !== nextTeamB[1])
    ) {
      errors.push('Players cannot be changed.');
    }
  }

  if (!isAdmin.value && editMatch.value) {
    if (editMatchDate.value !== editMatch.value.match_date) {
      errors.push('Match date cannot be changed.');
    }
  }

  if (profile.value && editMatch.value) {
    if (!isAdmin.value && !isParticipant(editMatch.value, profile.value.id)) {
      errors.push('You can only edit matches you played.');
    }
  }

  let wins1 = 0;
  let wins2 = 0;
  let matchDecided = false;
  let foundGap = false;

  for (let i = 1; i <= editGameCount.value; i += 1) {
    const row = editRows.value[i - 1] ?? buildGameRow(i);
    const score1 = parseScore(row.sideAScore);
    const score2 = parseScore(row.sideBScore);
    const cellKey1 = `game${i}:sideAScore`;
    const cellKey2 = `game${i}:sideBScore`;

    const score1Empty = score1 === null;
    const score2Empty = score2 === null;
    const bothEmpty = score1Empty && score2Empty;

    if (bothEmpty) {
      if (games.length > 0) {
        foundGap = true;
      }
      continue;
    }

    if (foundGap) {
      errors.push(`Game ${i} is filled after a blank game.`);
      nextCellErrors[cellKey1] = 'Game order must be contiguous.';
      nextCellErrors[cellKey2] = 'Game order must be contiguous.';
      continue;
    }

    if (score1Empty || score2Empty) {
      errors.push(`Game ${i} must include scores for both players.`);
      if (score1Empty) {
        nextCellErrors[cellKey1] = 'Missing score.';
      }
      if (score2Empty) {
        nextCellErrors[cellKey2] = 'Missing score.';
      }
      continue;
    }

    if (score1 === 'invalid' || score2 === 'invalid') {
      errors.push(`Game ${i} scores must be numbers.`);
      if (score1 === 'invalid') {
        nextCellErrors[cellKey1] = 'Invalid score.';
      }
      if (score2 === 'invalid') {
        nextCellErrors[cellKey2] = 'Invalid score.';
      }
      continue;
    }

    if (score1 < 0 || score2 < 0) {
      errors.push(`Game ${i} scores must be non-negative.`);
      if (score1 < 0) {
        nextCellErrors[cellKey1] = 'Must be >= 0.';
      }
      if (score2 < 0) {
        nextCellErrors[cellKey2] = 'Must be >= 0.';
      }
      continue;
    }

    if (score1 === score2) {
      errors.push(`Game ${i} cannot be tied.`);
      nextCellErrors[cellKey1] = 'No ties.';
      nextCellErrors[cellKey2] = 'No ties.';
      continue;
    }

    if (matchDecided) {
      errors.push(`Game ${i} was played after the match was already decided.`);
      nextCellErrors[cellKey1] = 'Match already decided.';
      nextCellErrors[cellKey2] = 'Match already decided.';
      continue;
    }

    const winnerScore = Math.max(score1, score2);
    const loserScore = Math.min(score1, score2);

    if (winnerScore < 11) {
      errors.push(`Game ${i} winner must reach at least 11 points.`);
      nextCellErrors[cellKey1] = 'Winning score must be >= 11.';
      nextCellErrors[cellKey2] = 'Winning score must be >= 11.';
      continue;
    }

    if (winnerScore - loserScore < 2) {
      errors.push(`Game ${i} must be won by 2 points.`);
      nextCellErrors[cellKey1] = 'Must win by 2.';
      nextCellErrors[cellKey2] = 'Must win by 2.';
      continue;
    }

    games.push({
      game_number: i,
      side_a_score: score1,
      side_b_score: score2
    });

    if (score1 > score2) {
      wins1 += 1;
    } else {
      wins2 += 1;
    }

    if (
      wins1 >= Math.floor(editGameCount.value / 2) + 1 ||
      wins2 >= Math.floor(editGameCount.value / 2) + 1
    ) {
      matchDecided = true;
    }
  }

  if (games.length === 0) {
    errors.push('At least one game is required.');
  }

  if (
    wins1 < Math.floor(editGameCount.value / 2) + 1 &&
    wins2 < Math.floor(editGameCount.value / 2) + 1
  ) {
    errors.push(`Match is incomplete for ${editMatchFormat.value}.`);
  }

  return { errors, cellErrors: nextCellErrors, games };
};

const handleEditCellValueChanged = () => {
  if (editValidationErrors.value.length || Object.keys(editCellErrors.value).length) {
    editValidationErrors.value = [];
    editCellErrors.value = {};
    editGridApi.value?.refreshCells({ force: true });
  }
};

const handleEditGridReady = (event: { api: GridApi }) => {
  editGridApi.value = event.api;
};

const handleSave = async () => {
  if (!editMatch.value || editSubmitting.value) {
    return;
  }

  editError.value = null;
  editValidationErrors.value = [];
  editCellErrors.value = {};

  const { errors, cellErrors: nextCellErrors, games } = validateEditMatch();
  if (errors.length > 0) {
    editValidationErrors.value = errors;
    editCellErrors.value = nextCellErrors;
    editGridApi.value?.refreshCells({ force: true });
    return;
  }

  if (!canEditMatch.value) {
    editError.value = 'You do not have permission to edit this match.';
    return;
  }

  editSubmitting.value = true;
  const { error } = await updateMatch({
    matchId: editMatch.value.id,
    matchType: editMatchType.value,
    matchDate: editMatchDate.value,
    matchFormat: editMatchFormat.value,
    competitionType: editMatch.value.competition_type,
    competitionId: editMatch.value.competition_id,
    teamA: isEditDoubles.value
      ? [editTeamAPlayer1Id.value, editTeamAPlayer2Id.value]
      : [editTeamAPlayer1Id.value],
    teamB: isEditDoubles.value
      ? [editTeamBPlayer1Id.value, editTeamBPlayer2Id.value]
      : [editTeamBPlayer1Id.value],
    games,
    notes: editNotes.value.trim() ? editNotes.value.trim() : null
  });
  editSubmitting.value = false;

  if (error) {
    editError.value = error;
    return;
  }

  await loadMatches();
  closeMatchDialog();
};

const handleVoid = async () => {
  if (!editMatch.value || !isAdmin.value) {
    return;
  }

  const confirmed = window.confirm('Are you sure you want to delete this match?');
  if (!confirmed) {
    return;
  }

  editSubmitting.value = true;
  const { error } = await voidMatch(editMatch.value.id);
  editSubmitting.value = false;

  if (error) {
    editError.value = error;
    return;
  }

  await loadMatches();
  closeMatchDialog();
};

const gridOptions = computed<GridOptions>(() => ({
  rowHeight: 44,
  headerHeight: 32
}));

const columnDefs = computed<ColDef[]>(() => [
  {
    headerName: 'Game',
    field: 'gameNumber',
    colId: 'gameNumber',
    editable: false,
    width: 80,
    minWidth: 80,
    maxWidth: 80,
    suppressSizeToFit: true,
    cellClass: 'game-label',
    cellStyle: { textAlign: 'center' },
    valueGetter: (params) => (params.data ? `Game ${params.data.gameNumber}` : '')
  },
  {
    headerName: editTeamALabel.value,
    field: 'sideAScore',
    editable: canEditScores.value,
    minWidth: 120,
    flex: 1,
    cellStyle: { textAlign: 'center' },
    valueSetter: (params) => {
      const raw = String(params.newValue ?? '').trim();
      if (raw === '') {
        params.data.sideAScore = null;
        return true;
      }
      const parsed = Number(raw);
      params.data.sideAScore = Number.isFinite(parsed) ? Math.floor(parsed) : raw;
      return true;
    },
    cellClassRules: {
      'grid-cell-error': (params) => {
        const gameNumber = params.data?.gameNumber;
        if (!gameNumber) {
          return false;
        }
        const key = `game${gameNumber}:sideAScore`;
        return Boolean(editCellErrors.value[key]);
      }
    }
  },
  {
    headerName: editTeamBLabel.value,
    field: 'sideBScore',
    editable: canEditScores.value,
    minWidth: 120,
    flex: 1,
    cellStyle: { textAlign: 'center' },
    valueSetter: (params) => {
      const raw = String(params.newValue ?? '').trim();
      if (raw === '') {
        params.data.sideBScore = null;
        return true;
      }
      const parsed = Number(raw);
      params.data.sideBScore = Number.isFinite(parsed) ? Math.floor(parsed) : raw;
      return true;
    },
    cellClassRules: {
      'grid-cell-error': (params) => {
        const gameNumber = params.data?.gameNumber;
        if (!gameNumber) {
          return false;
        }
        const key = `game${gameNumber}:sideBScore`;
        return Boolean(editCellErrors.value[key]);
      }
    }
  }
]);

const defaultColDef: ColDef = {
  resizable: false,
  sortable: false,
  suppressMovable: true,
  suppressSizeToFit: true
};

watch(
  [includeInactive, dateFrom, dateTo, opponentId, sortOrder, filterWins, filterLosses, matchMode, profile, isAdmin],
  () => {
    if (profile.value) {
      loadMatches();
    }
  }
);

watch(
  () => route.params.id,
  () => {
    if (profile.value && !targetPlayerId.value) {
      router.replace('/leaderboard');
      return;
    }
    opponentId.value = '';
    filterWins.value = true;
    filterLosses.value = true;
    loadMatches();
  }
);

watch(isAdmin, (next) => {
  if (!next) {
    includeInactive.value = false;
  }
  loadProfiles();
});

watch([editTeamAPlayer1Id, editTeamAPlayer2Id, editTeamBPlayer1Id, editTeamBPlayer2Id], () => {
  editGridApi.value?.refreshHeader();
});

watch(editMatchType, (next) => {
  if (next === 'singles') {
    editTeamAPlayer2Id.value = '';
    editTeamBPlayer2Id.value = '';
  }
  editGridApi.value?.refreshHeader();
});

watch(editMatchFormat, (next) => {
  syncEditRows(gamesByFormat[next]);
  if (editValidationErrors.value.length || Object.keys(editCellErrors.value).length) {
    editValidationErrors.value = [];
    editCellErrors.value = {};
    editGridApi.value?.refreshCells({ force: true });
  }
});

onMounted(() => {
  loadProfiles();
  if (profile.value) {
    if (!targetPlayerId.value) {
      router.replace('/leaderboard');
      return;
    }
    loadMatches();
  }
});
</script>

<template>
  <div class="page-root">
    <section class="page">
      <header class="page-header page-header--with-actions">
        <div>
          <h2 v-if="targetPlayerLabel">{{ targetPlayerLabel }}'s matches</h2>
          <h2 v-else>Matches</h2>
          <p v-if="!targetPlayerLabel">Viewing match history.</p>
        </div>
        <button class="ghost-btn" type="button" @click="openFilterDialog">Filters</button>
      </header>

      <div
        class="mode-toggle auth-toggle match-type-toggle match-type-toggle--page"
        role="tablist"
        aria-label="Match type"
      >
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

      <div v-if="matchesLoading" class="form-message">Loading matches...</div>
      <div v-else-if="matchesError" class="form-message is-error">{{ matchesError }}</div>
      <div v-else-if="!visibleMatches.length" class="form-message">No matches found.</div>

      <section v-else class="match-list">
        <article
          v-for="match in visibleMatches"
          :key="match.id"
          class="match-card"
          :class="{ 'is-deleted': !match.is_active }"
        >
          <div class="match-card__header">
            <div>
              <p class="match-card__date">
                <span class="match-type-pill">{{ matchTypeBadge(match) }}</span>
                {{ matchDateLabel(match.match_date) }}
              </p>
              <h3 class="match-card__players">{{ matchPlayersLabel(match) }}</h3>
              <p class="match-card__detail">{{ matchFormatLabel(match.match_format) }}</p>
            </div>
            <div class="match-card__score">
              <div class="match-card__pills">
                <span
                  v-if="matchEloDeltaLabel(match) !== null"
                  class="match-card__elo"
                  :class="matchEloDeltaClass(match)"
                >
                  Elo {{ matchEloDeltaLabel(match) }}
                </span>
                <span
                  v-if="matchOutcome(match)"
                  class="match-card__outcome"
                  :class="matchOutcome(match) === 'Win' ? 'is-win' : 'is-loss'"
                >
                  {{ matchOutcome(match) }}
                </span>
              </div>
              <span class="match-card__result">{{ matchScoreLabel(match) }}</span>
              <span class="match-card__format">{{ matchFormatLabel(match.match_format) }}</span>
            </div>
          </div>
          <div class="match-card__actions">
            <span v-if="!match.is_active" class="match-card__status">Deleted</span>
            <button class="ghost-btn" type="button" @click="openMatchDialog(match)">View / Edit</button>
          </div>
        </article>
      </section>
    </section>

    <dialog ref="filterDialogRef" class="filter-dialog">
      <form method="dialog" class="filter-dialog__card" @submit.prevent>
        <header class="filter-dialog__header">
          <h2>Filters</h2>
          <button type="button" class="filter-dialog__close" @click="closeFilterDialog">X</button>
        </header>

        <div class="filter-dialog__body">
          <label class="field">
            <span>Opponent</span>
            <select v-model="opponentId" :disabled="profilesLoading">
              <option value="">All opponents</option>
              <option v-for="player in opponentOptions" :key="player.id" :value="player.id">
                {{ formatPlayerLabel(player) }}
              </option>
            </select>
            <span v-if="profilesError" class="field-hint is-error">{{ profilesError }}</span>
          </label>

          <div class="filter-date-row">
            <label class="field">
              <span>Date from</span>
              <input v-model="dateFrom" type="date" :max="maxMatchDate" />
            </label>

            <label class="field">
              <span>Date to</span>
              <input v-model="dateTo" type="date" :max="maxMatchDate" />
            </label>
          </div>

          <label class="field">
            <span>Sort by</span>
            <select v-model="sortOrder">
              <option value="">No sorting</option>
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

        <div class="filter-toggle-group">
          <label class="filter-toggle">
            <input v-model="filterWins" type="checkbox" />
            <span>Wins</span>
          </label>
          <label class="filter-toggle">
            <input v-model="filterLosses" type="checkbox" />
            <span>Losses</span>
          </label>
        </div>

        <label v-if="isAdmin" class="filter-toggle">
          <input v-model="includeInactive" type="checkbox" />
          <span>Include inactive</span>
        </label>
        </div>

        <div class="filter-dialog__actions">
          <button type="button" class="ghost-btn" @click="closeFilterDialog">Close</button>
        </div>
      </form>
    </dialog>

    <dialog ref="dialogRef" class="match-dialog" @close="resetEditState">
      <form method="dialog" class="match-dialog__card" @submit.prevent>
        <header class="match-dialog__header">
          <div>
            <p class="eyebrow">Match editor</p>
            <h2>Update match</h2>
          </div>
          <button type="button" class="match-dialog__close" @click="closeMatchDialog">X</button>
        </header>

        <p class="match-dialog__copy">Edit match details, scores, and notes.</p>

        <div v-if="editLoading" class="form-message">Loading match...</div>
        <div v-else-if="editError" class="form-message is-error">{{ editError }}</div>

        <div v-if="editMatch" class="match-dialog__body">
          <div class="mode-toggle auth-toggle match-type-toggle" role="tablist" aria-label="Match type">
            <button
              type="button"
              class="auth-toggle__btn"
              :class="{ 'is-active': editMatchType === 'doubles' }"
              role="tab"
              :aria-selected="editMatchType === 'doubles'"
              :disabled="!canEditPlayers"
              @click="canEditPlayers && (editMatchType = 'doubles')"
            >
              Doubles
            </button>
            <button
              type="button"
              class="auth-toggle__btn"
              :class="{ 'is-active': editMatchType === 'singles' }"
              role="tab"
              :aria-selected="editMatchType === 'singles'"
              :disabled="!canEditPlayers"
              @click="canEditPlayers && (editMatchType = 'singles')"
            >
              Singles
            </button>
          </div>

          <div class="matchup-row">
            <div class="team-stack">
              <label class="field matchup-field">
                <span>Team A - Player 1</span>
                <select v-model="editTeamAPlayer1Id" :disabled="!canEditPlayers">
                  <option value="" disabled>Select player</option>
                  <option v-for="player in editTeamAPlayer1Options" :key="player.id" :value="player.id">
                    {{ formatPlayerLabel(player) }}
                  </option>
                </select>
              </label>

              <label v-if="isEditDoubles" class="field matchup-field">
                <span>Team A - Player 2</span>
                <select v-model="editTeamAPlayer2Id" :disabled="!canEditPlayers">
                  <option value="" disabled>Select player</option>
                  <option v-for="player in editTeamAPlayer2Options" :key="player.id" :value="player.id">
                    {{ formatPlayerLabel(player) }}
                  </option>
                </select>
              </label>
            </div>

            <span class="matchup-vs">vs.</span>

            <div class="team-stack">
              <label class="field matchup-field">
                <span>Team B - Player 1</span>
                <select v-model="editTeamBPlayer1Id" :disabled="!canEditPlayers">
                  <option value="" disabled>Select player</option>
                  <option v-for="player in editTeamBPlayer1Options" :key="player.id" :value="player.id">
                    {{ formatPlayerLabel(player) }}
                  </option>
                </select>
              </label>

              <label v-if="isEditDoubles" class="field matchup-field">
                <span>Team B - Player 2</span>
                <select v-model="editTeamBPlayer2Id" :disabled="!canEditPlayers">
                  <option value="" disabled>Select player</option>
                  <option v-for="player in editTeamBPlayer2Options" :key="player.id" :value="player.id">
                    {{ formatPlayerLabel(player) }}
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div class="field-row field-row--inline">
            <label class="field">
              <span>Match date</span>
              <input v-model="editMatchDate" type="date" :max="maxMatchDate" :disabled="!canEditDate" />
            </label>

            <span class="inline-spacer" aria-hidden="true"></span>

            <label class="field">
              <span>Match format</span>
              <select v-model="editMatchFormat" :disabled="!canEditScores">
                <option v-for="option in formatOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <div class="score-grid-wrapper">
            <ag-grid-vue
              class="ag-theme-quartz score-grid"
              :grid-options="gridOptions"
              :column-defs="columnDefs"
              :row-data="editRows"
              :default-col-def="defaultColDef"
              :suppress-movable-columns="true"
              :row-selection="'none'"
              :dom-layout="'autoHeight'"
              :stop-editing-when-cells-lose-focus="true"
              :single-click-edit="true"
              :suppress-row-click-selection="true"
              :suppress-horizontal-scroll="true"
              @grid-ready="handleEditGridReady"
              @cell-value-changed="handleEditCellValueChanged"
            />
          </div>

          <details class="notes-toggle">
            <summary class="notes-toggle__summary">
              <span>Notes (optional)</span>
              <span class="notes-toggle__action notes-toggle__action--closed">Add notes</span>
              <span class="notes-toggle__action notes-toggle__action--open">Hide notes</span>
            </summary>
            <div class="notes-toggle__body">
              <textarea
                v-model="editNotes"
                rows="3"
                placeholder="Optional context or corrections"
                :disabled="!canEditScores"
              ></textarea>
            </div>
          </details>

          <div v-if="editValidationErrors.length" class="form-message is-error">
            <p>Fix the following before saving:</p>
            <ul class="error-list">
              <li v-for="(error, index) in editValidationErrors" :key="index">{{ error }}</li>
            </ul>
          </div>
        </div>

        <div class="match-dialog__actions">
          <button
            v-if="canVoid"
            type="button"
            class="ghost-btn ghost-btn--danger"
            :disabled="editSubmitting"
            @click="handleVoid"
          >
            Delete
          </button>
          <button class="primary-btn" type="button" :disabled="editSubmitting || !canEditMatch" @click="handleSave">
            {{ editSubmitting ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.page-header--with-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
}

.match-type-toggle {
  margin-bottom: var(--space-md);
}

.match-type-toggle--page {
  width: min(360px, 100%);
}

.filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  padding: var(--space-xs) var(--space-sm);
  font-size: 14px;
  color: var(--text-muted);
}

.filter-toggle input {
  width: 16px;
  height: 16px;
}

.filter-toggle-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.filter-dialog {
  width: min(560px, 94vw);
  border: none;
  padding: 0;
  background: transparent;
  margin: auto;
}

.filter-dialog::backdrop {
  background: var(--overlay-backdrop);
  backdrop-filter: blur(4px);
}

.filter-dialog__card {
  background: var(--surface-card);
  color: var(--text-primary);
  border-radius: var(--radius-card);
  border: 1px solid var(--brand-tint-08);
  box-shadow: var(--shadow-card);
  padding: var(--space-xl);
  display: grid;
  gap: var(--space-md);
}

.filter-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.filter-dialog__close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}

.filter-dialog__body {
  display: grid;
  gap: var(--space-sm);
}

.filter-date-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-sm);
}

.filter-dialog__actions {
  display: flex;
  justify-content: flex-end;
}

.match-list {
  display: grid;
  gap: var(--space-md);
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}

.match-card {
  background: var(--surface-card);
  border-radius: var(--radius-card);
  padding: var(--space-md);
  border: 1px solid var(--brand-tint-08);
  box-shadow: var(--shadow-card);
  display: grid;
  gap: var(--space-sm);
}

.match-card.is-deleted {
  opacity: 0.75;
  border-style: dashed;
}

.match-card__header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
}

.match-card__date {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.match-type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--brand-tint-20);
  color: var(--text-primary);
  font-weight: 700;
  font-size: 11px;
}

.match-card__players {
  font-size: 16px;
  margin-top: var(--space-2xs);
}

.match-card__detail {
  margin-top: var(--space-2xs);
  font-size: 13px;
  color: var(--text-muted);
}

.match-card__score {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.match-card__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.match-card__outcome {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}

.match-card__outcome.is-win {
  color: var(--status-success);
  background: var(--status-success-bg);
  border-color: var(--status-success-border);
}

.match-card__outcome.is-loss {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}

.match-card__result {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-card__format {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.match-card__elo {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}

.match-card__elo.is-gain {
  color: var(--status-success);
  background: var(--status-success-bg);
  border-color: var(--status-success-border);
}

.match-card__elo.is-loss {
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
}

.match-card__elo.is-flat {
  color: var(--text-muted);
  background: var(--surface-input);
  border-color: var(--border-subtle);
}

.match-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.match-card__status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  padding: 4px 8px;
  border-radius: var(--radius-pill);
}

.match-dialog {
  width: min(720px, 96vw);
  border: none;
  padding: 0;
  background: transparent;
  margin: auto;
}

.match-dialog::backdrop {
  background: var(--overlay-backdrop);
  backdrop-filter: blur(4px);
}

.match-dialog__card {
  background: var(--surface-card);
  color: var(--text-primary);
  border-radius: var(--radius-card);
  border: 1px solid var(--brand-tint-08);
  box-shadow: var(--shadow-card);
  padding: var(--space-2xl);
  display: grid;
  gap: var(--space-md);
  max-height: 90vh;
  overflow-y: auto;
}

.match-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.match-dialog__close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}

.match-dialog__copy {
  color: var(--text-muted);
}

.match-dialog__body {
  display: grid;
  gap: var(--space-md);
}

.match-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-sm);
}

.score-grid-wrapper {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 320px;
  overscroll-behavior-x: none;
}

.matchup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: var(--space-sm);
}

.team-stack {
  display: grid;
  gap: var(--space-sm);
}

.matchup-vs {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-muted);
  padding-bottom: 6px;
}

.matchup-field select {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: var(--space-sm);
  padding-right: calc(var(--space-sm) + 20px);
  font-size: 13px;
}

.field-row--inline {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: var(--space-sm);
}

.inline-spacer {
  display: block;
  width: 100%;
  height: 1px;
}

.score-grid {
  width: 100%;
  border-radius: var(--radius-card);
  border: 1px solid var(--brand-tint-08);
  overflow: hidden;
  --ag-background-color: var(--surface-card);
  --ag-header-background-color: var(--surface-card);
  --ag-odd-row-background-color: var(--surface-card);
  --ag-row-hover-color: var(--brand-tint-08);
  --ag-foreground-color: var(--text-primary);
  --ag-secondary-foreground-color: var(--text-muted);
  --ag-border-color: var(--border-subtle);
  --ag-row-border-color: var(--border-subtle);
  --ag-input-border-color: var(--border-subtle);
  --ag-control-panel-background-color: var(--surface-card);
}

.score-grid :deep(.ag-root-wrapper) {
  border: none;
}

.score-grid :deep(.ag-header-cell-label) {
  justify-content: center;
}

.score-grid :deep(.ag-header-cell) {
  padding: 0 2px;
}

.score-grid :deep(.ag-cell) {
  font-size: 14px;
  padding: 0 2px;
}

.score-grid :deep(.grid-cell-error) {
  background: rgba(183, 56, 45, 0.15);
}

.score-grid :deep(.game-label) {
  font-weight: 600;
  color: var(--text-muted);
}

.score-grid :deep(.ag-body-viewport) {
  overflow-x: hidden !important;
}

.score-grid :deep(.ag-header-viewport) {
  overflow-x: hidden !important;
}

.score-grid :deep(.ag-body-horizontal-scroll),
.score-grid :deep(.ag-horizontal-left-spacer),
.score-grid :deep(.ag-horizontal-right-spacer) {
  display: none !important;
}

.notes-toggle {
  border: 1px solid var(--brand-tint-08);
  border-radius: var(--radius-card);
  background: var(--surface-card);
  padding: var(--space-sm) var(--space-md);
}

.notes-toggle__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
  list-style: none;
}

.notes-toggle__summary::-webkit-details-marker {
  display: none;
}

.notes-toggle__action {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-primary);
  background: var(--surface-input);
}

.notes-toggle__action--open {
  display: none;
}

.notes-toggle[open] .notes-toggle__action--open {
  display: inline-flex;
}

.notes-toggle[open] .notes-toggle__action--closed {
  display: none;
}

.notes-toggle__body {
  margin-top: var(--space-sm);
}

.notes-toggle__body textarea {
  width: 100%;
}

.error-list {
  margin-top: var(--space-xs);
  padding-left: 18px;
  display: grid;
  gap: var(--space-2xs);
}
</style>
