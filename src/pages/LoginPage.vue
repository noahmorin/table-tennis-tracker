<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';

const router = useRouter();
const {
  authLoading,
  profileLoading,
  profileError,
  isAuthenticated,
  signInWithPassword,
  signUpWithEmail,
  signOut,
  checkUsernameAvailability
} = useAuth();

type AuthMode = 'sign-in' | 'sign-up';

const mode = ref<AuthMode>('sign-in');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const username = ref('');
const firstName = ref('');
const lastName = ref('');

const infoMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const usernameStatus = ref<string | null>(null);
const usernameAvailable = ref<boolean | null>(null);
const submitting = ref(false);

const headerTitle = computed(() => {
  return mode.value === 'sign-up' ? 'Create Account' : 'Sign In';
});

const headerCopy = computed(() => {
  return mode.value === 'sign-up'
    ? 'Create your league profile with email and password.'
    : 'Use your league email to submit and edit matches.';
});

const passwordLabel = computed(() => (mode.value === 'sign-up' ? 'Create Password' : 'Password'));
const passwordAutoComplete = computed(() =>
  mode.value === 'sign-up' ? 'new-password' : 'current-password'
);

watch(isAuthenticated, (value) => {
  if (value) {
    router.replace('/leaderboard');
  }
});

watch(mode, () => {
  infoMessage.value = null;
  errorMessage.value = null;
  usernameStatus.value = null;
  usernameAvailable.value = null;
  confirmPassword.value = '';
});

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const validateUsername = (value: string) => {
  const normalized = normalizeUsername(value);
  if (!normalized) {
    return 'Username is required.';
  }
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    return 'Use letters, numbers, dots, underscores, or dashes.';
  }
  return null;
};

const validateSignUp = () => {
  if (!email.value || !password.value || !confirmPassword.value) {
    return 'Email and password are required.';
  }
  const usernameError = validateUsername(username.value);
  if (usernameError) {
    return usernameError;
  }
  if (!firstName.value.trim() || !lastName.value.trim()) {
    return 'First and last name are required.';
  }
  if (password.value.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.value !== confirmPassword.value) {
    return 'Passwords do not match.';
  }
  return null;
};

const validateSignIn = () => {
  if (!email.value || !password.value) {
    return 'Email and password are required.';
  }
  return null;
};

const handleSignIn = async () => {
  infoMessage.value = null;
  errorMessage.value = validateSignIn();
  if (errorMessage.value) {
    return;
  }

  submitting.value = true;
  try {
    await signInWithPassword(email.value, password.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Sign-in failed.';
  } finally {
    submitting.value = false;
  }
};

const handleSignUp = async () => {
  infoMessage.value = null;
  errorMessage.value = validateSignUp();
  if (errorMessage.value) {
    return;
  }

  const usernameCheck = await checkUsernameAvailability(username.value);
  if (usernameCheck.available === false) {
    errorMessage.value = usernameCheck.message;
    usernameStatus.value = usernameCheck.message;
    usernameAvailable.value = false;
    return;
  }

  submitting.value = true;
  try {
    const { needsEmailConfirmation } = await signUpWithEmail({
      email: email.value.trim(),
      password: password.value,
      username: username.value,
      firstName: firstName.value,
      lastName: lastName.value
    });

    infoMessage.value = needsEmailConfirmation
      ? 'Check your email to confirm your account, then sign in.'
      : 'Account created. Signing you in now.';
    errorMessage.value = null;
  } catch (error) {
    const usernameCheck = await checkUsernameAvailability(username.value);
    if (usernameCheck.available === false) {
      errorMessage.value = usernameCheck.message;
    } else {
      errorMessage.value = 'Signup failed. Check your details and try again.';
    }
  } finally {
    submitting.value = false;
  }
};

const checkUsername = async () => {
  if (!username.value.trim()) {
    usernameStatus.value = null;
    usernameAvailable.value = null;
    return;
  }

  const result = await checkUsernameAvailability(username.value);
  if (result.available === null) {
    usernameStatus.value = null;
    usernameAvailable.value = null;
    return;
  }

  usernameStatus.value = result.message;
  usernameAvailable.value = result.available;
};

const handleSignOut = async () => {
  await signOut();
};

</script>

<template>
  <section class="page auth-page">
    <header class="page-header">
      <h2>{{ headerTitle }}</h2>
      <p>{{ headerCopy }}</p>
    </header>

    <div v-if="(authLoading || profileLoading) && !submitting" class="card">
      <p>Checking your session...</p>
    </div>

    <form v-else class="form-card" @submit.prevent="mode === 'sign-in' ? handleSignIn() : handleSignUp()">
      <div class="auth-toggle">
        <button
          class="auth-toggle__btn"
          :class="{ 'is-active': mode === 'sign-in' }"
          type="button"
          @click="mode = 'sign-in'"
        >
          Sign In
        </button>
        <button
          class="auth-toggle__btn"
          :class="{ 'is-active': mode === 'sign-up' }"
          type="button"
          @click="mode = 'sign-up'"
        >
          Create Account
        </button>
      </div>

      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" placeholder="you@company.com" autocomplete="email" />
      </label>

      <label v-if="mode === 'sign-up'" class="field">
        <span>Username</span>
        <input
          v-model="username"
          type="text"
          placeholder="first.last"
          autocomplete="username"
          @blur="checkUsername"
        />
        <span
          v-if="usernameStatus"
          class="field-hint"
          :class="{ 'is-error': usernameAvailable === false, 'is-success': usernameAvailable }"
        >
          {{ usernameStatus }}
        </span>
      </label>

      <div v-if="mode === 'sign-up'" class="field-row">
        <label class="field">
          <span>First name</span>
          <input v-model="firstName" type="text" placeholder="First name" autocomplete="given-name" />
        </label>
        <label class="field">
          <span>Last name</span>
          <input v-model="lastName" type="text" placeholder="Last name" autocomplete="family-name" />
        </label>
      </div>

      <label class="field">
        <span>{{ passwordLabel }}</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="passwordAutoComplete"
          placeholder="********"
        />
      </label>

      <label v-if="mode === 'sign-up'" class="field">
        <span>Confirm password</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="********" />
      </label>

      <button class="primary-btn" type="submit" :disabled="submitting || profileLoading">
        {{ mode === 'sign-in' ? 'Sign In' : 'Create Account' }}
      </button>

      <p v-if="infoMessage" class="form-message is-success">{{ infoMessage }}</p>
      <p v-if="errorMessage" class="form-message is-error">{{ errorMessage }}</p>
      <p v-if="profileError" class="form-message is-error">{{ profileError }}</p>
      <button
        v-if="profileError"
        class="ghost-btn"
        type="button"
        :disabled="submitting || profileLoading"
        @click="handleSignOut"
      >
        Sign Out
      </button>
    </form>
  </section>
</template>
