FROM node:20-slim

RUN apt-get update && apt-get install -y chromium --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar solo el package.json del worker (no el raiz)
COPY screenshot-worker/package.json ./
RUN npm install --omit=dev

# Copiar solo los fuentes del worker
COPY screenshot-worker/index.js ./
COPY screenshot-worker/screenshotLogic.js ./

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
