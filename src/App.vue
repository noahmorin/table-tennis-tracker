<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Settings, LogOut } from 'lucide-vue-next';
import BottomNav from './components/BottomNav.vue';
import { appConfig } from './config/appConfig';
import { useAuth } from './stores/auth';
import { createBugReport } from './lib/data/bugReports';

const { appName, leagueLabel } = appConfig;
const { isAuthenticated, profile, user, signOut } = useAuth();
const router = useRouter();

type ThemeMode = 'light' | 'dark';
type ThemeColor = 'red' | 'blue' | 'green' | 'purple' | 'pink' | 'yellow' | 'orange';

const themeKey = 'ttt-theme';
const themeColorKey = 'ttt-theme-color';

const theme = ref<ThemeMode | null>(null);
const themeColor = ref<ThemeColor>('green');
const dialogRef = ref<HTMLDialogElement | null>(null);
const bugDialogRef = ref<HTMLDialogElement | null>(null);
const bugTitle = ref('');
const bugDescription = ref('');
const bugSubmitting = ref(false);
const bugError = ref<string | null>(null);
const bugSuccess = ref<string | null>(null);

const isDark = computed(() => theme.value === 'dark');
const activeThemeLabel = computed(() => (isDark.value ? 'Dark' : 'Light'));
const showBottomNav = computed(() => isAuthenticated.value);
const profileLabel = computed(
  () => profile.value?.display_name ?? profile.value?.username ?? user.value?.email ?? ''
);

const themeColors: Array<{ id: ThemeColor; label: string; swatch: string }> = [
  { id: 'red', label: 'Red', swatch: '#c0392b' },
  { id: 'blue', label: 'Blue', swatch: '#1e5aa8' },
  { id: 'green', label: 'Green', swatch: '#1f7a4d' },
  { id: 'purple', label: 'Purple', swatch: '#6a3fa0' },
  { id: 'pink', label: 'Pink', swatch: '#c1467f' },
  { id: 'yellow', label: 'Yellow', swatch: '#b58a00' },
  { id: 'orange', label: 'Orange', swatch: '#d36c1f' }
];

const applyTheme = (value: ThemeMode | null) => {
  const root = document.documentElement;
  if (value) {
    root.setAttribute('data-theme', value);
    localStorage.setItem(themeKey, value);
  } else {
    root.removeAttribute('data-theme');
    localStorage.removeItem(themeKey);
  }
};

const applyThemeColor = (value: ThemeColor) => {
  const root = document.documentElement;
  root.setAttribute('data-theme-color', value);
  localStorage.setItem(themeColorKey, value);
};

const syncFromStorageOrSystem = () => {
  const stored = localStorage.getItem(themeKey) as ThemeMode | null;
  if (stored === 'light' || stored === 'dark') {
    theme.value = stored;
    applyTheme(stored);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme.value = prefersDark ? 'dark' : 'light';
    applyTheme(theme.value);
  }

  const storedColor = localStorage.getItem(themeColorKey) as ThemeColor | null;
  if (storedColor && themeColors.some((option) => option.id === storedColor)) {
    themeColor.value = storedColor;
  } else {
    themeColor.value = 'green';
  }
  applyThemeColor(themeColor.value);
};

const openThemeDialog = () => {
  dialogRef.value?.showModal();
};

const closeThemeDialog = () => {
  dialogRef.value?.close();
};

const resetBugForm = () => {
  bugTitle.value = '';
  bugDescription.value = '';
  bugError.value = null;
  bugSuccess.value = null;
};

const openBugDialog = () => {
  if (!isAuthenticated.value) {
    bugError.value = 'You must be signed in to submit a bug report.';
    return;
  }
  resetBugForm();
  closeThemeDialog();
  bugDialogRef.value?.showModal();
};

const closeBugDialog = () => {
  bugDialogRef.value?.close();
};

const buildBugDescription = (details: string) => {
  if (typeof window === 'undefined') {
    return details;
  }
  const page = window.location.href;
  return `${details}\n\n---\nPage: ${page}\nVersion: ${appVersion}`;
};

const handleBugSubmit = async () => {
  bugError.value = null;
  bugSuccess.value = null;

  const title = bugTitle.value.trim();
  const details = bugDescription.value.trim();

  if (!title || !details) {
    bugError.value = 'Summary and details are required.';
    return;
  }

  bugSubmitting.value = true;
  const { error } = await createBugReport({
    title,
    description: buildBugDescription(details)
  });
  bugSubmitting.value = false;

  if (error) {
    bugError.value = error;
    return;
  }

  bugSuccess.value = 'Bug report submitted. Thank you!';
  bugTitle.value = '';
  bugDescription.value = '';
};

const setTheme = (value: ThemeMode) => {
  theme.value = value;
  applyTheme(value);
};

