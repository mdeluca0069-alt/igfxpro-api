import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";

export const complianceRoutes = new Hono<HonoEnv>();
complianceRoutes.use("*", jwtAuthMiddleware);

complianceRoutes.get("/disclosures", async (c) => {
  return c.json({
    jurisdiction: "EU",
    retailProtections: [
      "Negative balance protection",
      "ESMA leverage limits (30:1 major FX, down to 2:1 crypto)",
      "Standardised risk warning on CFD products",
      "Mandatory margin close-out at 50%",
    ],
    legalNote: "CFDs are complex instruments and come with a high risk of losing money rapidly due to leverage.",
  });
});

complianceRoutes.get("/status", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const [dbUser, kycCase] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.sub }, select: { kycStatus: true } }),
    prisma.kycCase.findUnique({ where: { userId: user.sub } }),
  ]);

  return c.json({
    kycStatus: dbUser?.kycStatus ?? "not_started",
    kycCaseStatus: kycCase?.status ?? null,
    liveTradingAllowed: dbUser?.kycStatus === "approved",
  });
});

export const onboardingRoutes = new Hono<HonoEnv>();
onboardingRoutes.use("*", jwtAuthMiddleware);

onboardingRoutes.get("/status", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const [dbUser, kycCase, documents] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.sub } }),
    prisma.kycCase.findUnique({ where: { userId: user.sub } }),
    prisma.clientDocument.findMany({ where: { userId: user.sub } }),
  ]);

  return c.json({
    kyc: { status: dbUser?.kycStatus ?? "not_started", caseStatus: kycCase?.status ?? null },
    appropriateness: { completed: !!kycCase },
    documents: documents.map((d) => ({ documentKey: d.documentKey, status: d.status })),
    liveTradingAllowed: dbUser?.kycStatus === "approved",
  });
});
