const schedule = require("node-schedule");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { promisify } = require("util");
const { Client } = require("pg");

const execAsync = promisify(exec);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);

/**
 * PostgreSQL 数据库自动备份服务
 * - 每 30 分钟自动备份一次
 * - 只保留最近 10 个备份文件
 * - 备份文件存储在项目根目录的 backups/postgres 文件夹
 */
class PostgresBackupService {
  constructor() {
    this.backupJob = null;
    this.backupDir = path.join(__dirname, "../../backups/postgres");
    this.maxBackups = 10; // 只保留最近 10 个备份

    // 数据库配置（从环境变量或默认配置读取）
    this.dbConfig = {
      host: process.env.PG_HOST || "150.5.158.179",
      port: process.env.PG_PORT || "5432",
      database: process.env.PG_DATABASE || "luykindatabase",
      username: process.env.PG_USERNAME || "luykin",
      password: process.env.PG_PASSWORD || "wtf.0813",
    };
    // 运行 pg_dump 时优先走本机环回地址，避免本地 socket 认证与外网连通差异
    this.dumpHost = process.env.PG_DUMP_HOST || "127.0.0.1";

    // 只备份 X 开头的表（XHunt 相关业务表）
    this.tablesToBackup = [
      "XHuntUsers",
      "XHuntUserTokens",
      "XHuntUserProSubscriptions",
      "XAccounts",
      "XReviewForAccounts",
      "XPrivateNotes",
      "XPrivateMessages",
      "XPointRecords",
      // RootData Fundraising 核心表：支持管理后台按备份时间点恢复
      "Projects",
      "InvestmentRelationships",
      "PositionRelationships",
      //   "MantleRegistrations",
    ];

    // 管理后台允许恢复的表组。严禁开放任意表名，避免误删/注入。
    this.restoreGroups = [
      {
        key: "fundraising_project_relationships",
        label: "RootData Fundraising：项目 + 关系表",
        description:
          "恢复 Projects、InvestmentRelationships、PositionRelationships 到指定备份时间点。",
        tables: ["Projects", "InvestmentRelationships", "PositionRelationships"],
      },
    ];
  }

  /**
   * 从数据库中发现实际存在的表名（public schema），用于构建 pg_dump 的 -t 参数
   * - 同时支持精确名匹配（不区分大小写）和前缀匹配（X 开头）
   */
  async discoverExistingTables() {
    const client = new Client({
      host: this.dbConfig.host,
      port: Number(this.dbConfig.port),
      database: this.dbConfig.database,
      user: this.dbConfig.username,
      password: this.dbConfig.password,
    });

    const desired = this.tablesToBackup;

    // 低配容错：添加常见的 snake_case 变体候选
    const variants = new Set();
    for (const t of desired) {
      variants.add(t);
      variants.add(t.toLowerCase());
      // 简单把驼峰转下划线
      const snake = t
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
      variants.add(snake);
    }

    // 连接并查询 public 下的所有普通表
    await client.connect();
    try {
      const res = await client.query(
        `select schemaname, tablename
         from pg_catalog.pg_tables
         where schemaname = 'public'`
      );

      const allPublic = res.rows.map((r) => ({
        schema: r.schemaname,
        name: r.tablename,
      }));

      // 规则：
      // 1) 名称出现在变体集合（大小写/下划线容错）
      // 2) 或者 X/x 开头（历史规则）
      const matches = allPublic.filter((t) => {
        return (
          variants.has(t.name) ||
          t.name.startsWith("X") ||
          t.name.startsWith("x")
        );
      });

      const finalSet = new Map();
      for (const t of [...matches]) {
        finalSet.set(`${t.schema}.${t.name}`, t);
      }

      return Array.from(finalSet.values());
    } finally {
      await client.end();
    }
  }

