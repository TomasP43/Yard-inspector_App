FROM node:22-alpine

WORKDIR /app

# Las deps se instalan en una capa aparte para no reinstalar en cada cambio
# de codigo. sharp trae binarios precompilados para alpine/musl.
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

# Punto de montaje del volumen yard_uploads
RUN mkdir -p /app/uploads

EXPOSE 3002

CMD ["node", "src/index.js"]
