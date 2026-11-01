# V-01 — CPU observation of bake-v2

Открыты как PNG `../ui-entry-fidelity-2026-07-02/baked-v2/city-gates.png` и `babylon-market-day.png`. Browser/GPU не использовались; GPU остаётся у avatar-contract/Main согласно очереди.

Относительно v1 в street действительно ниже и разнообразнее skyline и больше неба. У жителей заметнее глаза, меньше вертикальная вытянутость головы; у foreground traveller читается backpack с клапаном/ремнями. Это целевые улучшения по предыдущим замечаниям. Gates сохраняет основной объём/перспективу/тёплые тени.

Отдельный новый обязательный rebake не назначается. V-01 остаётся pending actual UI composite: нужно увидеть заполнение signboards поверх большого центрального столба и crops на четырёх размерах. Asset observation не закрывает ENTRY/R01–R05 и не является runtime/FPS evidence.

R-06: Main сообщил old BW0 initial-I/equip BODY failure и новый Dmp_w5NJ manual pass с focusout recovery. Это не независимый повтор. Reviewer сохраняет R-06 open до fresh deployed run; unlock-only причина не утверждается. Следующий gate включает immediate и delayed focus после unlock, equip ACK/второй I, сохранение пользовательского focus и нового Settings/top modal.
