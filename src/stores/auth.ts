import { computed, ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { missingProfileMessage } from '../lib/data/errors';

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
};

const session = ref<Session | null>(null);
const profile = ref<Profile | null>(null);
const cachedProfileId = ref<string | null>(null);
const authLoading = ref(true);
const profileLoading = ref(false);
const profileError = ref<string | null>(null);

const user = computed(() => session.value?.user ?? null);
const isAuthenticated = computed(() => !!session.value && !!profile.value);
const profileId = computed(() => profile.value?.id ?? cachedProfileId.value);
const isAdmin = computed(() => profile.value?.is_admin ?? false);

let initPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

const buildEmailRedirectUrl = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.origin}${window.location.pathname}`;
};

const profileIdCacheKey = (authUserId: string) => `ttt-profile-id:${authUserId}`;

const readCachedProfileId = (authUserId: string) => {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(profileIdCacheKey(authUserId));
};

const writeCachedProfileId = (authUserId: string, value: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }
  const key = profileIdCacheKey(authUserId);
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, value);
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
    profileError.value = missingProfileMessage;
    profileLoading.value = false;
    return;
  }

  profile.value = data as Profile;
  cachedProfileId.value = data.id;
  writeCachedProfileId(authUser.id, data.id);
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
      cachedProfileId.value = readCachedProfileId(session.value.user.id);
      await loadProfile(session.value.user);
    } else {
      profile.value = null;
      profileError.value = null;
      cachedProfileId.value = null;
    }

    authLoading.value = false;

    if (!authSubscription) {
      const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        session.value = nextSession;

        if (nextSession?.user) {
          cachedProfileId.value = readCachedProfileId(nextSession.user.id);
          await loadProfile(nextSession.user);
        } else {
          profile.value = null;
          profileError.value = null;
          cachedProfileId.value = null;
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

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
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
  cachedProfileId.value = null;
};

const refreshProfile = async () => {
  if (session.value?.user) {
    await loadProfile(session.value.user);
  }
};

const requireProfileId = () => {
  if (!session.value?.user) {
    return { profileId: null, error: 'You must be signed in to do that.' };
  }
  if (!profile.value) {
    return { profileId: null, error: missingProfileMessage };
  }
  return { profileId: profile.value.id, error: null };
};

export const useAuth = () => ({
  session,
  user,
  profile,
  profileId,
  authLoading,
  profileLoading,
  profileError,
  isAdmin,
  isAuthenticated,
  initAuth,
  signInWithPassword,
  signUpWithEmail,
  signOut,
  refreshProfile,
  requireProfileId
});
