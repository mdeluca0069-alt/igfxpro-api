# IGFXPRO API - Deploy su Render

## Prerequisiti
- Account Render.com
- Repository GitHub collegato a Render

## Step per il Deploy

### 1. Connetti il Repository su Render
1. Vai su [Render Dashboard](https://dashboard.render.com)
2. Clicca **"New +"** → **"Web Service"**
3. Seleziona il repository: `igfxpro-api`
4. Branch: `main`
5. Clicca **"Connect"**

### 2. Configura il Web Service
- **Name:** `igfxpro-api`
- **Environment:** `Node`
- **Region:** `Ohio` (o la tua preferita)
- **Build Command:** `npm install --legacy-peer-deps && npm run build`
- **Start Command:** `npx prisma migrate deploy && node dist/main.js`
- **Plan:** `Free` (opzionale, puoi scalare dopo)

### 3. Configura il Database PostgreSQL
1. Nel dashboard Render, clicca **"New +"** → **"PostgreSQL"**
2. **Name:** `igfxpro-db`
3. **Database Name:** `igfxpro_db`
4. **Region:** `Ohio` (stessa del Web Service)
5. **Plan:** `Free`
6. Clicca **"Create"**

### 4. Collega il Database al Web Service
1. Dopo la creazione del DB, copia il `Internal Database URL`
2. Nel Web Service, vai a **"Environment"**
3. Aggiungi la variabile `DATABASE_URL` con l'URL copiato

### 5. Aggiungi Variabili di Ambiente
Nel Web Service → **"Environment"**, aggiungi:
```
NODE_ENV=production
PORT=3000
JWT_SECRET=your-very-secure-jwt-secret-key-here
```

### 6. Deploy e Seed del Database
1. Il deploy inizia automaticamente
2. Una volta deployato, il comando `npx prisma migrate deploy` eseguirà le migrazioni
3. Per il seed iniziale, vai nella shell di Render e esegui:
   ```bash
   npm run prisma:seed
   ```

## URL del Backend
Dopo il deploy, il tuo backend sarà disponibile su:
```
https://igfxpro-api.onrender.com
```

## Health Check
Verifica che il backend sia online:
```bash
curl https://igfxpro-api.onrender.com/health
```

## Troubleshooting
- Se il deploy fallisce, vedi i **Deploy Logs** nel dashboard
- Se il database non si connette, verifica la `DATABASE_URL`
- Per problemi di bcryptjs, assicurati che sia installato: `npm install bcryptjs`

## Note di Sicurezza
⚠️ **Non commitare i segreti nel repository!**
- Cambia `JWT_SECRET` nel dashboard Render
- Non usare le stesse password del database locale
