<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { AgGridVue } from 'ag-grid-vue3';
import type { ColDef, CellValueChangedEvent, GridApi, GridOptions, GridReadyEvent } from 'ag-grid-community';
import { listProfiles } from '../lib/data/profiles';
import { createMatch } from '../lib/data/matches';
import type { CompetitionType, GameInput, MatchFormat, MatchType, ProfileRow } from '../lib/data/types';
import { useAuth } from '../stores/auth';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

const { profile, isAdmin } = useAuth();

const todayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const matchType = ref<MatchType>('doubles');
const matchDate = ref(todayString());
const matchFormat = ref<MatchFormat>('bo3');
const competitionType = ref<CompetitionType>('ranked');
const notes = ref('');
const teamAPlayer1Id = ref('');
const teamAPlayer2Id = ref('');
const teamBPlayer1Id = ref('');
const teamBPlayer2Id = ref('');

const players = ref<ProfileRow[]>([]);
const playersLoading = ref(false);
const playersError = ref<string | null>(null);

const submitting = ref(false);
const successMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const validationErrors = ref<string[]>([]);
const cellErrors = ref<Record<string, string>>({});
const gridApi = ref<GridApi | null>(null);

type GameRow = {
  gameNumber: number;
  sideAScore: number | string | null;
  sideBScore: number | string | null;
};

const buildGameRow = (gameNumber: number): GameRow => ({
  gameNumber,
  sideAScore: null,
  sideBScore: null
});

const rowData = ref<GameRow[]>([]);

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

const gameCount = computed(() => gamesByFormat[matchFormat.value]);
const neededWins = computed(() => Math.floor(gameCount.value / 2) + 1);
const maxMatchDate = computed(() => todayString());

const syncGameRows = (count: number) => {
  const next = rowData.value.slice(0, count);
  for (let i = next.length + 1; i <= count; i += 1) {
    next.push(buildGameRow(i));
  }
  rowData.value = next.map((row, index) => ({
    ...row,
    gameNumber: index + 1
  }));
};

syncGameRows(gameCount.value);

const playerMap = computed(() => {
  const map = new Map<string, ProfileRow>();
  players.value.forEach((player) => {
    map.set(player.id, player);
  });
  return map;
});

const formatPlayerLabel = (player: ProfileRow) => {
  const base = player.display_name?.trim() || player.username;
  return player.is_active ? base : `${base} (inactive)`;
};

const playerLabelForId = (id: string) => {
  const player = playerMap.value.get(id);
  return player ? formatPlayerLabel(player) : '';
};

const isDoubles = computed(() => matchType.value === 'doubles');

const teamAIds = computed(() => {
  const ids = [teamAPlayer1Id.value];
  if (isDoubles.value) {
    ids.push(teamAPlayer2Id.value);
  }
  return ids.filter(Boolean);
});

const teamBIds = computed(() => {
  const ids = [teamBPlayer1Id.value];
  if (isDoubles.value) {
    ids.push(teamBPlayer2Id.value);
  }
  return ids.filter(Boolean);
});

const teamALabel = computed(() => {
  const labels = teamAIds.value.map((id) => playerLabelForId(id)).filter(Boolean);
  return labels.length ? `Team A: ${labels.join(' & ')}` : 'Team A';
});

const teamBLabel = computed(() => {
  const labels = teamBIds.value.map((id) => playerLabelForId(id)).filter(Boolean);
  return labels.length ? `Team B: ${labels.join(' & ')}` : 'Team B';
});

const selectedIds = computed(() => new Set([...teamAIds.value, ...teamBIds.value].filter(Boolean)));

const buildPlayerOptions = (currentId: string) =>
  players.value.filter((player) => player.id === currentId || !selectedIds.value.has(player.id));

