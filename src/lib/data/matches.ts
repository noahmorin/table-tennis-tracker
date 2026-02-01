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
  'id, player1_id, player2_id, winner_user_id, loser_user_id, player1_games_won, player2_games_won, match_format, match_date, competition_type, competition_id, notes, is_active, created_at, created_by, updated_at, updated_by';

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
}): Promise<DbResult<MatchRow[]>> => {
  const includeInactive = options?.includeInactive ?? false;
  let query = supabase.from('matches').select(matchSelect);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  if (options?.playerId) {
    query = query.or(`player1_id.eq.${options.playerId},player2_id.eq.${options.playerId}`);
  }

  if (options?.competitionId) {
    query = query.eq('competition_id', options.competitionId);
  }

  if (options?.competitionType) {
    query = query.eq('competition_type', options.competitionType);
  }

  if (options?.dateFrom) {
    query = query.gte('match_date', options.dateFrom);
  }

  if (options?.dateTo) {
    query = query.lte('match_date', options.dateTo);
  }

  const { data, error } = await query
    .order('match_date', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  return { data: (data as MatchRow[]) ?? null, error: mapDbError(error) };
};

export const getMatchById = async (id: string): Promise<DbResult<MatchRow>> => {
  const { data, error } = await supabase
    .from('matches')
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
    p_player1_id: input.player1Id,
    p_player2_id: input.player2Id,
    p_match_date: input.matchDate,
    p_match_format: input.matchFormat,
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
    p_games: input.games,
    p_notes: input.notes ?? null,
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
    return { data: null, error: mapDbError(rpcError, 'Unable to void match.') };
  }

  return { data: { id: matchId }, error: null };
};
