import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

/**
 * Serverless + Supabase transaction pooler (6543): one Prisma connection per
 * isolate, pgbouncer mode (no prepared statements), longer pool wait.
 * Shopify's PrismaSessionStorage treats a failed `session.count()` as
 * "table missing" and 410s the Admin iframe.
 */
function prismaDatasourceUrl() {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return raw;
  // Avoid `new URL()` — Supabase passwords often include reserved
  // characters, which makes the parser throw and skip these params.
  const extras: string[] = [];
  if (!/[?&]pgbouncer=/.test(raw)) extras.push("pgbouncer=true");
  if (!/[?&]connection_limit=/.test(raw)) extras.push("connection_limit=1");
  if (!/[?&]pool_timeout=/.test(raw)) extras.push("pool_timeout=20");
  if (extras.length === 0) return raw;
  return raw + (raw.includes("?") ? "&" : "?") + extras.join("&");
}

const prismaClientOptions = {
  datasourceUrl: prismaDatasourceUrl() || undefined,
} as const;

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient(prismaClientOptions);
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient(prismaClientOptions);

export default prisma;
