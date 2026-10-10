import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId } from "../db";
import { sdk } from "./sdk";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // Public single-owner dashboard mode: when no browser session is present,
  // resolve the configured owner so existing user-scoped procedures can serve
  // the owner's dashboard without exposing credentials or accepting a user id
  // from the client. OWNER_OPEN_ID must identify an existing user row.
  if (!user && ENV.ownerOpenId) {
    try {
      user = (await getUserByOpenId(ENV.ownerOpenId)) ?? null;
    } catch (error) {
      console.warn("[Auth] Public owner lookup failed", error instanceof Error ? error.message : error);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
