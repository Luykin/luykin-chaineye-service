# CryptoHunt API Documentation


**CryptoHunt API is designed for professional users, providing powerful Twitter account analysis and content detection capabilities.**

## Pricing Information
- **Credit Exchange**: 1 USDT = 200 credits
- **API Gift**: 200 credits upon registration
- **Rate Limit (Default)**: 100 requests/minute per endpoint
- **Rate Limit (Special Endpoints)**: 10 requests/minute per endpoint for:
  - Tweet detail information (`/tweet/tweet_detail`)
  - User tweets (`/tweet/user_tweets`)
  - Twitter profile by username (`/user/profile_by_handle`)
  - Twitter profile by user ID (`/user/profile_by_userid`)
  - User follower data (`/social/follower`)
  - User following data (`/social/following`)

## CryptoHunt Content Farming Detection Features

CryptoHunt provides the following six core detection dimensions:

1. **Account Profile Analysis** - Deep analysis of Twitter account basic information and historical data
2. **Tweet Engagement Analysis** - Evaluate the authenticity and quality of tweet interactions
3. **Originality & AI Detection** - Identify whether content is AI-generated or plagiarized
4. **Information Quality Assessment** - Analyze the information value and credibility of account content
5. **KOL Interaction Analysis** - Detect interactions with key opinion leaders
6. **Account Matrix Behavior** - Identify batch accounts and automated behavior patterns

## Contact
- Telegram: https://t.me/cryptohunt_ai

## Quick Start

1. Register an account and get your API key
2. Add `X-API-KEY: your_api_key` to request headers
3. Start calling API endpoints

## Authentication

All API requests require your API key in the request header:

```
X-API-KEY: your_api_key_here
```
          

## Base URL

**生产环境**: `https://pro.cryptohunt.ai`

**内部服务**: `http://172.31.0.2:3001` (用于内部微服务调用)

## Authentication

All API requests require an API key in the request header:

```
X-API-KEY: your_api_key_here
```


## AI

### POST /ai/ability_model

**Twitter account ability model analysis**

## Description

Get ability model analysis for a Twitter account. This endpoint analyzes the account's capabilities and influence metrics.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/ability_model" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /ai/mbti

**Twitter account MBTI personality analysis**

## Description

Get MBTI personality analysis for a Twitter account. This endpoint analyzes the account's content and behavior to determine MBTI personality type.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/mbti" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /ai/narrative

**Twitter project narrative analysis**

## Description

Get narrative analysis for a Twitter project account. This endpoint analyzes the project's content narrative and storytelling patterns.

**Credits**: 0.1 credits

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/narrative" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "Uniswap"
  }'
```

---

### POST /ai/projectAnalysis

**Project analysis data**

## Description

Get project analysis data. This endpoint provides detailed analysis information about Twitter projects, including project overview, social media performance, discussion popularity, positive/negative sentiment analysis, etc.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/projectAnalysis" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "Uniswap"
  }'
```

---

### POST /ai/soul_index

**Twitter account soul index analysis**

## Description

Get soul index analysis for a Twitter account. This endpoint provides a comprehensive score representing the account's authenticity and engagement quality.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/soul_index" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /ai/tokenAnalysis

**Token analysis data**

## Description

Get token analysis data. This endpoint provides detailed analysis information about tokens, including price, market cap, trading volume, and other key metrics.

**Credits**: 1 credit

## Parameters

- **ticker** (required): Token ticker symbol, such as BTC, ETH, BNB, etc.
- **ca** (optional): Token contract address.

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/ai/tokenAnalysis" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ticker": "BTC"
  }'
```


## API

### GET /api/user/change_apikey

**Change user API key**

## Description

Change user's API key. This endpoint generates a new API key for the authenticated user and returns it.

**Credits**: Free

## Parameters

This endpoint does not require any request parameters, only the API key in the request header.

**Example (cURL):**

```bash
curl -X GET "https://pro.cryptohunt.ai/api/user/change_apikey" \\
  -H "X-API-KEY: your_api_key_here"
```

---

### POST /api/user/history

**User API usage history**

## Description

Get user API usage history. This endpoint retrieves the API usage history for a user based on their bound wallet address.

**Credits**: Free

## Parameters

- **wallet_address** (required): User's bound wallet address (e.g., 0x0000000000000000000000000000000000000000)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/api/user/history" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "wallet_address": "0x0000000000000000000000000000000000000000"
  }'
```

---

### GET /api/user/info

**User information**

## Description

Get current user information, including account status, API key, remaining credits, etc.

