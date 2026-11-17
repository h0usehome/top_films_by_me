# Telegram-бот

Бот отвечает на `/start` приветствием с картинкой и кнопкой «🎬 Открыть коллекцию», которая открывает сайт как Mini App. Работает на Cloudflare Workers, бесплатного тарифа хватает с запасом.

## Запуск

1. **Создать бота.** В Telegram откройте @BotFather → `/newbot`, задайте имя и адрес. Сохраните токен: он понадобится на шаге 3. Никому его не пересылайте.

2. **Создать Worker.** [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Create Worker → Hello World. Задайте имя (например, `movies-bot`) и нажмите Deploy. Затем Edit code → замените весь код содержимым `worker.js` → Deploy.

3. **Добавить переменные.** Worker → Settings → Variables and Secrets → Add:

   | Имя | Тип | Значение |
   |---|---|---|
   | `BOT_TOKEN` | Secret | токен от @BotFather |
   | `WEBHOOK_SECRET` | Secret | любая длинная строка из латиницы, цифр, `_` и `-` |
   | `APP_URL` | Text | `https://h0usehome.github.io/top_films_by_me/` (можно не задавать) |

4. **Подключить бота.** Откройте в браузере:
   ```
   https://movies-bot.<ваш-аккаунт>.workers.dev/setup?key=<WEBHOOK_SECRET>
   ```
   Должен появиться JSON со значениями `true`. Этот шаг подключает вебхук, кнопку меню «Коллекция» рядом с полем ввода, команду `/start` и описание бота.

5. **Проверить.** Напишите боту `/start`.

## Ссылки сразу на фильм или раздел

- `https://t.me/<бот>?start=film_42` — приветствие с кнопкой, которая откроет фильм с id 42
- `https://t.me/<бот>?start=view_top100` — то же для раздела (`movies`, `series`, `cartoons`, `top100`, `new`, `recent`, `rewatch`)

Чтобы ссылка открывала приложение сразу, без сообщения бота, создайте Mini App в @BotFather (`/newapp`, адрес сайта в качестве URL). Тогда будут работать ссылки вида `https://t.me/<бот>/<app>?startapp=film_42`.
