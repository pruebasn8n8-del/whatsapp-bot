FROM node:20-slim

# ffmpeg para conversion de audio (notas de voz)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias raiz (cubre todo el proyecto)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar fuentes (sin node_modules de sub-paquetes)
COPY src/ ./src/
COPY Groqbot/src/ ./Groqbot/src/
COPY Gastos/src/ ./Gastos/src/
COPY Gastos/config/ ./Gastos/config/
COPY DailyBriefing/ ./DailyBriefing/

# Directorios necesarios en runtime
RUN mkdir -p auth_info Gastos/credentials .tmp_audio

# Railway inyecta $PORT dinamicamente; el app lee process.env.PORT
EXPOSE ${PORT:-3000}

CMD ["node", "src/index.js"]
