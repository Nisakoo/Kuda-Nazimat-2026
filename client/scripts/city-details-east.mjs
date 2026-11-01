/** Small authored vignettes for the gate, guest court, homes and school.
 * The caller applies district transforms and fits each tracked group to the city edge.
 */
export function decorateEast(id, api) {
  if (!['gate', 'guest', 'homes', 'school'].includes(id)) return;
  const { box, bead, cylinder, beam, block, tracked, tablet, basket, rope, wood, cream, teal } = api;
  const bronze = '#ac8750', darkBronze = '#675440', clay = '#c38c66', linen = '#d9c6a2';

  function ring(x, y, z, radius, color = bronze) {
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      bead(color, x + Math.sin(angle) * radius, y + Math.cos(angle) * radius, z, .055, .055, .04);
    }
  }
  function clothBundle(x, y, z, color, width = .8) {
    box(color, x, y, z, width, .42, .7);
    box(linen, x, y + .215, z, .075, .025, .74);
    box(linen, x, y, z + .36, .075, .44, .025);
    box(linen, x, y + .22, z, width + .04, .025, .065);
    bead(linen, x, y + .26, z, .1, .06, .08);
  }
  function reedMat(x, z, width, depth) {
    box('#ba9d6d', x, .035, z, width, .045, depth);
    const count = Math.ceil(width / .15);
    for (let i = 0; i < count; i++) box(i % 3 ? '#cfb687' : '#9d8056', x - width / 2 + .07 + i * .15, .065, z, .065, .025, depth);
    for (const offset of [-.3, .3]) box('#856b48', x, .082, z + offset * depth, width, .018, .045);
  }

  if (id === 'gate') {
    // Attached to the existing closed gate: straps, bosses and two ring handles.
    tracked(function gateIronwork() {
      for (const side of [-1, 1]) {
        for (const y of [.8, 3.3, 5.3]) {
          box(darkBronze, side * 2.5, y, 12.7, 4.3, .19, .1);
          for (let i = 0; i < 5; i++) bead(bronze, side * 2.5 - 1.7 + i * .85, y, 12.62, .065, .065, .045);
        }
        box(bronze, side * 1.1, 2.5, 12.61, .35, .55, .12);
        ring(side * 1.1, 2.25, 12.48, .22);
      }
      box(wood, 0, 1.6, 12.48, 4.6, .28, .28);
      for (const x of [-1.8, 1.8]) box(bronze, x, 1.6, 12.29, .18, .52, .12);
    })();

    tracked(function gateSealStation() {
      const x = 8, z = -10;
      box('#b49975', x, .38, z, 1.35, .76, 1.15);
      box(cream, x, .8, z, 1.5, .12, 1.3);
      tablet(x - .3, .9, z + .15, .6);
      cylinder(darkBronze, x + .3, 1.02, z - .1, .1, .35);
      cylinder(bronze, x + .3, 1.22, z - .1, .17, .07);
      for (let i = 0; i < 5; i++) bead(clay, x - .45 + i * .22, .92, z - .35, .075, .035, .07);
      for (let i = 0; i < 3; i++) box(teal, x - .4 + i * .4, .48, z + .59, .2, .21, .035);
      block(x, z, 1.5, 1.3);
    })();

    tracked(function travellersMilestone() {
      const x = -10, z = -10.7;
      box('#c6b28c', x, .48, z, .55, .96, .4);
      box(cream, x, 1.01, z, .67, .14, .5);
      for (let row = 0; row < 4; row++) {
        box(darkBronze, x - .12, .3 + row * .17, z + .21, .07, .08, .025);
        box(darkBronze, x + .07, .3 + row * .17, z + .21, .13, .025, .025);
      }
      block(x, z, .65, .5);
    })();
  }

  if (id === 'guest') {
    tracked(function caravanLuggage() {
      const x = -4.7, z = -10.2;
      box('#775439', x, .34, z, 1.45, .68, .95);
      box('#a57e50', x, .71, z, 1.5, .1, 1);
      for (const dx of [-.5, .5]) {
        box(darkBronze, x + dx, .38, z + .49, .09, .7, .04);
        box(darkBronze, x + dx, .78, z, .09, .035, 1);
      }
      box(bronze, x, .54, z + .52, .2, .23, .07);
      clothBundle(x + .18, 1.02, z, '#967b91', 1.05);
      clothBundle(x -.3, 1.46, z + .03, '#ae795c', .7);
      block(x, z, 1.5, 1);
      rope(x + 1.1, z + .2);
    })();

    tracked(function guestWashstand() {
      const x = 11, z = 10;
      box(wood, x, .7, z, 1.5, .12, 1.1);
      for (const dx of [-.57, .57]) for (const dz of [-.37, .37]) box(wood, x + dx, .35, z + dz, .11, .7, .11);
      cylinder(clay, x -.2, .86, z, .4, .24, .47);
      cylinder('#79a3a1', x -.2, .99, z, .38, .025);
      box(linen, x + .52, .8, z + .1, .3, .035, .8);
      box(linen, x + .52, .57, z + .51, .3, .45, .035);
      for (let i = 0; i < 3; i++) box(teal, x + .44 + i * .08, .56, z + .535, .025, .32, .02);
      block(x, z, 1.5, 1.1);
    })();

    tracked(function guestSleepingRolls() {
      const x = -10.7, z = 8.7;
      reedMat(x, z, 1.75, 1.2);
      clothBundle(x, .28, z - .12, '#7e9490', 1.2);
      clothBundle(x + .12, .7, z - .12, '#bd9371', 1.05);
      box(cream, x, .12, z + .45, 1.55, .045, .22);
      block(x, z -.12, 1.2, .72);
    })();
  }

  if (id === 'homes') {
    tracked(function householdSpinning() {
      const x = 2.9, z = -11;
      box(wood, x, .62, z, 1.25, .12, .7);
      for (const dx of [-.45, .45]) box(wood, x + dx, .3, z, .12, .6, .55);
      for (let i = 0; i < 3; i++) {
        cylinder(linen, x - .4 + i * .4, .83, z, .12, .3);
        cylinder(wood, x - .4 + i * .4, 1.03, z, .025, .22);
      }
      beam(wood, x -.4, 1.35, z -.2, .055, 1.3, .055, -.17);
      bead(cream, x -.48, 1.75, z -.2, .2, .33, .16);
      basket(x + .9, z + .15, false, .6);
      for (let i = 0; i < 5; i++) bead(linen, x + .9 + Math.sin(i * 2) * .12, .48, z + .15 + Math.cos(i * 2) * .12, .13, .11, .12);
      block(x + .15, z, 1.6, .8);
    })();

    tracked(function childrenClayAnimals() {
      const x = -10.5, z = 4.1;
      reedMat(x, z, 1.45, 1.1);
      for (let i = 0; i < 3; i++) {
        const px = x - .45 + i * .42;
        bead(i % 2 ? '#ad7055' : clay, px, .22, z, .14, .1, .22);
        bead(clay, px, .34, z + .16, .09, .12, .09);
        for (const side of [-1, 1]) bead(cream, px + side * .06, .45, z + .17, .025, .08, .025);
      }
      for (let i = 0; i < 4; i++) box('#d3b38c', x - .4 + i * .25, .15, z -.35, .17, .14, .13);
      // Hand-sized toys are decoration and do not create invisible obstacles.
    })();

    tracked(function homeMendingBasket() {
      const x = 11.8, z = 1.8;
      basket(x, z, false, .65);
      clothBundle(x, .51, z, '#ad7e70', .55);
      box(teal, x + .48, .065, z + .35, .75, .035, .55);
      for (let i = 0; i < 4; i++) box(linen, x + .22 + i * .17, .09, z + .35, .035, .02, .52);
      cylinder(wood, x + .45, .12, z + .3, .025, .08);
      block(x, z, .65, .65);
    })();
  }

  if (id === 'school') {
    tracked(function dryingClayTablets() {
      const x = 9, z = -2.8;
      box(wood, x, .43, z, 1.65, .12, 1.05);
      for (const dx of [-.65, .65]) box(wood, x + dx, .2, z, .12, .4, .8);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) tablet(x -.5 + col * .5, .52, z -.27 + row * .54, .43);
      cylinder(clay, x + .62, .7, z -.3, .13, .33, .17);
      for (let i = 0; i < 3; i++) beam(wood, x + .56 + i * .05, .97, z -.3, .025, .45, .025, (i - 1) * .16);
      block(x, z, 1.65, 1.05);
    })();

    tracked(function schoolMeasuringTools() {
      const x = -9, z = 9.5;
      reedMat(x, z, 1.5, 1.2);
      for (const dx of [-.55, .55]) box(wood, x + dx, .18, z, .12, .24, 1.05);
      for (let i = 0; i < 6; i++) {
        box(linen, x, .32, z -.4 + i * .16, 1.2, .035, .045);
        for (let count = 0; count <= i % 4; count++) bead(i % 2 ? clay : teal, x -.4 + count * .2, .37, z -.4 + i * .16, .06, .065, .065);
      }
      box(wood, x + .97, .1, z, .13, .12, 1.3);
      for (let i = 0; i < 7; i++) box(cream, x + .97, .17, z -.54 + i * .18, .135, .02, .025);
    })();

    tracked(function schoolTabletArchive() {
      const x = -5, z = -11.8;
      box('#a67c53', x, .35, z, 1.4, .7, .85);
      for (let i = 0; i < 4; i++) {
        box(wood, x -.63 + i * .42, .76, z, .07, .38, .85);
        for (let j = 0; j < 3; j++) box(clay, x -.45 + i * .29, .68 + j * .11, z, .24, .08, .6);
      }
      box(wood, x, .76, z -.46, 1.4, .4, .07);
      box(linen, x, .4, z + .44, .42, .32, .025);
      for (let i = 0; i < 3; i++) box('#775737', x -.12 + i * .12, .4, z + .46, .045, .16, .025);
      block(x, z, 1.4, .9);
    })();
  }
}
