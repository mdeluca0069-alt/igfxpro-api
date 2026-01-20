# Dockerfile SICURO per Railway
FROM node:18-alpine

WORKDIR /app

# 1. Copia file di dipendenze
COPY package*.json ./
COPY prisma ./prisma/

# 2. Installa dipendenze (SOLO produzione)
RUN npm ci --only=production --legacy-peer-deps

# 3. Genera Prisma Client
RUN npx prisma generate

# 4. Copia il codice buildato (devi buildare PRIMA del deploy!)
COPY dist ./dist

# 5. Porta e avvio
EXPOSE 3000
CMD ["node", "dist/main.js"]