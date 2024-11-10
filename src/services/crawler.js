const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { Fundraising, CrawlState } = require('../models');

class FundraisingCrawler {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async crawlPage(pageNum) {
    try {
      await this.page.goto(`https://www.rootdata.com/Fundraising?page=${pageNum}`, {
        waitUntil: 'networkidle0'
      });

      // Wait for the table to load
      await this.page.waitForSelector('.fundraising-table');

      // Extract data
      const fundraisingData = await this.page.evaluate(() => {
        const rows = document.querySelectorAll('.fundraising-table tr');
        return Array.from(rows).slice(1).map(row => {
          const cells = row.querySelectorAll('td');
          return {
            projectName: cells[0]?.textContent?.trim(),
            amount: cells[1]?.textContent?.trim(),
            date: cells[2]?.textContent?.trim(),
            investors: cells[3]?.textContent?.trim(),
            stage: cells[4]?.textContent?.trim(),
            category: cells[5]?.textContent?.trim()
          };
        });
      });

      return fundraisingData;
    } catch (error) {
      console.error(`Error crawling page ${pageNum}:`, error);
      throw error;
    }
  }

  async fullCrawl(startPage = 1) {
    let currentPage = startPage;
    let hasMoreData = true;
    const state = await CrawlState.findOne({ where: { isFullCrawl: true } }) || 
                 await CrawlState.create({ isFullCrawl: true });

    try {
      await this.initialize();
      state.status = 'running';
      await state.save();

      while (hasMoreData) {
        console.log(`Crawling page ${currentPage}...`);
        
        const data = await retry(
          async () => {
            return await this.crawlPage(currentPage);
          },
          {
            retries: 3,
            minTimeout: 2000,
            maxTimeout: 5000
          }
        );

        if (data.length === 0) {
          hasMoreData = false;
          continue;
        }

        await Fundraising.bulkCreate(data, {
          updateOnDuplicate: ['amount', 'investors', 'stage', 'category']
        });

        state.lastPage = currentPage;
        state.lastUpdateTime = new Date();
        await state.save();

        currentPage++;
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      state.status = 'completed';
      await state.save();
    } catch (error) {
      state.status = 'failed';
      state.error = error.message;
      await state.save();
      throw error;
    } finally {
      await this.close();
    }
  }

  async quickUpdate() {
    try {
      await this.initialize();
      const state = await CrawlState.findOne({ where: { isFullCrawl: false } }) ||
                   await CrawlState.create({ isFullCrawl: false });

      state.status = 'running';
      await state.save();

      // Only crawl first 3 pages for quick updates
      for (let page = 1; page <= 3; page++) {
        const data = await this.crawlPage(page);
        await Fundraising.bulkCreate(data, {
          updateOnDuplicate: ['amount', 'investors', 'stage', 'category']
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      state.lastUpdateTime = new Date();
      state.status = 'completed';
      await state.save();
    } catch (error) {
      console.error('Quick update error:', error);
      throw error;
    } finally {
      await this.close();
    }
  }
}

module.exports = new FundraisingCrawler();