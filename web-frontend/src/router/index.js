import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/RegisterView.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/project/:id',
    name: 'Project',
    component: () => import('../views/ProjectView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/project/:projectId/chapter/:chapterId',
    name: 'Editor',
    component: () => import('../views/EditorView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/project/:id/world',
    name: 'World',
    component: () => import('../views/WorldView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/project/:id/characters',
    name: 'Characters',
    component: () => import('../views/CharacterView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/project/:id/free-mode',
    name: 'FreeMode',
    component: () => import('../views/FreeModeView.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('access_token')
  if (to.meta.requiresAuth && !token) {
    next('/login')
  } else if (to.meta.guest && token) {
    next('/')
  } else {
    next()
  }
})

export default router
