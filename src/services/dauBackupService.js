const fs = require("fs").promises;
const path = require("path");
const schedule = require("node-schedule");

/**
 * DAU数据备份服务
 * 负责每天将Redis中的DAU数据备份到文件系统
 */
class DAUBackupService {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.backupDir = path.join(__dirname, "../../data/dau-backups");
    this.isInitialized = false;
    this.cronJob = null;
  }

  /**
   * 初始化备份服务
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    try {
      // 确保备份目录存在
      await this.ensureBackupDirectory();

      // 设置定时任务：每天北京时间23:59执行备份
      this.setupCronJob();

      this.isInitialized = true;
      console.log("📊 DAU备份服务已初始化");
    } catch (error) {
      console.error("❌ DAU备份服务初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保备份目录存在
   */
  async ensureBackupDirectory() {
    try {
      await fs.access(this.backupDir);
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs.mkdir(this.backupDir, { recursive: true });
        console.log(`📁 创建DAU备份目录: ${this.backupDir}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * 设置定时任务
   */
  setupCronJob() {
    // 只在主进程中设置定时任务，避免 cluster 模式下重复执行
    if (
      process.env.NODE_APP_INSTANCE === "0" ||
      !process.env.NODE_APP_INSTANCE
    ) {
      // 北京时间23:59执行备份（UTC 15:59）
      this.cronJob = schedule.scheduleJob("59 15 * * *", async () => {
        try {
          console.log("🕐 开始执行DAU数据备份任务...");
          await this.backupAllDAUData();
          console.log("✅ DAU数据备份任务完成");
        } catch (error) {
          console.error("❌ DAU数据备份任务失败:", error);
        }
      });

      console.log(
        "⏰ DAU备份定时任务已设置: 每天北京时间23:59执行 ===== 主进程"
      );
    } else {
      console.log("⏭️  非主进程，跳过定时任务设置");
    }
  }

  /**
   * 备份所有Redis中的DAU数据（累加模式）
   */
  async backupAllDAUData() {
    try {
      console.log("🔄 开始备份所有DAU数据（累加模式）...");

      // 先尝试读取已有的备份文件
      let existingUsers = new Set();
      let existingSourceDates = new Set();

      try {
        const existingBackup = await this.readLatestBackupData();
        if (existingBackup && existingBackup.users) {
          console.log(
            `📖 读取到已有备份文件，包含 ${existingBackup.users.length} 个用户`
          );

          // 将已有用户数据加载到Set中
          existingBackup.users.forEach((userId) => {
            existingUsers.add(userId);
          });

          existingSourceDates = new Set(existingBackup.sourceDates || []);
        }
      } catch (error) {
        console.log("ℹ️  没有找到已有备份文件，将创建新文件");
      }

      // 获取所有DAU相关的键
      const dauKeys = await this.redisClient.keys("dau:*");

      if (dauKeys.length === 0) {
        console.log("ℹ️  Redis中没有找到DAU数据");
        return {
          success: true,
          message: "没有找到DAU数据",
          totalUsers: existingUsers.size,
        };
      }

      // 用于存储新处理的用户数据
      let newProcessed = 0;
      let errorCount = 0;
      let addedUsers = 0;

      // 处理每个日期的数据
      for (const dauKey of dauKeys) {
        try {
          const date = dauKey.replace("dau:", "");

          // 如果这个日期已经在已有备份中，跳过
          if (existingSourceDates.has(date)) {
            console.log(`⏭️  跳过已处理的日期: ${date}`);
            continue;
          }

          console.log(`📅 处理 ${date} 的数据...`);

          // 获取该日期的所有DAU数据
          const dauData = await this.redisClient.sMembers(dauKey);

          for (const item of dauData) {
            const [fingerprint, xUserId] = item.split(",");
            const userId = xUserId || fingerprint; // 使用xUserId或fingerprint作为唯一标识

            // 检查是否是新用户
            if (!existingUsers.has(userId)) {
              // 新用户
              existingUsers.add(userId);
              addedUsers++;
            }
          }

          newProcessed += dauData.length;
          existingSourceDates.add(date);
          console.log(`✅ 处理完成 ${date}: ${dauData.length} 条记录`);
        } catch (error) {
          console.error(`❌ 处理 ${dauKey} 失败:`, error);
          errorCount++;
        }
      }

      // 生成累加备份文件（固定文件名）
      const fileName = "dau-all-users.json";
      const filePath = path.join(this.backupDir, fileName);

      // 准备备份数据
      const backupData = {
        exportTime: new Date().toISOString(),
        totalUniqueUsers: existingUsers.size,
        totalRecords: newProcessed,
        sourceDates: Array.from(existingSourceDates).sort(),
        users: Array.from(existingUsers),
      };

      // 写入备份文件
      await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), "utf8");

      const result = {
        success: errorCount === 0,
        message: `备份完成：总计 ${existingUsers.size} 个唯一用户，${backupData.totalRecords} 条总记录（新增 ${addedUsers} 个用户）`,
        fileName: fileName,
        totalUsers: existingUsers.size,
        totalRecords: backupData.totalRecords,
        addedUsers: addedUsers,
        newRecords: newProcessed,
        errorCount: errorCount,
      };

      console.log("📊 备份结果:", result);
      return result;
    } catch (error) {
      console.error("❌ 备份所有DAU数据失败:", error);
      throw error;
    }
  }

  /**
   * 备份指定日期的数据
   */
  async backupDataForDate(date, allowOverwrite = false) {
    const dauKey = `dau:${date}`;

    try {
      // 检查Redis中是否存在该日期的数据
      const exists = await this.redisClient.exists(dauKey);
      if (!exists) {
        console.log(`ℹ️  ${date} 没有DAU数据，跳过备份`);
        return;
      }

      // 获取所有DAU数据
      const dauData = await this.redisClient.sMembers(dauKey);

      if (dauData.length === 0) {
        console.log(`ℹ️  ${date} DAU数据为空，跳过备份`);
        return;
      }

      // 生成备份文件路径
      const fileName = `dau-${date}.json`;
      const filePath = path.join(this.backupDir, fileName);

      // 检查文件是否已存在（如果不允许覆盖）
      if (!allowOverwrite) {
        try {
          await fs.access(filePath);
          console.log(`⚠️  ${date} 备份文件已存在，跳过备份`);
          return;
        } catch (error) {
          // 文件不存在，继续备份
        }
      } else {
        console.log(`🔄 ${date} 允许覆盖，将重新备份数据`);
      }

      // 准备备份数据
      const backupData = {
        date: date,
        backupTime: new Date().toISOString(),
        totalUsers: dauData.length,
        users: dauData.map((item) => {
          const [fingerprint, xUserId] = item.split(",");
          return xUserId || fingerprint; // 只保存用户标识符
        }),
      };

      // 写入备份文件
      await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), "utf8");

      console.log(
        `✅ ${date} DAU数据备份完成: ${dauData.length} 个用户，文件: ${fileName}`
      );

      // 备份成功后，可以选择删除Redis中的数据（可选）
      // await this.redisClient.del(dauKey);
    } catch (error) {
      console.error(`❌ 备份${date}数据时出错:`, error);
      throw error;
    }
  }

  /**
   * 手动备份指定日期的数据
   */
  async manualBackup(date) {
    if (!this.isInitialized) {
      await this.init();
    }

    console.log(`🔄 开始手动备份${date}的DAU数据...`);
    await this.backupDataForDate(date);
  }

  /**
   * 获取所有备份文件列表
   */
  async getBackupFiles() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter((file) => file.startsWith("dau-") && file.endsWith(".json"))
        .sort()
        .reverse(); // 最新的在前

      return backupFiles;
    } catch (error) {
      console.error("❌ 获取备份文件列表失败:", error);
      return [];
    }
  }

  /**
   * 读取指定日期的备份数据
   */
  async readBackupData(date) {
    const fileName = `dau-${date}.json`;
    const filePath = path.join(this.backupDir, fileName);

    try {
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`备份文件不存在: ${fileName}`);
      }
      throw error;
    }
  }

  /**
   * 清理过期的备份文件（保留最近30天）
   */
  async cleanupOldBackups() {
    try {
      const files = await this.getBackupFiles();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let cleanedCount = 0;

      for (const file of files) {
        // 从文件名提取日期
        const dateMatch = file.match(/dau-(\d{4}-\d{2}-\d{2})\.json/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]);
          if (fileDate < thirtyDaysAgo) {
            const filePath = path.join(this.backupDir, file);
            await fs.unlink(filePath);
            cleanedCount++;
            console.log(`🗑️  删除过期备份文件: ${file}`);
          }
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 清理完成，删除了 ${cleanedCount} 个过期备份文件`);
      }
    } catch (error) {
      console.error("❌ 清理过期备份文件失败:", error);
    }
  }

  /**
   * 销毁服务
   */
  destroy() {
    if (this.cronJob) {
      this.cronJob.cancel();
      this.cronJob = null;
    }
    this.isInitialized = false;
    console.log("🛑 DAU备份服务已销毁");
  }

  /**
   * 获取最新的累加备份文件
   */
  async getLatestBackupFile() {
    try {
      const files = await this.getBackupFiles();
      // 查找固定的累加备份文件
      const backupFile = files.find((file) => file === "dau-all-users.json");

      if (!backupFile) {
        return null;
      }

      return backupFile;
    } catch (error) {
      console.error("❌ 获取最新备份文件失败:", error);
      return null;
    }
  }

  /**
   * 读取累加备份文件
   */
  async readLatestBackupData() {
    try {
      const fileName = await this.getLatestBackupFile();
      if (!fileName) {
        throw new Error("没有找到累加备份文件");
      }

      const filePath = path.join(this.backupDir, fileName);
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("备份文件不存在");
      }
      throw error;
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      backupDir: this.backupDir,
      hasCronJob: !!this.cronJob,
    };
  }
}

module.exports = DAUBackupService;
