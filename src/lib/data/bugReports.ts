import { supabase } from '../supabaseClient';
import { mapDbError } from './errors';
import type { BugReportInput, DbResult } from './types';
import { useAuth } from '../../stores/auth';

const requireProfileId = () => {
  const { requireProfileId: authRequireProfileId } = useAuth();
  return authRequireProfileId();
};

export const createBugReport = async (input: BugReportInput): Promise<DbResult<null>> => {
  const { profileId, error } = requireProfileId();
  if (error || !profileId) {
    return { data: null, error };
  }

  const { error: insertError } = await supabase.from('bug_reports').insert({
    title: input.title,
    description: input.description,
    created_by: profileId
  });

  if (insertError) {
    return { data: null, error: mapDbError(insertError, 'Unable to submit bug report.') };
  }

  return { data: null, error: null };
};
