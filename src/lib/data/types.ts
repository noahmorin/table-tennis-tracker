export type DbTimestamp = string;

export type MatchFormat = 'bo1' | 'bo3' | 'bo5' | 'bo7';
export type CompetitionType = 'ranked' | 'tournament';

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
  player1_id: string;
  player2_id: string;
  winner_user_id: string | null;
  loser_user_id: string | null;
  player1_games_won: number;
  player2_games_won: number;
  match_format: MatchFormat;
  match_date: string;
  competition_type: CompetitionType;
  competition_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: DbTimestamp;
  created_by: string;
  updated_at: DbTimestamp | null;
  updated_by: string | null;
};

export type GameRow = {
  id: string;
  match_id: string;
  game_number: number;
  player1_score: number;
  player2_score: number;
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

export type GameInput = {
  game_number: number;
  player1_score: number;
  player2_score: number;
};

export type CreateMatchInput = {
  matchId?: string;
  player1Id: string;
  player2Id: string;
  matchDate: string;
  matchFormat: MatchFormat;
  games: GameInput[];
  notes?: string | null;
};

export type UpdateMatchInput = {
  matchId: string;
  games: GameInput[];
  notes?: string | null;
};

export type DbResult<T> = {
  data: T | null;
  error: string | null;
};
