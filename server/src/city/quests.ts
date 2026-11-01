import type { Localized } from '../../../shared/city/catalogue.ts';
const L = (ru: string, en: string, es: string): Localized => ({ ru, en, es });
export interface CityStep { target: string; clue: Localized; choices: readonly Localized[]; correct: number; hidden?: boolean; candidates?: readonly string[] }
export interface CityQuest { id: string; wave: number; giver: string; title: Localized; steps: readonly CityStep[] }
const step = (target: string, clue: Localized, choices: readonly Localized[], correct = 0, hidden = false): CityStep => ({ target, clue, choices, correct, hidden });
const deliver = L('Передать', 'Deliver', 'Entregar');
const acknowledge = L('Рассказать о месте', 'Describe this place', 'Describir este lugar');
export const CITY_QUESTS: readonly CityQuest[] = [
  { id: 'QUEST-002', wave: 2, giver: 'kuddu', title: L('Вода для огорода', 'Water for the garden', 'Agua para el huerto'), steps: [
    step('potter', L('Возьми высокий кувшин, а не чашу.', 'Take the tall jug, not the bowl.', 'Toma la jarra alta, no el cuenco.'), [L('Чаша','Bowl','Cuenco'),L('Высокий кувшин','Tall jug','Jarra alta')],1),
    step('ilta', L('Наполни кувшин водой у фонтана.', 'Fill the jug with water at the fountain.', 'Llena la jarra con agua de la fuente.'),[L('Наполнить водой','Fill with water','Llenar de agua'),L('Оставить пустым','Leave empty','Dejar vacía')]),
    step('kuddu', L('Полей второй ряд. Первый уже полит.', 'Water the second row. The first is already watered.', 'Riega la segunda fila. La primera ya está regada.'),[L('Первый ряд','First row','Primera fila'),L('Второй ряд','Second row','Segunda fila'),L('Третий ряд','Third row','Tercera fila')],1),
  ] },
  { id: 'QUEST-003', wave: 2, giver: 'ibbi', title: L('Хлеб для пастуха','Bread for the shepherd','Pan para el pastor'), steps: [
    step('shamhat', L('Для хлеба нужны два мешка муки.', 'The bread needs two bags of flour.', 'El pan necesita dos sacos de harina.'),[L('Один мешок','One bag','Un saco'),L('Два мешка','Two bags','Dos sacos'),L('Три мешка','Three bags','Tres sacos')],1),
    step('fruit-seller', L('Возьми финики для сладкого хлеба.', 'Take dates for the sweet bread.', 'Toma dátiles para el pan dulce.'),[L('Финики','Dates','Dátiles'),L('Красные плоды','Red fruit','Frutos rojos')]),
    step('kuddu', L('Для рецепта нужна одна ложка мёда.', 'The recipe needs one spoon of honey.', 'La receta necesita una cucharada de miel.'),[L('Мёд','Honey','Miel'),L('Соль','Salt','Sal')]),
    step('ibbi', L('Смешай муку, финики и мёд. Испеки лепёшку.', 'Mix flour, dates and honey. Bake the flatbread.', 'Mezcla harina, dátiles y miel. Hornea el pan.'),[L('Испечь','Bake','Hornear'),L('Добавить соль вместо мёда','Use salt instead of honey','Usar sal en vez de miel')]),
    step('shepherd', L('Отнеси тёплый хлеб пастуху.', 'Deliver the warm bread to the shepherd.', 'Lleva el pan caliente al pastor.'),[deliver]),
  ] },
  { id: 'QUEST-004', wave: 3, giver: 'taram', title: L('Пропавшие дети','The missing children','Los niños desaparecidos'), steps: [
    step('enki', L('Энки в бирюзовой тунике за пекарней, справа от входа.', 'Enki wears a turquoise tunic behind the bakery, to the right of its entrance.', 'Enki lleva una túnica turquesa detrás de la panadería, a la derecha de la entrada.'),[L('Позвать домой','Call home','Llamar a casa')],0,true),
    step('niya', L('Ния в оранжевой тунике под навесом в гостевом дворе.', 'Niya wears an orange tunic under the canopy in the guest courtyard.', 'Niya lleva una túnica naranja bajo el toldo del patio de huéspedes.'),[L('Позвать домой','Call home','Llamar a casa')],0,true),
    step('taram', L('Сообщи Тарам, что оба ребёнка найдены.', 'Tell Taram that both children have been found.', 'Dile a Taram que habéis encontrado a los dos niños.'),[L('Оба найдены','Both found','Encontramos a los dos')]),
  ] },
  { id: 'QUEST-005', wave: 1, giver: 'herodotus', title: L('Гость из Греции','A guest from Greece','Un huésped de Grecia'), steps: [
    ...['fruit-seller','shepherd','beltani'].map(target => ({...step(target,L('Выберите три разных места: рынок, пастбище, двор башни, ворота или школу. Расскажите о каждом местному жителю.', 'Choose three different places: the market, pasture, tower courtyard, gate or school. Describe each to its resident.', 'Elegid tres lugares diferentes: mercado, pastizal, patio de la torre, puerta o escuela. Describid cada uno a su habitante.'),[acknowledge]),candidates:['fruit-seller','shepherd','beltani','belu','ishme']})),
    step('apil',L('В легенде люди перестали понимать друг друга, потому что смешались языки.', 'In the legend people stopped understanding each other because their languages became mixed.', 'En la leyenda la gente dejó de entenderse porque se mezclaron sus lenguas.'),[L('Смешались языки','Languages became mixed','Se mezclaron las lenguas'),L('Исчезла вода','The water disappeared','Desapareció el agua')]),
  ] },
  { id: 'QUEST-006', wave: 3, giver: 'fabric-seller', title: L('Цвет для заказчика','A colour for the customer','Un color para el cliente'), steps: [
    step('nur-sin',L('Заказчик просит зелёную ткань. Смешай синюю и жёлтую краски.', 'The customer wants green cloth. Mix blue and yellow dye.', 'El cliente pide tela verde. Mezcla tinte azul y amarillo.'),[L('Синий + красный','Blue + red','Azul + rojo'),L('Синий + жёлтый','Blue + yellow','Azul + amarillo'),L('Красный + жёлтый','Red + yellow','Rojo + amarillo')],1),
    step('fabric-seller',L('Верни зелёную ткань торговке.', 'Return the green cloth to the merchant.', 'Devuelve la tela verde a la vendedora.'),[deliver]),
  ] },
  { id: 'QUEST-007', wave: 3, giver: 'haddad', title: L('Караван','The caravan','La caravana'), steps: [
    step('zeria',L('В караване три мешка: специи, финики и ткань.', 'The caravan has three bags: spices, dates and cloth.', 'La caravana trae tres sacos: especias, dátiles y tela.'),[L('Два','Two','Dos'),L('Три','Three','Tres'),L('Четыре','Four','Cuatro')],1),
    step('rimi',L('Рими ждёт специи.', 'Rimi is waiting for spices.', 'Rimi espera especias.'),[L('Ткань','Cloth','Tela'),L('Специи','Spices','Especias')],1),
    step('fruit-seller',L('Торговец фруктами ждёт финики.', 'The fruit merchant is waiting for dates.', 'El frutero espera dátiles.'),[L('Финики','Dates','Dátiles'),L('Ткань','Cloth','Tela')]),
    step('fabric-seller',L('Торговке нужна ткань.', 'The merchant needs cloth.', 'La vendedora necesita tela.'),[L('Специи','Spices','Especias'),L('Ткань','Cloth','Tela')],1),
  ] },
  { id: 'QUEST-008', wave: 3, giver: 'ishme', title: L('Беглый ученик','The runaway pupil','El alumno fugitivo'), steps: [
    step('lipit',L('Липит спрятался справа у входа на пастбище. Предложи вместе решить загадку учителя.', 'Lipit is hiding on the right near the pasture entrance. Offer to solve the teacher’s riddle together.', 'Lipit se esconde a la derecha de la entrada del pastizal. Propón resolver juntos el acertijo del maestro.'),[L('Вернёмся и решим загадку вместе','Let’s return and solve the riddle together','Volvamos y resolvamos el acertijo juntos'),L('Останемся здесь','Let’s stay here','Quedémonos aquí')],0,true),
    step('ishme',L('Верни учителю табличку Липита.', 'Return Lipit’s tablet to the teacher.', 'Devuelve la tablilla de Lipit al maestro.'),[deliver]),
  ] },
  { id: 'QUEST-009', wave: 4, giver: 'beltani', title: L('Ночь наблюдений','A night of observations','Una noche de observación'), steps: [
    step('ishme',L('Подготовь табличку: в одном часе 60 минут.', 'Prepare a tablet: one hour has 60 minutes.', 'Prepara una tablilla: una hora tiene 60 minutos.'),[L('10 минут','10 minutes','10 minutos'),L('60 минут','60 minutes','60 minutos'),L('100 минут','100 minutes','100 minutos')],1),
    step('beltani',L('На учебной карте неба выбери яркую восьмилучевую звезду. Мы изучаем запись наблюдения, время суток в мире не меняется.', 'Choose the bright eight-pointed star on the teaching sky chart. We are studying a recorded observation; the time of day does not change.', 'Elige la estrella brillante de ocho puntas en el mapa didáctico del cielo. Estudiamos una observación registrada; la hora del mundo no cambia.'),[L('✦ Четыре луча','✦ Four points','✦ Cuatro puntas'),L('✴ Восемь лучей','✴ Eight points','✴ Ocho puntas'),L('● Круг','● Circle','● Círculo')],1),
  ] },
  { id: 'QUEST-010', wave: 4, giver: 'nindada', title: L('Сады для Амитис','Gardens for Amytis','Jardines para Amitis'), steps: [
    step('nindada',L('Цветок любит тень. Посади его на нижней тенистой террасе.', 'The flower likes shade. Plant it on the lower shaded terrace.', 'La flor prefiere la sombra. Plántala en la terraza inferior sombreada.'),[L('Нижняя терраса в тени','Lower shaded terrace','Terraza inferior a la sombra'),L('Верхняя терраса на солнце','Upper sunny terrace','Terraza superior al sol')]),
    step('nindada',L('Направь воду снизу вверх водоподъёмным колесом.', 'Use the water wheel to lift water from below.', 'Usa la rueda para elevar el agua desde abajo.'),[L('Поднять воду','Lift water','Elevar el agua'),L('Перекрыть воду','Stop water','Cerrar el agua')]),
    step('amytis',L('Сады Амитис — легенда, их существование обсуждают историки.', 'The gardens of Amytis are a legend; historians debate their existence.', 'Los jardines de Amitis son una leyenda; los historiadores debaten su existencia.'),[L('Это легенда','It is a legend','Es una leyenda'),L('Точная реконструкция','An exact reconstruction','Una reconstrucción exacta')]),
    step('nebuchadnezzar',L('Расскажи во дворце о посаженном растении и воде для садов.', 'Tell the palace about the planted flower and the water for the gardens.', 'Cuenta en el palacio cómo plantaste la flor y llevaste agua a los jardines.'),[L('Представить работу','Present the work','Presentar el trabajo')]),
  ] },
  { id: 'QUEST-011', wave: 1, giver: 'belu', title: L('Животные ворот','Animals on the gate','Los animales de la puerta'), steps: [
    step('belu',L('Назови животных ворот: лев, бык и дракон.', 'Name the animals of the gate: lion, bull and dragon.', 'Nombra los animales de la puerta: león, toro y dragón.'),[L('Лев, бык, дракон','Lion, bull, dragon','León, toro, dragón'),L('Кошка, коза, птица','Cat, goat, bird','Gato, cabra, pájaro')]),
  ] },
  { id: 'QUEST-012', wave: 4, giver: 'sharrum', title: L('Груз с реки','Cargo from the river','Carga del río'), steps: [
    step('bau',L('Для гостей нужна большая рыба, а маленькую оставим в реке.', 'The guests need a large fish; leave the small one in the river.', 'Los huéspedes necesitan un pez grande; deja el pequeño en el río.'),[L('Маленькая рыба','Small fish','Pez pequeño'),L('Большая рыба','Large fish','Pez grande')],1),
    step('sharrum',L('Положи рыбу в лёгкую корзину, а не в тяжёлый мешок.', 'Put the fish in a light basket, not a heavy bag.', 'Pon el pescado en una cesta ligera, no en un saco pesado.'),[L('Лёгкая корзина','Light basket','Cesta ligera'),L('Тяжёлый мешок','Heavy bag','Saco pesado')]),
    step('nanaya',L('Отнеси корзину хозяйке гостевого двора.', 'Deliver the basket to the guest courtyard’s host.', 'Entrega la cesta a la anfitriona del patio.'),[deliver]),
  ] },
  { id: 'QUEST-013', wave: 3, giver: 'nanaya', title: L('Угощение для гостей','A meal for the guests','Una comida para los huéspedes'), steps: [
    step('ibbi',L('Двум гостям нужны две лепёшки.', 'Two guests need two flatbreads.', 'Dos huéspedes necesitan dos panes.'),[L('Одна лепёшка','One flatbread','Un pan'),L('Две лепёшки','Two flatbreads','Dos panes')],1),
    step('nanaya',L('Накрой стол хлебом и пожелай гостям приятного аппетита.', 'Set the bread on the table and wish the guests a good meal.', 'Pon el pan en la mesa y desea buen provecho a los huéspedes.'),[L('Приятного аппетита','Enjoy your meal','Buen provecho')]),
  ] },
];
