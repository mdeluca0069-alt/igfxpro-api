# ─────────────────────────────────────────
# BUILD STAGE
# ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copia package.json e schema Prisma prima di npm install
COPY package*.json ./
COPY prisma ./prisma

# Installa tutte le dipendenze (inclusi dev per prisma generate)
RUN npm ci --legacy-peer-deps

# Genera Prisma Client
RUN npx prisma generate

# Copia tutto il codice sorgente
COPY . .

# Build TypeScript
RUN npm run build


# ─────────────────────────────────────────
# PRODUCTION STAGE
# ─────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Installa OpenSSL 1.1 (richiesto da Prisma per libssl.so.1.1)
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma

# Solo dipendenze di produzione, salta postinstall
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

# Copia Prisma Client dal builder
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma

# Copia build compilato dal builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Applica migrazioni e avvia server
CMD sh -c "npx prisma migrate deploy && node dist/main.js"
