<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AgGridVue } from 'ag-grid-vue3';
import type { ColDef, GridOptions } from 'ag-grid-community';
import { listMatches } from '../lib/data/matches';
import { listGamesByMatchIds } from '../lib/data/games';
import { listProfiles } from '../lib/data/profiles';
import type { MatchRow, GameRow, ProfileRow } from '../lib/data/types';
import { buildMatchGameTotals, calculateEloRatings } from '../lib/elo';
import { eloConfig } from '../config/eloConfig';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

type LeaderRow = {
  id: string;
  name: string;
  rank: number;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winPct: number;
  setWins: number;
  setLosses: number;
  setDiff: number;
  pointsFor: number;
};

const loading = ref(false);
const error = ref<string | null>(null);
const rows = ref<LeaderRow[]>([]);
const searchTerm = ref('');

const formatPlayerLabel = (player: ProfileRow) => {
  const base = player.display_name?.trim() || player.username;
  return player.is_active ? base : `${base} (inactive)`;
};

const buildLeaderboardRows = (profiles: ProfileRow[], matches: MatchRow[], games: GameRow[]) => {
  const statsByPlayer = new Map<string, LeaderRow>();

  profiles.forEach((player) => {
    statsByPlayer.set(player.id, {
      id: player.id,
      name: formatPlayerLabel(player),
      rank: 0,
      elo: eloConfig.baseline,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winPct: 0,
      setWins: 0,
      setLosses: 0,
      setDiff: 0,
      pointsFor: 0
    });
  });

  matches.forEach((match) => {
    if (!statsByPlayer.has(match.player1_id)) {
      statsByPlayer.set(match.player1_id, {
        id: match.player1_id,
        name: 'Unknown player',
        rank: 0,
        elo: eloConfig.baseline,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        winPct: 0,
        setWins: 0,
        setLosses: 0,
        setDiff: 0,
        pointsFor: 0
      });
    }
    if (!statsByPlayer.has(match.player2_id)) {
      statsByPlayer.set(match.player2_id, {
        id: match.player2_id,
        name: 'Unknown player',
        rank: 0,
        elo: eloConfig.baseline,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        winPct: 0,
        setWins: 0,
        setLosses: 0,
        setDiff: 0,
        pointsFor: 0
      });
    }
  });

  const matchGameTotals = buildMatchGameTotals(matches, games);

  matches.forEach((match) => {
    const totals = matchGameTotals.get(match.id);
    if (!totals) {
      return;
    }

    const player1 = statsByPlayer.get(match.player1_id);
    const player2 = statsByPlayer.get(match.player2_id);
    if (!player1 || !player2) {
      return;
    }

    player1.matchesPlayed += 1;
    player2.matchesPlayed += 1;

    player1.setWins += totals.p1Wins;
    player1.setLosses += totals.p2Wins;
    player2.setWins += totals.p2Wins;
    player2.setLosses += totals.p1Wins;

    player1.pointsFor += totals.p1Points;
    player2.pointsFor += totals.p2Points;

    if (totals.p1Wins > totals.p2Wins) {
      player1.wins += 1;
      player2.losses += 1;
    } else if (totals.p2Wins > totals.p1Wins) {
      player2.wins += 1;
      player1.losses += 1;
    }
  });

  const eloByPlayer = calculateEloRatings(
    matches,
    matchGameTotals,
    Array.from(statsByPlayer.keys())
  );

  const list = Array.from(statsByPlayer.values()).map((row) => ({
    ...row,
    setDiff: row.setWins - row.setLosses,
    winPct: row.matchesPlayed > 0 ? row.wins / row.matchesPlayed : 0,
    elo: eloByPlayer.get(row.id) ?? row.elo
  }));

  list.sort((a, b) => {
    if (b.elo !== a.elo) {
      return b.elo - a.elo;
    }
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    if (b.setDiff !== a.setDiff) {
      return b.setDiff - a.setDiff;
    }
    if (b.pointsFor !== a.pointsFor) {
      return b.pointsFor - a.pointsFor;
    }
    return a.name.localeCompare(b.name);
  });

  list.forEach((row, index) => {
    row.rank = index + 1;
  });

  return list;
};

const filteredRows = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) {
    return rows.value;
  }
  return rows.value.filter((row) => row.name.toLowerCase().includes(term));
});

const loadLeaderboard = async () => {
  loading.value = true;
  error.value = null;

  try {
    const { data: profilesData, error: profilesError } = await listProfiles({ includeInactive: false });
    if (profilesError) {
      error.value = profilesError;
      rows.value = [];
      return;
    }

    const { data: matchesData, error: matchesError } = await listMatches({ includeInactive: false });
    if (matchesError) {
      error.value = matchesError;
      rows.value = [];
      return;
    }

    const matchIds = (matchesData ?? []).map((match) => match.id);
    const { data: gamesData, error: gamesError } = await listGamesByMatchIds(matchIds, {
      includeInactive: false
    });
    if (gamesError) {
      error.value = gamesError;
      rows.value = [];
      return;
    }

    rows.value = buildLeaderboardRows(profilesData ?? [], matchesData ?? [], gamesData ?? []);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load leaderboard.';
    rows.value = [];
  } finally {
    loading.value = false;
  }
};

const gridOptions = computed<GridOptions>(() => ({
  rowHeight: 44,
  headerHeight: 36
}));

const defaultColDef: ColDef = {
  sortable: true,
  resizable: false,
  suppressMovable: true
};

