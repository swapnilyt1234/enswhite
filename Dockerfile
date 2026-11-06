FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY app ./app
COPY docs/deployments/enswhite-testnets.json docs/deployments/agent-identities.json ./docs/deployments/
ENV PUBLIC_BIND=0.0.0.0
EXPOSE 3006
USER node
CMD ["node", "app/judge-server.js"]
