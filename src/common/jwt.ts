import { SignJWT, jwtVerify } from "jose";

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
};

function getSecretKey(jwtSecret: string) {
  if (!jwtSecret) {
    throw new Error("JWT_SECRET non configurato (wrangler secret put JWT_SECRET)");
  }
  return new TextEncoder().encode(jwtSecret);
}

export async function signJwt(payload: JwtPayload, jwtSecret: string): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(getSecretKey(jwtSecret));
}

export async function verifyJwt(token: string, jwtSecret: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(jwtSecret));
  return payload as unknown as JwtPayload;
}
