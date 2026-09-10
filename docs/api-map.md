# Карта API личного кабинета WATA

Извлечено из фронтенда `merchant.wata.pro` и подтверждено живыми запросами.
Базовый адрес: `https://merchant.wata.pro`.

Публичный API эквайринга и цифровых товаров (`api.wata.pro` /
`api-sandbox.wata.pro`, авторизация JWT-токеном терминала) сюда не входит —
он описан в `docs/public-api.md`.

Окружения кабинета: боевое — `merchant.wata.pro`, песочница — `merchant-sandbox.wata.pro`.
Переключаются переменной `WATA_ENV=sandbox`; у песочницы отдельные учётные
данные и отдельный файл сессии — вход в боевом окружении на неё не переносится.

Формат ошибки кабинета: `{error: {message, details}}`.

## Авторизация

```
GET  /api/anti-forgery          204, ставит XSRF-TOKEN и .AspNetCore.Antiforgery.*
POST /api/auth/sign-in          {email, password} -> 401 {isTwoFactorRequired:true} + кука 2fa_cookie
POST /api/auth/2fa              {token} -> 200, ставит auth_cookie (max-age 60 дней)
POST /api/auth/sign-out
```

Заголовок `RequestVerificationToken` = значение куки `XSRF-TOKEN` обязателен на каждом запросе,
включая GET. Без него сервер отвечает `400` с пустым телом.

`auth_cookie` ротируется в каждом ответе — cookie jar обязан сохранять обновления.

## Эндпоинты по доменам

### Профиль и мерчант

| Метод | Путь |
|---|---|
| GET | `/api/my-profile` |
| GET | `/api/merchant/merchants/my-merchant` |
| GET | `/api/merchant/merchants/stories` |
| PUT | `/api/merchant/merchants/stories/disable` |

### Восстановление пароля

| Метод | Путь |
|---|---|
| POST | `/api/accounts/send-password-reset-code` |
| POST | `/api/accounts/reset-password` |

### Терминалы

| Метод | Путь |
|---|---|
| GET | `/api/merchant/terminals` |
| GET | `/api/merchant/terminals/{terminalId}` |
| GET | `/api/merchant/terminals/{terminalId}/all-rates` |
| PUT | `/api/merchant/terminals/{terminalId}/payer-rates` |
| PATCH | `/api/merchant/terminals/live/{terminalId}` |
| GET | `/api/merchant/terminals/{terminalId}/api-tokens` |
| POST | `/api/merchant/terminals/{terminalId}/api-tokens` |
| DELETE | `/api/merchant/terminals/{terminalId}/api-tokens/{id}` |
| PUT | `/api/merchant/terminals/test/{terminalId}` |
| GET | `/api/payout/merchant/terminals` |

### Транзакции

| Метод | Путь |
|---|---|
| GET | `/api/merchant/transactions` |
| GET | `/api/merchant/transactions/statuses` |
| GET | `/api/merchant/transactions/{id}` |
| POST | `/api/merchant/transactions/refunds` |
| POST | `/api/merchant/transactions/{id}/pay-webhook` |

### Платёжные ссылки

| Метод | Путь |
|---|---|
| GET | `/api/merchant/links` |
| GET | `/api/merchant/links/{id}` |
| POST | `/api/merchant/links` |
| PUT | `/api/merchant/links/{id}` |

### Чарджбеки

| Метод | Путь |
|---|---|
| GET | `/api/merchant/chargebacks` |
| GET | `/api/merchant/chargebacks/{id}` |

### Подписки

| Метод | Путь |
|---|---|
| GET | `/api/merchant/subscriptions` |
| GET | `/api/merchant/subscriptions/statuses` |
| GET | `/api/merchant/subscriptions/{subscriptionId}` |
| POST | `/api/merchant/subscriptions/{subscriptionId}/statuses` |
| GET | `/api/admin/subscriptions` |

### Финансы и выплаты

| Метод | Путь |
|---|---|
| GET | `/api/merchant/finance/turnover-and-revenue/total` |
| GET | `/api/merchant/finance/turnover-and-revenue/daily` |
| GET | `/api/payout/merchant/payouts/history` |
| GET | `/api/payout/merchant/convert/history` |

### Кошелёк — счета и рынок

