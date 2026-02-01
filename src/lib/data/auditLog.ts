import { supabase } from '../supabaseClient';
import { mapDbError } from './errors';
import type { AuditLogRow, DbResult } from './types';

const auditSelect =
  'id, entity_type, entity_id, action, before_data, after_data, is_active, created_at, created_by';

export const listAuditLogForEntity = async (input: {
  entityType: string;
  entityId: string;
}): Promise<DbResult<AuditLogRow[]>> => {
  const { data, error } = await supabase
    .from('audit_log')
    .select(auditSelect)
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .order('created_at', { ascending: false });

  return { data: (data as AuditLogRow[]) ?? null, error: mapDbError(error) };
};
