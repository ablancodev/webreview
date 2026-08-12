# Imagen oficial de Playwright: trae Chromium + dependencias del SO.
FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /app

# Instalar dependencias primero (mejor cacheo de capas).
COPY package*.json ./
RUN npm ci --omit=dev

# Código de la aplicación.
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV WEBREVIEW_DATA=/data

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "src/server.js"]
