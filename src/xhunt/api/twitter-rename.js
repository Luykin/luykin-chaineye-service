const express = require("express");
const axios = require("axios");

const router = express.Router();

const MEMORY_LOL_BASE_URL = "https://api.memory.lol";

function normalizeTwitterHandle(value) {
  const handle = String(value || "")
    .trim()
    .replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : "";
}

// GET /api/xhunt/twitter/rename-info?handle=xxx
router.get("/rename-info", async (req, res) => {
  try {
    const handle = normalizeTwitterHandle(req.query.handle);
    if (!handle) {
      return res.status(400).json({ error: "INVALID_HANDLE" });
    }

    const response = await axios.get(
      `${MEMORY_LOL_BASE_URL}/v1/tw/${encodeURIComponent(handle)}`,
      {
        timeout: 8000,
        headers: {
          Accept: "application/json",
        },
      }
    );

    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json(
      response.data && typeof response.data === "object"
        ? response.data
        : { accounts: [] }
    );
  } catch (error) {
    if (error.response?.status === 404) {
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.status(200).json({ accounts: [] });
    }

    console.error("[TwitterRename] fetch rename info failed:", {
      handle: req.query.handle,
      status: error.response?.status,
      message: error.message,
    });

    return res.status(502).json({ error: "RENAME_INFO_FETCH_FAILED" });
  }
});

module.exports = router;
