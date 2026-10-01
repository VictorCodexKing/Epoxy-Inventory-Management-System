import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './style.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ConfigError from './views/ConfigErrorView.vue'
import { firebaseConfigProblem, initBackend } from './services/backend'
import { createAppRouter } from './router'
import { useAuthStore } from './stores/auth'

async function bootstrap() {
  const problem = firebaseConfigProblem()
  if (problem) {
    createApp(ConfigError, { missing: problem.missing }).mount('#app')
    return
  }
  try {
    await initBackend()
  } catch (e) {
    console.error(e)
    createApp(ConfigError, { missing: [], message: e instanceof Error ? e.message : String(e) }).mount('#app')
    return
  }
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  useAuthStore().init()
  app.use(createAppRouter())
  app.mount('#app')
}

void bootstrap()
