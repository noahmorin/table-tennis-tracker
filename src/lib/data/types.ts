export type DbTimestamp = string;

export type MatchFormat = 'bo1' | 'bo3' | 'bo5' | 'bo7';
export type CompetitionType = 'ranked' | 'tournament';
export type MatchType = 'singles' | 'doubles';
export type MatchSide = 'A' | 'B';

export type ProfileRow = {
  id: string;
  auth_user_id: string | null;
  username: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: DbTimestamp;
  created_by: string | null;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};

export type MatchRow = {
  id: string;
  match_type: MatchType;
  match_format: MatchFormat;
  match_date: string;
  competition_type: CompetitionType;
  competition_id: string | null;
  notes: string | null;
  side_a_games_won: number;
  side_b_games_won: number;
  winner_side: MatchSide;
  loser_side: MatchSide;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
  team_a?: string[] | null;
  team_b?: string[] | null;
};

export type GameRow = {
  id: string;
  match_id: string;
  game_number: number;
  side_a_score: number;
  side_b_score: number;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};

export type CompetitionRow = {
  id: string;
  name: string;
  format: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};

export type AuditLogRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_data: unknown | null;
  after_data: unknown | null;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
};

export type BugReportRow = {
  id: string;
  title: string;
  description: string;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};

export type BugReportInput = {
  title: string;
  description: string;
};

export type GameInput = {
  game_number: number;
  side_a_score: number;
  side_b_score: number;
};

export type CreateMatchInput = {
  matchId?: string;
  matchType: MatchType;
  matchDate: string;
  matchFormat: MatchFormat;
  competitionType?: CompetitionType;
  competitionId?: string | null;
  teamA: string[];
  teamB: string[];
  games: GameInput[];
  notes?: string | null;
};

export type UpdateMatchInput = {
  matchId: string;
  matchType: MatchType;
  matchDate: string;
  matchFormat: MatchFormat;
  competitionType: CompetitionType;
  competitionId: string | null;
  teamA: string[];
  teamB: string[];
  games: GameInput[];
  notes?: string | null;
};

export type DbResult<T> = {
  data: T | null;
  error: string | null;
};

export type MatchParticipantRow = {
  id: string;
  match_id: string;
  player_id: string;
  side: MatchSide;
  slot: number;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};
