const express = require("express");
const editedTweetRoutes = require("./edited-tweets");
const twitterRenameRoutes = require("./twitter-rename");

const router = express.Router();

router.use(twitterRenameRoutes);
router.use(editedTweetRoutes);

module.exports = router;
