import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { fileURLToPath } from "node:url";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const cookieDomain = process.env.BETTER_AUTH_COOKIE_DOMAIN;

export const auth = betterAuth({
  database: new Database(
    process.env.BETTER_AUTH_DATABASE ?? fileURLToPath(new URL("./better-auth.db", import.meta.url)),
  ),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret,
  trustedOrigins: [process.env.FLASK_APP_URL ?? "http://localhost:8000"],
  advanced: cookieDomain
    ? {
        crossSubDomainCookies: {
          enabled: true,
          domain: cookieDomain,
        },
      }
    : {},
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            requireEmailVerification: true,
          },
        }
      : {},
});