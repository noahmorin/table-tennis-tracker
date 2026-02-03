<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '../lib/supabaseClient';
import { parseHash } from '../lib/parseHash';

const router = useRouter();

const MIN_PASSWORD_LENGTH = 8;
const invalidLinkMessage = 'Invalid or expired link. Request a new password reset.';

const loading = ref(true);
const hasSession = ref(false);
const linkError = ref<string | null>(null);

const requestEmail = ref('');
const requestError = ref<string | null>(null);
const requestSuccess = ref<string | null>(null);
const requestSubmitting = ref(false);

const newPassword = ref('');
const confirmPassword = ref('');
const updateError = ref<string | null>(null);
const updateSuccess = ref<string | null>(null);
const updating = ref(false);

const passwordHint = computed(
  () => `Use at least ${MIN_PASSWORD_LENGTH} characters and avoid reusing old passwords.`
);

const buildRedirectUrl = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.origin}${window.location.pathname}#/account/update-password`;
};

const clearAuthHash = () => {
  if (typeof window === 'undefined') {
    return;
  }
  const hash = window.location.hash || '';
  if (!hash.includes('access_token=')) {
    return;
  }
  const fallbackHash = '#/account/update-password';
  const nextUrl = `${window.location.pathname}${window.location.search}${fallbackHash}`;
  window.history.replaceState(null, '', nextUrl);
};

const loadSessionFromLink = async () => {
  linkError.value = null;
  const params = typeof window === 'undefined' ? {} : parseHash(window.location.hash);
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (accessToken) {
    if (!refreshToken) {
      linkError.value = invalidLinkMessage;
    } else {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) {
        linkError.value = invalidLinkMessage;
      }
    }
  }

  clearAuthHash();

  const { data } = await supabase.auth.getSession();
  hasSession.value = Boolean(data.session);

  if (!hasSession.value && !linkError.value) {
    linkError.value = invalidLinkMessage;
  }
};

const handleRequestReset = async () => {
  requestError.value = null;
  requestSuccess.value = null;
  const email = requestEmail.value.trim();

  if (!email) {
    requestError.value = 'Email is required.';
    return;
  }

  requestSubmitting.value = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: buildRedirectUrl()
  });
  requestSubmitting.value = false;

  if (error) {
    requestError.value = error.message || 'Unable to send reset email.';
    return;
  }

  requestSuccess.value = 'Password reset email sent. Check your inbox.';
};

const handleUpdatePassword = async () => {
  updateError.value = null;
  updateSuccess.value = null;

  const password = newPassword.value.trim();
  const confirm = confirmPassword.value.trim();

  if (!password || !confirm) {
    updateError.value = 'Both password fields are required.';
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    updateError.value = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    return;
  }
  if (password !== confirm) {
    updateError.value = 'Passwords do not match.';
    return;
  }

  updating.value = true;
  const { error } = await supabase.auth.updateUser({ password });
  updating.value = false;

  if (error) {
    updateError.value =
      error.message?.includes('session') || error.message?.includes('JWT')
        ? invalidLinkMessage
        : error.message || 'Unable to update password.';
    return;
  }

  updateSuccess.value = 'Password updated successfully.';
  newPassword.value = '';
  confirmPassword.value = '';
};

const goToLeaderboard = () => {
  router.replace('/leaderboard');
};

onMounted(async () => {
  loading.value = true;
  await loadSessionFromLink();
  loading.value = false;
});
</script>

<template>
  <section class="page auth-page">
    <header class="page-header">
      <h2>Update password</h2>
      <p>Set a new password for your account.</p>
    </header>

    <div class="form-card">
      <div v-if="loading" class="form-message">Checking reset link...</div>

      <template v-else>
        <div v-if="!hasSession">
          <p class="form-message is-error">{{ linkError }}</p>

          <div class="field">
            <span>Email</span>
            <input v-model="requestEmail" type="email" placeholder="you@company.com" />
          </div>

          <button class="primary-btn" type="button" :disabled="requestSubmitting" @click="handleRequestReset">
            {{ requestSubmitting ? 'Sending...' : 'Request new reset' }}
          </button>

          <p v-if="requestSuccess" class="form-message is-success">{{ requestSuccess }}</p>
          <p v-if="requestError" class="form-message is-error">{{ requestError }}</p>
        </div>

        <form v-else @submit.prevent="handleUpdatePassword">
          <label class="field">
            <span>New password</span>
            <input v-model="newPassword" type="password" autocomplete="new-password" />
          </label>

          <label class="field">
            <span>Confirm password</span>
            <input v-model="confirmPassword" type="password" autocomplete="new-password" />
          </label>

          <p class="field-hint">{{ passwordHint }}</p>

          <button class="primary-btn" type="submit" :disabled="updating">
            {{ updating ? 'Updating...' : 'Update password' }}
          </button>

          <p v-if="updateSuccess" class="form-message is-success">{{ updateSuccess }}</p>
          <p v-if="updateError" class="form-message is-error">{{ updateError }}</p>

          <button v-if="updateSuccess" class="ghost-btn" type="button" @click="goToLeaderboard">
            Go to leaderboard
          </button>
        </form>
      </template>
    </div>
  </section>
</template>
