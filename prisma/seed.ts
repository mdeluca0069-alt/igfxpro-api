import { PrismaClient, RoleName, AccountType, DepositStatus, TradeType, TradeStatus, RiskEventType, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Inizio seed operativo definitivo…');

  // ===========================
  // PASSWORD HASH
  // ===========================
  const adminPassword = await bcrypt.hash('AdminPassword123!', 10);
  const clientPassword = await bcrypt.hash('ClientPassword123!', 10);
  const ibPassword = await bcrypt.hash('IBPassword123!', 10);

  // ===========================
  // USERS con ID fisso
  // ===========================
  const admin = await prisma.user.upsert({
    where: { email: 'admin@igfxpro.com' },
    update: {},
    create: { 
      id: 'ADMIN_USER', 
      email: 'admin@igfxpro.com', 
      password: adminPassword, 
      role: RoleName.ADMIN, 
      status: UserStatus.ACTIVE,
      name: 'Admin User'
    },
  });

  const client = await prisma.user.upsert({
    where: { email: 'client@igfxpro.com' },
    update: {},
    create: { 
      id: 'CLIENT_USER', 
      email: 'client@igfxpro.com', 
      password: clientPassword, 
      role: RoleName.CLIENT, 
      status: UserStatus.ACTIVE,
      name: 'Client User'
    },
  });

  const ibUser = await prisma.user.upsert({
    where: { email: 'ib@igfxpro.com' },
    update: {},
    create: { 
      id: 'IB_USER', 
      email: 'ib@igfxpro.com', 
      password: ibPassword, 
      role: RoleName.BROKER, 
      status: UserStatus.ACTIVE,
      name: 'Introducing Broker'
    },
  });

  // ===========================
  // COMMISSION PLAN
  // ===========================
  const commissionPlan = await prisma.commissionPlan.upsert({
    where: { id: 'DEFAULT_PLAN' },
    update: {},
    create: { 
      id: 'DEFAULT_PLAN', 
      name: 'Default Plan', 
      description: 'Default commission plan for IBs',
      basePercentage: new Decimal('0.001'), // 0.1%
      volumeBonus: new Decimal('0') 
    },
  });

  // ===========================
  // INTRODUCING BROKER (usa commissionPlan come stringa)
  // ===========================
  const ib = await prisma.introducingBroker.upsert({
    where: { id: 'IB_1' },
    update: {},
    create: { 
      id: 'IB_1', 
      name: 'IB_1',
      email: ibUser.email, 
      commissionPlan: 'DEFAULT_PLAN', // STRINGA, non relazione
      isActive: true
    },
  });

  // ===========================
  // ACCOUNTS + WALLETS
  // ===========================
  const clientReal = await prisma.account.upsert({
    where: { id: 'CLIENT_REAL_ACCOUNT' },
    update: {},
    create: {
      id: 'CLIENT_REAL_ACCOUNT',
      userId: client.id,
      type: AccountType.REAL,
      status: 'ACTIVE',
      currency: 'USD',
      leverage: 100,
    },
  });

  const clientDemo = await prisma.account.upsert({
    where: { id: 'CLIENT_DEMO_ACCOUNT' },
    update: {},
    create: {
      id: 'CLIENT_DEMO_ACCOUNT',
      userId: client.id,
      type: AccountType.DEMO,
      status: 'ACTIVE',
      currency: 'USD',
      leverage: 100,
    },
  });

  // ===========================
  // WALLETS per gli account
  // ===========================
  const clientRealWallet = await prisma.wallet.upsert({
    where: { id: 'CLIENT_REAL_WALLET' },
    update: {},
    create: {
      id: 'CLIENT_REAL_WALLET',
      accountId: clientReal.id,
      balance: new Decimal('0'),
      available: new Decimal('0'),
      marginUsed: new Decimal('0'),
      equity: new Decimal('0'),
      freeMargin: new Decimal('0'),
    },
  });

  const clientDemoWallet = await prisma.wallet.upsert({
    where: { id: 'CLIENT_DEMO_WALLET' },
    update: {},
    create: {
      id: 'CLIENT_DEMO_WALLET',
      accountId: clientDemo.id,
      balance: new Decimal('10000'),
      available: new Decimal('10000'),
      marginUsed: new Decimal('0'),
      equity: new Decimal('10000'),
      freeMargin: new Decimal('10000'),
    },
  });

  // ===========================
  // MARKETS
  // ===========================
  const marketsData = [
    { symbol: 'EURUSD', type: 'FOREX', spread: 0.2, swapLong: -1.2, swapShort: 0.8, id: 'EURUSD' },
    { symbol: 'BTCUSD', type: 'CRYPTO', spread: 25, swapLong: -10, swapShort: -10, id: 'BTCUSD' },
    { symbol: 'ETHUSD', type: 'CRYPTO', spread: 15, swapLong: -5, swapShort: -5, id: 'ETHUSD' },
    { symbol: 'USDJPY', type: 'FOREX', spread: 0.3, swapLong: -1.1, swapShort: 0.9, id: 'USDJPY' },
  ];

  for (const m of marketsData) {
    await prisma.market.upsert({
      where: { id: m.id },
      update: {},
      create: { 
        id: m.id,
        symbol: m.symbol, 
        name: m.symbol,
        type: m.type, 
        spread: m.spread, 
        swapLong: m.swapLong, 
        swapShort: m.swapShort 
      },
    });
  }

  // ===========================
  // LEGAL CONTENT
  // ===========================
  const legalContents = [
    { type: 'TERMS', title: 'Terms of Service', content: 'Default terms content' },
    { type: 'PRIVACY', title: 'Privacy Policy', content: 'Default privacy content' },
    { type: 'DISCLAIMER', title: 'Disclaimer', content: 'Default disclaimer content' },
  ];

  for (const item of legalContents) {
    await prisma.legalContent.upsert({
      where: { id: item.type },
      update: {},
      create: { 
        id: item.type, 
        type: item.type,
        title: item.title, 
        content: item.content, 
        version: 1 
      },
    });
  }

  // ===========================
  // COMPANY STATS
  // ===========================
  await prisma.companyStats.upsert({
    where: { id: 'COMPANY_STATS' },
    update: {},
    create: {
      id: 'COMPANY_STATS',
      year: new Date().getFullYear(),
      activeClients: 1,
      totalAccounts: 2,
      totalTrades: 0,
      totalVolume: new Decimal('0'),
      totalCommission: new Decimal('0'),
      activeAccounts: 2,
    },
  });

  // ===========================
  // INITIAL DEPOSIT (REAL ACCOUNT)
  // ===========================
  await prisma.deposit.upsert({
    where: { id: 'INITIAL_DEPOSIT_CLIENT_REAL' },
    update: {},
    create: {
      id: 'INITIAL_DEPOSIT_CLIENT_REAL',
      walletId: clientRealWallet.id,
      amount: new Decimal('1000'),
      method: 'Initial deposit',
      status: DepositStatus.APPROVED,
      approvedBy: admin.email,
      approvedAt: new Date(),
    },
  });

  await prisma.wallet.update({
    where: { id: clientRealWallet.id },
    data: {
      balance: new Decimal('1000'),
      available: new Decimal('1000'),
      equity: new Decimal('1000'),
      freeMargin: new Decimal('1000'),
    },
  });

  // ===========================
  // OPEN INITIAL TRADES (REAL ACCOUNT)
  // ===========================
  for (const m of marketsData) {
    const tradeId = `TRADE_${m.symbol}_1`;
    await prisma.trade.upsert({
      where: { id: tradeId },
      update: {},
      create: {
        id: tradeId,
        accountId: clientReal.id,
        marketId: m.id,
        symbol: m.symbol,
        type: TradeType.BUY,
        status: TradeStatus.OPEN,
        volume: new Decimal('0.01'),
        price: new Decimal('1.1'),
        entryPrice: new Decimal('1.1'),
        pnl: new Decimal('0'),
      },
    });

    await prisma.priceSnapshot.upsert({
      where: { id: tradeId },
      update: {},
      create: {
        id: tradeId,
        symbol: m.symbol,
        price: new Decimal('1.1'),
        timestamp: new Date(),
      },
    });
  }

  // ===========================
  // INITIAL RISK EVENTS
  // ===========================
  await prisma.riskEvent.upsert({
    where: { id: 'RISK_MARGIN_CALL' },
    update: {},
    create: {
      id: 'RISK_MARGIN_CALL',
      accountId: clientReal.id,
      type: RiskEventType.LIQUIDATION_WARNING,
      severity: 'MEDIUM',
      message: 'Margin call warning',
    },
  });

  await prisma.riskEvent.upsert({
    where: { id: 'RISK_STOP_OUT' },
    update: {},
    create: {
      id: 'RISK_STOP_OUT',
      accountId: clientReal.id,
      type: RiskEventType.LIQUIDATION_EXECUTED,
      severity: 'HIGH',
      message: 'Stop out executed',
    },
  });

  console.log('🔥 SEED OPERATIVO DEFINITIVO COMPLETO!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });