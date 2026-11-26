# Veda Vidya: one container serves the website, the app and the API on $PORT.
FROM node:22-slim
# poppler-utils (pdftoppm) turns answer-sheet PDFs into page images, so marks can be drawn on each page.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && apt-get clean && rm -rf /var/lib/apt/lists/*
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
