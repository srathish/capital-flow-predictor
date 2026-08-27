FROM node:20-alpine
WORKDIR /app
COPY apps/earnings-mcp/package.json apps/earnings-mcp/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY apps/earnings-mcp/ ./
# Railway injects PORT → server starts in Streamable HTTP mode
CMD ["node", "server.mjs"]
