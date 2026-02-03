import { supabase } from '../supabaseClient';
import { mapDbError } from './errors';
import type {
  CreateMatchInput,
  DbResult,
  MatchRow,
  UpdateMatchInput
} from './types';
import { useAuth } from '../../stores/auth';

const matchSelect =
  'id, match_type, match_format, match_date, competition_type, competition_id, notes, side_a_games_won, side_b_games_won, winner_side, loser_side, is_active, created_at, created_by, updated_at, updated_by, team_a, team_b';

const createUuid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16;
    const value = char === 'x' ? rand : (rand % 4) + 8;
    return Math.floor(value).toString(16);
  });
};

const requireProfileId = () => {
  const { requireProfileId: authRequireProfileId } = useAuth();
  return authRequireProfileId();
};

export const listMatches = async (options?: {
  includeInactive?: boolean;
  playerId?: string;
  dateFrom?: string;
  dateTo?: string;
  competitionId?: string;
  competitionType?: 'ranked' | 'tournament';
  matchType?: 'singles' | 'doubles';
}): Promise<DbResult<MatchRow[]>> => {
  const includeInactive = options?.includeInactive ?? false;
  let query = supabase.from('match_team_rosters').select(matchSelect);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  if (options?.competitionId) {
    query = query.eq('competition_id', options.competitionId);
  }

  if (options?.competitionType) {
    query = query.eq('competition_type', options.competitionType);
  }

  if (options?.matchType) {
    query = query.eq('match_type', options.matchType);
  }

  if (options?.dateFrom) {
    query = query.gte('match_date', options.dateFrom);
  }

  if (options?.dateTo) {
    query = query.lte('match_date', options.dateTo);
  }

  const { data, error } = await query;

  let matches = (data as MatchRow[]) ?? [];
  if (options?.playerId) {
    const targetId = options.playerId;
    matches = matches.filter((match) => {
      const teamA = match.team_a ?? [];
      const teamB = match.team_b ?? [];
      return teamA.includes(targetId) || teamB.includes(targetId);
    });
  }

  return { data: matches, error: mapDbError(error) };
};

export const getMatchById = async (id: string): Promise<DbResult<MatchRow>> => {
  const { data, error } = await supabase
    .from('match_team_rosters')
    .select(matchSelect)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { data: null, error: mapDbError(error) };
  }

  return { data: (data as MatchRow) ?? null, error: data ? null : 'Match not found.' };
};

export const createMatch = async (input: CreateMatchInput): Promise<DbResult<{ id: string }>> => {
  const { profileId, error } = requireProfileId();
  if (error || !profileId) {
    return { data: null, error };
  }

  const matchId = input.matchId ?? createUuid();

  const { error: rpcError } = await supabase.rpc('match_create', {
    p_match_id: matchId,
    p_match_type: input.matchType,
    p_match_date: input.matchDate,
    p_match_format: input.matchFormat,
    p_competition_type: input.competitionType ?? 'ranked',
    p_competition_id: input.competitionId ?? null,
    p_team_a: input.teamA,
    p_team_b: input.teamB,
    p_games: input.games,
    p_notes: input.notes ?? null,
    p_created_by: profileId
  });

  if (rpcError) {
    return { data: null, error: mapDbError(rpcError, 'Unable to create match.') };
  }

  return { data: { id: matchId }, error: null };
};

export const updateMatch = async (input: UpdateMatchInput): Promise<DbResult<{ id: string }>> => {
  const { profileId, error } = requireProfileId();
  if (error || !profileId) {
    return { data: null, error };
  }

  const { error: rpcError } = await supabase.rpc('match_update', {
    p_match_id: input.matchId,
    p_match_type: input.matchType,
    p_match_date: input.matchDate,
    p_match_format: input.matchFormat,
    p_competition_type: input.competitionType,
    p_competition_id: input.competitionId,
    p_notes: input.notes ?? null,
    p_team_a: input.teamA,
    p_team_b: input.teamB,
    p_games: input.games,
    p_updated_by: profileId
  });

  if (rpcError) {
    return { data: null, error: mapDbError(rpcError, 'Unable to update match.') };
  }

  return { data: { id: input.matchId }, error: null };
};

export const voidMatch = async (matchId: string): Promise<DbResult<{ id: string }>> => {
  const { profileId, error } = requireProfileId();
  if (error || !profileId) {
    return { data: null, error };
  }

  const { error: rpcError } = await supabase.rpc('match_void', {
    p_match_id: matchId,
    p_updated_by: profileId
  });

  if (rpcError) {
    return { data: null, error: mapDbError(rpcError, 'Unable to delete match.') };
  }

  return { data: { id: matchId }, error: null };
};