  // 简单的标识符引用（双引号包裹且转义内部双引号）
  quoteIdent(ident) {
    return '"' + String(ident).replace(/"/g, '""') + '"';
  }

  shellEscape(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
  }

  getRestoreGroups() {
    return this.restoreGroups.map((group) => ({ ...group }));
  }

  getRestoreGroup(groupKey) {
    const group = this.restoreGroups.find((item) => item.key === groupKey);
    if (!group) {
      throw new Error("不支持的恢复表组");
    }
    return group;
  }

  resolveBackupFile(backupName) {
    const safeName = path.basename(String(backupName || ""));
    if (
      !safeName ||
      safeName !== backupName ||
      !/^pg_backup_[A-Za-z0-9_.:-]+\.sql$/.test(safeName)
    ) {
      throw new Error("备份文件名不合法");
    }

    const backupFilePath = path.resolve(this.backupDir, safeName);
    const backupRoot = path.resolve(this.backupDir);
    if (!backupFilePath.startsWith(`${backupRoot}${path.sep}`)) {
      throw new Error("备份文件路径不合法");
    }
    if (!fs.existsSync(backupFilePath)) {
      throw new Error("备份文件不存在");
    }
    return backupFilePath;
  }

  isCopyLineForTable(line, tableName) {
    return (
      line.startsWith(`COPY public.${this.quoteIdent(tableName)} `) ||
      line.startsWith(`COPY ${this.quoteIdent(tableName)} `) ||
      line.startsWith(`COPY public.${tableName} `) ||
      line.startsWith(`COPY ${tableName} `)
    );
  }

  isSequenceSetLineForTable(line, tableName) {
    return (
      line.startsWith("SELECT pg_catalog.setval(") &&
      line.includes(`${tableName}_id_seq`)
    );
  }

  async extractDataOnlySqlFromPlainDump(backupFilePath, tables) {
    const blocksByTable = new Map(tables.map((table) => [table, []]));
    const sequenceLines = [];
    const presentTables = new Set();

    const stream = fs.createReadStream(backupFilePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let currentTable = null;
    let currentBlock = [];

    for await (const line of rl) {
      if (currentTable) {
        currentBlock.push(line);
        if (line === "\\.") {
          blocksByTable.get(currentTable).push(currentBlock.join("\n"));
          currentTable = null;
          currentBlock = [];
        }
        continue;
      }

      const copyTable = tables.find((table) => this.isCopyLineForTable(line, table));
      if (copyTable) {
        presentTables.add(copyTable);
        currentTable = copyTable;
        currentBlock = [line];
        continue;
      }

      const sequenceTable = tables.find((table) =>
        this.isSequenceSetLineForTable(line, table)
      );
      if (sequenceTable) {
        sequenceLines.push(line);
      }
    }

    const missingTables = tables.filter((table) => !presentTables.has(table));
    if (missingTables.length > 0) {
      throw new Error(
        `备份文件不包含这些表的数据：${missingTables.join(", ")}。请确认该时间点之后的备份已包含 Fundraising 表。`
      );
    }

    return [
      "SET statement_timeout = 0;",
      "SET lock_timeout = 0;",
      "SET client_encoding = 'UTF8';",
      "",
      `TRUNCATE TABLE ${tables
        .map((table) => `public.${this.quoteIdent(table)}`)
        .join(", ")} RESTART IDENTITY;`,
      "",
      ...tables.flatMap((table) => blocksByTable.get(table)),
      "",
      ...sequenceLines,
      "",
    ].join("\n");
  }

  async countRows(tables) {
    const client = new Client({
      host: this.dbConfig.host,
      port: Number(this.dbConfig.port),
      database: this.dbConfig.database,
      user: this.dbConfig.username,
      password: this.dbConfig.password,
    });

    await client.connect();
    try {
      const result = {};
      for (const table of tables) {
        const res = await client.query(
          `select count(*)::int as count from public.${this.quoteIdent(table)}`
        );
        result[table] = Number(res.rows[0]?.count || 0);
      }
      return result;
    } finally {
      await client.end();
    }
  }

  async restoreTablesFromBackup({ backupName, groupKey, createSafetyBackup = true }) {
    const startedAt = Date.now();
    const group = this.getRestoreGroup(groupKey);
    const backupFilePath = this.resolveBackupFile(backupName);
    const tables = group.tables;

    console.log(
      `♻️ 开始恢复表组: ${group.label}，备份文件: ${backupName}，表: ${tables.join(", ")}`
    );

    await this.ensureBackupDir();

    const restoreSql = await this.extractDataOnlySqlFromPlainDump(backupFilePath, tables);
    const beforeCounts = await this.countRows(tables);
    let safetyBackup = null;
    if (createSafetyBackup) {
      console.log("🛟 恢复前先创建安全备份...");
      safetyBackup = await this.performBackup();
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `pg_restore_${Date.now()}_${Math.random().toString(16).slice(2)}.sql`
    );

    try {
      await fs.promises.writeFile(tmpFile, restoreSql, "utf8");

      const command = `PGPASSWORD=${this.shellEscape(
        this.dbConfig.password
      )} psql -h ${this.shellEscape(this.dumpHost)} -p ${this.shellEscape(
        this.dbConfig.port
      )} -U ${this.shellEscape(this.dbConfig.username)} -d ${this.shellEscape(
        this.dbConfig.database
      )} -v ON_ERROR_STOP=1 --single-transaction -f ${this.shellEscape(tmpFile)}`;

      await execAsync(command);
      const afterCounts = await this.countRows(tables);
      const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

      console.log(
        `✅ 表恢复完成: ${group.label}，耗时 ${duration}s，安全备份: ${
          safetyBackup?.name || "-"
        }`
      );

      return {
        backupName,
        groupKey,
        groupLabel: group.label,
        tables,
        beforeCounts,
        afterCounts,
        safetyBackup,
        durationSeconds: Number(duration),
      };
    } finally {
      try {
        if (fs.existsSync(tmpFile)) {
          await fs.promises.unlink(tmpFile);
        }
      } catch (error) {
        console.warn("清理临时恢复 SQL 文件失败:", error.message);
      }
    }
  }

  /**
   * 检查 PostgreSQL 客户端工具是否已安装
   */
  async checkPgDumpAvailable() {
    try {
      const { stdout } = await execAsync("pg_dump --version");
      const version = stdout.trim();
      console.log(`✅ PostgreSQL 客户端工具已安装: ${version}`);
      return true;
    } catch (error) {
      console.error("❌ PostgreSQL 客户端工具未安装或不可用");
      console.error("\n请安装 PostgreSQL 客户端工具：");
      console.error("  macOS:   brew install postgresql");
      console.error("  Ubuntu:  sudo apt-get install postgresql-client");
      console.error("  CentOS:  sudo yum install postgresql");
      console.error("\n安装后重启服务即可启用自动备份功能\n");
      return false;
    }
  }

  /**
   * 启动备份定时任务
   * 每 30 分钟执行一次备份
   */
  async start() {
    console.log("🗄️ PostgreSQL 备份服务启动中...");

    // 检查 pg_dump 是否可用
    const isAvailable = await this.checkPgDumpAvailable();
    if (!isAvailable) {
      console.log("⚠️ 备份服务已禁用，请安装 PostgreSQL 客户端工具后重启");
      return;
    }

    // 确保备份目录存在
    await this.ensureBackupDir();

    // 立即执行一次备份（可选，启动时进行首次备份）
    // await this.performBackup();

    // 设置定时任务：每 30 分钟执行一次
    // Cron 表达式：*/30 * * * * 表示每 30 分钟执行
    this.backupJob = schedule.scheduleJob("*/30 * * * *", async () => {
      console.log(`\n⏰ [${new Date().toISOString()}] 开始执行定时备份...`);
      try {
        await this.performBackup();
      } catch (error) {
        console.error("❌ 定时备份失败:", error);
      }
    });

    console.log("✅ PostgreSQL 备份服务已启动，将每 30 分钟自动备份一次");
    console.log(`📁 备份文件存储路径: ${this.backupDir}`);
    console.log(`📊 最多保留备份数量: ${this.maxBackups} 个\n`);
  }

  /**
   * 停止备份定时任务
   */
  stop() {
    if (this.backupJob) {
      this.backupJob.cancel();
      console.log("🛑 PostgreSQL 备份服务已停止");
    }
  }

  /**
   * 确保备份目录存在
   */
  async ensureBackupDir() {
    try {
      await mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  /**
   * 执行数据库备份
   */
  async performBackup() {
    const startTime = Date.now();
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/T/, "_")
      .split(".")[0];
    const backupFileName = `pg_backup_${timestamp}.sql`;
    const backupFilePath = path.join(this.backupDir, backupFileName);

    console.log(`📦 开始备份数据库: ${this.dbConfig.database}`);
    console.log(`📝 备份文件: ${backupFileName}`);
    console.log(
      `📋 备份表数量: ${this.tablesToBackup.length} 个 (只备份 X 开头的业务表)`
    );

    try {
      // 发现数据库中实际存在的表（public），并进行 schema 限定与正确引用
      const existing = await this.discoverExistingTables();
      if (!existing.length) {
        throw new Error(
          "没有发现需要备份的目标表。请确认表名/大小写/Schema 是否正确。"
        );
      }

      // 将每个 -t 参数包裹为单引号整体，内部使用双引号精确匹配大小写表名：-t 'public."XHuntUsers"'
      const tableParams = existing
        .map(({ schema, name }) => `-t '${this.quoteIdent(schema)}.${this.quoteIdent(name)}'`)
        .join(" ");

      const command = `PGPASSWORD="${this.dbConfig.password}" pg_dump -h ${this.dumpHost} -p ${this.dbConfig.port} -U ${this.dbConfig.username} -d ${this.dbConfig.database} ${tableParams} -F p --no-owner --no-privileges -f "${backupFilePath}"`;

      await execAsync(command);

      // 检查备份文件大小
      const stats = await stat(backupFilePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`✅ 备份成功完成！`);
      console.log(`   文件大小: ${fileSizeMB} MB`);
      console.log(`   耗时: ${duration} 秒`);
      console.log(`   路径: ${backupFilePath}\n`);

      // 清理旧备份文件
      await this.cleanupOldBackups();

      return {
        name: backupFileName,
        path: backupFilePath,
        size: stats.size,
        sizeMB: fileSizeMB,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ 备份失败:", error.message);

      // 如果备份失败，删除可能不完整的备份文件
      try {
        if (fs.existsSync(backupFilePath)) {
          await unlink(backupFilePath);
          console.log("🗑️ 已删除不完整的备份文件");
        }
      } catch (cleanupError) {
        console.error("清理失败的备份文件时出错:", cleanupError);
      }

      throw error;
    }
  }

  /**
   * 清理旧备份文件，只保留最近的 N 个备份
   */
  async cleanupOldBackups() {
    try {
      // 读取备份目录中的所有文件
      const files = await readdir(this.backupDir);

      // 过滤出备份文件并获取文件信息
      const backupFiles = [];
      for (const file of files) {
        if (file.startsWith("pg_backup_") && file.endsWith(".sql")) {
          const filePath = path.join(this.backupDir, file);
          const stats = await stat(filePath);
          backupFiles.push({
            name: file,
            path: filePath,
            mtime: stats.mtime.getTime(),
            size: stats.size,
          });
        }
      }

      // 按修改时间降序排序（最新的在前）
      backupFiles.sort((a, b) => b.mtime - a.mtime);

      // 如果备份文件数量超过限制，删除最旧的文件
      if (backupFiles.length > this.maxBackups) {
        const filesToDelete = backupFiles.slice(this.maxBackups);

        console.log(
          `🗑️ 清理旧备份文件：当前 ${backupFiles.length} 个，保留 ${this.maxBackups} 个，删除 ${filesToDelete.length} 个`
        );

        for (const file of filesToDelete) {
          await unlink(file.path);
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          console.log(
            `   ✓ 已删除: ${file.name} (${fileSizeMB} MB, ${new Date(
              file.mtime
            ).toLocaleString("zh-CN")})`
          );
        }

        console.log(`✅ 清理完成，当前保留 ${this.maxBackups} 个备份文件\n`);
      } else {
        console.log(
          `📊 当前备份文件数量: ${backupFiles.length}/${this.maxBackups}，无需清理\n`
        );
      }
    } catch (error) {
      console.error("❌ 清理旧备份文件时出错:", error);
    }
  }

  /**
   * 获取备份文件列表
   */
  async listBackups() {
    try {
      const files = await readdir(this.backupDir);
      const backupFiles = [];

      for (const file of files) {
        if (file.startsWith("pg_backup_") && file.endsWith(".sql")) {
          const filePath = path.join(this.backupDir, file);
          const stats = await stat(filePath);
          backupFiles.push({
            name: file,
            path: filePath,
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
            mtime: stats.mtime,
            mtimeStr: stats.mtime.toLocaleString("zh-CN"),
          });
        }
      }

      // 按修改时间降序排序
      backupFiles.sort((a, b) => b.mtime - a.mtime);

      return backupFiles;
    } catch (error) {
      console.error("获取备份列表失败:", error);
      return [];
    }
  }

  /**
   * 手动触发备份（用于测试或紧急备份）
   */
  async manualBackup() {
    console.log("🔧 手动触发备份...");
    await this.performBackup();
  }
}

// 导出单例
module.exports = new PostgresBackupService();
