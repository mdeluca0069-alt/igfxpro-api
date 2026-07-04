import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";

export const configRoutes = new Hono<HonoEnv>();

const DEFAULT_FEATURE_FLAGS = {
  aiTrading: true,
  smartSignals: true,
  brokerControlCenter: true,
  hedgeAutomation: true,
  institutionalCharts: true,
  liveTrading: true,
};

configRoutes.get("/feature-flags", async (c) => {
  const prisma = getPrisma(c.env);
  const setting = await prisma.brokerSetting.findUnique({ where: { key: "feature_flags" } });
  if (!setting) return c.json(DEFAULT_FEATURE_FLAGS);
  return c.json({ ...DEFAULT_FEATURE_FLAGS, ...(setting.value as object) });
});

export const tenantRoutes = new Hono<HonoEnv>();

tenantRoutes.get("/active", async (c) => {
  const prisma = getPrisma(c.env);
  const tenant = await prisma.tenant.findFirst();
  return c.json({
    id: tenant?.id ?? "tenant_igfxpro",
    slug: "igfxpro",
    name: tenant?.name ?? "IGFXPRO",
    region: tenant?.region ?? "EU",
    defaultCurrency: "EUR",
    regulatoryProfile: "MiFID II / ESMA CFD controls",
    branding: {
      accent: "#22d3ee",
      logoUrl: "/assets/logos/primary-logo.svg",
    },
    features: ["olos-ai", "sandbox-execution", "negative-balance-protection"],
  });
});
