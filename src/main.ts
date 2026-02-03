import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { useAuth } from './stores/auth';
import { useMatchMode } from './stores/matchMode';
import './styles.css';

useAuth().initAuth();
useMatchMode().initMatchMode();

createApp(App).use(router).mount('#app');
