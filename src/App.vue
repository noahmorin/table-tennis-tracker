<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Settings } from 'lucide-vue-next';
import BottomNav from './components/BottomNav.vue';
import { appConfig } from './config/appConfig';

const { appName, leagueLabel, statusLabel } = appConfig;

type ThemeMode = 'light' | 'dark';
type ThemeColor = 'red' | 'blue' | 'green' | 'purple' | 'pink' | 'yellow' | 'orange';

const themeKey = 'ttt-theme';
const themeColorKey = 'ttt-theme-color';

const theme = ref<ThemeMode | null>(null);
const themeColor = ref<ThemeColor>('green');
const dialogRef = ref<HTMLDialogElement | null>(null);

const isDark = computed(() => theme.value === 'dark');
const activeThemeLabel = computed(() => (isDark.value ? 'Dark' : 'Light'));

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

const setTheme = (value: ThemeMode) => {
  theme.value = value;
  applyTheme(value);
};

const setThemeColor = (value: ThemeColor) => {
  themeColor.value = value;
  applyThemeColor(value);
};

onMounted(() => {
  syncFromStorageOrSystem();
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">{{ leagueLabel }}</p>
        <h1>{{ appName }}</h1>
      </div>
      <div class="header-actions">
        <button class="gear-button" type="button" aria-label="Theme settings" @click="openThemeDialog">
          <Settings aria-hidden="true" class="gear-icon" />
        </button>
        <div class="status-pill">{{ statusLabel }}</div>
      </div>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <BottomNav />
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
            @click="setThemeColor(option.id)"
          >
            <span class="theme-color-swatch" aria-hidden="true"></span>
            <span class="theme-color-label">{{ option.label }}</span>
          </button>
        </div>
      </div>
    </form>
  </dialog>
</template>
