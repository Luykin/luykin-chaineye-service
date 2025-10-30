const retry = require("async-retry");
const axios = require("axios");
// 从 SQLite 导入爬取状态管理
const { NewCrawlState, C_STATE_TYPE } = require("../models/sqlite-start");
// 从 PostgreSQL 导入 Fundraising 模型
const { Fundraising } = require("../models/postgres-fundraising");
const { v4: uuidv4 } = require("uuid");
const { Op, literal } = require("sequelize");
const BaseCrawler = require("./base-crawler");
const { ip1, ip2, ip3, ip4 } = require("./base-crawler");
const baseRootDataURL = "https://www.rootdata.com";

class FundraisingCrawler extends BaseCrawler {
  constructor() {
    super();
    // 合并所有代理到扁平数组
    this.allProxies = [...ip1, ...ip2, ...ip3, ...ip4];

    // 【配置】页面获取方案优先级
    // 'axios' = 优先使用方案1（axios + setContent，快速但可能遇到登录问题）
    // 'puppeteer' = 优先使用方案2（puppeteer + goto，慢但支持cookie登录）
    this.fetchStrategy = "puppeteer"; // 可选值: 'axios' | 'puppeteer'
  }

  /**
   * 获取随机代理（可能返回 null 表示不使用代理）
   */
  getRandomProxyOrNull() {
    const useProxy = Math.random() > 0.8; // 20% 概率使用代理
    if (!useProxy) {
      return null; // 不使用代理
    }

    const availableProxies = this.allProxies.filter(
      (p) => !this.banedIp.includes(p?.ip)
    );

    if (availableProxies.length === 0) {
      return null; // 没有可用代理就直连
    }

    const randomIndex = Math.floor(Math.random() * availableProxies.length);
    return availableProxies[randomIndex];
  }

  /**
   * 使用随机代理或直连发送 axios 请求，失败自动尝试下一个
   */
  async axiosRequestWithRetry(url, config = {}, maxRetries = 5) {
    const triedProxies = new Set();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const proxy = this.getRandomProxyOrNull();

      // 如果选中了某个代理且已经尝试过，跳过
      if (proxy && triedProxies.has(proxy.ip)) {
        continue;
      }

      // 标记这个代理为已尝试
      if (proxy) {
        triedProxies.add(proxy.ip);
      }

      console.log(
        `[axios] 尝试 ${attempt + 1}/${maxRetries} (${
          proxy ? `${proxy.ip}:${proxy.port}` : "直连"
        })`
      );

      try {
        const axiosConfig = {
          ...config,
          //   proxy: proxy
          //     ? {
          //         protocol: "http",
          //         host: proxy.ip,
          //         port: parseInt(proxy.port),
          //         auth: {
          //           username: proxy.username,
          //           password: proxy.password,
          //         },
          //       }
          //     : false, // false 表示不使用代理
        };

        const response = await axios.get(url, axiosConfig);

        if (response.status >= 300 && response.status < 400) {
          throw new Error(`被重定向，状态码: ${response.status}`);
        }

        return response;
      } catch (error) {
        console.log(
          `[axios] 尝试 ${attempt + 1}/${maxRetries} 失败 (${
            proxy ? `${proxy.ip}:${proxy.port}` : "直连"
          }):`,
          error.message
        );

        // 如果是最后一次尝试，抛出错误
        if (attempt === maxRetries - 1) {
          throw error;
        }
      }
    }

