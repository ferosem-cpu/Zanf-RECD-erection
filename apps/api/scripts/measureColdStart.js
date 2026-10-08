// Measures how long the built API (dist/index.js) takes to import - the module-load part of a
// serverless cold start - and which heavy modules are loaded at that point. Never listens and
// never touches a database: VERCEL + NODE_ENV=production skip app.listen, Prisma connects
// lazily on the first query, and DOTENV_CONFIG_PATH points at no file so no .env is read.
//   node scripts/measureColdStart.js
process.env.NODE_ENV = "production";
process.env.VERCEL = "1";
process.env.DOTENV_CONFIG_PATH = "__no_env_file__";
process.env.JWT_SECRET = process.env.JWT_SECRET || "cold-start-measurement-only";

const t0 = process.hrtime.bigint();
require("../dist/index.js");
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

const heavy = ["googleapis", "pdf-parse", "mammoth", "openai", "@anthropic-ai/sdk", "nodemailer", "@prisma/client", "bcryptjs", "google-auth-library"];
const loaded = heavy.filter((m) => Object.keys(require.cache).some((p) => p.includes(`node_modules${require("path").sep}${m.replace("/", require("path").sep)}${require("path").sep}`)));
console.log(JSON.stringify({ importMs: Math.round(ms), modulesInCache: Object.keys(require.cache).length, heavyLoaded: loaded }));
