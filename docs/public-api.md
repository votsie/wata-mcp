# Публичные API WATA

Собрано из документации и настоящего OpenAPI-контракта WATA (он не отдаётся напрямую,
а лежит внутри чанков сайта документации).

## Окружения

| | Боевое | Песочница |
|---|---|---|
| Эквайринг | `https://api.wata.pro` | `https://api-sandbox.wata.pro` |
| Кабинет | `merchant.wata.pro` | `merchant-sandbox.wata.pro` |

Переключается переменной `WATA_ENV=sandbox`.

**У окружений разные публичные ключи для проверки вебхуков.** Кэшировать один ключ на оба
нельзя — это самая коварная ошибка при подключении песочницы.

## Авторизация

`Authorization: Bearer <JWT>`.

Токен выпускается в кабинете **на конкретный терминал**: терминал нигде не передаётся
в запросе, он определяется самим токеном. На терминал допускается 1–5 токенов, срок
действия 1–12 месяцев, работа только с согласованных с WATA IP-адресов.

Единственное исключение — `GET /api/h2h/public-key`: работает без авторизации.

Общий таймаут ответа API — 1 минута. Для пяти эндпоинтов действует ограничение
1 GET за 30 секунд (получение публичного ключа в их число не входит).

## Эквайринг — `https://api.wata.pro/api/h2h`

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/links` | Создать платёжную ссылку |
| GET | `/links` | Поиск ссылок (пагинация SkipCount/MaxResultCount) |
| GET | `/links/{id}` | Ссылка по идентификатору (плюс блок `digitalGood`) |
| GET | `/v2/transactions` | Поиск транзакций (**курсорная** пагинация) |
| GET | `/transactions/{id}` | Транзакция по идентификатору |
| POST | `/transactions/refunds` | Возврат |
| GET | `/finance/balance` | Баланс терминала (обязательный `Date`) |
| POST | `/payments/sbp` | Прямая оплата по СБП |
| POST | `/payments/tpay` | Прямая оплата T-Pay |
| POST | `/payments/card-crypto` | Оплата картой по криптограмме |
| GET | `/public-key` | Публичный ключ для вебхуков (без авторизации) |

### Ограничения, которых нет в схеме, но есть в документации

- Сумма ссылки: от 10 RUB (1 USD/EUR) до 999999.99
- Срок жизни ссылки: от 10 минут до 30 дней, по умолчанию 3 дня
- Подсказки произвольной суммы: рекомендуется 3–4, максимум 6, каждая не меньше `amount`
- `Date` в балансе: **только сегодня или вчера по UTC**, иначе запрос отклоняется
- Возврат: сумма > 0, не больше остатка, максимум 2 знака после запятой;
  недоступен на терминалах с продуктом «Цифровые товары + Эквайринг»
- Поиск: `MaxResultCount` практически ограничен 1000, по умолчанию 10

### Enum'ы

- `Currency`: RUB, USD, EUR (в схеме есть также GBP, но нигде не документирован)
- `PaymentLinkStatus`: Opened, Closed
- `PaymentLinkType`: OneTime, ManyTime
- `TransactionStatus`: Created, Paid, Pending, Declined
- `TransactionKind`: Payment, Refund
- `TransactionType`: CardCrypto, SBP, TPay
- `SubscriptionInterval`: Test, Week, Month

### Подводный камень именования

Комиссия по транзакции приходит под разными именами: в payload вебхука это `commission`,
а в ответе `GET /transactions/{id}` — `totalCommission`.

## Вебхуки

- Заголовок подписи: `X-Signature`
- Алгоритм: **SHA512withRSA** (RSA PKCS#1 v1.5 + SHA-512), подпись в base64
- Ключ: `GET /api/h2h/public-key`, поле `value`, формат PEM
  (документация называет его PKCS#1, фактически это X.509 SubjectPublicKeyInfo)
- Проверять нужно **сырое тело** запроса, до разбора JSON
- Обработчик обязан вернуть HTTP 200; любой другой ответ считается сбоем доставки
- События: предоплатный (до обращения в банк), постоплатный, возвратный

## Цифровые товары — `https://dg-api.wata.pro/api`

Два способа оплаты, и от выбора зависит путь:
**acquiring** — платит покупатель, **deposit** — списывается с депозита мерчанта.

| Направление | Acquiring | Deposit |
|---|---|---|
| Steam | `/v3/steam`, `/v3/steam/amount`, `/v3/steam/by-amount`, `/v3/steam/order/{id}` | `/v1/steam/deposit`, `/v1/steam/deposit/price`, `/v1/steam/deposit/netamount`, `/v1/steam/deposit/by-price` |
| Telegram Stars | `/stars`, `/stars/price`, `/stars/order/{id}`, `/stars/order/{id}/confirm`, `/stars/order/{id}/reject` | — |
| Top-Up | `/v3/topup`, `/v3/topup/all`, `/v3/topup/orders/{id}` | `/v1/deposit/topups` |
| Ваучеры | `/v3/vouchers`, `/v3/vouchers/all`, `/v3/vouchers/order/{id}` | `/v1/deposit/vouchers` |
| Общее | — | `/v1/deposit/order/{orderId}`, `/v1/deposit/balance` |

У депозитных заказов один общий эндпоинт статуса на все направления.
Заказы Telegram Stars могут попасть в статус `Review` — их нужно явно подтвердить или отклонить.
