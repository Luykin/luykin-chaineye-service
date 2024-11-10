const express = require('express');
const { query, validationResult } = require('express-validator');
const { Fundraising, CrawlState } = require('../models');
const crawler = require('../services/crawler');

const router = express.Router();

// Validation middleware
const validatePagination = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
];

// Get fundraising data with pagination
router.get('/', validatePagination, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const data = await Fundraising.findAndCountAll({
      limit,
      offset,
      order: [['date', 'DESC']]
    });

    res.json({
      data: data.rows,
      total: data.count,
      page,
      totalPages: Math.ceil(data.count / limit)
    });
  } catch (error) {
    console.error('Error fetching fundraising data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Start full crawl
router.post('/crawl/full', async (req, res) => {
  try {
    const state = await CrawlState.findOne({ where: { isFullCrawl: true } });
    if (state && state.status === 'running') {
      return res.status(400).json({ error: 'Full crawl already in progress' });
    }

    // Start crawl in background
    crawler.fullCrawl().catch(console.error);
    res.json({ message: 'Full crawl started' });
  } catch (error) {
    console.error('Error starting full crawl:', error);
    res.status(500).json({ error: 'Failed to start full crawl' });
  }
});

// Start quick update
router.post('/crawl/quick', async (req, res) => {
  try {
    const state = await CrawlState.findOne({ where: { isFullCrawl: false } });
    if (state && state.status === 'running') {
      return res.status(400).json({ error: 'Quick update already in progress' });
    }

    // Start quick update in background
    crawler.quickUpdate().catch(console.error);
    res.json({ message: 'Quick update started' });
  } catch (error) {
    console.error('Error starting quick update:', error);
    res.status(500).json({ error: 'Failed to start quick update' });
  }
});

// Get crawl status
router.get('/status', async (req, res) => {
  try {
    const [fullCrawl, quickUpdate] = await Promise.all([
      CrawlState.findOne({ where: { isFullCrawl: true } }),
      CrawlState.findOne({ where: { isFullCrawl: false } })
    ]);

    res.json({
      fullCrawl: fullCrawl ? {
        status: fullCrawl.status,
        lastPage: fullCrawl.lastPage,
        lastUpdate: fullCrawl.lastUpdateTime,
        error: fullCrawl.error
      } : null,
      quickUpdate: quickUpdate ? {
        status: quickUpdate.status,
        lastUpdate: quickUpdate.lastUpdateTime,
        error: quickUpdate.error
      } : null
    });
  } catch (error) {
    console.error('Error fetching crawl status:', error);
    res.status(500).json({ error: 'Failed to fetch crawl status' });
  }
});

module.exports = router;