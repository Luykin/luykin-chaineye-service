const schedule = require("node-schedule");
const rootDataCrawler = require("./rootdata-crawler");
const investorsCrawler = require("./investors-crawler");
const BinanceExNewsCrawler = require("./binance-ex-news-crawler");
const OkxExNewsCrawler = require("./okx-ex-news-crawler");
const CoinBaseTgNewsCrawler = require("./coinbase-tg-news-crawler");
const UpbitExNewsCrawler = require("./upbit-news-crawler");
const TruthsocialCrawler = require("./truthsocial-crawler");
const { NewCrawlState } = require("../models/sqlite-start");
const { exec } = require("child_process");

// const BaseCrawler = require('./base-crawler');

class CrawlerScheduler {
  constructor() {
    this.morningJob = null;
    this.eveningJob = null;
  }

  async startScheduler() {
    this.scheduleTmpPuppeteerCleanup();
    console.log(
      "RootData fundraising 定时更新已迁移到 Tampermonkey，跳过服务器侧 morning/evening quick update。"
    );
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    await this.resetAllState();
    /** 每次重启没必要执行一次 rootData 的更新 start ============ **/
    /** RootData fundraising 列表已改由 Tampermonkey 定时采集，服务重启时不再自动触发 RootData 爬虫 **/
    // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    // this.startInvestorsCrawl().then(r => r);
    // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    /** 每次重启没必要执行一次 rootData 的更新 end ============== **/
    /** 开始币安 公告**/
    // this.startBinanceExNewsCrawl().then(r => r);
    // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    // /** 开始OKX 公告 **/
    // this.startOkxExNewsCrawl().then(r => r);
    // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    // /** 开始coinbase 推特爬取 **/
    // this.startCoinBaseTgNewsCrawler().then(r => r);
    // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    // /** 开始Upbit 公告 **/
    // this.startUpbitExNewsCrawler().then(r => r);
    // // await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
    // /** 开始Truthsocial 公告 **/
    // // this.startTruthsocialCrawler().then(r => r);
  }

  stopScheduler() {
    if (this.morningJob) {
      this.morningJob.cancel();
    }
    if (this.eveningJob) {
      this.eveningJob.cancel();
    }
  }

  /** 清理配置文件 **/
  scheduleTmpPuppeteerCleanup() {
    // 每20分钟执行（cron 表达式：分钟 小时 日 月 星期）
    schedule.scheduleJob("*/20 * * * *", () => {
      const cleanupCommand =
        'find /tmp -name "puppeteer-*" -mmin +20 -exec rm -rf {} +';
      exec(cleanupCommand, (err) => {
        if (err) {
          console.error(
            "【浏览器配置文件定时清理】Puppeteer Cleanup failed:",
            err
          );
        } else {
          console.log(
            `【浏览器配置文件定时清理】Puppeteer Cleanup succeeded at ${new Date().toISOString()}`
          );
        }
      });
    });
  }

  /**
   * 重置所有状态为 idle
   * **/
  async resetAllState() {
    try {
      await NewCrawlState.update(
        { status: "idle", error: null, otherInfo: null }, // 更新的字段和值
        { where: {} } // 空条件，表示更新所有记录
      );
      console.log("所有状态已更新为 idle");
    } catch (error) {
      console.error("更新状态时出错:", error);
    }
  }

  /**
   * rootData 爬取启动
   * 包含每日爬取前两页的项目数据，以及爬取详情数据
   * 数据直接写入 PostgreSQL（不再需要迁移步骤）
   * **/
  async startRootDataCrawl() {
    try {
      console.log("🕷️ 开始爬取数据到 PostgreSQL...");
      await rootDataCrawler.quickUpdate();
      await rootDataCrawler.detailsCrawl();
      await rootDataCrawler.subDetailsCrawl();
      console.log("✅ PostgreSQL 数据爬取完成");
    } catch (error) {
      console.error("❌ RootData 爬取失败:", error);
      throw error;
    }
  }

  /** 开始爬取investors列表 **/
  async startInvestorsCrawl() {
    await investorsCrawler.fullCrawl();
  }

  /**
   * 币安交易所公告爬取
   * **/
  async startBinanceExNewsCrawl() {
    await BinanceExNewsCrawler.startCrawling();
  }

  /**
   * OKX交易所公告爬取
   * **/
  async startOkxExNewsCrawl() {
    await OkxExNewsCrawler.startCrawling();
  }

  /**
   * CoinBaseTg公告爬取
   * **/
  async startCoinBaseTgNewsCrawler() {
    await CoinBaseTgNewsCrawler.startCrawling();
  }

  /**
   * Upbit公告爬取
   * **/
  async startUpbitExNewsCrawler() {
    await UpbitExNewsCrawler.startCrawling();
  }

  /**
   * Truthsocial公告爬取
   * **/
  async startTruthsocialCrawler() {
    await TruthsocialCrawler.startCrawling();
  }
}

module.exports = new CrawlerScheduler();
