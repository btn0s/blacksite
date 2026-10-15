FROM node:lts-alpine
WORKDIR /game
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build
CMD ["pnpm", "server:start"]
