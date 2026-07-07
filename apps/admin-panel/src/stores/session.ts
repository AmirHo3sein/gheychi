import { defineStore } from 'pinia'

export interface SessionUser {
  id: string
  phone: string
  name: string | null
  gender: 'female' | 'male' | null
  role: 'customer' | 'provider' | 'admin'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    checked: false, // becomes true once we've asked the API at least once this session
  }),
  getters: {
    isLoggedIn: (state) => !!state.user,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    setUser(user: SessionUser | null) {
      this.user = user
      this.checked = true
    },
  },
})
