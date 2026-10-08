// Import time of each heavy dependency on its own (fresh process per module).
//   node scripts/measureModuleImports.js
const { execFileSync } = require("child_process");
const mods = ["express", "@prisma/client", "googleapis", "google-auth-library", "pdf-parse", "mammoth", "openai", "@anthropic-ai/sdk", "nodemailer", "bcryptjs", "zod", "@recd/shared"];
for (const m of mods) {
  const code = `const t=process.hrtime.bigint();try{require(${JSON.stringify(m)})}catch(e){console.log(${JSON.stringify(m)}+" ERR "+e.message.split("\\n")[0]);process.exit(0)}console.log(${JSON.stringify(m)}.padEnd(22)+Math.round(Number(process.hrtime.bigint()-t)/1e6)+" ms")`;
  process.stdout.write(execFileSync(process.execPath, ["-e", code], { cwd: __dirname + "/.." }).toString());
}
