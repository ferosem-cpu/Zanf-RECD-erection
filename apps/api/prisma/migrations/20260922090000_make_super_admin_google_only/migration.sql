-- The primary Super Admin authenticates exclusively through Google Identity Services.
-- Removing the legacy seed password at the data layer prevents password login even if
-- an older application deployment is temporarily serving traffic during rollout.
UPDATE "User"
SET "passwordHash" = NULL,
    "mustChangePassword" = false
WHERE LOWER("email") = 'ferosem@gmail.com';
