require('dotenv').config({ path: `${process.env.NODE_ENV === 'development' ? '.env-dev' : '.env-pro'}` });
console.log(process.env.NODE_ENV, 'process.env.NODE_ENV运行环境');
const path = require('path');
const { pgInstance: sequelize, XReviewForAccount, XHuntUser, XPointRecord, setupPostgres} = require(path.resolve(__dirname, '../models/postgres-start'));
const { getPointsByRank } = require(path.resolve(__dirname, '../xhunt/services/twitter'));

async function migrateAddPoints() {
	try {
		console.log('🚀 正在连接到数据库...')
		await setupPostgres();
		console.log('✅ 成功连接到数据库');
		
		const reviews = await XReviewForAccount.findAll({
			attributes: ['id', 'xHuntUserId']
		});
		
		console.log(`🔍 共找到 ${reviews.length} 条评论`);

		let count = 0;

		for (const review of reviews) {
			const user = await XHuntUser.findByPk(review.xHuntUserId, {
				attributes: ['id', 'kolRank20W']
			});

			if (!user) {
				console.warn(`⚠️ 用户不存在：${review.xHuntUserId}`);
				continue;
			}

			const points = getPointsByRank(user.kolRank20W);
			console.log(user.id, '应该得到积分:',points)

			const existingRecord = await XPointRecord.findOne({
				where: {
					xHuntUserId: review.xHuntUserId,
					reviewId: review.id
				}
			});

			if (existingRecord) {
				console.log(`🔁 已存在积分记录，跳过：用户 ${user.id} - 评论 ${review.id}`);
				continue;
			}

			await XPointRecord.create({
				xHuntUserId: review.xHuntUserId,
				reviewId: review.id,
				points,
				userRankAtTimeOfReview: user.kolRank20W
			});

			count++;
			if (count % 100 === 0) {
				console.log(`🔧 已处理 ${count} 条`);
			}
		}

		console.log(`🎉 迁移完成！共补充了 ${count} 条积分记录`);
		process.exit(0);
	} catch (error) {
		console.error('❌ 数据库迁移失败:', error.message);
		process.exit(1);
	}
}

migrateAddPoints();
// NODE_ENV=production node ./src/script/migrate-add-points.js
