const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export const API_BASE = import.meta.env.VITE_API_BASE || `${basePath}/api`
