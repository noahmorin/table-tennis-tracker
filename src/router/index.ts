import { createRouter, createWebHashHistory } from 'vue-router';
import LeaderboardPage from '../pages/LeaderboardPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import MatchesPage from '../pages/MatchesPage.vue';
import PlayerProfilePage from '../pages/PlayerProfilePage.vue';
import SubmitMatchPage from '../pages/SubmitMatchPage.vue';
import UpdatePasswordPage from '../pages/UpdatePasswordPage.vue';
import { useAuth } from '../stores/auth';

const routes = [
  { path: '/', redirect: '/leaderboard' },
  { path: '/login', component: LoginPage, meta: { public: true } },
  { path: '/account/update-password', component: UpdatePasswordPage, meta: { public: true } },
  { path: '/access_token=:token(.*)', component: UpdatePasswordPage, meta: { public: true } },
  { path: '/submit-match', component: SubmitMatchPage, meta: { requiresAuth: true, requiresProfile: true } },
  { path: '/leaderboard', component: LeaderboardPage, meta: { requiresAuth: true } },
  {
    path: '/players/:id',
    component: PlayerProfilePage,
    props: true,
    meta: { requiresAuth: true, requiresProfile: true }
  },
  {
    path: '/players/:id/matches',
    component: MatchesPage,
    props: true,
    meta: { requiresAuth: true, requiresProfile: true }
  },
  { path: '/my-matches', component: MatchesPage, meta: { requiresAuth: true, requiresProfile: true } }
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
    if (to.path === '/account/update-password') {
      return true;
    }
    if (session.value) {
      return '/leaderboard';
    }
    return true;
  }

  if (!session.value) {
    return '/login';
  }

  if (to.meta.requiresProfile && !profile.value) {
    return '/leaderboard';
  }

  if (to.path === '/my-matches') {
    return `/players/${profile?.value?.id}/matches`;
  }

  return true;
});

export default router;
