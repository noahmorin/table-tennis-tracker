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

type ProfileInput = {
  username: string;
  firstName: string;
  lastName: string;
};

type SignUpInput = ProfileInput & {
  email: string;
  password: string;
};

const session = ref<Session | null>(null);
const profile = ref<Profile | null>(null);
const authLoading = ref(true);
const profileLoading = ref(false);
const profileError = ref<string | null>(null);
const profileWarning = ref<string | null>(null);

const user = computed(() => session.value?.user ?? null);
const isAuthenticated = computed(() => !!session.value && !!profile.value);
const needsProfileSetup = computed(() => !!session.value && !profile.value && !profileLoading.value);

let initPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

const normalizeUsername = (value: unknown) => String(value ?? '').trim().toLowerCase();

const normalizeName = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const buildDisplayName = (firstName: string, lastName: string) =>
  [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

const buildEmailRedirectUrl = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.origin}${window.location.pathname}`;
};

const createUuid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16;
    const value = char === 'x' ? rand : (rand % 4) + 8;
    return Math.floor(value).toString(16);
  });
};

const formatProfileInsertError = (error: { code?: string; message: string }) => {
  if (error.code === '23505') {
    return 'That username is already taken.';
  }
  return error.message;
};

const createProfile = async (input: ProfileInput, authUserId: string) => {
  const username = normalizeUsername(input.username);
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const displayName = buildDisplayName(firstName, lastName);

  if (!username || !firstName || !lastName) {
    return { profile: null, error: 'Please provide a username and full name.' };
  }

  const profileId = createUuid();

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: profileId,
      auth_user_id: authUserId,
      username,
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      is_active: true,
      created_by: profileId
    })
    .select('id, username, display_name, first_name, last_name, is_admin, is_active')
    .single();

  if (error) {
    return { profile: null, error: formatProfileInsertError(error) };
  }

  const auditPayload = {
    entity_type: 'profile',
    entity_id: profileId,
    action: 'create',
    before_data: null,
    after_data: {
      id: profileId,
      username,
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      auth_user_id: authUserId
    },
    created_by: profileId
  };

  const { error: auditError } = await supabase.from('audit_log').insert(auditPayload);
  if (auditError) {
    profileWarning.value = 'Profile created, but audit logging failed.';
    console.warn('Audit log insert failed.', auditError);
  }

  return { profile: data as Profile, error: null };
};

const loadOrCreateProfile = async (authUser: User) => {
  profileLoading.value = true;
  profileError.value = null;
  profileWarning.value = null;

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

  if (data) {
    profile.value = data as Profile;
    profileLoading.value = false;
    return;
  }

  const metadata = authUser.user_metadata ?? {};
  const username = normalizeUsername(metadata.username);
  const firstName = normalizeName(metadata.first_name);
  const lastName = normalizeName(metadata.last_name);

  if (!username || !firstName || !lastName) {
    profileError.value = 'Complete your profile to continue.';
    profileLoading.value = false;
    return;
  }

  const { profile: createdProfile, error: createError } = await createProfile(
    { username, firstName, lastName },
    authUser.id
  );

  if (createError) {
    profileError.value = createError;
    profileLoading.value = false;
    return;
  }

  profile.value = createdProfile;
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
      await loadOrCreateProfile(session.value.user);
    } else {
      profile.value = null;
      profileError.value = null;
    }

    authLoading.value = false;

    if (!authSubscription) {
      const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        session.value = nextSession;

        if (nextSession?.user) {
          await loadOrCreateProfile(nextSession.user);
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

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        username: normalizeUsername(input.username),
        first_name: normalizeName(input.firstName),
        last_name: normalizeName(input.lastName)
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
};

const refreshProfile = async () => {
  if (session.value?.user) {
    await loadOrCreateProfile(session.value.user);
  }
};

const completeProfileSetup = async (input: ProfileInput) => {
  if (!session.value?.user) {
    throw new Error('You must be signed in to complete your profile.');
  }

  profileLoading.value = true;
  profileError.value = null;
  profileWarning.value = null;

  const { profile: createdProfile, error: createError } = await createProfile(
    input,
    session.value.user.id
  );

  if (createError) {
    profileError.value = createError;
    profileLoading.value = false;
    return { success: false };
  }

  profile.value = createdProfile;
  profileLoading.value = false;
  return { success: true };
};

const checkUsernameAvailability = async (value: string) => {
  const username = normalizeUsername(value);
  if (!username) {
    return { available: false, message: 'Username is required.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return { available: null, message: 'Unable to check username availability.' };
  }

  return { available: !data, message: !data ? 'Username is available.' : 'Username is taken.' };
};

export const useAuth = () => ({
  session,
  user,
  profile,
  authLoading,
  profileLoading,
  profileError,
  profileWarning,
  isAuthenticated,
  needsProfileSetup,
  initAuth,
  signInWithPassword,
  signUpWithEmail,
  signOut,
  refreshProfile,
  completeProfileSetup,
  checkUsernameAvailability
});
