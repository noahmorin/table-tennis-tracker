import { supabase } from '../supabaseClient';
import { mapDbError, missingProfileMessage } from './errors';
import type { DbResult, ProfileRow } from './types';

const profileSelect =
  'id, auth_user_id, username, first_name, last_name, display_name, is_active, is_admin, created_at, created_by, updated_at, updated_by';

export const listProfiles = async (options?: { includeInactive?: boolean }): Promise<DbResult<ProfileRow[]>> => {
  const includeInactive = options?.includeInactive ?? true;
  let query = supabase.from('profiles').select(profileSelect);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('display_name', { ascending: true });
  return { data: (data as ProfileRow[]) ?? null, error: mapDbError(error) };
};

export const getProfileById = async (id: string): Promise<DbResult<ProfileRow>> => {
  const { data, error } = await supabase
    .from('profiles')
    .select(profileSelect)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { data: null, error: mapDbError(error) };
  }

  if (!data) {
    return { data: null, error: missingProfileMessage };
  }

  return { data: data as ProfileRow, error: null };
};