| Метод | Путь |
|---|---|
| GET | `/api/wallet/client/accounts/balances` |
| POST | `/api/wallet/client/accounts/transfer` |
| GET | `/api/wallet/client/operations` |
| GET | `/api/wallet/client/operations/{id}` |
| GET | `/api/wallet/client/market/rates` |

### Кошелёк — фиатный вывод

| Метод | Путь |
|---|---|
| GET | `/api/wallet/client/fiat/withdrawals/methods` |
| GET | `/api/wallet/client/fiat/withdrawals/banks` |
| GET | `/api/wallet/client/fiat/withdrawals/limits` |
| POST | `/api/wallet/client/fiat/withdrawals/calculate-commission` |
| POST | `/api/wallet/client/fiat/withdrawals/initiate/card` |
| POST | `/api/wallet/client/fiat/withdrawals/initiate/sbp` |
| POST | `/api/wallet/client/fiat/withdrawals/confirm` |
| GET | `/api/wallet/client/fiat/withdrawals/terminal-info` |
| GET | `/api/wallet/client/fiat/orders/{orderId}` |

### Кошелёк — вывод и пополнение в криптовалюте

| Метод | Путь |
|---|---|
| GET | `/api/wallet/client/crypto/withdrawals/limits` |
| POST | `/api/wallet/client/crypto/withdrawals/calculate-commission` |
| POST | `/api/wallet/client/crypto/withdrawals/initiate` |
| POST | `/api/wallet/client/crypto/withdrawals/confirm` |
| POST | `/api/wallet/client/crypto/deposit` |

### Автосеттлмент

| Метод | Путь |
|---|---|
| GET | `/api/wallet/client/autosettlement` |
| POST | `/api/wallet/client/autosettlement/initiate` |
| POST | `/api/wallet/client/autosettlement/confirm` |

### Тикеты поддержки

| Метод | Путь |
|---|---|
| GET | `/api/tickets/merchant` |
| GET | `/api/tickets/merchant/{id}` |
| POST | `/api/tickets/merchant` |
| POST | `/api/tickets/merchant/{id}/comments` |
| POST | `/api/tickets/merchant/{id}/comments/{commentId}/read` |
| GET | `/api/tickets/merchant/{ticketId}/attachment/{attachmentId}/{filename}` |

### Цифровые товары (кабинет)

| Метод | Путь |
|---|---|
| GET | `/api/digital-goods/merchant/orders` |
| GET | `/api/digital-goods/merchant/orders/statuses` |
| GET | `/api/digital-goods/merchant/orders/terminals/{publicId}/orders/{orderId}` |

## Тела ключевых мутаций

Поля, которых нет в списке ниже, эндпоинт не принимает — не добавляй лишнего.

