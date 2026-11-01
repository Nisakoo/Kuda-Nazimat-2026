# Metadata fixture Ollama 0.40.13

`qwen35-2b-active-manifest.json` — **только 1088 bytes метаданных**, восстановленных из опубликованного владельцем вывода локальной диагностики. SHA-256 raw bytes: `1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7`. Это не модель, не веса и не конфиг runtime; ссылки на blobs не разрешаются в сеть и здесь не скачиваются.

Legacy downgrade-anchor воспроизводится добавлением в конец `layers` объекта с `mediaType: application/vnd.docker.distribution.manifest.v2+json`, `digest: sha256:1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7`, `size: 1088`, затем compact JSON без trailing newline, сохраняя порядок ключей. Его 1252 bytes имеют SHA-256 `2fcba4e039b23928e05c8554adc262dbf5652d70bb20a36c947db9272c38c1dc`, совпадающий с пользовательским pin.

Fixture закрепляет форму и криптографическую связь двух разных manifest. Полная проверка model blobs использует отдельно сгенерированные маленькие тестовые файлы. Наличие этого metadata fixture не подтверждает подлинность издателя, загрузку модели, RAM, скорость или правильность ответов.
