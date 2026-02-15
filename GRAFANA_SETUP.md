# Grafana + Loki Setup для FitCoach

Инструкция по подключению логов FitCoach к существующему Loki stack.

---

## Предварительные требования

Loki stack уже настроен и запущен в `/Users/filko/Docker/loki_stack`:
- **Loki**: http://localhost:3100
- **Grafana**: http://localhost:3030
- **Alloy**: собирает логи и отправляет в Loki

---

## Шаг 1: Настроить Alloy для чтения файлов проекта

Отредактировать `/Users/filko/Docker/loki_stack/infra/alloy/config.alloy` — добавить **перед** блоком `loki.write "local"`:

```alloy
// Collect logs from FitCoach project files (development)
local.file_match "fitcoach_dev" {
  path_targets = [
    {
      __path__ = "/Users/filko/WebstormProjects/fit_coach/logs/server.log",
      service  = "fitcoach-server",
      env      = "development",
    },
    {
      __path__ = "/Users/filko/WebstormProjects/fit_coach/logs/bot.log",
      service  = "fitcoach-bot",
      env      = "development",
    },
  ]
}

loki.source.file "fitcoach_dev" {
  targets    = local.file_match.fitcoach_dev.targets
  forward_to = [loki.process.json_extract.receiver]
}
```

---

## Шаг 2: Пробросить директорию logs в Alloy контейнер

Отредактировать `/Users/filko/Docker/loki_stack/docker-compose.yml` — добавить volume в сервис `alloy`:

```yaml
  alloy:
    # ... existing config ...
    volumes:
      - ./infra/alloy/config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /Users/filko/WebstormProjects/fit_coach/logs:/Users/filko/WebstormProjects/fit_coach/logs:ro  # <-- добавить
```

---

## Шаг 3: Перезапустить Alloy

```bash
cd /Users/filko/Docker/loki_stack
docker-compose restart alloy

# Проверить, что Alloy увидел файлы
docker logs fitcoach-alloy 2>&1 | grep fitcoach
```

---

## Шаг 4: Запустить server и bot с перенаправлением в файлы

### Terminal 1: Server
```bash
cd /Users/filko/WebstormProjects/fit_coach/apps/server
npm run dev 2>&1 | tee ../../logs/server.log
```

### Terminal 2: Bot
```bash
cd /Users/filko/WebstormProjects/fit_coach/apps/bot
npm run dev 2>&1 | tee ../../logs/bot.log
```

**Что делает `tee`:**
- Пишет логи в файл (`logs/server.log`)
- Одновременно показывает в терминале
- Alloy читает файл и отправляет в Loki

---

## Шаг 5: Проверить логи в Grafana

1. Открыть **Grafana**: http://localhost:3030
2. Перейти в **Explore** (иконка компаса слева)
3. Выбрать datasource: **Loki**
4. Ввести LogQL запрос:

```logql
{service=~"fitcoach.*"}
```

Должны появиться логи от server и bot.

---

## Полезные LogQL запросы

### Все ошибки за последний час
```logql
{service="fitcoach-server", level="error"}
```

### Полная трассировка запроса по reqId
```logql
{service="fitcoach-server"} | json | reqId="req-4"
```

### Все действия конкретного пользователя
```logql
{service="fitcoach-server"} | json | userId="2cf50748-a0f9-4cde-b94c-d49338241f10"
```

### LLM запросы с полным контентом (development)
```logql
{service="fitcoach-server", module="llm"} | json
```

### Медленные LLM вызовы (> 5 секунд)
```logql
{service="fitcoach-server", module="llm"} | json | processingTime > 5000
```

### Ошибки по модулям за 5 минут
```logql
sum by (module) (rate({service="fitcoach-server", level="error"}[5m]))
```

---

## Troubleshooting

### Логи не появляются в Grafana

**Проверить 1: Alloy видит файлы**
```bash
docker logs fitcoach-alloy 2>&1 | tail -50
```

Должны быть строки типа:
```
level=info msg="watching new target" path="/Users/filko/WebstormProjects/fit_coach/logs/server.log"
```

**Проверить 2: Файлы существуют и не пустые**
```bash
ls -lh /Users/filko/WebstormProjects/fit_coach/logs/
cat /Users/filko/WebstormProjects/fit_coach/logs/server.log | head -5
```

**Проверить 3: Loki принимает логи**
```bash
curl http://localhost:3100/ready
# Должен вернуть: ready
```

**Проверить 4: Alloy контейнер имеет доступ к файлам**
```bash
docker exec fitcoach-alloy ls -la /Users/filko/WebstormProjects/fit_coach/logs/
```

### Логи дублируются

Если видите дубликаты — это потому что `tee` пишет в файл, а вы также видите в терминале. Это нормально.

### Старые логи

Alloy читает файлы с конца. Если хотите увидеть старые логи:
```bash
# Очистить файлы
> logs/server.log
> logs/bot.log

# Перезапустить приложения
```

---

## Автоматизация (опционально)

Создать npm scripts для автоматического перенаправления:

**package.json (root):**
```json
{
  "scripts": {
    "dev:server": "cd apps/server && npm run dev 2>&1 | tee ../../logs/server.log",
    "dev:bot": "cd apps/bot && npm run dev 2>&1 | tee ../../logs/bot.log"
  }
}
```

Тогда запуск:
```bash
npm run dev:server  # Terminal 1
npm run dev:bot     # Terminal 2
```

---

## Результат

После настройки вы получаете:

✅ **Логи в терминале** — видите в реальном времени  
✅ **Логи в Grafana** — поиск, фильтрация, история  
✅ **Трассировка запросов** — по `reqId` видите полную цепочку  
✅ **LLM observability** — промпты, ответы, токены, latency  
✅ **Error analysis** — все ошибки с контекстом  

---

**Статус:** Ready to use  
**Время настройки:** ~5 минут
