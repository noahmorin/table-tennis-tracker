import { createRouter, createWebHashHistory } from 'vue-router';
import LeaderboardPage from '../pages/LeaderboardPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import MyMatchesPage from '../pages/MyMatchesPage.vue';
import PlayerProfilePage from '../pages/PlayerProfilePage.vue';
import SubmitMatchPage from '../pages/SubmitMatchPage.vue';
import { useAuth } from '../stores/auth';

const routes = [
  { path: '/', redirect: '/leaderboard' },
  { path: '/login', component: LoginPage, meta: { public: true } },
  { path: '/submit-match', component: SubmitMatchPage, meta: { requiresAuth: true } },
  { path: '/leaderboard', component: LeaderboardPage, meta: { requiresAuth: true } },
  { path: '/players/:id', component: PlayerProfilePage, props: true, meta: { requiresAuth: true } },
  { path: '/players/:id/matches', component: MyMatchesPage, props: true, meta: { requiresAuth: true } },
  { path: '/my-matches', component: MyMatchesPage, meta: { requiresAuth: true } }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

router.beforeEach(async (to) => {
  const { initAuth, session, profile } = useAuth();
  await initAuth();

  const isPublic = to.meta.public === true;
  if (isPublic) {
    if (session.value && profile.value) {
      return '/leaderboard';
    }
    return true;
  }

  if (!session.value || !profile.value) {
    return '/login';
  }

  if (to.path === '/my-matches') {
    return `/players/${profile.value.id}/matches`;
  }

  return true;
});

export default router;
