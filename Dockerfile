# Dockerfile para produção (VPS/DigitalOcean/Hetzner ou Render via Docker)
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
EXPOSE 3001
# Monte um volume persistente em /data (banco SQLite + uploads)
VOLUME ["/data"]
ENV PORT=3001
ENV DATA_DIR=/data
CMD ["npm", "start"]
