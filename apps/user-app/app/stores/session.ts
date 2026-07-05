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
    needsProfileCompletion: (state) => !!state.user && (!state.user.name || !state.user.gender),
  },
  actions: {
    setUser(user: SessionUser | null) {
      this.user = user
      this.checked = true
    },
  },
})
