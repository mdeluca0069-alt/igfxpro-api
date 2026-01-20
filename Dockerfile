# ----------------------
# Stage 1: Build
# ----------------------
FROM node:18-alpine AS builder

# Install tools necessari per compilare
RUN apk add --no-cache python3 make g++ git

# Working directory
WORKDIR /app

# Copia solo package.json e package-lock.json prima per caching layer
COPY package*.json ./

# Installa tutte le dipendenze (dev incluse)
RUN npm ci --legacy-peer-deps --include=dev

# Prisma generate
COPY prisma ./prisma
RUN npx prisma generate

# Copia tutto il resto del progetto
COPY . .

# Build TypeScript
RUN npm run build

# ----------------------
# Stage 2: Produzione
# ----------------------
FROM node:18-alpine

WORKDIR /app

# Copia solo le dipendenze di produzione
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps

# Copia la build dallo stage precedente
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Porta e comando di avvio
EXPOSE 3000
CMD ["node", "dist/main.js"]