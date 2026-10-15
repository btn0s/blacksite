interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  GAME_SERVER: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/room/')) return env.GAME_SERVER.fetch(request)
    return env.ASSETS.fetch(request)
  },
}
