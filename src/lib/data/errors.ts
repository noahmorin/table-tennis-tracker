export type DbError = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

export const missingProfileMessage = 'Profile not found for this account. Contact an admin.';

export const mapDbError = (error: DbError | null | undefined, fallback = 'Something went wrong.') => {
  if (!error) {
    return null;
  }

  if (error.code === '23505') {
    const combined = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
    if (combined.includes('username')) {
      return 'That username is already taken.';
    }
    return 'Duplicate value violates a unique constraint.';
  }

  if (error.code === 'PGRST116') {
    return 'Record not found.';
  }

  return error.message || fallback;
};
