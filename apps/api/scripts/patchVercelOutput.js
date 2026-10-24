const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, "../../..");
const apiVercelOutput = path.resolve(repoRoot, "apps/api/.vercel/output/functions");
const sharedPkgDir = path.resolve(repoRoot, "packages/shared");
const sharedDist = path.resolve(sharedPkgDir, "dist");
const sharedPkgJson = path.resolve(sharedPkgDir, "package.json");

if (!fs.existsSync(apiVercelOutput)) {
  console.error(`Error: .vercel/output/functions not found at ${apiVercelOutput}. Run 'vercel build' first.`);
  process.exit(1);
}

if (!fs.existsSync(sharedDist)) {
  console.error(`Error: packages/shared/dist not found at ${sharedDist}. Build the shared package first.`);
  process.exit(1);
}

function getFuncDirs(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file.endsWith('.func')) {
        results.push(fullPath);
      } else {
        results = results.concat(getFuncDirs(fullPath));
      }
    }
  });
  return results;
}

const funcDirs = getFuncDirs(apiVercelOutput);

funcDirs.forEach((funcDir) => {
  console.log(`Patching ${path.relative(apiVercelOutput, funcDir)}...`);

  // (a) Patch .vc-config.json
  const vcConfigPath = path.join(funcDir, ".vc-config.json");
  if (fs.existsSync(vcConfigPath)) {
    try {
      const vcConfig = JSON.parse(fs.readFileSync(vcConfigPath, 'utf8'));
      if (vcConfig.filePathMap) {
        const mentionsShared = JSON.stringify(vcConfig.filePathMap).includes("@recd/shared");
        if (mentionsShared) {
          delete vcConfig.filePathMap;
          fs.writeFileSync(vcConfigPath, JSON.stringify(vcConfig, null, 2), 'utf8');
          console.log(`  - Removed filePathMap from .vc-config.json`);
        }
      }
    } catch (err) {
      console.warn(`  - Warning: Failed to parse or write .vc-config.json: ${err.message}`);
    }
  }

  // (b) Patch @recd/shared
  const targets = [
    path.join(funcDir, "node_modules/@recd/shared")
  ];
  
  const apiNodeModules = path.join(funcDir, "apps/api/node_modules");
  if (fs.existsSync(apiNodeModules)) {
    targets.push(path.join(apiNodeModules, "@recd/shared"));
  }

  targets.forEach((T) => {
    if (fs.existsSync(T) || fs.lstatSync(T, { throwIfNoEntry: false })) {
      try {
        const lstat = fs.lstatSync(T);
        if (lstat.isSymbolicLink()) {
          fs.unlinkSync(T);
          console.log(`  - Unlinked symlink at ${path.relative(funcDir, T)}`);
        } else if (lstat.isDirectory()) {
          fs.rmSync(T, { recursive: true, force: true });
          console.log(`  - Removed directory at ${path.relative(funcDir, T)}`);
        }
      } catch (err) {
        console.warn(`  - Warning: Failed to remove ${T}: ${err.message}`);
      }
    }

    try {
      fs.mkdirSync(T, { recursive: true });
      fs.cpSync(sharedDist, path.join(T, "dist"), { recursive: true, dereference: true });
      fs.copyFileSync(sharedPkgJson, path.join(T, "package.json"));
      console.log(`  - Copied shared package to ${path.relative(funcDir, T)}`);
    } catch (err) {
      console.error(`  - Error: Failed to copy shared package to ${T}: ${err.message}`);
    }
  });

  // Scan for remaining symlinks pointing to directories
  function scanSymlinks(dir) {
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      const fullPath = path.join(dir, file);
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          const targetPath = fs.readlinkSync(fullPath);
          const resolvedTarget = path.resolve(path.dirname(fullPath), targetPath);
          if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
            console.warn(`  - Warning: Remaining symlinked directory found: ${path.relative(funcDir, fullPath)} -> ${targetPath}`);
          }
        } else if (lstat.isDirectory()) {
          scanSymlinks(fullPath);
        }
      } catch (err) {
        // Skip errors on scanning
      }
    });
  }
  scanSymlinks(funcDir);
});

console.log("Patching complete.");
