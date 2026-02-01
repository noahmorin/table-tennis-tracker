import { supabase } from '../supabaseClient';
import { mapDbError } from './errors';
import type { CompetitionRow, DbResult } from './types';

const competitionSelect =
  'id, name, format, start_date, end_date, is_active, created_at, created_by, updated_at, updated_by';

export const listCompetitions = async (
  options?: { includeInactive?: boolean }
): Promise<DbResult<CompetitionRow[]>> => {
  const includeInactive = options?.includeInactive ?? false;
  let query = supabase.from('competitions').select(competitionSelect);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('start_date', { ascending: true, nullsFirst: true });
  return { data: (data as CompetitionRow[]) ?? null, error: mapDbError(error) };
};

export const getCompetitionById = async (id: string): Promise<DbResult<CompetitionRow>> => {
  const { data, error } = await supabase
    .from('competitions')
    .select(competitionSelect)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { data: null, error: mapDbError(error) };
  }

  return { data: (data as CompetitionRow) ?? null, error: data ? null : 'Competition not found.' };
};
