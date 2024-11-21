require('dotenv').config({ path: `${process.env.NODE_ENV === 'development' ? '.env-dev' : '.env-pro'}` });
const { Telegraf } = require('telegraf');
const { TGUser } = require('../models/postgres-start'); // Assuming your Sequelize model is defined in './models'

class TelegramBot {
  constructor(token, chatId) {
    if (!token) {
      throw new Error('Telegram Bot token is required.');
    }
    if (!chatId) {
      throw new Error('Telegram chat ID is required.');
    }
    this.bot = new Telegraf(token); // Initialize Telegraf
    this.chatId = chatId; // Store chat ID
  }

  // Configure event listeners
  configureListeners() {
    // Listen for new chat members
    this.bot.on('chat_member', async (ctx) => {
      const chatId = ctx.chat.id; // Get the chat ID of the event

      if (chatId.toString() !== this.chatId.toString()) {
        console.log(`Ignored event from unauthorized chat: ${chatId}`);
        return; // Ignore events from unauthorized chats
      }

      const { user, invite_link } = ctx.update.chat_member.new_chat_member;

      if (invite_link) {
        // Check the database for the invite link
        const userRecord = await TGUser.findOne({ where: { inviteLink: invite_link.invite_link } });

        if (!userRecord) {
          // No matching user found, remove the user from the group
          await ctx.kickChatMember(user.id);
          await ctx.reply(
            `Dear ${user.first_name}, you were removed from the group as your invitation link could not be verified. If you believe this is a mistake, please contact support.`
          );
        } else {
          // Update user information
          await userRecord.update({
            tgId: user.id,
            username: user.first_name,
            joinTime: new Date(),
            userType: 'normal', // Update user type to "normal"
          });
          await ctx.reply(
            `Welcome, ${user.first_name}, to the cryptohunt community! We are excited to have you onboard.`
          );
        }
      } else {
        // User joined without a valid invite link, remove from group
        await ctx.kickChatMember(user.id);
        await ctx.reply(
          `Dear ${user.first_name}, your access to the group has been denied as no valid invitation link was detected. Please ensure you join using a verified link.`
        );
      }
    });

    // Command for users to check their membership status
    this.bot.command('status', async (ctx) => {
      const tgId = ctx.message.from.id;

      // Query user information from the database
      const user = await TGUser.findOne({ where: { tgId } });

      if (user) {
        ctx.reply(
          `Your membership details:\n- Expiry Date: ${user.expireTime}\n- Payment Method: ${user.paymentMethod || 'Not Recorded'}\n\nThank you for being a part of our Web3 community!`
        );
      } else {
        ctx.reply(
          'You are not registered as a member of this community. Please contact the administrator for assistance.'
        );
      }
    });
  }

  // Create an invite link and log user information
  async createInviteLink({ paidAt, paymentChain, paymentHash, expireTime }) {
    const inviteLink = await this.bot.telegram.createChatInviteLink(this.chatId, {
      expire_date: Math.floor(Date.now() / 1000) + 3600 * 3, // Expires in 3 hours
      member_limit: 1, // Limited to 1 use
    });

    console.log(`Generated invite link: ${inviteLink.invite_link}`);

    // Log user details in the database
    const user = await TGUser.create({
      tgId: null, // Not yet joined
      username: null,
      joinTime: null,
      expireTime,
      removedTime: null,
      paidAt,
      paymentMethod: paymentChain,
      inviteLink: inviteLink.invite_link,
      userType: 'blank', // Initial user type is "blank"
      orderNumberPaid: { [paymentChain]: paymentHash }, // Payment information
    });

    return { inviteLink: inviteLink.invite_link, user };
  }

  // Start the bot
  async start() {
    this.configureListeners(); // Configure event listeners
    await this.bot.launch(); // Launch the bot
    console.log('Telegram Bot launched.');
  }

  // Stop the bot
  async stop() {
    await this.bot.stop();
    console.log('Telegram Bot stopped.');
  }
}

module.exports = TelegramBot;