const setThemeColor = (value: ThemeColor) => {
  themeColor.value = value;
  applyThemeColor(value);
};

const handleSignOut = async () => {
  await signOut();
  closeThemeDialog();
  router.replace('/login');
};

const appVersion = __APP_VERSION__;

onMounted(() => {
  syncFromStorageOrSystem();
});
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--guest': !showBottomNav }">
    <header class="app-header">
      <div>
        <p class="eyebrow">{{ leagueLabel }}</p>
        <h1>{{ appName }}</h1>
      </div>
      <div class="header-actions">
        <div v-if="isAuthenticated" class="user-pill">{{ profileLabel }}</div>
        <button class="gear-button" type="button" aria-label="Theme settings" @click="openThemeDialog">
          <Settings aria-hidden="true" class="gear-icon" />
        </button>
      </div>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <BottomNav v-if="showBottomNav" />
  </div>

  <dialog ref="dialogRef" class="theme-dialog">
    <form method="dialog" class="theme-dialog__card" @submit.prevent>
      <header class="theme-dialog__header">
        <h2>Theme</h2>
        <button type="button" class="theme-dialog__close" @click="closeThemeDialog">X</button>
      </header>
      <p class="theme-dialog__copy">Choose appearance settings for this device.</p>

      <div class="theme-dialog__section">
        <p class="theme-dialog__label">Mode</p>
        <div class="theme-dialog__options">
          <button
            type="button"
            class="theme-option"
            :class="{ 'is-active': theme === 'light' }"
            @click="setTheme('light')"
          >
            Light
          </button>
          <button
            type="button"
            class="theme-option"
            :class="{ 'is-active': theme === 'dark' }"
            @click="setTheme('dark')"
          >
            Dark
          </button>
        </div>
        <p class="theme-dialog__hint">Current: {{ activeThemeLabel }}</p>
      </div>

      <div class="theme-dialog__section">
        <p class="theme-dialog__label">Accent color</p>
        <div class="theme-color-grid">
          <button
            v-for="option in themeColors"
            :key="option.id"
            type="button"
            class="theme-color-option"
            :class="{ 'is-active': themeColor === option.id }"
            :style="{ '--swatch': option.swatch }"
            :aria-label="option.label"
            :title="option.label"
            @click="setThemeColor(option.id)"
          ></button>
        </div>
      </div>

      <div class="theme-dialog__section">
        <h3 class="theme-dialog__section-title">Support</h3>
        <p class="theme-dialog__hint">Spot a bug or glitch? Send a quick report.</p>
        <button v-if="isAuthenticated" class="ghost-btn" type="button" @click="openBugDialog">
          Report a bug
        </button>
        <p v-else class="theme-dialog__hint">Sign in to submit bug reports.</p>
      </div>

      <div v-if="isAuthenticated" class="theme-dialog__section theme-dialog__actions">
        <h3 class="theme-dialog__section-title">Account</h3>
        <button class="ghost-btn ghost-btn--danger" type="button" @click="handleSignOut">
          <LogOut class="ghost-btn__icon" aria-hidden="true" />
          Sign Out
        </button>
      </div>

      <p class="theme-dialog__hint theme-dialog__version">Version {{ appVersion }}</p>
    </form>
  </dialog>

  <dialog ref="bugDialogRef" class="bug-dialog" @close="resetBugForm">
    <form method="dialog" class="bug-dialog__card" @submit.prevent="handleBugSubmit">
      <header class="bug-dialog__header">
        <h2>Report a bug</h2>
        <button type="button" class="bug-dialog__close" @click="closeBugDialog">X</button>
      </header>
      <p class="bug-dialog__copy">Tell us what broke and how we can reproduce it.</p>

      <div class="bug-dialog__body">
        <label class="field">
          <span>Summary</span>
          <input v-model="bugTitle" type="text" maxlength="120" placeholder="Short description" />
        </label>
        <label class="field">
          <span>Details</span>
          <textarea
            v-model="bugDescription"
            rows="5"
            placeholder="Steps to reproduce, expected vs actual"
          ></textarea>
        </label>
        <p class="bug-dialog__hint">We automatically attach the page URL and app version.</p>
      </div>

      <div class="bug-dialog__actions">
        <button type="button" class="ghost-btn" @click="closeBugDialog">Cancel</button>
        <button class="primary-btn" type="submit" :disabled="bugSubmitting">
          {{ bugSubmitting ? 'Sending...' : 'Send report' }}
        </button>
      </div>

      <p v-if="bugSuccess" class="form-message is-success">{{ bugSuccess }}</p>
      <p v-if="bugError" class="form-message is-error">{{ bugError }}</p>
    </form>
  </dialog>
</template>
