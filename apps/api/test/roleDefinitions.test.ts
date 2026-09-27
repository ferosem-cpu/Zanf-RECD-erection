import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PERMISSION_KEY, ROLE_KEY } from "@recd/shared";
import { ALL_EXCEPT_SETTINGS, ALL_PERMISSIONS, PERMISSION_DEFINITIONS, ROLE_DEFINITIONS } from "../prisma/roleDefinitions";

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
const allKeys = sorted(Object.values(PERMISSION_KEY));
const allButSettings = allKeys.filter((k) => k !== PERMISSION_KEY.MANAGE_SETTINGS);

test("ALL_PERMISSIONS is every PERMISSION_KEY (computed, so new keys are included automatically)", () => {
  assert.deepEqual(sorted(ALL_PERMISSIONS), allKeys);
  assert.deepEqual(sorted(ALL_EXCEPT_SETTINGS), allButSettings);
});

test("Management = every permission Super Admin has, minus manage_settings", () => {
  const management = ROLE_DEFINITIONS[ROLE_KEY.MANAGEMENT];
  const superAdmin = ROLE_DEFINITIONS[ROLE_KEY.SUPER_ADMIN];
  assert.deepEqual(
    sorted(management.permissions),
    sorted(superAdmin.permissions).filter((k) => k !== PERMISSION_KEY.MANAGE_SETTINGS),
  );
  assert.ok(!management.permissions.includes(PERMISSION_KEY.MANAGE_SETTINGS));
  // The seed actively revokes it too, so a DB that ever granted it gets cleaned up.
  assert.deepEqual(management.revoke, [PERMISSION_KEY.MANAGE_SETTINGS]);
  // The lists the bug report was about.
  for (const k of [PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.VIEW_ORDERS, PERMISSION_KEY.VIEW_SITE_STATUS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.VIEW_LEDGERS, PERMISSION_KEY.MANAGE_CREDIT_NOTES]) {
    assert.ok(management.permissions.includes(k), k);
  }
});

test("Super Admin has every permission and is the only role with manage_settings", () => {
  assert.deepEqual(sorted(ROLE_DEFINITIONS[ROLE_KEY.SUPER_ADMIN].permissions), allKeys);
  const withSettings = Object.entries(ROLE_DEFINITIONS)
    .filter(([, def]) => def.permissions.includes(PERMISSION_KEY.MANAGE_SETTINGS))
    .map(([key]) => key);
  assert.deepEqual(withSettings, [ROLE_KEY.SUPER_ADMIN]);
});

test("Owner/Admin follows the same all-except-settings rule", () => {
  assert.deepEqual(sorted(ROLE_DEFINITIONS[ROLE_KEY.OWNER_ADMIN].permissions), allButSettings);
});

test("every role is defined and every permission key is seeded exactly once", () => {
  assert.deepEqual(sorted(Object.keys(ROLE_DEFINITIONS)), sorted(Object.values(ROLE_KEY)));
  const seededKeys = PERMISSION_DEFINITIONS.map((p) => p.key);
  assert.equal(seededKeys.length, new Set(seededKeys).size, "duplicate permission definition");
  assert.deepEqual(sorted(seededKeys), allKeys);
});

test("the Management grant migration only touches the management role and never grants manage_settings", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../prisma/migrations/20260927120000_management_all_permissions_except_settings/migration.sql"),
    "utf8",
  );
  const code = sql.replace(/--.*$/gm, "");
  const roleKeysReferenced = sorted([...code.matchAll(/r\.key\s*=\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual(roleKeysReferenced, [ROLE_KEY.MANAGEMENT]);
  assert.match(code, /p\.key\s*<>\s*'manage_settings'/);
  assert.match(code, /DELETE FROM "RolePermission"[\s\S]*p\.key = 'manage_settings'/);
  assert.match(code, /ON CONFLICT DO NOTHING/);
  // No hard-coded ids: role/permission rows are only ever looked up by key.
  assert.doesNotMatch(code, /"roleId"\s*=\s*'/);
});
