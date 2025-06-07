const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'XHunt API Documentation',
      version: '1.0.0',
      description: 'XHunt浏览器插件后端API文档 - 提供Twitter账号评价、用户认证、代理服务等功能',
      contact: {
        name: 'XHunt Team',
        email: 'support@xhunt.ai'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:8087/api/xhunt',
        description: '开发环境'
      },
      {
        url: 'https://api.xhunt.ai/api/xhunt',
        description: '生产环境'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Token认证，格式: Bearer <token>'
        },
        SecurityHeaders: {
          type: 'apiKey',
          in: 'header',
          name: 'x-request-signature',
          description: '安全请求头验证，包含签名、时间戳、设备指纹等'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: '错误信息'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' }
                }
              },
              description: '详细错误列表'
            }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: '用户唯一标识符'
            },
            username: {
              type: 'string',
              description: 'Twitter用户名'
            },
            displayName: {
              type: 'string',
              description: '显示名称'
            },
            avatar: {
              type: 'string',
              format: 'uri',
              description: '头像URL'
            },
            twitterId: {
              type: 'string',
              description: 'Twitter ID'
            },
            classification: {
              type: 'string',
              nullable: true,
              description: '用户分类（KOL、项目方、机构等）'
            },
            kolRank20W: {
              type: 'integer',
              nullable: true,
              description: 'KOL影响力排名（20万内）'
            },
            xPoints: {
              type: 'integer',
              description: '用户积分'
            }
          }
        },
        XAccount: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'X账号唯一标识符'
            },
            handle: {
              type: 'string',
              description: 'X账号用户名（不含@）'
            },
            displayName: {
              type: 'string',
              description: '显示名称'
            },
            avatar: {
              type: 'string',
              format: 'uri',
              description: '头像URL'
            },
            followers: {
              type: 'integer',
              description: '关注者数量'
            },
            following: {
              type: 'integer',
              description: '正在关注的数量'
            }
          }
        },
        Review: {
          type: 'object',
          properties: {
            rating: {
              type: 'number',
              format: 'float',
              minimum: 0.0,
              maximum: 5.0,
              description: '评分（0.0-5.0，支持一位小数）'
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: '标签列表'
            },
            note: {
              type: 'string',
              nullable: true,
              description: '私人备注（即将废弃）'
            },
            comment: {
              type: 'string',
              nullable: true,
              description: '公开评论内容'
            }
          }
        },
        ReviewSummary: {
          type: 'object',
          properties: {
            averageRating: {
              type: 'number',
              format: 'float',
              description: '平均评分'
            },
            totalReviews: {
              type: 'integer',
              description: '总评论数'
            },
            tagCloud: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  value: { type: 'integer' }
                }
              },
              description: '标签云（前10个高频标签）'
            },
            topReviewers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  avatar: { type: 'string' },
                  name: { type: 'string' }
                }
              },
              description: '最近评论用户（前5个）'
            },
            currentUserReview: {
              allOf: [{ $ref: '#/components/schemas/Review' }],
              nullable: true,
              description: '当前用户的评论（需要登录）'
            },
            allTagCount: {
              type: 'integer',
              description: '所有标签总数'
            },
            defaultTags: {
              type: 'object',
              properties: {
                kol: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'KOL人物类型标签'
                },
                project: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '项目/机构特征标签'
                }
              }
            }
          }
        },
        PrivateNote: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'X账号用户名'
            },
            note: {
              type: 'string',
              description: '私人备注内容'
            },
            lastUpdated: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: '最后更新时间'
            }
          }
        }
      }
    },
    security: [
      {
        SecurityHeaders: []
      }
    ]
  },
  apis: [
    './src/xhunt/api/*.js',
    './src/xhunt/docs/*.yaml'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;