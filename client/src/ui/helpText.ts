interface HelpCopy {
  readonly title: string; readonly close: string; readonly back: string; readonly controls: string;
  readonly sections: readonly (readonly [string, string])[];
  readonly keys: readonly (readonly [string, string])[];
}
export const helpText: Readonly<Record<'ru' | 'en' | 'es', HelpCopy>> = {
  ru: {
    title: 'Как играть', close: 'Закрыть помощь', back: 'Назад', controls: 'Управление',
    sections: [
      ['Цель', 'Языки в Вавилоне смешались. Помогайте жителям, выполняйте задания вместе с напарниками и учите язык, на котором с вами говорят.'],
      ['Как общаться', 'Пишите на родном языке, читайте ответы на изучаемом. Переведённые сообщения отмечены «Машинный перевод». Подойдите к жителю и нажмите E, чтобы поговорить. Ошибку отправки можно исправить и повторить запрос.'],
      ['Камень', 'В чате нажмите «Нарисовать», чтобы объяснить мысль рисунком. Штрихи нельзя стереть. Закрытие окна сохраняет черновик; после высечения камень видят участники задания. Жители не распознают рисунки.'],
      ['Словарь', 'Нажмите любое слово ответа жителя или сообщения напарника: проверьте перевод и добавьте слово. Подчёркнутые слова уже в вашем словаре. «Запомнил» переносит слово в «Выучено». Словарь виден только вам.'],
      ['Задания', 'Текущее задание видно слева сверху, подробности открываются по Tab из игры. У одного игрока могут быть сведения, у другого — возможность действовать. Договоритесь, кто что делает. В одиночной игре доступны обе роли.'],
      ['Пауза и сохранения', 'Меню освобождает курсор и останавливает вашего персонажа; напарники продолжают играть. «На главный экран» возвращает в кабинет, «Выйти из сессии» завершает вход. Сервер сохраняет прогресс. Локальная прогулка — отдельная демонстрация со сбросом при перезапуске.'],
    ],
    keys: [['W A S D / ↑ ← ↓ →', 'Движение'], ['Мышь / колесо', 'Осмотреться / приблизить'], ['Shift / Пробел', 'Бег / прыжок'], ['E', 'Взаимодействие'], ['F', 'Взять / положить яблоко'], ['Tab', 'Задачи; внутри окна — следующий элемент'], ['1 / 2', 'Чат / словарь'], ['3 / 4', 'Карта / изучаемый язык'], ['Alt / Option', 'Удерживать для краткой подсказки'], ['Esc', 'Закрыть окно / меню']],
  },
  en: {
    title: 'How to play', close: 'Close help', back: 'Back', controls: 'Controls',
    sections: [
      ['Your goal', 'The languages of Babylon have become mixed. Help residents, complete tasks with your teammates and practise the language they speak.'],
      ['Conversation', 'Write in your native language and read replies in your learning language. Translated messages are marked as machine translations. Approach a resident and press E to talk. If sending fails, check the error and try again.'],
      ['Stone drawings', 'Choose Draw in the chat to explain an idea with a picture. Strokes cannot be erased. Closing the window keeps your draft; engraving shares the stone with your task group. Residents cannot interpret drawings.'],
      ['Dictionary', 'Click any word in a resident’s reply or a teammate’s message, check its translation and add it. Underlined words are already in your dictionary. Mark a word as learned to move it to the learned list. Your dictionary is private.'],
      ['Tasks', 'Your current task appears at the top left. Press Tab while playing for details. One player may have the information while another can perform the action. Agree on your roles. Solo players can do both.'],
      ['Pause and progress', 'The menu releases the cursor and stops your character; teammates keep playing. The main screen returns to your profile, while signing out ends your session. The server saves progress. The local walk is a separate demo that resets when restarted.'],
    ],
    keys: [['W A S D / ↑ ← ↓ →', 'Move'], ['Mouse / wheel', 'Look / zoom'], ['Shift / Space', 'Run / jump'], ['E', 'Interact'], ['F', 'Pick up / put down an apple'], ['Tab', 'Tasks; in a window — next control'], ['1 / 2', 'Chat / dictionary'], ['3 / 4', 'Map / learning language'], ['Alt / Option', 'Hold for quick controls'], ['Esc', 'Close window / menu']],
  },
  es: {
    title: 'Cómo jugar', close: 'Cerrar ayuda', back: 'Volver', controls: 'Controles',
    sections: [
      ['Objetivo', 'Las lenguas de Babilonia se han mezclado. Ayuda a los habitantes, cumple tareas con tus compañeros y practica la lengua que hablan.'],
      ['Conversación', 'Escribe en tu lengua materna y lee las respuestas en la lengua que estudias. Los mensajes traducidos llevan una indicación de traducción automática. Acércate a un habitante y pulsa E para hablar. Si falla el envío, consulta el error y vuelve a intentarlo.'],
      ['Dibujos en piedra', 'Elige Dibujar en el chat para explicar una idea con una imagen. No se pueden borrar los trazos. Al cerrar se conserva el borrador; al grabarlo, el grupo recibe la piedra. Los habitantes no interpretan dibujos.'],
      ['Diccionario', 'Pulsa cualquier palabra de una respuesta o mensaje de un compañero, revisa la traducción y añádela. Las palabras subrayadas ya están en tu diccionario. Marca una palabra como aprendida para moverla a esa lista. Tu diccionario es privado.'],
      ['Tareas', 'La tarea actual aparece arriba a la izquierda. Pulsa Tab durante el juego para ver los detalles. Un jugador puede tener la información y otro realizar la acción. Acordad los papeles. En solitario puedes hacer ambas cosas.'],
      ['Pausa y progreso', 'El menú libera el cursor y detiene a tu personaje; tus compañeros siguen jugando. La pantalla principal vuelve al perfil, mientras que cerrar sesión termina el acceso. El servidor guarda el progreso. El paseo local es una demostración independiente que se reinicia al volver a empezar.'],
    ],
    keys: [['W A S D / ↑ ← ↓ →', 'Moverse'], ['Ratón / rueda', 'Mirar / acercar'], ['Shift / Espacio', 'Correr / saltar'], ['E', 'Interactuar'], ['F', 'Recoger / dejar una manzana'], ['Tab', 'Tareas; en ventanas — siguiente control'], ['1 / 2', 'Chat / diccionario'], ['3 / 4', 'Mapa / lengua de aprendizaje'], ['Alt / Option', 'Mantener para ver los controles'], ['Esc', 'Cerrar ventana / menú']],
  },
};
