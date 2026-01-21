# Fase builder
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Installa tutte le dipendenze (inclusi dev per prisma)
RUN npm ci --legacy-peer-deps

# Genera client prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Fase produzione
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Solo dipendenze di produzione (--ignore-scripts per evitare prisma generate che fallisce senza @prisma/client)
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

# Copia prisma client dal builder
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