**Credits**: Free

## Parameters

This endpoint does not require any request parameters, only the API key in the request header.

**Parameters:**

- `X-Fields` (optional): An optional fields mask

**Example (cURL):**

```bash
curl -X GET "https://pro.cryptohunt.ai/api/user/info" \\
  -H "X-API-KEY: your_api_key_here"
```


## Data

### POST /data/cryptohunt

**Complete account analysis**

## Description

Get complete CryptoHunt Twitter account analysis data, including profile, rank, kol followers, token mention, fundraising, mbti, discussion, narratives, ability model, etc. 

**Credits**: 2 credits

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/cryptohunt" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /data/discussion

**Twitter project discussion analysis**

## Description

Get discussion analysis for a Twitter project account. This endpoint analyzes the project's discussion patterns and engagement metrics.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/discussion" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "Uniswap"
  }'
```

---

### POST /data/hot_topics

**Hot topics on Twitter**

## Description

Get hot topics data. This endpoint retrieves trending topics based on the specified group and time range.

**Credits**: 1.5 credits

## Parameters

- **group** (optional): Topic group - 'global', 'cn' (default: 'global')
- **days** (optional): Time range in days - 1 or 7 (default: 1)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/hot_topics" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "global",
    "days": 1
  }'
```

---

### POST /data/kol_follow

**Twitter account KOL follow analysis**

## Description

Get KOL (Key Opinion Leader) follow analysis for a Twitter account. This endpoint analyzes which KOLs the account follows and provides related insights.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/kol_follow" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /data/rank

**Twitter account ranking**

## Description

Get Twitter account ranking data. This endpoint provides the account's ranking based on various metrics and influence factors.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/rank" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /data/relation

**Twitter project relation analysis**

## Description

Get relation analysis for a Twitter project account. This endpoint analyzes the project's social network and discover its team profiles on Twitter.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/relation" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "Uniswap"
  }'
```

---

### POST /data/token_mention

**Twitter account token mention data**

## Description

Get token mention data for a Twitter account. This endpoint analyzes which tokens are mentioned by the account and provides related statistics and ROIs.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/token_mention" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /data/trending_discussion

**Trending discussions**

## Description

Get the latest trending discussion accounts and topics within the specified parameter range.

**Credits**: 1 credit

## Parameters

- **group** (optional): Region group - 'cn' or 'global' (default: 'global')
- **days** (optional): Time range in days - 1 or 7 (default: 1)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/trending_discussion" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "global",
    "days": 1
  }'
```

---

### POST /data/trending_kol

**Trending KOLs**

## Description

Get the latest KOL accounts with the highest follower growth and their hot topics within the specified parameter range.

**Credits**: 1 credit

## Parameters

- **group** (optional): Region group - 'cn' or 'global' (default: 'global')
- **days** (optional): Time range in days - 1 or 7 (default: 1)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/trending_kol" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "global",
    "days": 1
  }'
```

---

### POST /data/trending_project

**Trending projects**

## Description

Get the latest project accounts with the highest follower growth and their narratives within the specified parameter range.

**Credits**: 1 credit

## Parameters

- **group** (optional): Region group - 'cn' or 'global' (default: 'global')
- **days** (optional): Time range in days - 1 or 7 (default: 1)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/data/trending_project" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "global",
    "days": 1
  }'
```


## social

### POST /social/follow_relation

**Twitter account follow relation**

## Description

Get follow relation analysis for a Twitter account. This endpoint analyzes the account's following and follower relationships.

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/follow_relation" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /social/follower

**User follower data**

## Description

Get the list of followers for a Twitter user. This endpoint retrieves the follower relationships for a specified user, with support for pagination using cursor.

**Credits**: 0.2 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **user_id** (required): Twitter user ID (numeric identifier)
- **cursor** (optional): Pagination cursor obtained from the previous page response

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/follower" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "44196397",
    "cursor": ""
  }'
```

---

### POST /social/following

**User following data**

## Description

Get the list of accounts that a Twitter user is following. This endpoint retrieves the following relationships for a specified user, with support for pagination using cursor.

**Credits**: 0.2 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **user_id** (required): Twitter user ID (numeric identifier)
- **cursor** (optional): Pagination cursor obtained from the previous page response

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/following" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "44196397",
    "cursor": ""
  }'
```

---

### POST /social/project_follow_relation

**Project follow relation analysis**

## Description

Get project follow relation analysis. This endpoint analyzes the follow relationships and network structure of a project's Twitter account. Currently only available for partnerships. If you are running a project and would like to get a complete list of social relation stream, contact us to be added to partner project lists.   

