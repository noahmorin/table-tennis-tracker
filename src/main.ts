import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { useAuth } from './stores/auth';
import './styles.css';

useAuth().initAuth();

createApp(App).use(router).mount('#app');
