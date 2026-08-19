# Dockerfile para produção (VPS/DigitalOcean/Hetzner ou Render via Docker)
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci instala exatamente o que está no lockfile: o build da imagem não muda
# de versão sozinho entre um deploy e o próximo.
RUN npm ci
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
# node_modules acima inclui tsx (fica em devDependencies) de propósito: "npm start"
# roda "tsx server/index.ts" direto, sem passo de compilação do backend — um
# "npm prune --production" aqui quebraria o container.
# Roda como usuário sem privilégio (imagem node:* já traz o usuário "node").
# /data é criado e entregue a ele antes do VOLUME para o volume nomeado herdar
# a permissão certa já na primeira criação.
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3001
# Monte um volume persistente em /data (banco SQLite + uploads)
VOLUME ["/data"]
ENV PORT=3001
ENV DATA_DIR=/data
CMD ["npm", "start"]
