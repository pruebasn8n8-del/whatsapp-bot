# 🤖 WhatsApp Groq Bot

Bot de WhatsApp con inteligencia artificial usando **Groq API** (LPU Inference Engine) y **whatsapp-web.js**.

Le escribes un mensaje por WhatsApp y te responde como si fuera ChatGPT, usando modelos como Llama 4, Llama 3.3, Kimi K2, etc.

## ⚡ Características

- 💬 Responde mensajes en WhatsApp con IA
- 🧠 Memoria de conversación por usuario (mantiene contexto)
- 🚀 Respuestas ultra-rápidas gracias a Groq (LPU)
- 🌐 Servidor Express con dashboard de estado
- 📱 Autenticación por QR code (como WhatsApp Web)
- 🔧 Comandos: `/reset`, `/ayuda`, `/modelo`

## 📋 Requisitos

- **Node.js** v18 o superior
- **Cuenta en Groq** con API key (gratis): https://console.groq.com
- **Google Chrome** o **Chromium** instalado (lo usa whatsapp-web.js internamente)

## 🚀 Instalación

```bash
# 1. Clonar o descargar el proyecto
git clone <tu-repo>
cd whatsapp-groq-bot

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env y agrega tu GROQ_API_KEY

# 4. Iniciar el bot
npm start
```

## 📱 Conectar WhatsApp

1. Al iniciar, se mostrará un **código QR** en la terminal
2. Abre WhatsApp en tu teléfono
3. Ve a **Configuración > Dispositivos vinculados > Vincular dispositivo**
4. Escanea el QR
5. ¡Listo! El bot empezará a responder tus mensajes

> La sesión se guarda en `.wwebjs_auth/`, así que no necesitas escanear el QR cada vez.

## 🔧 Configuración

Edita el archivo `.env`:

| Variable | Descripción | Default |
|---|---|---|
| `GROQ_API_KEY` | Tu API key de Groq (obligatorio) | — |
| `GROQ_MODEL` | Modelo de IA a usar | `meta-llama/llama-4-scout-17b-16e-instruct` |
| `PORT` | Puerto del servidor Express | `3000` |
| `BOT_PERSONALITY` | System prompt / personalidad del bot | Asistente amigable |
| `MAX_HISTORY` | Mensajes de contexto por usuario | `20` |

### Modelos recomendados (según tus límites de Groq)

| Modelo | Tokens/min | Mejor para |
|---|---|---|
| `meta-llama/llama-4-scout-17b-16e-instruct` | 30K | ⭐ Mejor balance velocidad/calidad |
| `llama-3.3-70b-versatile` | 12K | Respuestas más inteligentes |
| `moonshotai/kimi-k2-instruct` | 10K | Buena calidad general |
| `llama-3.1-8b-instant` | 6K | Más rápido, respuestas simples |

## 📡 Endpoints

| Ruta | Descripción |
|---|---|
| `GET /` | Dashboard visual con estado del bot |
| `GET /health` | Health check (para deploys) |
| `GET /api/status` | Estado en JSON |

## 💡 Comandos del bot

Envía estos comandos por WhatsApp:

- `/ayuda` o `/help` — Ver comandos disponibles
- `/reset` o `/nuevo` — Reiniciar la conversación (borrar contexto)
- `/modelo` — Ver qué modelo de IA está usando

## 🚢 Deploy

### Railway / Render

1. Sube el código a GitHub
2. Conecta el repo en Railway o Render
3. Agrega las variables de entorno (`GROQ_API_KEY`, etc.)
4. Railway detectará Node.js automáticamente

> **⚠️ Nota importante:** whatsapp-web.js usa Puppeteer (Chrome headless), así que necesitas un servidor con al menos **512MB de RAM**. En plataformas como Railway o Render, necesitarás agregar el buildpack de Chrome o usar una imagen Docker con Chromium.

### Docker (opcional)

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
```

## ⚠️ Limitaciones con el plan gratuito de Groq

Según tu screenshot, estás en el plan **Personal/Free**:

- **30 requests/minuto** para la mayoría de modelos
- **1K requests/día** para modelos grandes
- Suficiente para uso personal (un solo usuario enviando mensajes)
- Si alcanzas el rate limit, el bot muestra un mensaje amigable

## 📝 Notas

- El bot **solo responde en chats privados** por defecto. Para habilitar grupos, edita `whatsappClient.js` y comenta la línea que filtra grupos.
- Las conversaciones se guardan **en memoria** (se pierden al reiniciar). Si quieres persistencia, puedes agregar SQLite o Redis.
- WhatsApp puede banear cuentas que usen bots de forma abusiva. Úsalo con moderación y en tu propia cuenta.
