FROM node:22-alpine
WORKDIR /app

# Enable corepack so pnpm matches the workspace version.
RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false

COPY server.ts ./
RUN mkdir -p /app/audit

EXPOSE 3100
CMD ["pnpm", "exec", "tsx", "server.ts"]
