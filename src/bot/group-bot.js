require('dotenv').config({ path: `${process.env.NODE_ENV === 'development' ? '.env-dev' : '.env-pro'}` });
const { Telegraf } = require('telegraf');
const { TGUser } = require('../models/postgres-start'); // Assuming your Sequelize model is defined in './models'
const { SocksProxyAgent } = require('socks-proxy-agent');
const util = require('util');
// 配置代理
const proxyUrl = 'socks5://127.0.0.1:33210'; // 替换为您的代理 URL
const agent = new SocksProxyAgent(proxyUrl);

class TelegramBot {
	constructor(token, chatId) {
		if (!token) {
			throw new Error('Telegram Bot token is required.');
		}
		if (!chatId) {
			throw new Error('Telegram chat ID is required.');
		}
		console.log('Telegram Bot initialized.');
		this.bot = new Telegraf(token, {
			telegram: { agent: process.env.NODE_ENV === 'development' ? agent : undefined },
			// telegram: { apiRoot: 'https://api.telegram.org', timeout: 30000 },
		}); // Initialize Telegraf
		this.chatId = chatId; // Store chat ID
	}
	
	// Configure event listeners
	configureListeners() {
		// Listen for new chat members
		this.bot.on('chat_join_request', async (ctx) => {
			try {
				// console.log(util.inspect(ctx.update, {
				// 	showHidden: false, // 是否显示不可枚举属性
				// 	depth: null,       // 展开对象的深度，null 表示无穷深度
				// 	colors: true,      // 启用颜色
				// }));
				const { from, chat, invite_link } = ctx.update.chat_join_request;
				if (String(chat?.id) !== this.chatId.toString()) {
					console.log(`Ignored event from unauthorized chat: ${String(chat?.id)}`);
					return; // Ignore events from unauthorized chats
				}
				const inviteLink = invite_link?.invite_link;
				if (inviteLink) {
					const userRecord = await TGUser.findOne({ where: { inviteLink } });
					/**
					 * 没找到对应邀请链接的用户或者
					 * 邀请链接的用户已经被加入群组
					 * 都会拒绝加入
					 * **/
					if (!userRecord || userRecord?.tgId || userRecord?.joinTime) {
						await ctx.telegram.declineChatJoinRequest(chat.id, from.id);
						console.log(`拒绝用户 ${inviteLink} ${from.first_name} ${from.last_name} 的加入请求，原因：无效的邀请链接`);
						await this.bot.telegram.revokeChatInviteLink(this.chatId, inviteLink);
					} else {
						await this.bot.telegram.revokeChatInviteLink(this.chatId, inviteLink);
						// Update user information
						await userRecord.update({
							tgId: from.id,
							username: from.first_name,
							joinTime: +new Date(),
							userType: 'normal', // Update user type to "normal"
						});
						// 如果邀请链接有效，批准用户加入
						await ctx.telegram.approveChatJoinRequest(chat.id, from.id);
						console.log(`批准用户加入 ${from.first_name}`);
						await ctx.reply(
							`Welcome, ${from.first_name} to the cryptohunt community!`
						);
					}
				} else {
					console.log('没有邀请链接的不做处理');
					// console.log(`拒绝用户 ${from.first_name} 的加入请求，原因：无邀请链接`);
					// await ctx.telegram.declineChatJoinRequest(chat.id, from.id);
				}
			} catch (err) {
				console.log(err);
			}
		});
		
		// // Command for users to check their membership status
		// this.bot.command('status', async (ctx) => {
		// 	const tgId = ctx.message.from.id;
		//
		// 	// Query user information from the database
		// 	const user = await TGUser.findOne({ where: { tgId } });
		//
		// 	if (user) {
		// 		ctx.reply(
		// 			`Your membership details:\n- Expiry Date: ${+new Date(user.expireTime)}`
		// 		);
		// 	} else {
		// 		ctx.reply(
		// 			'You are not registered as a member of this community. Please contact the administrator for assistance.'
		// 		);
		// 	}
		// });
	}
	
	// Create an invite link and log user information
	async createInviteLink({ paidAt, paymentChain, paymentHash, expireTime, address }) {
		try {
			// 检查 paymentHash 是否已存在
			const existingUser = await TGUser.findOne({ where: { paymentHash } });
			if (existingUser) {
				return { inviteLink: existingUser.inviteLink };
			}
			const inviteLink = await this.bot.telegram.createChatInviteLink(this.chatId, {
				expire_date: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hours
				// member_limit: 1, // Limited to 1 use
				creates_join_request: true
			});
			
			console.log(`Generated invite link: ${inviteLink.invite_link}`);
			
			// Log user details in the database
			await TGUser.create({
				address,
				tgId: null, // Not yet joined
				username: null,
				joinTime: null,
				expireTime,
				removedTime: null,
				paidAt,
				paymentMethod: paymentChain,
				inviteLink: inviteLink.invite_link,
				userType: 'blank', // Initial user type is "blank"
				paymentHash, // Payment information
			});
			
			return { inviteLink: inviteLink.invite_link };
		} catch (err) {
			throw "error";
		}
	}
	
	// Start the bot
	async start() {
		this.configureListeners(); // Configure event listeners
		this.bot.launch().then(r => console.log).catch(err => {
			console.log(err, '机器人挂了');
		}); // Launch the bot
		console.log('Telegram Bot launched.');
	}
	
	// Stop the bot
	async stop() {
		await this.bot.stop();
		console.log('Telegram Bot stopped.');
	}
	
}

module.exports = TelegramBot;
