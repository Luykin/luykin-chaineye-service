const fs = require("fs");
const path = require("path");

class TypemapManager {
  constructor() {
    this._idMapCache = {
      byType: {
        1: new Set(), // Projects
        2: new Set(), // Organizations
        3: new Set(), // People
      },
      isLoaded: false,
    };
    this.loadIdMaps();
  }

  /**
   * 加载所有 typemap 文件到内存中。
   */
  loadIdMaps() {
    if (this._idMapCache.isLoaded) {
      return;
    }

    console.log("正在加载 Typemap 文件到内存...");
    const typemapDir = __dirname;
    const files = [
      "idmap-from-redis-type-1.json",
      "idmap-from-redis-type-2.json",
      "idmap-from-redis-type-3.json",
    ];

    for (const file of files) {
      try {
        const filePath = path.join(typemapDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const jsonData = JSON.parse(content);

        if (jsonData && jsonData.success && Array.isArray(jsonData.data)) {
          const type = parseInt(jsonData.type, 10);
          if (this._idMapCache.byType[type]) {
            for (const item of jsonData.data) {
              this._idMapCache.byType[type].add(String(item.id));
            }
          }
        }
      } catch (error) {
        console.error(`加载或解析 typemap 文件 ${file} 时出错:`, error);
      }
    }

    this._idMapCache.isLoaded = true;
    console.log("Typemap 文件加载完成。");
  }

  /**
   * 根据 ID 获取其类型。
   * @param {string|number} id 要查询的 ID。
   * @returns {number|null} 返回类型 (1: Project, 2: Organization, 3: Person)，如果找不到则返回 null。
   */
  getType(id) {
    const idStr = String(id);
    if (this._idMapCache.byType[1].has(idStr)) return 1;
    if (this._idMapCache.byType[2].has(idStr)) return 2;
    if (this._idMapCache.byType[3].has(idStr)) return 3;
    return null;
  }
}

// 创建单例
const instance = new TypemapManager();
module.exports = instance;
