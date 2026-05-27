# WeChat Mini Program Deployment Plan

## 1. Backend

Deploy the Node backend to an HTTPS domain.

Required environment variables:

```text
GEMINI_API_KEY=...
IMAGE_PROVIDER=gemini
ANALYSIS_PROVIDER=gemini
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
ANALYSIS_MODEL=gemini-2.5-flash
WX_APPID=...
WX_APP_SECRET=...
DAILY_HAIR_LIMIT=11
HAIR_VARIANT_CONCURRENCY=1
```

Before real launch, replace the current in-memory auth/quota storage with persistent storage.

Recommended tables/keys:

- `users`: `openid`, `created_at`
- `sessions`: `token`, `openid`, `expires_at`
- `daily_generation_usage`: `openid`, `date`, `used_count`

## 2. Mini Program

Open `miniprogram/` in WeChat DevTools.

Update:

- `miniprogram/project.config.json`: replace `touristappid` with the real AppID.
- `miniprogram/app.js`: set `apiBase` to the deployed HTTPS backend.

## 3. WeChat Console

In the WeChat Mini Program admin console:

- Add the backend HTTPS domain to request legal domains.
- Enable camera permission description.
- Upload code through WeChat DevTools.
- Submit for review.

## 4. Product Quota Rule

Per user per day:

- First recommendation: 5 hairstyles.
- More recommendation 1: 3 hairstyles.
- More recommendation 2: 3 hairstyles.
- Total: 11 hairstyles.

After 11 generated hairstyles, show:

```text
您的今日生成次数已达上限，请明天再来试试吧
```
