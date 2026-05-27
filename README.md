# iStyle Hair Try-On

WeChat Mini Program hairstyle recommendation and try-on backend, optimized for
China-accessible model providers.

## Features

- Volcengine Ark / Doubao-powered hairstyle analysis.
- Seedream-powered image try-on.
- Identity lock prompt: only change hairstyle, preserve the user's face and recognizability.
- First run generates 5 hairstyles, then two "more recommendations" batches of 3 each.
- Daily quota control: 11 generated hairstyles per user per day.
- WeChat Mini Program login scaffold using `wx.login` and backend token sessions.

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
- Persist quota data in a real database before production traffic.

## Cost Control

The backend exposes:

- `POST /api/auth/wechat-login`
- `GET /api/quota`
- `POST /api/hair-recommendation`
- `POST /api/hair-tryon`

When a request includes `Authorization: Bearer <token>`, `/api/hair-tryon` consumes daily quota. Default limit is `11` hairstyles per user per day. After the limit is reached, the API returns:

```text
您的今日生成次数已达上限，请明天再来试试吧
```

Current in-memory quota is suitable for local/dev only. For online production, replace `quotaByUserDay` and `authSessions` in `server.js` with Redis/Postgres/CloudBase.

## Notes

Do not commit `.env` or API keys. Use `.env.example` for configuration shape only.
