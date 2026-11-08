---
status: accepted
date: 2026-10-31
decision-makers: команда проекта (технологии заданы ТЗ)
---

# Клиент: Vite + Svelte 5 + Three.js, TypeScript strict, без лишних каркасов

## Context and Problem Statement

Нужен браузерный 3D-клиент, который запускается без установки ПО на ноутбуках игроков и работает офлайн. Надо выбрать стек и ограничить архитектурные каркасы.

## Decision Drivers

* Технологии заданы новым ТЗ: Three.js — единственный движок.
* Отдельное владение жизненным циклом, отсутствие утечек GPU-ресурсов.
* Простая сборка и раздача статикой с сервера.

## Considered Options

* Один Vite-проект: TypeScript strict, Svelte 5 + CSS, Three.js, Socket.IO Client, Vitest (выбрано)
* SvelteKit
* Монорепозиторий / workspaces
* Полноценный ECS-фреймворк
* Переключаемый движок рендера (второй движок)
* WebXR / VR-шлем

## Decision Outcome

Выбран один Vite-проект в `client/` со стеком из первого варианта. Рендерер всегда Three.js (`ThreeRenderer`), поля выбора движка в конфигурации нет. Core остаётся headless и без внешних зависимостей. `GameApp` — единственное место композиции, без DI-контейнера. SvelteKit, workspaces, ECS-фреймворк, WebXR не добавляются.

### Consequences

* Good: мало движущихся частей; сборка раздаётся обычным HTTP-сервером.
* Good: UI и рендер изолированы фасадом `GameApp` и `RenderAdapter`.
* Bad: нельзя сменить движок без переписывания `render/three`.
* Bad: иммерсивный режим (VR) не поддерживается; решение «обсуждается отдельно».
* Bad: мобильные браузеры не целевые (клавиатура и мышь).

### Confirmation

`npm --prefix client run check` (svelte-check, tsc strict), `check:core` (Core без DOM/Node), `check:imports` (dependency-cruiser).

## Pros and Cons of the Options

### Vite + Svelte 5 + Three.js

* Good: заданы ТЗ; сборка раздаётся статикой.
* Bad: нет готовой игровой структуры — её строим сами.

### SvelteKit, монорепозиторий, ECS, второй движок, WebXR

* Bad: в источниках перечислены как не добавляемые; обоснования отдельно не указаны.

## More Information

[../tech/client.md](../tech/client.md). Связано: [0005](0005-shared-executable-contract.md).
