# Veda Vidya: one container serves the website, the app and the API on $PORT.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production DATA_DIR=/data PORT=4000 SEED_DEMO=true
EXPOSE 4000
# Seeds the demo institute on first start (skipped if it already exists), then starts the server.
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = \"true\" ]; then npm run seed; fi; npm start"]
