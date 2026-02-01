import { computed, ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_active: boolean;
};

type SignUpInput = {
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
};

const session = ref<Session | null>(null);
const profile = ref<Profile | null>(null);
const authLoading = ref(true);
const profileLoading = ref(false);
const profileError = ref<string | null>(null);

const user = computed(() => session.value?.user ?? null);
const isAuthenticated = computed(() => !!session.value && !!profile.value);

let initPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

const normalizeUsername = (value: unknown) => String(value ?? '').trim().toLowerCase();

const normalizeName = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const buildEmailRedirectUrl = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.origin}${window.location.pathname}`;
};
const loadProfile = async (authUser: User) => {
  profileLoading.value = true;
  profileError.value = null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, first_name, last_name, is_admin, is_active')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    profileError.value = error.message;
    profileLoading.value = false;
    return;
  }

  if (!data) {
    profile.value = null;
    profileError.value = 'Profile not found for this account. Contact an admin.';
    profileLoading.value = false;
    return;
  }

  profile.value = data as Profile;
  profileLoading.value = false;
};

const initAuth = async () => {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    authLoading.value = true;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Failed to restore auth session.', error);
    }

    session.value = data.session ?? null;

    if (session.value?.user) {
      await loadProfile(session.value.user);
    } else {
      profile.value = null;
      profileError.value = null;
    }

    authLoading.value = false;

    if (!authSubscription) {
      const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        session.value = nextSession;

        if (nextSession?.user) {
          await loadProfile(nextSession.user);
        } else {
          profile.value = null;
          profileError.value = null;
        }

        authLoading.value = false;
      });

      authSubscription = authListener.subscription;
    }
  })();

  return initPromise;
};

const signInWithPassword = async (email: string, password: string) => {
  authLoading.value = true;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  authLoading.value = false;

  if (error) {
    throw new Error(error.message);
  }
};

const signUpWithEmail = async (input: SignUpInput) => {
  const redirectTo = buildEmailRedirectUrl();
  const username = normalizeUsername(input.username);
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);

  if (!username || !firstName || !lastName) {
    throw new Error('Username, first name, and last name are required.');
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        username,
        first_name: firstName,
        last_name: lastName
      },
      emailRedirectTo: redirectTo
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  return { needsEmailConfirmation: !data.session };
};

const signOut = async () => {
  await supabase.auth.signOut();
  session.value = null;
  profile.value = null;
  profileError.value = null;
};

const refreshProfile = async () => {
  if (session.value?.user) {
    await loadProfile(session.value.user);
  }
};

const checkUsernameAvailability = async (value: string) => {
  const username = normalizeUsername(value);
  if (!username) {
    return { available: false, message: 'Username is required.' };
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return { available: false, message: 'Use letters, numbers, dots, underscores, or dashes.' };
  }

  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  if (error) {
    return { available: null, message: 'Unable to check username availability.' };
  }

  return {
    available: Boolean(data),
    message: data ? 'Username is available.' : 'Username is taken.'
  };
};

export const useAuth = () => ({
  session,
  user,
  profile,
  authLoading,
  profileLoading,
  profileError,
  isAuthenticated,
  initAuth,
  signInWithPassword,
  signUpWithEmail,
  signOut,
  refreshProfile,
  checkUsernameAvailability
});