**Credits**: 1 credit

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/project_follow_relation" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "ambergroup_io"
  }'
```

---

### POST /social/unfollow_relation

**Twitter account unfollow relation**

## Description

Get unfollow relation analysis for a Twitter account. This endpoint retrieves accounts that the user has unfollowed, helping you understand social tendencies in real-time. Supports some top KOLs, with target accounts continuously expanding.

**Credits**: 2 credits

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/unfollow_relation" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /social/unfollow_relation_flow

**Tracked KOL unfollow relation flow**

## Description

Get the unfollow relation flow of tracked KOL accounts. Each request returns the latest 20 records, and you can use the offset parameter to retrieve older data.

**Credits**: 2 credits

## Parameters

- **offset** (optional): Pagination offset for all unfollow relation data (default: 0)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/social/unfollow_relation_flow" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "offset": 0
  }'
```


## tweet

### POST /tweet/deleted_tweets

**Deleted tweets data**

## Description

Get deleted tweets data for a Twitter account. This endpoint retrieves information about tweets that have been deleted by the account owner.

**Credits**: 2 credits

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/deleted_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /tweet/hot_tweets

**Hot tweets**

## Description

Get the latest hot tweets within the specified parameter range. You can optionally pass a specific tag to filter hot tweets by discussion topic. Supports both Chinese and English tags.

**Credits**: 1 credit

## Parameters

- **group** (required): Region group
  - `cn`: Chinese region
  - `global`: English/Global region
- **hours** (required): Time range in hours for hot tweets
  - `1`: Last 1 hour
  - `4`: Last 4 hours
  - `24`: Last 24 hours
- **tag** (optional): Topic tag to filter hot tweets, supports Chinese and English (e.g., 以太坊, ethereum)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/hot_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "cn",
    "hours": 24,
    "tag": "以太坊"
  }'
```

---

### POST /tweet/kol_tweets

**KOL tweets**

## Description

Get KOL tweets. This endpoint retrieves tweets from tracking KOLs only. This endpoints return 20 tweets per request. Use offset to fetch historical tweets from a KOL. The data is processed by CryptoHunt AI and may have some delay in timeliness.

**Credits**: 0.2 credits

## Parameters

- **handle** (required): KOL username (handle) without @ symbol
- **offset** (required): Offset for pagination (number)
- **verbose** (optional): Whether to include retweets and reply tweets in the response. Default is false (only original tweets are returned).

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/kol_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"handle": "cz_binance", "offset": 0, "verbose": false}'
```

---

### POST /tweet/mention_tweets

**Mention tweets**

## Description

Retrieve recent tweets that mention a specific token, contract address, or Twitter account. This endpoint searches through Twitter data to find tweets that contain references to the specified token symbol, contract address, or Twitter username.

This endpoint is particularly useful for:
- **Token Monitoring**: Track social media mentions and discussions about specific cryptocurrencies or tokens
- **Contract Address Tracking**: Monitor mentions of specific smart contract addresses across Twitter
- **Account Mentions**: Find tweets that mention or reference a particular Twitter account
- **Social Sentiment Analysis**: Analyze how tokens, contracts, or accounts are being discussed on social media
- **Trend Detection**: Identify emerging discussions and trends related to specific assets or accounts

All three parameters (ticker, ca, and twitter) are optional, but **at least one parameter must be provided** for the request to be valid. You can combine multiple parameters to narrow down your search results.

The returned tweets include comprehensive information such as:
- Full tweet content with HTML formatting
- User profile information and AI classification
- Engagement metrics (likes, retweets, replies, views)
- Tweet metadata (creation time, conversation ID, thread information)
- AI analysis data (crypto relevance, summaries, tags)

**Credits**: 1.5 credits

## Parameters

- **ticker** (optional): Token ticker symbol (e.g., BTC, ETH, USDT, DOGE). Use this to find tweets mentioning a token by its trading symbol. At least one parameter (ticker, ca, or twitter) must be provided.
- **ca** (optional): Token contract address. Use this to find tweets mentioning a specific smart contract address. Useful for tracking mentions of tokens on specific blockchains. At least one parameter (ticker, ca, or twitter) must be provided.
- **twitter** (optional): Twitter username without @ symbol (e.g., cz_binance, elonmusk). Use this to find tweets that mention or reference a specific Twitter account. At least one parameter (ticker, ca, or twitter) must be provided.
- **start** (optional): Start timestamp as string in Unix timestamp format (seconds precision). Only tweets created at or after this timestamp will be returned. Use this to filter tweets by time range. Example: "1704067200"
- **end** (optional): End timestamp as string in Unix timestamp format (seconds precision). Only tweets created before or at this timestamp will be returned. Use this together with `start` to define a specific time range for tweet retrieval. Example: "1704153600"
- **limit** (optional): Maximum number of tweets to return as string. Must not exceed 100. Default is 50. Use this to control the number of results returned in a single request. Example: "50"

