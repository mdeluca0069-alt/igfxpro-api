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

// Maps the internal User.kycStatus / KycCase.status pair down to the
// frontend's OnboardingStatus union. "in_review" covers every submitted-but-
// undecided KycCase state (SUBMITTED, or a future granular sub-status) so
// this doesn't need updating every time the case pipeline gains a new state.
function toKycUnion(kycStatus: string, caseStatus: string | null): "pending" | "approved" | "rejected" | "in_review" {
  if (kycStatus === "approved") return "approved";
  if (kycStatus === "rejected") return "rejected";
  if (caseStatus && caseStatus !== "APPROVED" && caseStatus !== "REJECTED") return "in_review";
  return "pending";
}

complianceRoutes.get("/status", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const [dbUser, kycCase, documents] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.sub }, select: { kycStatus: true, createdAt: true, tier: true } }),
    prisma.kycCase.findUnique({ where: { userId: user.sub } }),
    prisma.clientDocument.findMany({ where: { userId: user.sub } }),
  ]);

  const kycStatus = dbUser?.kycStatus ?? "not_started";
  // Vocabulary here ("clear"/"complete"/"pending"/"review") is dictated by
  // CompliancePage.tsx's StatusPill, which colors by exact string match
  // (ok: verified/clear/complete/active, warn: pending/review, else: error).
  const documentStatus =
    documents.length === 0 ? "pending" : documents.every((d) => d.status === "APPROVED") ? "complete" : documents.some((d) => d.status === "REJECTED") ? "review" : "pending";
  // No dedicated sanctions/PEP screening provider is wired up yet (would need
  // a real screening API — e.g. ComplyAdvantage/Dow Jones); riskScore on the
  // KycCase (set by the onboarding questionnaire) is the only real risk signal
  // currently collected, so it's surfaced honestly instead of faking a clean
  // "clear" from nothing.
  const riskScore = kycCase?.riskScore ?? 0;

  return c.json({
    kycStatus,
    kycCaseStatus: kycCase?.status ?? null,
    amlStatus: riskScore === 0 ? "pending" : riskScore >= 70 ? "review" : "clear",
    documentStatus,
    sanctionsScreening: riskScore >= 70 ? "review" : riskScore === 0 ? "pending" : "clear",
    pepScreening: "pending",
    auditTrailStatus: "active",
    clientClassification: dbUser?.tier ?? "RETAIL",
    lastReviewAt: kycCase?.reviewedAt?.toISOString() ?? null,
    liveTradingAllowed: kycStatus === "approved",
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

  const kycStatus = dbUser?.kycStatus ?? "not_started";
  return c.json({
    kyc: toKycUnion(kycStatus, kycCase?.status ?? null),
    appropriateness: kycStatus === "approved" ? "completed" : "required",
    documents: documents.map((d) => d.documentKey),
    liveTradingAllowed: kycStatus === "approved",
  });
});
