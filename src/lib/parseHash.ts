export const parseHash = (hash: string): Record<string, string> => {
  const cleaned = hash.replace(/^#/, '');
  const tokenIndex = cleaned.indexOf('access_token=');
  const tokenQuery = tokenIndex >= 0 ? cleaned.slice(tokenIndex) : cleaned;
  if (!tokenQuery.includes('=')) {
    return {};
  }
  return Object.fromEntries(new URLSearchParams(tokenQuery));
};