**Note**: The parameters ticker, ca, and twitter are all optional, but you must provide at least one of them for the request to succeed. The start and end parameters allow you to filter tweets by time range, and limit controls the maximum number of results.

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/mention_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ticker": "BTC",
    "start": "1704067200",
    "end": "1704153600",
    "limit": "50"
  }'
```

---

### POST /tweet/top_kol_tweets

**Top KOL tweets**

## Description

Get the latest tweets from top KOLs (Key Opinion Leaders) within the specified parameter range. This endpoint retrieves tweets from the top-ranked KOLs based on your selection criteria, sorted in reverse chronological order (newest first). Use the offset parameter to paginate through historical tweets and access earlier content.

All tweets are processed by CryptoHunt AI, which includes AI analysis, classification, and enrichment. Due to this processing, there may be a slight delay in timeliness compared to real-time Twitter data.

This endpoint is ideal for:
- Monitoring top influencers in specific regions (Chinese, Global, or both)
- Tracking trending content from high-ranking KOLs
- Analyzing engagement patterns and content quality
- Building feeds of curated content from verified influencers

**Credits**: 0.1 credits

## Parameters

- **group** (required): Group type to filter KOLs by region
  - `cn`: Chinese region KOLs only
  - `global`: Global (English) region KOLs only
  - `all`: Both Chinese and Global region KOLs
- **top_n** (required): Number of top KOLs to include in the results, no more than 500. This determines the ranking range (e.g., top_n=100 means tweets from the top 100 ranked KOLs).
- **offset** (required): Pagination offset for retrieving earlier tweets. Start with 0 for the most recent tweets, then increment to get historical data

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/top_kol_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "group": "global",
    "top_n": 100,
    "offset": 0
  }'
```

---

### POST /tweet/tweet_detail

**Tweet detail information**

## Description

Get detailed information about a specific tweet. This endpoint retrieves comprehensive tweet data including content, CryptoHunt's exclusive KOL engagement metrics, thread information, user profile, and all associated metadata.

This endpoint currently has **two response variants**:
- **Variant 1 (KOL-style detail)**: Includes `ai`, `info`, `statistic`, `mention`, `thread_ids`, etc.
- **Variant 2 (legacy detail)**: Includes `created_at`, `html`, `mentions`, `likes`, `user_profile`, etc.

**Credits**: 0.05 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **tweet_id** (required): Tweet ID (unique identifier of the tweet)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/tweet_detail" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tweet_id": "2008854930036256838"
  }'
```

---

### POST /tweet/user_tweets

**User tweets**

## Description

Get user tweets data. This endpoint retrieves tweets posted by a specific Twitter user in real time.

**Credits**: 0.5 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **user_id** (required): Twitter user ID (numeric)
- **cursor** (optional): Pagination cursor for retrieving more results

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/tweet/user_tweets" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "44196397",
    "cursor": ""
  }'
```


## user

### POST /user/profile_by_handle

**Twitter profile by username**

## Description

Get Twitter profile information by username (handle). This endpoint retrieves detailed profile data for a Twitter account using its username.

**Credits**: 0.1 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/user/profile_by_handle" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

---

### POST /user/profile_by_userid

**Twitter profile by user ID**

## Description

Get Twitter profile information by user ID. This endpoint retrieves detailed profile data for a Twitter account using its unique numeric user ID.

**Credits**: 0.1 credits
**Rate Limit**: 10 requests/minute

## Parameters

- **user_id** (required): Twitter user ID (numeric identifier)

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/user/profile_by_userid" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "44196397"
  }'
```

---

### POST /user/profile_history

**Twitter profile history**

## Description

Get Twitter profile history data. This endpoint provides historical changes and updates to the account profile.

**Credits**: 2 credits

## Parameters

- **handle** (required): Twitter username without @ symbol

**Parameters:**

- `payload` (required): 

**Example (cURL):**

```bash
curl -X POST "https://pro.cryptohunt.ai/user/profile_history" \\
  -H "X-API-KEY: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "handle": "cz_binance"
  }'
```

