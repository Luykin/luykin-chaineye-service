const { TwitterApi } = require('twitter-api-v2');

// 环境变量校验
if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
	throw new Error('Missing Twitter credentials in environment variables');
}

const client = new TwitterApi({
	clientId: process.env.TWITTER_CLIENT_ID,
	clientSecret: process.env.TWITTER_CLIENT_SECRET
});

// 生成 Twitter 授权 URL
async function generateTwitterAuthUrl(stateStoreFn) {
	const { url, state, codeVerifier } = await client.generateOAuth2AuthLink(
		process.env.TWITTER_CALLBACK_URL,
		{
			scope: ['tweet.read', 'users.read', 'offline.access'],
		}
	);
	
	// 建议：将 state 存入 session
	if (typeof stateStoreFn === 'function') {
		await stateStoreFn(state, codeVerifier);
	}
	
	return url;
}

// 获取 Twitter Tokens
async function getTwitterTokens(code, codeVerifier) {
	console.log('getTwitterTokens', 'code', code, codeVerifier);
	const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
		code,
		codeVerifier,
		redirectUri: process.env.TWITTER_CALLBACK_URL,
	});
	console.log('getTwitterTokens', 'accessToken', accessToken);
	return { accessToken, refreshToken, expiresIn };
}

// 获取 Twitter 用户信息
async function getTwitterUserInfo(accessToken) {
	const userClient = new TwitterApi(accessToken);
	const { data: user } = await userClient.v2.me({
		'user.fields': ['id', 'name', 'username', 'profile_image_url', 'created_at']
	});
	return user;
}

module.exports = {
	generateTwitterAuthUrl,
	getTwitterTokens,
	getTwitterUserInfo
};
