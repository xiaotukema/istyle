# iStyle Hair Try-On

WeChat Mini Program hairstyle recommendation and try-on backend, optimized for
China-accessible model providers.

## Features

- Volcengine Ark / Doubao-powered hairstyle analysis.
- Seedream-powered image try-on.
- Identity lock prompt: only change hairstyle, preserve the user's face and recognizability.
- First run generates 5 hairstyles, then two "more recommendations" batches of 3 each.
- Daily quota control: 11 generated hairstyles per user per day.
- WeChat Mini Program login via CloudBase openid headers or `wx.login` fallback.

## Local / CloudBase Backend

```bash
cp .env.example .env
# Fill ARK_API_KEY and optional WeChat credentials.
npm start
```

Open:

```text
http://127.0.0.1:8000/
```

## WeChat Mini Program

The Mini Program source is in `miniprogram/`.

For local development, open `miniprogram/` in WeChat DevTools. Production
uses WeChat CloudBase Run and `wx.cloud.callContainer`.

Production requirements:

- WeChat CloudBase Run service.
- Set `ARK_API_KEY` on the backend.
- Set `IMAGE_PROVIDER=seedream`.
- Set `ANALYSIS_PROVIDER=ark`.
- Keep the CloudBase MySQL `MYSQL_*` variables enabled for persistent quota.

## Cost Control

The backend exposes:

- `POST /api/auth/wechat-login`
- `GET /api/quota`
- `POST /api/hair-recommendation`
- `POST /api/hair-tryon`

When a request includes CloudBase openid headers or `Authorization: Bearer <token>`, try-on generation consumes daily quota. Default limit is `11` hairstyles per user per day. After the limit is reached, the API returns:

```text
您的今日生成次数已达上限，请明天再来试试吧
```

If `MYSQL_ADDRESS`, `MYSQL_USERNAME`, and `MYSQL_PASSWORD` are present, quota is stored in the `daily_generation_usage` MySQL table. Without MySQL, the server falls back to in-memory quota for local development only.

## Notes

Do not commit `.env` or API keys. Use `.env.example` for configuration shape only.
