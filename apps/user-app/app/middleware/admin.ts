export default defineNuxtRouteMiddleware(() => {
  const session = useSessionStore()
  if (session.user?.role !== 'admin') {
    return navigateTo('/')
  }
})
