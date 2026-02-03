import { supabase } from '../supabaseClient';
import { mapDbError } from './errors';
import type { DbResult, GameRow } from './types';

const gameSelect =
  'id, match_id, game_number, side_a_score, side_b_score, is_active, created_at, created_by, updated_at, updated_by';

export const listGamesByMatchId = async (
  matchId: string,
  options?: { includeInactive?: boolean }
): Promise<DbResult<GameRow[]>> => {
  const includeInactive = options?.includeInactive ?? false;
  let query = supabase.from('games').select(gameSelect).eq('match_id', matchId);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('game_number', { ascending: true });
  return { data: (data as GameRow[]) ?? null, error: mapDbError(error) };
};

export const listGamesByMatchIds = async (
  matchIds: string[],
  options?: { includeInactive?: boolean }
): Promise<DbResult<GameRow[]>> => {
  if (!matchIds.length) {
    return { data: [], error: null };
  }

  const includeInactive = options?.includeInactive ?? false;
  let query = supabase.from('games').select(gameSelect).in('match_id', matchIds);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query
    .order('match_id', { ascending: true })
    .order('game_number', { ascending: true });
  return { data: (data as GameRow[]) ?? null, error: mapDbError(error) };
};