| Эндпоинт | Тело запроса | Примечание |
|---|---|---|
| `POST /api/merchant/transactions/refunds` | `{originalTransactionId, amount}` | Поля «причина» нет |
| `POST /api/merchant/terminals/{terminalId}/api-tokens` | `{name, expirationMonths}` | `expirationMonths` от 1 до 12, по умолчанию 12; на терминал — от 1 до 5 активных токенов; сами токены работают только с IP, согласованных с WATA |
| `POST /api/merchant/links` | Поля платёжной ссылки, включая `terminalId` | Терминал указывается явно — этот эндпоинт не требует JWT публичного API |
| `PUT /api/merchant/links/{id}` (закрытие) | `{amount, currency, terminalId, status: "Closed"}` | |
| `PUT /api/merchant/terminals/{terminalId}/payer-rates` | `{transactionType, rate}` | По одному методу оплаты за вызов |
| `PATCH /api/merchant/terminals/live/{terminalId}` | `{webhookUrl, successPageUrl, failPageUrl, sendPayWebhook, sendPayWebhookOnDecline, sendPrePayWebhook, sendRefundWebhook}` | Все поля опциональны — шлём только изменяемые. Основной способ подключить приём вебхуков |
| `POST /api/wallet/client/fiat/withdrawals/initiate/sbp` | `{bankNumber, phone, orderId, quoteId}` | `phone` — 11 цифр, начинается с `7`, без маски и разделителей |
| `POST /api/wallet/client/fiat/withdrawals/initiate/card` | `{orderId, quoteId}` | Реквизиты карты через API не передаются — только через виджет WATA |
| `POST /api/wallet/client/crypto/withdrawals/initiate` | `{amount, blockchainType: "Tron", currency: "USDT", commission, address, orderId}` | |
| `POST /api/wallet/client/fiat/withdrawals/confirm` | `{code, credentialTokenId, orderId}` | |
| `POST /api/wallet/client/crypto/withdrawals/confirm` | `{code, credentialTokenId}` | Без `orderId` — в отличие от фиатного подтверждения |
| `POST /api/wallet/client/{fiat,crypto}/withdrawals/calculate-commission` | `{amount, currency, method, fromAccountId}` | Возвращает `orderId` и `quoteId`, обязательные для `initiate`/`confirm` |
| `GET /api/wallet/client/fiat/withdrawals/limits` | query: `Currency`, `Method` | Без обоих параметров — `400 Ваш запрос недействителен` |
| `GET /api/wallet/client/crypto/withdrawals/limits` | query: `Currency`, `BlockchainType` | Без обоих параметров — `400 Ваш запрос недействителен` |
| `POST /api/wallet/client/accounts/transfer` | `{amount, currency, fromAccountId, toAccountId}` | |
| `POST /api/wallet/client/autosettlement/initiate` | `{blockchainType, balancePercentage, currency, minimumThreshold}` | |
| `POST /api/tickets/merchant/{id}/comments` | `multipart/form-data`: поле `data` — JSON `{text}`, плюс 0..N полей `file` | Не JSON-тело, а форма |
| `POST /api/tickets/merchant` | `multipart/form-data`: поле `data` — JSON `{category, description, subject}`, плюс 0..N полей `file` | Создание обращения, не JSON-тело |

## Вебхуки, настраиваемые через терминал

Адрес и события задаются через `PATCH /api/merchant/terminals/live/{terminalId}`
(см. таблицу тел выше). Поведение доставки по типу вебхука:

| Вебхук | Ретраи | Требование к обработчику |
|---|---|---|
| Предоплатный (`sendPrePayWebhook`) | Нет — таймаут ответа 10 секунд | Не успел за 10 секунд — транзакция отклоняется без обращения в банк |
| Постоплатный (`sendPayWebhook`, `sendPayWebhookOnDecline`) | С нарастающим интервалом, до 32 часов | Обработчик обязан быть идемпотентным и отвечать `HTTP 200` |
| Возвратный (`sendRefundWebhook`) | С нарастающим интервалом, до 32 часов | Обработчик обязан быть идемпотентным и отвечать `HTTP 200` |

Проверка подлинности вебхука (подпись, публичный ключ, окружения) — в `docs/public-api.md`.

## Формы ответов

- Offset-пагинация: `{totalCount, items[]}` — терминалы, ссылки, выплаты, конвертации, тикеты, подписки
- Курсорная пагинация: `{hasNextPage, nextCursorId, nextCursorDate, items[]}` — транзакции, чарджбеки
- Параметры: `SkipCount`, `MaxResultCount`, `page`, `From`, `To`; у операций кошелька — `CreatedAtPeriod.From` и `CreatedAtPeriod.To`
- Операции кошелька дополнительно принимают массивы `Statuses[]` и `Types[]`,
  сериализуемые повторяющимися ключами: `Statuses=A&Statuses=B`

## Справочник enum'ов кабинета

| Сущность | Значения |
|---|---|
| Роль пользователя | Admin, Merchant, WalletClient |
| Тип операции кошелька | WithdrawalCrypto, WithdrawalFiat, DepositTerminal, InternalTransfer, DepositCrypto, DigitalGoodsPurchase |
| Статус операции кошелька | New, Processing, Completed, Canceled, Failed |
| Статус заказа цифровых товаров | Created, Pending, Paid, Success, Fail, Expired, Refunded |
| Тип заказа цифровых товаров | Steam, TopUp, Voucher, Stars, SteamDeposit, TopUpDeposit, VoucherDeposit |
| Статус подписки | Active, Failed, Completed |
| Статус платёжной ссылки | Opened, Closed |
| Тип платёжной ссылки | OneTime, ManyTime, Undefined |
