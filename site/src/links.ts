export const base = import.meta.env.BASE_URL
export const link = (path: string) => `${base}${path}`
export const asset = (path: string) => `${base}${path}`