const columnDefs = computed<ColDef[]>(() => [
  {
    headerName: 'Rank',
    field: 'rank',
    colId: 'rank',
    width: 56,
    minWidth: 50,
    maxWidth: 70,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  },
  {
    headerName: 'Name',
    field: 'name',
    colId: 'name',
    flex: 1,
    minWidth: 140,
    cellRenderer: (params: any) => {
      const playerId = params.data?.id ?? '';
      const anchor = document.createElement('a');
      anchor.href = `#/players/${playerId}`;
      anchor.textContent = params.value ?? '';
      anchor.className = 'leaderboard-link';
      return anchor;
    }
  },
  {
    headerName: 'Elo',
    field: 'elo',
    colId: 'elo',
    width: 74,
    minWidth: 68,
    maxWidth: 88,
    cellClass: 'cell-center',
    headerClass: 'cell-center',
    valueFormatter: (params) => Math.round(params.value ?? 0).toString()
  },
  {
    headerName: 'Record',
    field: 'wins',
    colId: 'record',
    width: 86,
    minWidth: 76,
    maxWidth: 96,
    cellClass: 'cell-center',
    headerClass: 'cell-center',
    valueGetter: (params) => `${params.data?.wins ?? 0}-${params.data?.losses ?? 0}`,
    comparator: (_valueA, _valueB, nodeA, nodeB) => {
      const winsA = nodeA?.data?.wins ?? 0;
      const winsB = nodeB?.data?.wins ?? 0;
      if (winsA !== winsB) {
        return winsA - winsB;
      }
      const lossesA = nodeA?.data?.losses ?? 0;
      const lossesB = nodeB?.data?.losses ?? 0;
      return lossesB - lossesA;
    }
  },
  {
    headerName: 'Win %',
    field: 'winPct',
    colId: 'winPct',
    width: 76,
    minWidth: 68,
    maxWidth: 86,
    cellClass: 'cell-center',
    headerClass: 'cell-center',
    valueFormatter: (params) => {
      const played = params.data?.matchesPlayed ?? 0;
      if (!played) {
        return '-';
      }
      const value = params.value ?? 0;
      return `${(value * 100).toFixed(1)}%`;
    }
  },
  {
    headerName: 'Played',
    field: 'matchesPlayed',
    colId: 'played',
    width: 72,
    minWidth: 64,
    maxWidth: 80,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  },
  {
    headerName: 'Set W',
    field: 'setWins',
    colId: 'setWins',
    width: 66,
    minWidth: 58,
    maxWidth: 78,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  },
  {
    headerName: 'Set L',
    field: 'setLosses',
    colId: 'setLosses',
    width: 66,
    minWidth: 58,
    maxWidth: 78,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  },
  {
    headerName: 'Set +/-',
    field: 'setDiff',
    colId: 'setDiff',
    width: 72,
    minWidth: 64,
    maxWidth: 86,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  },
  {
    headerName: 'Points',
    field: 'pointsFor',
    colId: 'pointsFor',
    width: 72,
    minWidth: 64,
    maxWidth: 86,
    cellClass: 'cell-center',
    headerClass: 'cell-center'
  }
]);

onMounted(() => {
  loadLeaderboard();
});
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h2>Leaderboard</h2>
      <p>Rankings based on Elo ratings.</p>
    </header>

    <div class="leaderboard-controls">
      <input
        v-model="searchTerm"
        class="leaderboard-search"
        type="search"
        placeholder="Search by name"
        aria-label="Search leaderboard by name"
      />
    </div>

    <div v-if="loading" class="form-message">Loading leaderboard...</div>
    <div v-else-if="error" class="form-message is-error">{{ error }}</div>

    <div v-else class="leaderboard-grid">
      <ag-grid-vue
        class="ag-theme-quartz leaderboard-grid__table"
        :grid-options="gridOptions"
        :column-defs="columnDefs"
        :row-data="filteredRows"
        :default-col-def="defaultColDef"
        :row-selection="'none'"
        :dom-layout="'autoHeight'"
        :suppress-row-click-selection="true"
        :suppress-horizontal-scroll="true"
      />
    </div>
  </section>
</template>

<style scoped>
.leaderboard-grid {
  width: 100%;
}

.leaderboard-controls {
  display: flex;
  width: 100%;
}

.leaderboard-search {
  width: 100%;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  padding: var(--space-xs) var(--space-sm);
  font-size: 14px;
  font-family: 'Space Grotesk', sans-serif;
  background: var(--surface-input);
}

.leaderboard-grid__table {
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

.leaderboard-grid__table :deep(.ag-root-wrapper) {
  border: none;
}

.leaderboard-grid__table :deep(.ag-header-cell) {
  padding: 0 4px;
}

.leaderboard-grid__table :deep(.ag-cell) {
  padding: 0 4px;
  font-size: 14px;
}

.leaderboard-grid__table :deep(.ag-cell) {
  display: flex;
  align-items: center;
}

.leaderboard-grid__table :deep(.cell-center) {
  justify-content: center;
  text-align: center;
}

.leaderboard-grid__table :deep(.ag-header-cell.cell-center) .ag-header-cell-label {
  justify-content: center;
}

.leaderboard-grid__table :deep(.leaderboard-link) {
  color: var(--text-primary) !important;
  text-decoration: none !important;
  font-weight: 600;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.leaderboard-grid__table :deep(.leaderboard-link:hover) {
  text-decoration: underline !important;
}

.leaderboard-grid__table :deep(.leaderboard-link:visited) {
  color: var(--text-primary) !important;
}

.leaderboard-grid__table :deep(.leaderboard-link:focus-visible) {
  outline: 2px solid var(--brand-tint-24);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (max-width: 720px) {
  .leaderboard-grid__table :deep(.ag-header-cell) {
    padding: 0 2px;
  }

  .leaderboard-grid__table :deep(.ag-cell) {
    padding: 0 2px;
  }
}
</style>
