const crypto = require("crypto");
const express = require("express");
const db = require("../models");

const router = express.Router();

function generateApiKey() {
  return `rk_${crypto.randomBytes(24).toString("hex")}`;
}

router.post("/apikey/create", async (req, res) => {
  try {
    const remark = typeof req.body?.remark === "string" ? req.body.remark.trim() : null;
    const key = generateApiKey();

    if (!db?.ApiKey) {
      return res.status(500).json({ success: false, error: "API_KEY_MODEL_NOT_READY" });
    }

    const row = await db.ApiKey.create({
      key,
      status: "active",
      credits_total: 100,
      credits_remaining: 100,
      remark: remark || null,
      last_used_at: null,
      expires_at: null,
    });

    return res.json({
      success: true,
      data: {
        id: row.id,
        key: row.key,
        status: row.status,
        credits_total: Number(row.credits_total),
        credits_remaining: Number(row.credits_remaining),
        expires_at: row.expires_at,
        remark: row.remark,
      },
    });
  } catch (err) {
    console.error("[rootdatapro] /internal/apikey/create error", err);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: err?.message || String(err),
    });
  }
});

router.post("/apikey/topup", async (req, res) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : null;
    const amountRaw = req.body?.amount;
    const amount = typeof amountRaw === "string" ? Number(amountRaw) : amountRaw;

    if (!key) {
      return res.status(400).json({ success: false, error: "INVALID_KEY" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: "INVALID_AMOUNT" });
    }

    if (!db?.ApiKey) {
      return res.status(500).json({ success: false, error: "API_KEY_MODEL_NOT_READY" });
    }

    const row = await db.ApiKey.findOne({ where: { key } });
    if (!row) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    const now = new Date();
    await db.ApiKey.update(
      {
        credits_total: db.Sequelize.literal(`credits_total + ${Number(amount)}`),
        credits_remaining: db.Sequelize.literal(`credits_remaining + ${Number(amount)}`),
        last_used_at: row.last_used_at || now,
      },
      { where: { id: row.id } }
    );

    const updated = await db.ApiKey.findByPk(row.id);

    return res.json({
      success: true,
      data: {
        id: updated.id,
        key: updated.key,
        status: updated.status,
        credits_total: Number(updated.credits_total),
        credits_remaining: Number(updated.credits_remaining),
        expires_at: updated.expires_at,
        remark: updated.remark,
      },
    });
  } catch (err) {
    console.error("[rootdatapro] /internal/apikey/topup error", err);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: err?.message || String(err),
    });
  }
});

module.exports = router;