const teamAPlayer1Options = computed(() => buildPlayerOptions(teamAPlayer1Id.value));
const teamAPlayer2Options = computed(() => buildPlayerOptions(teamAPlayer2Id.value));
const teamBPlayer1Options = computed(() => buildPlayerOptions(teamBPlayer1Id.value));
const teamBPlayer2Options = computed(() => buildPlayerOptions(teamBPlayer2Id.value));

const clearScores = () => {
  rowData.value.forEach((row) => {
    row.sideAScore = null;
    row.sideBScore = null;
  });
};

const resetMessages = () => {
  successMessage.value = null;
  errorMessage.value = null;
  validationErrors.value = [];
  cellErrors.value = {};
};

const resetForm = () => {
  matchType.value = 'doubles';
  matchDate.value = todayString();
  matchFormat.value = 'bo3';
  syncGameRows(gamesByFormat.bo3);
  notes.value = '';
  teamAPlayer2Id.value = '';
  teamBPlayer1Id.value = '';
  teamBPlayer2Id.value = '';
  if (isAdmin.value) {
    teamAPlayer1Id.value = '';
  } else if (profile.value?.id) {
    teamAPlayer1Id.value = profile.value.id;
  }
  clearScores();
  resetMessages();
};

const loadPlayers = async () => {
  playersLoading.value = true;
  playersError.value = null;
  try {
    const { data, error } = await listProfiles({ includeInactive: isAdmin.value });
    if (error) {
      playersError.value = error;
      players.value = [];
    } else {
      players.value = data ?? [];
    }
  } catch (err) {
    playersError.value =
      err instanceof Error ? err.message : 'Network error loading players.';
    players.value = [];
  } finally {
    playersLoading.value = false;
    gridApi.value?.refreshHeader();
  }
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

const validateMatch = () => {
  const errors: string[] = [];
  const nextCellErrors: Record<string, string> = {};
  const games: GameInput[] = [];

  if (!matchDate.value) {
    errors.push('Match date is required.');
  } else if (matchDate.value > maxMatchDate.value) {
    errors.push('Match date cannot be in the future.');
  }

  if (!teamAPlayer1Id.value) {
    errors.push('Team A player 1 is required.');
  }

  if (isDoubles.value && !teamAPlayer2Id.value) {
    errors.push('Team A player 2 is required.');
  }

  if (!teamBPlayer1Id.value) {
    errors.push('Team B player 1 is required.');
  }

  if (isDoubles.value && !teamBPlayer2Id.value) {
    errors.push('Team B player 2 is required.');
  }

  const selectedPlayers = [
    teamAPlayer1Id.value,
    isDoubles.value ? teamAPlayer2Id.value : '',
    teamBPlayer1Id.value,
    isDoubles.value ? teamBPlayer2Id.value : ''
  ].filter(Boolean);
  if (selectedPlayers.length !== new Set(selectedPlayers).size) {
    errors.push('Players must be unique across both teams.');
  }

  if (!isAdmin.value && profile.value?.id && teamAPlayer1Id.value !== profile.value.id) {
    errors.push('Team A player 1 must be your profile.');
  }

  let wins1 = 0;
  let wins2 = 0;
  let matchDecided = false;
  let foundGap = false;

  for (let i = 1; i <= gameCount.value; i += 1) {
    const row = rowData.value[i - 1] ?? buildGameRow(i);
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

    if (wins1 >= neededWins.value || wins2 >= neededWins.value) {
      matchDecided = true;
    }
  }

  if (games.length === 0) {
    errors.push('At least one set is required.');
  }

  if (wins1 < neededWins.value && wins2 < neededWins.value) {
    errors.push(`Match is incomplete for ${matchFormat.value}.`);
  }

  return { errors, cellErrors: nextCellErrors, games };
};

const handleCellValueChanged = (_event: CellValueChangedEvent) => {
  if (validationErrors.value.length || Object.keys(cellErrors.value).length) {
    validationErrors.value = [];
    cellErrors.value = {};
    gridApi.value?.refreshCells({ force: true });
  }
};

const handleGridReady = (event: GridReadyEvent) => {
  gridApi.value = event.api;
};

const handleSubmit = async () => {
  resetMessages();

  const { errors, cellErrors: nextCellErrors, games } = validateMatch();
  if (errors.length > 0) {
    validationErrors.value = errors;
    cellErrors.value = nextCellErrors;
    gridApi.value?.refreshCells({ force: true });
    return;
  }

  submitting.value = true;
  const { error } = await createMatch({
    matchType: matchType.value,
    matchDate: matchDate.value,
    matchFormat: matchFormat.value,
    competitionType: competitionType.value,
    competitionId: null,
    teamA: isDoubles.value
      ? [teamAPlayer1Id.value, teamAPlayer2Id.value]
      : [teamAPlayer1Id.value],
    teamB: isDoubles.value
      ? [teamBPlayer1Id.value, teamBPlayer2Id.value]
      : [teamBPlayer1Id.value],
    games,
    notes: notes.value.trim() ? notes.value.trim() : null
  });
  submitting.value = false;

  if (error) {
    errorMessage.value = error;
    return;
  }

  successMessage.value = 'Match submitted successfully.';
  resetForm();
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
    headerName: teamALabel.value,
    field: 'sideAScore',
    editable: true,
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
        return Boolean(cellErrors.value[key]);
      }
    }
  },
  {
    headerName: teamBLabel.value,
    field: 'sideBScore',
    editable: true,
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
        return Boolean(cellErrors.value[key]);
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

watch([teamAPlayer1Id, teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id], () => {
  gridApi.value?.refreshHeader();
});

watch(matchType, (next) => {
  if (next === 'singles') {
    teamAPlayer2Id.value = '';
    teamBPlayer2Id.value = '';
  }
  gridApi.value?.refreshHeader();
});

watch(matchFormat, (next) => {
  syncGameRows(gamesByFormat[next]);
  if (validationErrors.value.length || Object.keys(cellErrors.value).length) {
    validationErrors.value = [];
    cellErrors.value = {};
    gridApi.value?.refreshCells({ force: true });
  }
});

watch([profile, isAdmin], () => {
  if (!isAdmin.value && profile.value?.id) {
    teamAPlayer1Id.value = profile.value.id;
  }
  loadPlayers();
});

onMounted(() => {
  if (!isAdmin.value && profile.value?.id) {
    teamAPlayer1Id.value = profile.value.id;
  }
  loadPlayers();
});
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h2>Submit Match</h2>
    </header>

    <form class="form-card" @submit.prevent="handleSubmit">
      <div class="mode-toggle auth-toggle" role="tablist" aria-label="Match type">
        <button
          type="button"
          class="auth-toggle__btn"
          :class="{ 'is-active': matchType === 'doubles' }"
          role="tab"
          :aria-selected="matchType === 'doubles'"
          @click="matchType = 'doubles'"
        >
          Doubles
        </button>
        <button
          type="button"
          class="auth-toggle__btn"
          :class="{ 'is-active': matchType === 'singles' }"
          role="tab"
          :aria-selected="matchType === 'singles'"
          @click="matchType = 'singles'"
        >
          Singles
        </button>
      </div>

      <div class="matchup-row">
        <div class="team-stack">
          <label class="field matchup-field">
            <span>Team A - Player 1</span>
            <select v-model="teamAPlayer1Id" :disabled="!isAdmin || playersLoading">
              <option value="" disabled>Select player</option>
              <option v-for="player in teamAPlayer1Options" :key="player.id" :value="player.id">
                {{ formatPlayerLabel(player) }}
              </option>
            </select>
          </label>

          <label v-if="isDoubles" class="field matchup-field">
            <span>Team A - Player 2</span>
            <select v-model="teamAPlayer2Id" :disabled="playersLoading">
              <option value="" disabled>Select player</option>
              <option v-for="player in teamAPlayer2Options" :key="player.id" :value="player.id">
                {{ formatPlayerLabel(player) }}
              </option>
            </select>
          </label>
        </div>

        <span class="matchup-vs">vs.</span>

        <div class="team-stack">
          <label class="field matchup-field">
            <span>Team B - Player 1</span>
            <select v-model="teamBPlayer1Id" :disabled="playersLoading">
              <option value="" disabled>Select player</option>
              <option v-for="player in teamBPlayer1Options" :key="player.id" :value="player.id">
                {{ formatPlayerLabel(player) }}
              </option>
            </select>
          </label>

          <label v-if="isDoubles" class="field matchup-field">
            <span>Team B - Player 2</span>
            <select v-model="teamBPlayer2Id" :disabled="playersLoading">
              <option value="" disabled>Select player</option>
              <option v-for="player in teamBPlayer2Options" :key="player.id" :value="player.id">
                {{ formatPlayerLabel(player) }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <div class="field-row field-row--inline">
        <label class="field">
          <span>Match date</span>
          <input v-model="matchDate" type="date" :max="maxMatchDate" />
        </label>

        <span class="inline-spacer" aria-hidden="true"></span>

        <label class="field">
          <span>Match format</span>
          <select v-model="matchFormat">
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
          :row-data="rowData"
          :default-col-def="defaultColDef"
          :suppress-movable-columns="true"
          :row-selection="'none'"
          :dom-layout="'autoHeight'"
          :stop-editing-when-cells-lose-focus="true"
          :single-click-edit="true"
          :suppress-row-click-selection="true"
          :suppress-horizontal-scroll="true"
          @grid-ready="handleGridReady"
          @cell-value-changed="handleCellValueChanged"
        />
      </div>

      <details class="notes-toggle">
        <summary class="notes-toggle__summary">
          <span>Notes (optional)</span>
          <span class="notes-toggle__action notes-toggle__action--closed">Add notes</span>
          <span class="notes-toggle__action notes-toggle__action--open">Hide notes</span>
        </summary>
        <div class="notes-toggle__body">
          <textarea v-model="notes" rows="3" placeholder="Optional context or corrections"></textarea>
        </div>
      </details>

      <button class="primary-btn" type="submit" :disabled="submitting || playersLoading">
        {{ submitting ? 'Submitting...' : 'Submit match' }}
      </button>

      <p v-if="successMessage" class="form-message is-success">{{ successMessage }}</p>
      <p v-if="errorMessage" class="form-message is-error">{{ errorMessage }}</p>
      <p v-if="playersError" class="form-message is-error">{{ playersError }}</p>

      <div v-if="validationErrors.length" class="form-message is-error">
        <p>Fix the following before submitting:</p>
        <ul class="error-list">
          <li v-for="(error, index) in validationErrors" :key="index">{{ error }}</li>
        </ul>
      </div>
    </form>
  </section>
</template>

<style scoped>
.page {
  --radius-card: 14px;
  --radius-control: 10px;
  --radius-pill: 12px;
}

.form-card {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
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
  margin-bottom: var(--space-md);
  font-size: 13px;
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

.score-grid :deep(.ag-header-cell-label) {
  justify-content: center;
}

.score-grid :deep(.ag-header-cell) {
  padding: 0 4px;
}

.score-grid :deep(.ag-cell) {
  font-size: 14px;
  padding: 0 4px;
}

.score-grid :deep(.grid-cell-error) {
  background: rgba(183, 56, 45, 0.15);
}

.score-grid :deep(.game-label) {
  font-weight: 600;
  color: var(--text-muted);
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

.field-row--inline {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: var(--space-2xl);
}

.inline-spacer {
  display: block;
  width: 100%;
  height: 1px;
}

.error-list {
  margin-top: var(--space-xs);
  padding-left: 18px;
  display: grid;
  gap: var(--space-2xs);
}
</style>
