const express = require('express');
const { validateRequestParams } = require('./util');
const router = express.Router();

router.post('/create-invite', validateRequestParams, async (req, res) => {
	try {
		const { decryptedData } = req;
		const ret = await req.bot6666.createInviteLink({
			paidAt: Number(decryptedData.paidAt),
			paymentChain: decryptedData.paymentChain,
			paymentHash: decryptedData.paymentHash,
			expireTime: Number(decryptedData.expireTime),
			address: decryptedData.address,
		});
		if (ret && ret?.inviteLink) {
			res.json(ret);
		} else {
			res.status(400).json({ error: 'create error' });
		}
	} catch (error) {
		console.log(error);
		res.status(400).json({ error: 'create error' });
	}
});

module.exports = router;
