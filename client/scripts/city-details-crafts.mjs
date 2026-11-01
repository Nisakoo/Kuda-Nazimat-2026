/** Small craft scenes in authored district coordinates; merged into the existing district mesh. */
export function decorateCrafts(id, api) {
  if (!['bakery', 'mill', 'dye', 'dock'].includes(id)) return;
  const { box, bead, cylinder, beam, block, tracked, wood, cream, teal } = api;
  const cord = '#c4a777', darkWood = '#6c503c', clay = '#b37a59', iron = '#777e74';
  const scene = build => tracked(build)();

  // Bands and handles are deliberately geometric, sharing the district's single material.
  function tiedBundle(x, y, z, length = 1.5, color = '#d0b179') {
    for (let i = 0; i < 5; i++) {
      box(color, x - .24 + i * .12, y + (i % 2) * .035, z, .07, .07, length);
    }
    for (const dz of [-length * .28, length * .28]) box(cord, x, y + .045, z + dz, .61, .055, .09);
  }
  function bowl(x, y, z, color, fill) {
    cylinder(color, x, y, z, .24, .16, .31);
    cylinder(darkWood, x, y + .085, z, .25, .012);
    if (fill) cylinder(fill, x, y + .09, z, .22, .015);
  }
  function fish(x, y, z, color, size = 1) {
    bead(color, x, y, z, .13 * size, .07 * size, .34 * size);
    bead(color, x, y, z - .34 * size, .21 * size, .035 * size, .14 * size);
    bead('#263f43', x + .09 * size, y + .025 * size, z + .18 * size, .025, .025, .025);
  }

  if (id === 'bakery') {
    scene(function bakeryOvenTools() {
      // These tools stay within the existing oven's blocked footprint.
      for (const [x, z, angle] of [[1.7, -6.8, -.12], [2.3, -7.1, .13]]) {
        beam(wood, x, 1.35, z, .09, 2.6, .09, angle);
        box('#b99463', x + Math.sin(angle) * .9, .35, z, .48, .55, .09);
        box(darkWood, x, 2.55, z, .18, .12, .15);
      }
      for (let i = 0; i < 7; i++) {
        box(i % 2 ? '#916143' : '#a77b50', -1.45 + (i % 4) * .3, .22 + Math.floor(i / 4) * .25, -9.8, .26, .24, 1.3);
        box('#c1a072', -1.45 + (i % 4) * .3, .22 + Math.floor(i / 4) * .25, -9.13, .18, .16, .025);
      }
      bowl(1, .2, -6.4, clay, '#4d443b');
      for (let i = 0; i < 5; i++) bead('#494239', .83 + i * .08, .3, -6.4, .04, .025, .06);
    });
    scene(function bakeryPreparation() {
      // The old bread counter already occupies this area under the awning.
      box('#c3a377', -8.3, 1.22, -5, 1.35, .07, .84);
      for (let i = 0; i < 3; i++) {
        bead('#efdcaf', -8.65 + i * .36, 1.31, -5.1, .16, .08, .24);
        box('#b98f5e', -8.65 + i * .36, 1.39, -5.1, .15, .012, .025);
      }
      beam('#9b7049', -8.3, 1.32, -4.75, 1.2, .09, .09);
      for (const x of [-8.97, -7.63]) box(darkWood, x, 1.32, -4.75, .18, .065, .065);
      bowl(-10.1, 1.22, -5.15, clay, '#e7d4a4');
      cylinder('#bb864f', -10.8, 1.25, -5.05, .2, .35, .17);
      cylinder('#8e6746', -10.8, 1.44, -5.05, .19, .035);
      box(cord, -10.8, 1.29, -4.84, .2, .16, .025);
    });
    scene(function bakeryCoolingShelves() {
      const x = -9.5, z = -8.35;
      for (const dx of [-.85, .85]) box(darkWood, x + dx, .9, z, .12, 1.8, .75);
      for (let shelf = 0; shelf < 3; shelf++) {
        const y = .35 + shelf * .55;
        box(wood, x, y, z, 1.85, .09, .85);
        for (let loaf = 0; loaf < 4; loaf++) {
          bead(shelf % 2 ? '#c58e51' : '#deb477', x - .63 + loaf * .42, y + .13, z, .17, .08, .29);
          for (let slash = 0; slash < 2; slash++) box('#9f703f', x - .63 + loaf * .42, y + .205, z - .1 + slash * .2, .16, .012, .024);
        }
      }
      block(x, z, 1.95, .85);
    });
  }

  if (id === 'mill') {
    scene(function millHopper() {
      // A small grain funnel rests on the existing stone; it adds no new walking obstacle.
      const x = -.85, z = -7;
      for (const dx of [-.44, .44]) box(darkWood, x + dx, 1.62, z, .09, .8, .8);
      box(wood, x, 1.98, z, 1.12, .12, .95);
      for (const dx of [-.5, .5]) box('#bc9465', x + dx, 2.19, z, .1, .38, 1.03);
      for (const dz of [-.47, .47]) box('#a77f54', x, 2.19, z + dz, 1.1, .38, .1);
      for (let i = 0; i < 15; i++) bead('#d5bd7d', x - .37 + (i % 5) * .18, 2.06 + (i % 3) * .025, z - .3 + Math.floor(i / 5) * .3, .055, .04, .085);
      box('#a67f51', x, 1.65, z + .54, .35, .08, .5);
    });
    scene(function millSackLabels() {
      for (let i = 0; i < 5; i++) {
        const x = -10 + i * 1.2;
        box(cord, x, 1.08, 10, .55, .09, .55);
        bead('#ddd0a4', x, 1.25, 10, .18, .17, .18);
        box(cream, x, .72, 10.49, .28, .3, .035);
        for (let mark = 0; mark <= i % 3; mark++) box('#7e6745', x - .07 + mark * .065, .74, 10.515, .02, .17, .015);
      }
    });
    scene(function millWinnowingScreen() {
      // Narrow tool rack against the grain-storage side, away from the central route.
      const x = -12, z = 6.7;
      for (const dx of [-.52, .52]) box(wood, x + dx, 1.05, z, .08, 2.1, .1);
      for (const y of [.48, 1.77]) box(wood, x, y, z, 1.1, .09, .1);
      for (let i = 0; i < 7; i++) box(cord, x - .44 + i * .145, 1.12, z, .025, 1.2, .035);
      for (let i = 0; i < 8; i++) box(cord, x, .6 + i * .145, z + .02, .9, .025, .025);
      for (const dx of [-.5, .5]) box(darkWood, x + dx, .1, z, .14, .2, .7);
      tiedBundle(x, .18, z + .4, .9);
      for (const dx of [-.5, .5]) block(x + dx, z, .14, .7);
      block(x, z, 1.1, .1);
    });
  }

  if (id === 'dye') {
    scene(function dyeVatTools() {
      const colors = ['#ad6654', '#579593', '#8a7298'];
      for (let i = 0; i < 3; i++) {
        const x = -9 + i * 9;
        for (const dx of [-1.1, 1.1]) {
          box('#d2af77', x + dx, 1.4, -7, .1, .12, 1.7);
          box(darkWood, x + dx, .7, -5.28, .08, .75, .08);
        }
        beam(wood, x + .5, 1.91, -7.2, .085, 1.8, .085, .35);
        box(colors[i], x + .18, 1.35, -7.1, .24, .1, .6);
        for (let dot = 0; dot < 6; dot++) bead('#bdd2b4', x + Math.sin(dot * 2.3) * .95, 1.35, -7 + Math.cos(dot * 2.3) * .95, .07, .014, .08);
        for (let mark = 0; mark < 4; mark++) box(cream, x - .5 + mark * .33, .72, -5.18, .08, .32, .025);
      }
    });
    scene(function dyeYarnFrame() {
      const x = -9.3, z = 10.6;
      for (const dx of [-1, 1]) box(darkWood, x + dx, 1.05, z, .12, 2.1, .13);
      for (const y of [.3, 1.85]) box(wood, x, y, z, 2.3, .13, .16);
      for (let i = 0; i < 6; i++) {
        const px = x - .8 + i * .32, color = ['#b76559', '#e4bc71', '#71948b', '#947394', '#c78d68', '#b8b995'][i];
        for (let thread = 0; thread < 3; thread++) box(color, px + (thread - 1) * .055, 1.13, z + .12, .035, 1.42, .06);
        bead(color, px, .41, z + .12, .105, .14, .07);
        box(cord, px, .86, z + .16, .2, .07, .05);
      }
      block(x, z, 2.3, .4);
    });
    scene(function dyeSampleBoard() {
      // Samples sit on the existing loom crossbar and never enter its interaction aisle.
      for (let i = 0; i < 5; i++) {
        const x = 7 + i * .45;
        box(['#c47d69', '#e1c17b', '#8bac99', '#6b9298', '#ad89a0'][i], x, 1.58, 7.13, .34, .46, .04);
        box(cream, x, 1.78, 7.16, .18, .05, .025);
      }
      tiedBundle(8, .22, 7, 1.3, '#d9d1af');
    });
  }

  if (id === 'dock') {
    scene(function dockCargoBindings() {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        const x = 7 + col * 2, z = -6 + row * 2;
        for (const dx of [-.52, .52]) {
          box(cord, x + dx, 1.025, z, .085, .045, 1.65);
          box(cord, x + dx, .52, z + .82, .085, 1.02, .04);
        }
        box(cream, x, .65, z + .84, .4, .3, .025);
        for (let mark = 0; mark < col + 2; mark++) box('#746045', x - .1 + mark * .1, .65, z + .86, .025, .19, .018);
        bead('#b18b53', x, 1.07, z + .5, .1, .07, .07);
      }
    });
    scene(function dockFishingNet() {
      const x = 8.6, z = -9.5;
      for (const dx of [-1.25, 1.25]) {
        box(darkWood, x + dx, 1.25, z, .12, 2.5, .12);
        box(wood, x + dx, .13, z, .45, .26, .8);
      }
      box(wood, x, 2.4, z, 2.7, .12, .12);
      for (let i = 0; i < 9; i++) {
        const px = x - 1.12 + i * .28;
        box(cord, px, 1.43, z, .023, 1.8, .023);
        bead('#b48455', px, 2.3, z, .085, .075, .07);
        bead('#8b8d80', px, .55, z, .055, .09, .06);
      }
      for (let i = 0; i < 8; i++) box(cord, x, .65 + i * .22, z + .025, 2.25, .025, .025);
      for (const dx of [-1.25, 1.25]) block(x + dx, z, .45, .8);
      block(x, z, 2.25, .12);
    });
    scene(function dockFishSorting() {
      // The existing canopy at (8,10) shelters this low drying tray.
      const x = 8, z = 10;
      box(darkWood, x, .33, z, 2.4, .12, 1.3);
      for (const dx of [-.9, .9]) box(wood, x + dx, .16, z, .14, .3, 1.15);
      for (let i = 0; i < 5; i++) {
        box('#a9865c', x - .9 + i * .45, .41, z, .08, .04, 1.25);
        fish(x - .85 + i * .43, .49, z, i % 2 ? '#90a99a' : '#aeb6a1', .8);
      }
      block(x, z, 2.4, 1.3);
    });
    scene(function dockRepairKit() {
      // The repair bundle rests on an existing cargo crate, leaving the pier and central lane free.
      for (let i = 0; i < 4; i++) {
        box(i % 2 ? '#b99467' : '#a58056', 6.5 + i * .32, 1.08, -6.1, .26, .065, 1.3);
        for (const dz of [-.48, .48]) cylinder(iron, 6.5 + i * .32, 1.121, -6.1 + dz, .025, .012);
      }
      tiedBundle(7, 1.17, -6.1, 1.15, '#ac895c');
    });
  }
}
