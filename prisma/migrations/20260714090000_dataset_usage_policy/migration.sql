-- Make dataset usage an explicit, auditable policy instead of relying on
-- missing metadata to block legacy files at release time.
UPDATE "DatasetBatch"
SET "status" = 'ACTIVE'
WHERE "status" = 'IMPORTED';

UPDATE "DatasetBatch"
SET "status" = 'LEGACY_QUARANTINED'
WHERE "name" = 'dataset-base-v1'
   OR "sourceFileName" = 'sharegpt-distill-dsv4-all-clean.json';

UPDATE "DatasetRelease"
SET "status" = 'LEGACY_QUARANTINED'
WHERE "version" = 'pilot-v1'
   OR "version" LIKE 'dataset-base-v1%';
