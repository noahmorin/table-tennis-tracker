import { createRouter, createWebHashHistory } from 'vue-router';
import LeaderboardPage from '../pages/LeaderboardPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import MyMatchesPage from '../pages/MyMatchesPage.vue';
import PlayerProfilePage from '../pages/PlayerProfilePage.vue';
import SubmitMatchPage from '../pages/SubmitMatchPage.vue';

const routes = [
  { path: '/', redirect: '/leaderboard' },
  { path: '/login', component: LoginPage },
  { path: '/submit-match', component: SubmitMatchPage },
  { path: '/leaderboard', component: LeaderboardPage },
  { path: '/players/:id', component: PlayerProfilePage, props: true },
  { path: '/my-matches', component: MyMatchesPage }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

export default router;