    throw new Error("所有尝试都失败了");
  }

  /**
   * 【爬虫】每一页的操作，爬取项目列表页面，包括等待页面加载，输入页数量，数据构建等
   * **/
  async crawlPage(pageNum) {
    const { browser, page: pageInstance } = await this.initBrowserAndPage();
    try {
      console.log("开始爬取", pageNum, "的数据");
      if (!pageInstance || pageInstance.isClosed()) {
        throw new Error("pageInstance not found");
      }
      const url = `https://www.rootdata.com/Fundraising?page=${pageNum}`;
      // console.log('正在打开网页', url);
      await pageInstance?.goto(url, {
        waitUntil: "networkidle0",
        timeout: 20000, // 设置超时
      });
      // 确保主容器加载完成
      await pageInstance.waitForSelector(".main_container", { timeout: 10000 });
      // 定位分页输入框并输入页码
      const inputSelector =
        "div.el-input.el-pagination__editor.is-in-pagination input";
      await pageInstance.waitForSelector(inputSelector, { timeout: 10000 });
      try {
        await pageInstance.waitForFunction(
          (selector, expectedValue) => {
            const input = document.querySelector(selector);
            return input && input.value === expectedValue;
          },
          { timeout: 3000 },
          inputSelector,
          String(pageNum)
        );
        console.log("页数对应上了，等待会儿继续", pageNum);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        console.log("页面BUG了，页面page对应不上");
        // 步骤2：直接操作DOM清空并设置值（核心逻辑）
        await pageInstance.evaluate(
          (selector, newValue) => {
            const input = document.querySelector(selector);
            if (!input) throw new Error("输入框未找到");

            // 清空并设置新值
            input.value = newValue;

            // 触发必要事件（兼容Vue/React/Angular）
            const events = ["input", "change", "keydown", "keyup"];
            events.forEach((eventName) =>
              input.dispatchEvent(new Event(eventName, { bubbles: true }))
            );
          },
          inputSelector,
          String(pageNum)
        );

        // 步骤3：模拟回车键（双重保障）
        await pageInstance.keyboard.press("Enter");

        // 步骤4：验证输入结果（关键！）
        await pageInstance.waitForFunction(
          (selector, expectedValue) => {
            const input = document.querySelector(selector);
            return input && input.value === expectedValue;
          },
          { timeout: 3000 },
          inputSelector,
          String(pageNum)
        );
        await new Promise((resolve) => setTimeout(resolve, 500)); // 设置间隔

        // 自定义轮询函数（每300ms检查一次，最多60秒）
        async function waitForLoadingComplete() {
          const startTime = Date.now();
          const timeout = 60000; // 60秒超时
          const interval = 1000; // 1s检查间隔

          return new Promise((resolve, reject) => {
            const check = async () => {
              try {
                // 检查DOM状态
                const result = await pageInstance.evaluate(() => {
                  const container = document.querySelector(
                    ".watermusk_center.table-compat-sort.table-compat-sticky.table-responsive"
                  );
                  return !container?.classList.contains(
                    "el-loading-parent--relative"
                  );
                });

                console.log("轮训查看DOM状态", result);
                if (result) {
                  clearInterval(timer);
                  resolve();
                } else if (Date.now() - startTime > timeout) {
                  clearInterval(timer);
                  reject(new Error("轮询超时：加载状态未消失"));
                }
              } catch (error) {
                clearInterval(timer);
                reject(error);
              }
            };

            // 启动轮询
            const timer = setInterval(check, interval);
            check(); // 立即首次检查
          });
        }

        try {
          //等待DOM加载状态消失（el-loading-parent--relative被移除）
          await waitForLoadingComplete();
        } catch (error) {
          console.log("精确等待失败:", error);
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      }

      // 提取并格式化数据（保持原有逻辑不变）
      const fundraisingData = await pageInstance.evaluate(async () => {
        const rows = document.querySelectorAll(".main_container tr");
        return Array.from(rows)
          .slice(1)
          .map((row) => {
            const cells = row.querySelectorAll("td");
            const projectElement = cells[0]?.querySelector(".name .list_name");
            return {
              logo: cells[0]?.querySelector("a img")?.src || "",
              projectName: projectElement?.childNodes[0]?.textContent?.trim(),
              projectLink: projectElement?.href,
              description: cells[0]?.textContent
                ?.trim()
                .replace(projectElement?.textContent?.trim(), "")
                .trim(),
              round: cells[1]?.textContent?.trim(),
              amount: cells[2]?.textContent?.trim(),
              valuation: cells[3]?.textContent?.trim(),
              date: cells[4]?.textContent?.trim(),
              isInitial: true,
            };
          });
      });

      console.log("爬取完毕, 得到", fundraisingData.length);
      if (
        !fundraisingData ||
        !fundraisingData.length ||
        fundraisingData.length <= 1
      ) {
        throw new Error("本次爬取页面没有找到数据");
      }
      return fundraisingData.map((item) => ({
        ...item,
        projectLink: joinUrl(item.projectLink, item.projectName),
        formattedAmount: parseAmount(item.amount),
        formattedValuation: parseAmount(item.valuation),
        fundedAt: parseDate(item.date),
        originalPageNumber: Number(pageNum),
      }));
    } catch (error) {
      console.error(`Error crawling page ${pageNum}:`, error?.message);
      throw error;
    } finally {
      browser && (await browser?.close());
    }
  }

  /**
   * 【爬虫】项目详情页的爬取逻辑，包括投资人，投资轮次，社交媒体等信息 */
  async crawlDetails(
    crawlStateType,
    crawlQueryOptions,
    crawlType,
    filterFunction
  ) {
    const state =
      (await NewCrawlState.findOne({ where: crawlStateType })) ||
      (await NewCrawlState.create(crawlStateType));
    if (state && state.status === "running") {
      throw new Error(`${crawlType} crawl already in progress`);
    }
    try {
      // console.log(`开始爬取【${crawlType}】项目详情数据`);
      // 查询项目列表
      let projectsToCrawl = await Fundraising.Project.findAll({
        ...crawlQueryOptions, // 使用展开运算符
      });
      // 应用层过滤
      if (filterFunction && typeof filterFunction === "function") {
        projectsToCrawl = projectsToCrawl.filter(filterFunction);
        console.log(
          `${crawlType} - 经过过滤后剩余 ${
            projectsToCrawl.length || 0
          } 项目待爬取`
        );
      }

      state.status = "running";
      state.error = null;
      state.lastUpdateTime = new Date();
      state.otherInfo = {
        total: projectsToCrawl.length,
        filterFunction: typeof filterFunction === "function",
      };
      await state.save();

      let remainingCount = projectsToCrawl.length;
      let failedCount = 0;
      for (const project of projectsToCrawl) {
        const { browser, page: pageInstance } = await this.initBrowserAndPage();
        try {
          await retry(
            async () => {
              return await this.scrapeAndUpdateProjectDetails(
                project,
                pageInstance
              );
            },
            {
              retries: 3,
              minTimeout: 1000,
            }
          );
        } catch (err) {
          console.log(`${crawlType} - ${err}`, "详情抓取失败了,继续下一个");
          failedCount++;
          state.otherInfo = {
            ...(state.otherInfo || {}),
            failed: failedCount,
          };
        } finally {
          browser && (await browser?.close?.());
        }
        remainingCount--;
        state.lastUpdateTime = new Date();
        state.otherInfo = {
          ...(state.otherInfo || {}),
          remaining: remainingCount,
          projectLink: project?.projectLink,
        };
        await state.save();
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 设置间隔
      }

      // 完成爬取
      state.lastUpdateTime = new Date();
      state.status = "completed";
      await state.save();
    } catch (error) {
      state.status = "failed";
      state.error = error.message;
      await state.save();
      throw error;
    }
  }

  /**
   * 【爬取类型：全量项目基础信息爬取】全量更新列表机构，包括页面的控制递增，
   * 状态控制
   * **/
  async fullCrawl(startPage = 1) {
    const state =
      (await NewCrawlState.findOne({ where: C_STATE_TYPE.full })) ||
      (await NewCrawlState.create(C_STATE_TYPE.full));
    if (state && state.status === "running") {
      throw new Error("fullCrawl already in progress");
    }
    let currentPage = startPage;
    let hasMoreData = true;
    let failedPages = [];
    // const pageInstance = await this.safeInitPage('listPage');
    try {
      state.status = "running";
      await state.save();

      while (hasMoreData) {
        // if (!pageInstance || pageInstance?.isClosed?.()) {
        // 	throw new Error('pageInstance not found');
        // }
        console.log(`开始爬取第 ${currentPage} 页的机构数据`);
        let data = [];
        try {
          data = await retry(
            async () => {
              return await this.crawlPage(currentPage);
            },
            {
              retries: 3,
              minTimeout: 1000,
            }
          );
        } catch (err) {
          console.log("爬取第 " + currentPage + " 页失败");
          data = [];
          failedPages = [...failedPages, currentPage];
        }

        if ((!data || (data || [])?.length === 0) && currentPage >= 278) {
          hasMoreData = false;
          continue;
        }

        // 获取所有字段，排除不需要更新的字段
        const fieldsToUpdate = Object.keys(
          Fundraising.Project.rawAttributes
        ).filter(
          (field) =>
            !["id", "projectLink", "createdAt", "updatedAt"].includes(field)
        );
        await Fundraising.Project.bulkCreate(data, {
          updateOnDuplicate: fieldsToUpdate,
        });

        state.otherInfo = {
          ...(state.otherInfo || {}),
          currentPage: currentPage,
          failedPages: failedPages,
        };
        state.lastUpdateTime = new Date();
        await state.save();
        currentPage++;
        // Add delay between requests
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      state.status = "completed";
      await state.save();
      console.log("全量爬取项目任务完成，Crawling completed.");
    } catch (error) {
      state.status = "failed";
      state.error = error.message;
      await state.save();
      console.error("全量爬取项目任务失败.", error.message);
      throw error;
    }
  }

  /**
   * 【爬取类型：第一页项目基础信息爬取】快速更新列表机构，每日更新第一页
   * **/
  async quickUpdate() {
    const state =
      (await NewCrawlState.findOne({ where: C_STATE_TYPE.quick })) ||
      (await NewCrawlState.create(C_STATE_TYPE.quick));
    if (state && state.status === "running") {
      throw new Error("quickUpdate already in progress");
    }
    // const pageInstance = await this.safeInitPage('listPage');
    let updateNum = 0;
    try {
      state.status = "running";
      state.error = null;
      await state.save();
      // Only crawl first 3 pages for quick updates
      for (let page = 1; page <= 1; page++) {
        const data = await this.crawlPage(page);
        const existingProject = await Fundraising.Project.findAll({
          // attributes: ['projectLink', 'isInitial', 'projectName'],
          where: {
            projectLink: data.map((item) => item.projectLink),
          },
        });
        const existingLinks = existingProject.map(
          (project) => project.projectLink
        );
        const newData = data.filter(
          (item) => !existingLinks.includes(item.projectLink)
        );

        if (newData.length > 0) {
          // 获取所有字段，排除不需要更新的字段
          const fieldsToUpdate = Object.keys(
            Fundraising.Project.rawAttributes
          ).filter(
            (field) =>
              !["id", "projectLink", "createdAt", "updatedAt"].includes(field)
          );
          // 执行 bulkCreate 时使用动态字段列表
          await Fundraising.Project.bulkCreate(newData, {
            updateOnDuplicate: fieldsToUpdate,
          });
          updateNum = updateNum + newData.length;
        } else {
          console.log("No new data found on page", page);
        }
        //除了更新项目本身，要去更新这一页的项目详情
        const totalCount = existingProject?.length;
        let sucUpdateCount = 0;
        let failedUpdateCount = 0;
        console.log(
          `第 ${page} 页的机构数据有${totalCount}个详情页数据还需要再爬取一遍`
        );
        for (const project of existingProject) {
          if (!project?.isInitial || !project?.projectLink) {
            console.log("非列表项目，或者链接不存在，跳过～");
            failedUpdateCount++;
            continue;
          }
          const { browser, page: pageInstance } =
            await this.initBrowserAndPage();
          try {
            await retry(
              async () => {
                return await this.scrapeAndUpdateProjectDetails(
                  project,
                  pageInstance
                );
              },
              {
                retries: 1,
                minTimeout: 1000,
              }
            );
            sucUpdateCount++;
          } catch (err) {
            failedUpdateCount++;
            console.log("前两页更新逻辑：详情抓取失败了,继续下一个");
          } finally {
            browser && (await browser?.close?.());
            state.otherInfo = {
              sucUpdateCount: sucUpdateCount,
              failedUpdateCount: failedUpdateCount,
            };
            await state.save();
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      state.lastUpdateTime = new Date();
      state.status = "completed";
      state.otherInfo = {
        updateNum: updateNum,
      };
      await state.save();
    } catch (error) {
      console.error("Quick update error:", error);
      state.status = "failed";
      state.error = error.message;
      state.otherInfo = {
        updateNum: updateNum,
      };
      await state.save();
      // throw error;
    } finally {
      console.log("quickUpdate finally: 关闭浏览器");
      // pageInstance && pageInstance?.close?.();
    }
  }

  /**
   * 【爬取类型：项目详情】更新2天前的详情页需要更新的项目
   * **/
  async detailsCrawl() {
    // 获取当前时间的时间戳（毫秒）
    const now = Date.now();
    const daysAgo1 = now - 2.5 * 24 * 60 * 60 * 1000; // 2 天前的时间戳
    // 计算 2 天前的时间戳
    const daysAgo2 = now - 2 * 24 * 60 * 60 * 1000; // 1 天前的时间戳

    const crawlQueryOptions = {
      where: {
        isInitial: true,
        // 合并条件：如果满足以下条件之一
        [Op.or]: [
          { "$investmentsReceived.id$": null }, // investmentsReceived 为空
          { socialLinks: { [Op.eq]: null } }, // socialLinks 为空
          { fundedAt: { [Op.gte]: daysAgo1 } }, // fundedAt 在最近 3 天内
        ],
        // 其他的限制条件
        detailFailuresNumber: { [Op.lte]: 8 },
        projectLink: { [Op.like]: "http%" }, // 确保 projectLink 以 http 开头

        // detailFetchedAt 的条件：要么是 null，要么是超过 2 天前的
        detailFetchedAt: {
          [Op.or]: [
            { [Op.is]: null }, // detailFetchedAt 为 null
            { [Op.lt]: daysAgo2 }, // detailFetchedAt 小于 2 天前
          ],
        },
      },
      include: [
        {
          model: Fundraising.InvestmentRelationships,
          as: "investmentsReceived",
          required: false,
          attributes: ["id"],
        },
      ],
      order: [
        [
          literal('CASE WHEN "originalPageNumber" IS NULL THEN 1 ELSE 0 END'),
          "ASC",
        ],
        ["originalPageNumber", "ASC"],
      ],
    };

    await this.crawlDetails(
      C_STATE_TYPE.detail,
      crawlQueryOptions,
      "detailPage"
    );
  }

  /**
   * 【爬取类型：项目详情】查漏补缺
   * **/
  async detailsCrawlCheckMissing() {
    // 获取当前时间的时间戳（毫秒）
    const now = Date.now();
    // 计算 3 天前的时间戳
    const daysAgo3 = now - 3 * 24 * 60 * 60 * 1000; // 3 天前的时间戳

    // 计算 2 天前的时间戳
    const daysAgo2 = now - 2 * 24 * 60 * 60 * 1000; // 1 天前的时间戳

    const crawlQueryOptions = {
      where: {
        isInitial: true, // 只筛选 isInitial 为 true 的项目
        [Op.or]: [
          { "$investmentsReceived.id$": null }, // investmentsReceived 为空
          { socialLinks: { [Op.eq]: null } }, // socialLinks 为空
          // { fundedAt: { [Op.gte]: daysAgo1 } }  // fundedAt 在最近 3 天内
        ],
        // fundedAt: {
        // 	[Op.lt]: daysAgo3  // 排除最近 3 天内的 fundedAt
        // },
        // originalPageNumber: {
        // 	[Op.lt]: 50  // 限制 originalPageNumber 小于 50
        // },
        projectLink: { [Op.like]: "http%" }, // 确保 projectLink 以 http 开头
        detailFetchedAt: {
          [Op.or]: [
            { [Op.is]: null }, // detailFetchedAt 为 null
            { [Op.lt]: daysAgo2 }, // detailFetchedAt 小于 2 天前
          ],
        },
        [Op.or]: [
          // 添加 OR 条件，满足其中一个即可
          {
            detailFailuresNumber: {
              [Op.lt]: 16, // detailFailuresNumber 小于 8
            },
          },
          {
            detailFailuresNumber: {
              [Op.gte]: 99, // detailFailuresNumber 大于等于 99
            },
          },
        ],
      },
      order: [
        ["originalPageNumber", "DESC"], // originalPageNumber 越大的在前面
      ],
    };

    console.log("开始全量查漏补缺 ======");

    await this.crawlDetails(
      C_STATE_TYPE.detail,
      crawlQueryOptions,
      "detailPage"
    );
  }

  /**
   * 【爬取类型：二层子项目项目详情】子项目详情
   * **/
  async subDetailsCrawl() {
    const crawlQueryOptions = {
      where: {
        isInitial: false,
        detailFailuresNumber: { [Op.lte]: 8 },
        socialLinks: null,
        projectLink: { [Op.like]: "http%" }, // 确保 projectLink 以 http 开头
      },
    };
    await this.crawlDetails(
      C_STATE_TYPE.detail2,
      crawlQueryOptions,
      "socialPage"
    );
  }

  /**
   * 方案1：使用 axios + page.setContent 获取页面
   * 优点：axios 获取快速，可以处理大 HTML
   * 缺点：setContent 可能遇到大文件问题
   */
  async fetchPageWithAxios(url, _page, isManualTrigger = false) {
    if (isManualTrigger) {
      console.log(`[详情] 方案1开始: axios + setContent`);
      console.log(`[详情] URL: ${url}`);
    }

    try {
      // 检查 axios 是否可用
      if (!axios || typeof axios.get !== "function") {
        throw new Error("axios 模块未正确加载");
      }

      if (isManualTrigger) {
        console.log(`[详情] axios 模块检查通过`);
      }

      // 直接使用 axios.get，使用 retry 包装以提高成功率
      const response = await retry(
        async (bail, attemptNum) => {
          if (isManualTrigger) {
            console.log(`[详情] axios 请求尝试 ${attemptNum}/3`);
          }
          try {
            // 【新增】准备cookie字符串
            const cookieString = [
              "_ga=GA1.1.1402673237.1726906805",
              "i18n_redirected=en",
              "rd_v1.theme=light",
              "rd_v1.uuid=d61dd521-025b-4858-9a4d-2879bd62c381",
              "rd_v1.currency=FIAT_USD",
              "rd_v1.auth._token.local1=false",
              "rd_v1.auth._token_expiration.local1=false",
              "rd_v1.auth.strategy=local3",
              "rd_v1.auth._token.local3=f9z34n5sby-70155-58-k68qapsgjb-1761787942202",
              "rd_v1.auth._token_expiration.local3=1764379950916",
              "_ga_TXPS04VGH2=GS2.1.s1761793200$o126$g1$t1761795302$j43$l0$h0",
            ].join("; ");

            if (isManualTrigger) {
              console.log(
                `[详情] 使用cookie进行请求 (${cookieString.substring(
                  0,
                  80
                )}...)`
              );
            }

            const res = await axios.get(url, {
              timeout: 20000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Cache-Control": "max-age=0",
                Connection: "keep-alive",
                Cookie: cookieString,
                "Sec-Ch-Ua":
                  '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"macOS"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
              },
              maxRedirects: 0,
              validateStatus: (status) => status >= 200 && status < 400,
            });
            if (isManualTrigger) {
              console.log(`[详情] axios 响应成功，状态: ${res.status}`);
            }
            return res;
          } catch (err) {
            if (isManualTrigger) {
              console.log(`[详情] axios 请求错误: ${err.message}`);
            }
            // 如果是重定向或其他致命错误，不重试
            if (
              err.response &&
              err.response.status >= 300 &&
              err.response.status < 400
            ) {
              if (isManualTrigger) {
                console.log(`[详情] 检测到重定向: ${err.response.status}`);
              }
              bail(new Error("页面被重定向"));
              return;
            }
            throw err;
          }
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
        }
      );

      const html = response.data;
      const htmlStr = Buffer.isBuffer(html)
        ? html.toString("utf-8")
        : String(html);

      if (isManualTrigger) {
        console.log(`[详情] HTML 长度: ${htmlStr.length} 字节`);
      }

      // 检查是否被重定向到登录页
      if (htmlStr.includes('window.location.href="/login')) {
        if (isManualTrigger) {
          console.log(`[详情] HTML 包含登录重定向脚本`);
        }
        throw new Error("页面重定向到登录页");
      }

      // 【关键】使用 Puppeteer 的 setContent 设置 HTML
      // 为了处理大 HTML，先导航到空白页，然后设置内容
      if (isManualTrigger) {
        console.log(`[详情] 先导航到空白页...`);
      }
      await _page.goto("about:blank", { waitUntil: "domcontentloaded" });

      if (isManualTrigger) {
        console.log(`[详情] 开始 setContent (HTML: ${htmlStr.length} 字节)...`);
      }

      // 使用 setContent，增加超时时间以处理大 HTML
      await _page.setContent(htmlStr, {
        waitUntil: "networkidle0", // 等待网络空闲（包括所有 script 执行）
        timeout: 60000, // 60秒超时
      });

      if (isManualTrigger) {
        console.log(`[详情] setContent 完成`);
        console.log(`[详情] 等待 JavaScript 初始化...`);
      }

      // 等待关键元素加载
      await _page.waitForSelector(".base_info", { timeout: 20000 });

      // 额外等待 JavaScript 完全初始化（Vue/React 等框架需要时间）
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (isManualTrigger) {
        console.log(`[详情] 页面加载完成`);
        const baseInfoCount = await _page.evaluate(() => {
          return document.querySelectorAll(".base_info").length;
        });
        const investorCount = await _page.evaluate(() => {
          return document.querySelectorAll(".investor").length;
        });
        console.log(
          `[详情] 页面元素: .base_info=${baseInfoCount}, .investor=${investorCount}`
        );
      }

      // 返回 Puppeteer page 对象
      return _page;
    } catch (error) {
      if (isManualTrigger) {
        console.log(`[详情] ❌ 方案1失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 方案2：使用 Puppeteer 访问页面
   * 优点：完整的浏览器环境，JavaScript 执行，支持cookie登录
   * 缺点：较慢，可能遇到登录限制
   */
  async fetchPageWithPuppeteer(url, _page, isManualTrigger = false) {
    if (isManualTrigger) {
      console.log(`[详情] 方案2开始: Puppeteer`);
      console.log(`[详情] URL: ${url}`);
    }

    try {
      // 【新增】设置cookie来模拟登录状态
      if (isManualTrigger) {
        console.log(`[详情] 设置登录cookie...`);
      }

      const cookies = [
        {
          name: "_ga",
          value: "GA1.1.1402673237.1726906805",
          domain: ".rootdata.com",
        },
        { name: "i18n_redirected", value: "en", domain: ".rootdata.com" },
        { name: "rd_v1.theme", value: "light", domain: ".rootdata.com" },
        {
          name: "rd_v1.uuid",
          value: "d61dd521-025b-4858-9a4d-2879bd62c381",
          domain: ".rootdata.com",
        },
        { name: "rd_v1.currency", value: "FIAT_USD", domain: ".rootdata.com" },
        {
          name: "rd_v1.auth._token.local1",
          value: "false",
          domain: ".rootdata.com",
        },
        {
          name: "rd_v1.auth._token_expiration.local1",
          value: "false",
          domain: ".rootdata.com",
        },
        {
          name: "rd_v1.auth.strategy",
          value: "local3",
          domain: ".rootdata.com",
        },
        {
          name: "rd_v1.auth._token.local3",
          value: "f9z34n5sby-70155-58-k68qapsgjb-1761787942202",
          domain: ".rootdata.com",
        },
        {
          name: "rd_v1.auth._token_expiration.local3",
          value: "1764379950916",
          domain: ".rootdata.com",
        },
        {
          name: "_ga_TXPS04VGH2",
          value: "GS2.1.s1761793200$o126$g1$t1761795302$j43$l0$h0",
          domain: ".rootdata.com",
        },
      ];

      await _page.setCookie(...cookies);

      if (isManualTrigger) {
        console.log(`[详情] Cookie设置完成，共${cookies.length}个`);
        console.log(`[详情] 启用请求拦截...`);
      }
      // 启用请求拦截，阻止重定向到登录页
      await _page.setRequestInterception(true);

      const requestHandler = (interceptedRequest) => {
        const reqUrl = interceptedRequest.url();
        if (reqUrl.includes("/login") || reqUrl.includes("fromUrl=")) {
          if (isManualTrigger) {
            console.log(`[详情] 拦截登录页请求: ${reqUrl.substring(0, 80)}`);
          }
          interceptedRequest.abort("aborted");
        } else {
          interceptedRequest.continue();
        }
      };

      _page.on("request", requestHandler);

      // 访问页面
      if (isManualTrigger) {
        console.log(`[详情] 开始 page.goto...`);
      }
      try {
        await _page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        if (isManualTrigger) {
          console.log(`[详情] page.goto 完成`);
        }
      } catch (error) {
        if (
          error.message.includes("net::ERR_ABORTED") ||
          error.message.includes("aborted")
        ) {
          if (isManualTrigger) {
            console.log(`[详情] 登录页重定向已阻止`);
          }
        } else {
          if (isManualTrigger) {
            console.log(`[详情] page.goto 错误: ${error.message}`);
          }
          throw error;
        }
      } finally {
        _page.off("request", requestHandler);
        await _page.setRequestInterception(false);
        if (isManualTrigger) {
          console.log(`[详情] 请求拦截已关闭`);
        }
      }

      // 检查当前 URL
      const currentUrl = _page.url();
      if (isManualTrigger) {
        console.log(`[详情] 当前URL: ${currentUrl}`);
      }
      if (currentUrl.includes("/login")) {
        if (isManualTrigger) {
          console.log(`[详情] 检测到仍在登录页`);
        }
        throw new Error("页面被重定向到登录页");
      }

      if (isManualTrigger) {
        console.log(`[详情] ✅ 方案2成功`);
      }

      // 返回 Puppeteer page 对象（不是 document）
      return _page;
    } catch (error) {
      if (isManualTrigger) {
        console.log(`[详情] ❌ 方案2失败: ${error.message}`);
      }
      throw error;
    }
  }

  async scrapeAndUpdateProjectDetails(project, _page, isManualTrigger = false) {
    try {
      if (!_page || _page.isClosed()) {
        throw new Error("网页不见了，Detail page not initialized");
      }

      // 手动触发时，强制视为初始项目以确保完整抓取
      const effectiveIsInitial = isManualTrigger ? true : project.isInitial;

      if (isManualTrigger) {
        console.log(
          `[详情] 开始: ${project.projectName} | ${project.projectLink} | isInitial=${project.isInitial} (手动触发，强制为 true)`
        );
      } else {
        console.log(
          `抓取详情: ${project.projectName} | ${project.projectLink}`
        );
      }

      // 【核心】根据配置选择优先方案，失败后自动fallback
      const primaryStrategy = this.fetchStrategy || "puppeteer";
      const fallbackStrategy =
        primaryStrategy === "axios" ? "puppeteer" : "axios";

      if (isManualTrigger) {
        console.log(
          `[详情] 使用策略: ${primaryStrategy} (fallback: ${fallbackStrategy})`
        );
      }

      let primaryError = null;
      let success = false;

      // 尝试主要方案
      try {
        if (primaryStrategy === "axios") {
          await this.fetchPageWithAxios(
            project.projectLink,
            _page,
            isManualTrigger
          );
          if (isManualTrigger) {
            console.log(`[详情] ✅ 方案1 (axios) 成功`);
          }
        } else {
          await this.fetchPageWithPuppeteer(
            project.projectLink,
            _page,
            isManualTrigger
          );
          if (isManualTrigger) {
            console.log(`[详情] ✅ 方案2 (puppeteer) 成功`);
          }
        }
        success = true;
      } catch (error) {
        primaryError = error;
        if (isManualTrigger) {
          console.log(
            `[详情] ❌ 主方案 (${primaryStrategy}) 失败: ${error.message}`
          );
          console.log(`[详情] 🔄 切换到备选方案 (${fallbackStrategy})...`);
        }
      }

      // 如果主方案失败，尝试fallback方案
      if (!success) {
        try {
          if (fallbackStrategy === "axios") {
            await this.fetchPageWithAxios(
              project.projectLink,
              _page,
              isManualTrigger
            );
            if (isManualTrigger) {
              console.log(`[详情] ✅ 备选方案1 (axios) 成功`);
            }
          } else {
            await this.fetchPageWithPuppeteer(
              project.projectLink,
              _page,
              isManualTrigger
            );
            if (isManualTrigger) {
              console.log(`[详情] ✅ 备选方案2 (puppeteer) 成功`);
            }
          }
        } catch (fallbackError) {
          throw new Error(
            `两种方案都失败 | 主方案(${primaryStrategy}): ${primaryError.message} | 备选(${fallbackStrategy}): ${fallbackError.message}`
          );
        }
      }

      // 【统一】两个方案都已经返回了可用的 _page，DOM 已就绪
      if (isManualTrigger) {
        const investorCount = await _page.evaluate(() => {
          return document.querySelectorAll(".investor").length;
        });
        console.log(`[详情] .investor 元素数量: ${investorCount}`);
      }

      // 点击展开更多按钮
      await this.clickExpandButtons(_page);

      let mergedInvestors = []; //谁对它投资的投资者数据
      let investedProjects = []; //它对外投资的投资者数据

      if (effectiveIsInitial) {
        const initialInvestors = await this.scrapeInitialInvestors(
          _page,
          isManualTrigger
        );
        if (isManualTrigger) {
          console.log(`[详情] 初始投资者: ${initialInvestors?.length || 0}`);
        }

        // 第二阶段：点击 rounds 按钮并抓取轮次数据
        await this.clickRoundsButton(_page);

        const roundsInvestors = await this.processRounds(
          _page,
          isManualTrigger
        );
        if (isManualTrigger) {
          console.log(`[详情] 轮次投资者: ${roundsInvestors?.length || 0}`);
        }
        if (
          isManualTrigger &&
          initialInvestors?.length !== roundsInvestors?.length
        ) {
          console.log(
            `[详情] ⚠️ 投资者数量不一致: initial=${
              initialInvestors?.length || 0
            }, rounds=${roundsInvestors?.length || 0}`
          );
        }
        // 合并投资者数据（轮次数据优先）
        mergedInvestors = this.mergeInvestorData(
          initialInvestors,
          roundsInvestors
        );

        // 第三阶段：抓取它投资的项目（.investment 部分）
        if (isManualTrigger) {
          console.log(`[详情] 开始抓取对外投资...`);
        }
        investedProjects = await this.scrapeInvestments(_page, isManualTrigger);
        if (isManualTrigger) {
          console.log(
            `[详情] 对外投资项目数: ${investedProjects?.length || 0}`
          );
        }
      }

      // 抓取基础信息（使用 Puppeteer）
      const details = await _page.evaluate(() => {
        const socialLinks = {};
        document.querySelectorAll(".base_info .links a").forEach((link) => {
          const type = link
            .querySelector("span")
            ?.textContent?.trim()
            .toLowerCase();
          if (type) socialLinks[type] = link.href;
        });

        const teamMembers = Array.from(
          document.querySelectorAll(".team_member .item")
        ).map((member) => ({
          name: member.querySelector(".content h2")?.textContent?.trim(),
          position: member.querySelector(".content p")?.textContent?.trim(),
          avatar: member.querySelector(".logo-wraper img")?.src || "",
          profileLink: member.querySelector(".card")?.href || "",
        }));

        return {
          socialLinks,
          teamMembers,
          projectName: document
            .querySelector(".detail_info_head h1.name")
            ?.textContent?.trim(),
          logo: document.querySelector(".detail_info_head .logo")?.src || "",
        };
      });

      // 更新项目基础信息
      const isCrawlSuccess =
        details.projectName &&
        details.logo &&
        Object.keys(details.socialLinks).length > 0;
      if (isManualTrigger) {
        console.log(
          `[详情] 抓取成功=${isCrawlSuccess} 社交链接=${
            Object.keys(details.socialLinks).length
          } 团队=${details.teamMembers?.length || 0}`
        );
      }
      await project.update({
        projectName: details.projectName,
        logo: details.logo,
        socialLinks: details.socialLinks,
        teamMembers: details.teamMembers,
        detailFetchedAt: isCrawlSuccess ? Date.now() : null,
        detailFailuresNumber: isCrawlSuccess
          ? mergedInvestors?.length || investedProjects?.length
            ? 0
            : 99
          : (Number(project.detailFailuresNumber) || 0) + 1,
      });
      let updateRelationshipsLength = 0;
      // 保存投资关系数据（被投资关系）
      if (mergedInvestors.length > 0) {
        if (isManualTrigger) {
          console.log(
            `[详情] 开始保存被投资关系 (${mergedInvestors.length} 个投资者)...`
          );
        }
        updateRelationshipsLength = await this.updateInvestmentRelationships(
          project,
          mergedInvestors
        );
        if (isManualTrigger) {
          console.log(
            `[详情] 被投资关系保存成功: ${updateRelationshipsLength} 条`
          );
        }
      }

      // 保存对外投资关系（投资者视角）
      let investedRelationshipsLength = 0;
      if (investedProjects.length > 0) {
        if (isManualTrigger) {
          console.log(
            `[详情] 开始保存对外投资关系 (${investedProjects.length} 个项目)...`
          );
        }
        investedRelationshipsLength = await this.updateInvestedRelationships(
          project,
          investedProjects
        );
        if (isManualTrigger) {
          console.log(
            `[详情] 对外投资关系保存成功: ${investedRelationshipsLength} 条`
          );
        }
      }

      console.log(
        `抓取详情成功 ${project.projectName} ${
          effectiveIsInitial
            ? `被投资关系: ${updateRelationshipsLength}, 对外投资关系: ${investedRelationshipsLength}`
            : "不需要关联"
        }`
      );
      return true;
    } catch (error) {
      console.error(
        `[错误] 失败: ${project.projectName} | ${project.projectLink}`
      );
      console.error(`[错误] ${error.name}: ${error.message}`);

      await project.update({
        detailFailuresNumber: project.detailFailuresNumber + 1,
      });
      throw error;
    }
  }

  // 点击展开更多按钮（不点击rounds按钮）[dom检查没问题，不需要修改]
  async clickExpandButtons(_page) {
    await _page.evaluate(() => {
      document.querySelectorAll("button").forEach((button) => {
        if (/expand\s*more/i.test(button.textContent)) {
          button.click();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 设置间隔
  }

  // 抓取初始投资者数据（无轮次信息）
  async scrapeInitialInvestors(_page, isManualTrigger = false) {
    // Puppeteer 模式：在浏览器环境执行
    const result = await _page.evaluate(() => {
      // 收集调试信息
      const debug = {
        investorCount: document.querySelectorAll(".investor").length,
        rowCount: document.querySelectorAll(".investor .row").length,
        rowItemCount: document.querySelectorAll(".investor .row .item").length,
        itemCount: document.querySelectorAll(".investor .item").length,
      };

      // 尝试不同的选择器
      let items = document.querySelectorAll(".investor .row .item");
      let usedSelector = ".investor .row .item";

      if (items.length === 0) {
        items = document.querySelectorAll(".investor .item");
        usedSelector = ".investor .item";
      }

      debug.usedSelector = usedSelector;
      debug.finalCount = items.length;

      const investors = Array.from(items)
        .map((item) => {
          const link = item.querySelector("a");
          if (!link) {
            return null;
          }

          // 获取链接并确保是绝对路径
          let projectLink = link.getAttribute("href") || link.href;
          if (projectLink && !projectLink.startsWith("http")) {
            try {
              projectLink = new URL(projectLink, "https://www.rootdata.com")
                .href;
            } catch (e) {
              // URL 解析失败，保持原样
            }
          }

          return {
            projectLink: projectLink,
            projectName: link.querySelector("h2")?.textContent?.trim(),
            lead: !!item.querySelector(".status_icon.status_position"),
            source: "initial",
          };
        })
        .filter(Boolean);

      return { debug, investors };
    });

    // 仅在手动触发时打印详细调试信息
    if (isManualTrigger) {
      console.log(
        `[详情] 查找 .investor 元素数量: ${result.debug.investorCount}`
      );
      console.log(
        `[详情] 查找 .investor .row 元素数量: ${result.debug.rowCount}`
      );
      console.log(
        `[详情] 查找 .investor .row .item 元素数量: ${result.debug.rowItemCount}`
      );
      console.log(
        `[详情] 查找 .investor .item 元素数量: ${result.debug.itemCount}`
      );
      console.log(`[详情] 使用的选择器: ${result.debug.usedSelector}`);
      console.log(
        `[详情] 最终找到的投资者元素数量: ${result.debug.finalCount}`
      );
    }

    return result.investors;
  }

  // 点击rounds按钮
  async clickRoundsButton(_page) {
    await _page.evaluate(() => {
      document.querySelectorAll("button").forEach((button) => {
        if (/rounds/i.test(button.textContent)) {
          button.click();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 设置间隔
  }

  // 处理轮次数据
  async processRounds(_page, isManualTrigger = false) {
    // Puppeteer 模式：在浏览器环境执行
    const result = await _page.evaluate(() => {
      // 收集调试信息
      const debug = {
        investorCount: document.querySelectorAll(".investor").length,
        trCount: document.querySelectorAll(".investor tr").length,
        theadCount: document.querySelectorAll(".investor thead").length,
      };

      // 建立表头到列下标的映射，避免硬编码列序号
      const headerCells = Array.from(
        document.querySelectorAll(
          ".investor thead th, .investor tr:first-child th, .investor tr:first-child td"
        )
      );

      debug.headerCellsCount = headerCells.length;

      const normalize = (str) =>
        String(str || "")
          .trim()
          .toLowerCase();
      const headerTexts = headerCells.map((th) => normalize(th.textContent));
      debug.headerTexts = headerTexts;

      const findIndexBy = (regex, fallbackIndex) => {
        const idx = headerTexts.findIndex((t) => regex.test(t));
        return idx >= 0 ? idx : fallbackIndex;
      };

      const idxRound = findIndexBy(/round/i, 0);
      const idxAmount = findIndexBy(/amount/i, 1);
      const idxValuation = findIndexBy(/valuation/i, 2);
      const idxDate = findIndexBy(/date/i, 3);
      const idxInvestors = findIndexBy(/investor/i, headerCells.length - 1);

      debug.columnIndexes = {
        idxRound,
        idxAmount,
        idxValuation,
        idxDate,
        idxInvestors,
      };

      const rows = Array.from(document.querySelectorAll(".investor tr")).slice(
        1
      );
      debug.dataRowsCount = rows.length;

      const investors = rows
        .map((row) => {
          const cells = row.querySelectorAll("td");
          const round = cells[idxRound]?.textContent?.trim();
          const amount = cells[idxAmount]?.textContent?.trim();
          const valuation = cells[idxValuation]?.textContent?.trim();
          const date = cells[idxDate]?.textContent?.trim();

          const investorCell = cells[idxInvestors];
          if (!investorCell) {
            return [];
          }

          const investorLinks = investorCell.querySelectorAll("a");

          return Array.from(investorLinks).map((a) => {
            // 获取链接并确保是绝对路径
            let projectLink = a.getAttribute("href") || a.href;
            if (projectLink && !projectLink.startsWith("http")) {
              try {
                projectLink = new URL(projectLink, "https://www.rootdata.com")
                  .href;
              } catch (e) {
                // URL 解析失败，保持原样
              }
            }

            return {
              projectLink: projectLink,
              projectName: a.textContent.replace("*", "").trim(),
              lead: a.textContent.includes("*"),
              round,
              amount,
              valuation,
              date,
              source: "rounds",
            };
          });
        })
        .flat();

      return { debug, investors };
    });

    // 仅在手动触发时打印详细调试信息
    if (isManualTrigger) {
      console.log(`[详情] 开始处理轮次数据`);
      console.log(
        `[详情] 查找 .investor 元素数量: ${result.debug.investorCount}`
      );
      console.log(`[详情] 查找 .investor tr 元素数量: ${result.debug.trCount}`);
      console.log(
        `[详情] 查找 .investor thead 元素数量: ${result.debug.theadCount}`
      );
      console.log(
        `[详情] 找到表头单元格数量: ${result.debug.headerCellsCount}`
      );
      console.log(
        `[详情] 表头文本: ${JSON.stringify(result.debug.headerTexts)}`
      );
      console.log(
        `[详情] 列索引: ${JSON.stringify(result.debug.columnIndexes)}`
      );
      console.log(`[详情] 数据行数量: ${result.debug.dataRowsCount}`);
    }

    return result.investors;
  }

  // 抓取投资者对外投资的项目（.investment 部分）
  async scrapeInvestments(_page, isManualTrigger = false) {
    try {
      if (isManualTrigger) {
        console.log(`[详情] 开始抓取 .investment 部分...`);
      }

      // 检查是否存在 .investment 元素
      const hasInvestment = await _page.evaluate(() => {
        return document.querySelectorAll(".investment").length > 0;
      });

      if (!hasInvestment) {
        if (isManualTrigger) {
          console.log(`[详情] 页面无 .investment 元素，跳过`);
        }
        return [];
      }

      const allProjects = [];
      const addedLinks = new Set(); // 用于去重 projectLink
      const addedNames = new Set(); // 用于去重 projectName

      // 1. 点击 Portfolio Tab 并抓取
      if (isManualTrigger) {
        console.log(`[详情] 点击 Portfolio Tab...`);
      }

      // 使用 dispatchEvent 触发完整的点击事件（而不是简单的 btn.click()）
      try {
        // 等待 tab 按钮出现并可交互
        await _page.waitForSelector(".investment .tabs button", {
          timeout: 5000,
        });

        // 找到并点击 Portfolio 按钮
        await _page.evaluate(() => {
          const buttons = Array.from(
            document.querySelectorAll(".investment .tabs button")
          );
          const portfolioBtn = buttons.find((btn) =>
            btn.textContent.includes("Portfolio")
          );
          if (portfolioBtn) {
            // 使用 dispatchEvent 触发完整事件（包括冒泡），确保 Vue/React 事件监听器被触发
            portfolioBtn.dispatchEvent(
              new MouseEvent("click", {
                view: window,
                bubbles: true,
                cancelable: true,
              })
            );
          }
        });

        // 等待内容动态加载
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (isManualTrigger) {
          console.log(`[详情] Portfolio Tab 已点击`);
        }
      } catch (e) {
        if (isManualTrigger) {
          console.log(`[详情] Portfolio Tab 点击失败: ${e.message}`);
        }
      }

      const portfolioProjects = await _page.evaluate(() => {
        const projects = [];
        const items = document.querySelectorAll(
          ".investment .row.list .item a.card"
        );
        items.forEach((item) => {
          let link = item.getAttribute("href") || item.href;
          const name = item.querySelector("h2")?.textContent?.trim();

          // 确保是绝对路径
          if (link && !link.startsWith("http")) {
            try {
              link = new URL(link, "https://www.rootdata.com").href;
            } catch (e) {
              // URL 解析失败
            }
          }

          if (link && name) {
            projects.push({
              projectLink: link,
              projectName: name,
              type: "portfolio",
            });
          }
        });
        return projects;
      });

      if (isManualTrigger) {
        console.log(`[详情] Portfolio 项目数: ${portfolioProjects.length}`);
      }

      // 去重后添加 Portfolio 项目
      let portfolioAdded = 0;
      for (const proj of portfolioProjects) {
        if (
          !addedLinks.has(proj.projectLink) &&
          !addedNames.has(proj.projectName)
        ) {
          allProjects.push(proj);
          addedLinks.add(proj.projectLink);
          addedNames.add(proj.projectName);
          portfolioAdded++;
        }
      }

      if (isManualTrigger && portfolioAdded < portfolioProjects.length) {
        console.log(
          `[详情] Portfolio 去重后: ${portfolioAdded} 个（过滤了 ${
            portfolioProjects.length - portfolioAdded
          } 个重复）`
        );
      }

      // 2. 点击 VC Tab 并抓取
      if (isManualTrigger) {
        console.log(`[详情] 点击 VC Tab...`);
      }

      // 使用 dispatchEvent 触发完整的点击事件
      try {
        // 找到并点击 VC 按钮
        await _page.evaluate(() => {
          const buttons = Array.from(
            document.querySelectorAll(".investment .tabs button")
          );
          const vcBtn = buttons.find((btn) => btn.textContent.includes("VC"));
          if (vcBtn) {
            // 使用 dispatchEvent 触发完整事件（包括冒泡），确保 Vue/React 事件监听器被触发
            vcBtn.dispatchEvent(
              new MouseEvent("click", {
                view: window,
                bubbles: true,
                cancelable: true,
              })
            );
          }
        });

        // 等待内容动态加载
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (isManualTrigger) {
          console.log(`[详情] VC Tab 已点击`);
        }
      } catch (e) {
        if (isManualTrigger) {
          console.log(`[详情] VC Tab 点击失败: ${e.message}`);
        }
      }

      const vcProjects = await _page.evaluate(() => {
        const projects = [];
        const items = document.querySelectorAll(
          ".investment .row.list .item a.card"
        );
        items.forEach((item) => {
          let link = item.getAttribute("href") || item.href;
          const name = item.querySelector("h2")?.textContent?.trim();

          // 确保是绝对路径
          if (link && !link.startsWith("http")) {
            try {
              link = new URL(link, "https://www.rootdata.com").href;
            } catch (e) {
              // URL 解析失败
            }
          }

          if (link && name) {
            projects.push({
              projectLink: link,
              projectName: name,
              type: "vc",
            });
          }
        });
        return projects;
      });

      if (isManualTrigger) {
        console.log(`[详情] VC 项目数: ${vcProjects.length}`);
      }

      // 去重后添加 VC 项目
      let vcAdded = 0;
      for (const proj of vcProjects) {
        if (
          !addedLinks.has(proj.projectLink) &&
          !addedNames.has(proj.projectName)
        ) {
          allProjects.push(proj);
          addedLinks.add(proj.projectLink);
          addedNames.add(proj.projectName);
          vcAdded++;
        }
      }

      if (isManualTrigger && vcAdded < vcProjects.length) {
        console.log(
          `[详情] VC 去重后: ${vcAdded} 个（过滤了 ${
            vcProjects.length - vcAdded
          } 个重复）`
        );
      }

      if (isManualTrigger) {
        console.log(
          `[详情] 总计对外投资项目: ${allProjects.length} 个（去重后）`
        );
      }

      return allProjects;
    } catch (error) {
      console.error(`[错误] 抓取 .investment 失败:`, error.message);
      return [];
    }
  }

  // 合并投资者数据（优先使用轮次数据）
  mergeInvestorData(initial, rounds) {
    const resultMap = new Map(); // 最终结果：(projectName, round) -> 投资记录
    const roundsProjectNames = new Set(); // 记录 rounds 中出现过的投资者

    // 1. 处理轮次数据 - 使用 (projectName, round) 作为唯一键
    (rounds || []).forEach((inv) => {
      const uniqueKey = `${inv.projectName}|${inv.round || "no-round"}`;
      roundsProjectNames.add(inv.projectName); // 记录投资者

      if (!resultMap.has(uniqueKey)) {
        resultMap.set(uniqueKey, {
          ...inv,
          projectLink: joinUrl(inv.projectLink, inv.projectName),
          formattedAmount: parseAmount(inv.amount),
          formattedValuation: parseAmount(inv.valuation),
          timestamp: parseDate(inv.date),
        });
      }
    });

    // 2. 补充初始数据中独有的投资者（完全不在 rounds 中的）
    (initial || []).forEach((inv) => {
      // 如果这个投资者已经在 rounds 中出现过（任何轮次），跳过
      if (roundsProjectNames.has(inv.projectName)) {
        return;
      }

      const uniqueKey = `${inv.projectName}|no-round`;
      if (!resultMap.has(uniqueKey)) {
        resultMap.set(uniqueKey, {
          ...inv,
          projectLink: joinUrl(inv.projectLink, inv.projectName),
          round: "--", // 使用 '--' 而不是 null
          amount: null,
          valuation: null,
          date: null,
          formattedAmount: null,
          formattedValuation: null,
          timestamp: 1230739200000, //2009/01/01 00:00:00
        });
      }
    });

    return Array.from(resultMap.values());
  }

  async updateInvestmentRelationships(project, investors) {
    const sequelize = Fundraising.Project.sequelize;
    let transaction;

    try {
      transaction = await sequelize.transaction();

      // 1. 处理投资者项目（串行化处理）
      const investorRecords = [];
      for (const inv of investors) {
        // 跳过没有项目名称的记录，避免创建 Unknown 项目
        if (!inv.projectName || inv.projectName.trim() === "") {
          console.log(`⏭️ 跳过无项目名称的投资者: ${inv.projectLink}`);
          continue;
        }

        const projectLink = joinUrl(inv.projectLink, inv.projectName);

        // 使用事务化的 findOrCreate
        const [investorProject] = await Fundraising.Project.findOrCreate({
          where: { projectLink },
          defaults: {
            projectName: inv.projectName,
            isInitial: false, // 投资者项目，由 subDetailsCrawl() 处理
            socialLinks: null, // ✅ 初始化为 null，满足 subDetailsCrawl 条件
            detailFailuresNumber: 0, // ✅ 初始化失败次数为 0
            detailFetchedAt: null, // ✅ 初始化抓取时间为 null，等待爬虫抓取
          },
          transaction,
        });

        investorRecords.push({
          investorProjectId: investorProject.id,
          fundedProjectId: project.id,
          round: inv.round || "--", // 使用 '--' 而不是 null，避免重复数据
          amount: inv.amount || null,
          formattedAmount: inv.formattedAmount || null,
          valuation: inv.valuation || null,
          formattedValuation: inv.formattedValuation || null,
          date: inv.timestamp || null,
          lead: !!inv.lead,
        });
      }

      // 2. 批量写入投资关系（事务内执行）
      await Fundraising.InvestmentRelationships.bulkCreate(investorRecords, {
        transaction,
        updateOnDuplicate: [
          "lead",
          "round",
          "amount",
          "valuation",
          "date",
          "formattedAmount",
          "formattedValuation",
        ],
      });

      await transaction.commit();
      return investorRecords.length;
    } catch (error) {
      if (transaction) await transaction.rollback();

      // 重试机制（最多3次）
      if (error.name === "SequelizeTimeoutError" && this.retryCount < 3) {
        this.retryCount = (this.retryCount || 0) + 1;
        console.log(`Retrying (${this.retryCount}/3)...`);
        return this.updateInvestmentRelationships(project, investors);
      }

      console.error("Failed to update investment relationships:", error);
      throw error;
    } finally {
      this.retryCount = 0; // 重置重试计数
    }
  }

  // 保存对外投资关系（投资者视角）
  async updateInvestedRelationships(investorProject, investedProjects) {
    const sequelize = Fundraising.Project.sequelize;
    let transaction;

    try {
      transaction = await sequelize.transaction();

      // 1. 处理被投资项目（串行化处理）
      const relationshipRecords = [];
      for (const proj of investedProjects) {
        // 跳过没有项目名称的记录，避免创建 Unknown 项目
        if (!proj.projectName || proj.projectName.trim() === "") {
          console.log(`⏭️ 跳过无项目名称的投资项目: ${proj.projectLink}`);
          continue;
        }

        const projectLink = joinUrl(proj.projectLink, proj.projectName);

        // 使用事务化的 findOrCreate
        const [fundedProject] = await Fundraising.Project.findOrCreate({
          where: { projectLink },
          defaults: {
            projectName: proj.projectName,
            isInitial: false,
            socialLinks: null,
            detailFailuresNumber: 0,
            detailFetchedAt: null,
          },
          transaction,
        });

        relationshipRecords.push({
          investorProjectId: investorProject.id, // 当前项目（投资者）
          fundedProjectId: fundedProject.id, // 被投资的项目
          round: "--", // 使用 '--' 而不是 null，避免重复数据
          amount: null,
          formattedAmount: null,
          valuation: null,
          formattedValuation: null,
          date: null,
          lead: false,
        });
      }

      // 2. 批量写入投资关系（事务内执行）
      await Fundraising.InvestmentRelationships.bulkCreate(
        relationshipRecords,
        {
          transaction,
          ignoreDuplicates: true, // 忽略重复（避免冲突）
        }
      );

      await transaction.commit();
      return relationshipRecords.length;
    } catch (error) {
      if (transaction) await transaction.rollback();
      console.error("Failed to update invested relationships:", error);
      throw error;
    }
  }
}

module.exports = new FundraisingCrawler();

function joinUrl(path, projectName) {
  // 如果 path 包含无效的 'javascript:void(0)' 链接，替换为唯一标识符
  if (String(path).includes("javascript:void(0)")) {
    return `javascript:void(0)/${projectName || uuidv4()}`;
  }

  // 如果 path 没有协议，拼接 baseRootDataURL
  if (!/^https?:\/\//i.test(path)) {
    const base = baseRootDataURL.replace(/\/+$/, ""); // 移除 base 末尾的多余斜杠
    path = path.replace(/^\/+/, ""); // 移除 path 开头的多余斜杠
    path = `${base}/${path}`;
  }

  // 去除多余的斜杠，确保中间只有一个斜杠
  path = path.replace(/([^:]\/)\/+/g, "$1");

  // 清理重复的 URL 参数
  const url = new URL(path);
  const params = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (!params.has(key)) params.append(key, value);
  });
  url.search = params.toString();

  // 清理重复的锚点
  if (url.hash) {
    const uniqueHash = Array.from(new Set(url.hash.split("#"))).join("");
    url.hash = uniqueHash;
  }

  return url.toString();
}

function parseAmount(valueStr) {
  if (!valueStr || valueStr === "--") return null;

  // 移除所有美元符号、空格以及中英文单位
  valueStr = valueStr
    .replace(/\$/g, "") // 移除美元符号
    .replace(/美元/g, "") // 移除中文美元
    .replace(/,/g, "") // 移除数字中的逗号
    .replace(/ /g, "") // 移除空格
    .trim();

  // 空值检查
  if (valueStr === "") return null;

  let multiplier = 1;
  const units = [
    // 中文大单位优先
    { pattern: /十亿/g, val: 1e9 },
    { pattern: /亿/g, val: 1e8 },
    { pattern: /万/g, val: 1e4 },

    // 英文单位（不区分大小写）
    { pattern: /billion/i, val: 1e9 },
    { pattern: /million/i, val: 1e6 },
    { pattern: /thousand/i, val: 1e3 },

    // 单字母后缀（严格匹配末尾）
    { pattern: /B$/i, val: 1e9 },
    { pattern: /M$/i, val: 1e6 },
    { pattern: /K$/i, val: 1e3 },
  ];

  // 循环匹配单位
  for (const unit of units) {
    if (unit.pattern.test(valueStr)) {
      multiplier = unit.val;
      valueStr = valueStr.replace(unit.pattern, "").trim();
      break; // 匹配到第一个单位后退出
    }
  }

  // 解析数值（支持负数和科学计数法）
  const value = parseFloat(valueStr);
  return Number.isFinite(value) ? value * multiplier : null;
}

function parseDate(dateStr) {
  if (!dateStr) return null;

  const currentYear = new Date().getFullYear();
  let formattedDateStr;

  // 英文日期格式处理
  if (/^[A-Za-z]{3} \d{2}, \d{4}$/.test(dateStr)) {
    formattedDateStr = dateStr;
  } else if (/^[A-Za-z]{3}, \d{4}$/.test(dateStr)) {
    formattedDateStr = `01 ${dateStr.replace(",", "")}`;
  } else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
    formattedDateStr = `${dateStr}, ${currentYear}`;
  }

  // 中文日期格式处理
  else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // 格式为 "2022-11-08"
    formattedDateStr = dateStr;
  } else if (/^\d{2}-\d{2}$/.test(dateStr)) {
    // 格式为 "11-08"，无年份
    formattedDateStr = `${currentYear}-${dateStr}`;
  }

  // 格式化为时间戳
  const timestamp = Date.parse(formattedDateStr);
  return isNaN(timestamp) ? null : timestamp;
}
