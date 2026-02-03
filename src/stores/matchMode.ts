import { computed, ref } from 'vue';
import type { MatchType } from '../lib/data/types';

const matchModeKey = 'ttt-match-mode';
const matchMode = ref<MatchType>('doubles');
let matchModeInitialized = false;

const initMatchMode = () => {
  if (matchModeInitialized) {
    return;
  }
  matchModeInitialized = true;
  if (typeof window === 'undefined') {
    return;
  }
  const stored = localStorage.getItem(matchModeKey);
  if (stored === 'singles' || stored === 'doubles') {
    matchMode.value = stored;
  }
};

const setMatchMode = (value: MatchType) => {
  matchMode.value = value;
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(matchModeKey, value);
};

const isDoubles = computed(() => matchMode.value === 'doubles');

export const useMatchMode = () => ({
  matchMode,
  isDoubles,
  setMatchMode,
  initMatchMode
});
