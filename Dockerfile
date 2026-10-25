# Образ с Chromium для браузерного агента (Боря)
FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data PIP_BREAK_SYSTEM_PACKAGES=1
EXPOSE 8080
CMD ["node", "src/index.js"]
