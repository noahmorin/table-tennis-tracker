const readEnv = (key: keyof ImportMetaEnv, fallback: string) => {
  const value = import.meta.env[key];
  return value && value.trim().length > 0 ? value : fallback;
};

export const appConfig = {
  appName: readEnv('VITE_APP_NAME', 'Table Tennis Tracker'),
  appShortName: readEnv('VITE_APP_SHORT_NAME', 'TT Tracker'),
  appDescription:
    'A lightweight, mobile-first web app for tracking office table tennis matches.',
  leagueLabel: readEnv('VITE_APP_LEAGUE_LABEL', 'Office League'),
  statusLabel: readEnv('VITE_APP_STATUS_LABEL', 'Ranked'),
  themeColor: '#1f5f45',
  backgroundColor: '#eef4ec'
};
