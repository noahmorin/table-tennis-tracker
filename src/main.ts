import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { useAuth } from './stores/auth';
import { ModuleRegistry, ClientSideRowModelModule } from 'ag-grid-community';
import './styles.css';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

useAuth().initAuth();

createApp(App).use(router).mount('#app');
