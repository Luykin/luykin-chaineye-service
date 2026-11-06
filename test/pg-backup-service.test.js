const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const pgBackupService = require("../src/services/pg-backup-service");

const SAMPLE_DUMP = [
  "COPY public.\"Projects\" (id, name) FROM stdin;",
  "1\tExample",
  "\\.",
  "COPY public.\"XHuntUsers\" (id) FROM stdin;",
  "2",
  "\\.",
  "SELECT pg_catalog.setval('public.\"Projects_id_seq\"', 1, true);",
  "",
].join("\n");

test("accepts compressed and legacy PostgreSQL backup names only", () => {
  assert.equal(pgBackupService.isBackupFileName("pg_backup_2026-11-06.sql"), true);
  assert.equal(pgBackupService.isBackupFileName("pg_backup_2026-11-06.sql.gz"), true);
  assert.equal(pgBackupService.isBackupFileName("pg_backup_2026-11-06.sql.gz.tmp"), false);
  assert.equal(pgBackupService.isBackupFileName("../pg_backup_2026-11-06.sql.gz"), false);
});

test("extracts the same restore SQL from .sql and .sql.gz backups", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-backup-test-"));
  const plainPath = path.join(tempDir, "pg_backup_fixture.sql");
  const gzipPath = `${plainPath}.gz`;

  try {
    await fs.writeFile(plainPath, SAMPLE_DUMP, "utf8");
    await fs.writeFile(gzipPath, zlib.gzipSync(SAMPLE_DUMP));

    const plainResult = await pgBackupService.extractDataOnlySqlFromPlainDump(
      plainPath,
      ["Projects"]
    );
    const gzipResult = await pgBackupService.extractDataOnlySqlFromPlainDump(
      gzipPath,
      ["Projects"]
    );

    assert.equal(gzipResult, plainResult);
    assert.match(gzipResult, /COPY public\."Projects"/);
    assert.match(gzipResult, /Projects_id_seq/);
    assert.doesNotMatch(gzipResult, /XHuntUsers/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("lists compressed and legacy backups but ignores temporary files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-backup-list-test-"));
  const originalBackupDir = pgBackupService.backupDir;

  try {
    pgBackupService.backupDir = tempDir;
    await fs.writeFile(path.join(tempDir, "pg_backup_old.sql"), "old");
    await fs.writeFile(path.join(tempDir, "pg_backup_new.sql.gz"), "new");
    await fs.writeFile(path.join(tempDir, "pg_backup_partial.sql.gz.tmp"), "partial");

    const backups = await pgBackupService.listBackups();
    assert.deepEqual(
      backups.map((backup) => backup.name).sort(),
      ["pg_backup_new.sql.gz", "pg_backup_old.sql"]
    );
  } finally {
    pgBackupService.backupDir = originalBackupDir;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
