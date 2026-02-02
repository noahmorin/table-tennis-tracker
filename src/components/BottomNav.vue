<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '../stores/auth';

const { profile } = useAuth();

const myMatchesPath = computed(() => {
  if (!profile.value) {
    return '/leaderboard';
  }
  return `/players/${profile.value.id}/matches`;
});
</script>

<template>
  <nav class="bottom-nav">
    <router-link to="/leaderboard" class="nav-item">Leaderboard</router-link>
    <router-link to="/submit-match" class="nav-item">Submit</router-link>
    <router-link :to="myMatchesPath" class="nav-item">My Matches</router-link>
  </nav>
</template>
