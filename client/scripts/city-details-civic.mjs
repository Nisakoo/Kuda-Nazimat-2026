/** Civic and green quarters: small authored details, batched by the city exporter. */
export function decorateCivic(id, api) {
  const { box, bead, cylinder, beam, tracked, wood, cream, teal, leaf } = api;
  const brass = '#c7a35f', clay = '#b77d5d', darkClay = '#825c45';

  // Low polygon petals and scored tiles read clearly from the walking camera.
  function rosette(x, y, z, radius, color = brass) {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      bead(color, x + Math.cos(a) * radius * .62, y + Math.sin(a) * radius * .62, z, radius * .38, radius * .38, .035);
    }
    bead(cream, x, y, z + .025, radius * .25, radius * .25, .045);
  }
  function wateringBowl(x, y, z, scale = 1) {
    cylinder(clay, x, y + .12 * scale, z, .3 * scale, .24 * scale, .39 * scale);
    cylinder('#78aaa3', x, y + .245 * scale, z, .33 * scale, .025 * scale);
    for (const side of [-1, 1]) {
      box(clay, x + side * .36 * scale, y + .2 * scale, z, .12 * scale, .1 * scale, .18 * scale);
    }
  }
  function seedling(x, y, z, color = leaf, height = .5) {
    box('#759063', x, y + height * .48, z, .025, height, .025);
    for (let i = 0; i < 3; i++) {
      const side = i % 2 ? -1 : 1;
      bead(color, x + side * .12, y + height * (.35 + i * .22), z + i * .035, .17, .045, .1);
    }
  }

  if (id === 'fountain') {
    tracked(function fountainStonework() {
      // The complete composition remains inside the existing 7 × 7 basin footprint.
      for (let i = 0; i < 20; i++) {
        const a = i * Math.PI / 10, x = Math.sin(a) * 3.36, z = -5 + Math.cos(a) * 3.36;
        cylinder(i % 2 ? '#b69c73' : '#dfc59b', x, .32, z, .12, .15);
        bead(i % 2 ? cream : teal, x, .77, z, .1, .15, .1);
      }
      for (const side of [-1, 1]) {
        const x = side * 2.45;
        box(cream, x, 1.4, -5, .5, .45, .52);
        bead(brass, x, 1.61, -4.81, .19, .18, .12);
        cylinder(brass, x, 1.5, -4.7, .12, .12);
        for (let drop = 0; drop < 4; drop++) {
          bead('#bddcd2', x, 1.45 - drop * .065, -4.57 + drop * .11, .055, .075, .065);
        }
      }
      // Floating leaves, tiny flowers and ripples give the still water a distinct surface.
      for (const [x, z, hue] of [[-1.6, -6.1, '#e2b3a9'], [.8, -6.8, '#f1d28e'], [1.55, -3.6, '#d6a2b8']]) {
        cylinder('#789b79', x, 1.175, z, .29, .025);
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          bead(hue, x + Math.cos(a) * .09, 1.22, z + Math.sin(a) * .09, .08, .045, .07);
        }
        bead(brass, x, 1.25, z, .045, .025, .045);
      }
      for (const x of [-.6, 0, .6]) box('#c4e0d3', x, 1.185, -3.1 + x * .16, .38, .015, .045);
    })();
    for (const x of [-9, 9]) tracked(function fountainBenchCloth() {
      // Cushions sit on existing seats, never introduce a new ground obstacle.
      box(x < 0 ? '#b28372' : '#73958c', x - .55, .64, 5, .7, .1, .48);
      for (let stripe = 0; stripe < 4; stripe++) box(cream, x - .8 + stripe * .17, .7, 5, .035, .02, .42);
      wateringBowl(x + .65, .61, 5, .55);
    })();
  }

  if (id === 'garden') {
    // All tall stems are contained by existing raised-bed collision footprints.
    for (const x of [-10, -6, 6, 10]) {
      tracked(function vegetableBedDetail() {
        for (let z = -10; z <= -2; z += 4) {
          const kind = (Math.abs(x) + z + 20) % 3;
          for (const dx of [-.7, 0, .7]) {
            if (kind === 0) {
              bead('#bd9c52', x + dx, .42, z + .65, .25, .15, .2);
              for (const side of [-1, 1]) bead('#8c9a55', x + dx + side * .18, .52, z + .65, .22, .04, .1);
              box(wood, x + dx, .63, z + .65, .035, .18, .035);
            } else if (kind === 1) {
              seedling(x + dx, .32, z + .6, '#8ca675', .58);
              bead('#997b78', x + dx + .12, .58, z + .6, .075, .08, .075);
              bead('#a58a7b', x + dx - .1, .74, z + .6, .065, .07, .065);
            } else {
              for (let stalk = 0; stalk < 3; stalk++) {
                const px = x + dx + (stalk - 1) * .1;
                beam('#bcac70', px, .7, z + .6, .025, .65, .025, (stalk - 1) * .12);
                bead('#d3bb75', px, 1.02, z + .6, .065, .19, .055);
              }
            }
          }
          // A pegged plant marker and twine tie distinguish each bed.
          box(wood, x + .93, .7, z - .9, .05, .7, .05);
          box(cream, x + .93, .94, z - .9, .36, .22, .06);
          box(teal, x + .93, .95, z - .86, .2, .035, .015);
        }
      })();
    }
    tracked(function irrigationSluice() {
      // Ground-level ribs cross the existing water strip; their top is below a walking step.
      for (let z = -13; z <= -7; z += 2) {
        box('#bbac89', 0, .065, z, 1.18, .11, .13);
        box('#a9cec1', 0, .075, z + .38, .62, .025, .06);
      }
      for (const side of [-1, 1]) box('#b29b75', side * .58, .05, -10, .12, .1, 8);
    })();
  }

  if (id === 'gardens') {
    for (let tier = 0; tier < 3; tier++) tracked(function terraceHangingPlants() {
      const width = 18 - tier * 5, depth = 12 - tier * 3, y = 1.5 + tier * 1.5, front = -6 + depth / 2;
      for (let j = 0; j < 5; j++) {
        const x = -width / 2 + 1.2 + j * (width - 2.4) / 4;
        box('#a5b48c', x, y + .04, front - .15, .45, .12, .3);
        const length = 3 + (j + tier) % 3;
        for (let k = 0; k < length; k++) {
          const px = x + Math.sin(k * 1.8) * .12;
          bead(k % 2 ? '#71936c' : '#8ca77b', px, y - .14 - k * .18, front + .055, .17, .16, .08);
          if ((j + k) % 3 === 0) bead(tier % 2 ? '#d7aa8d' : '#cfb4c5', px + .1, y - .1 - k * .18, front + .12, .07, .07, .04);
        }
      }
      // Small inset patterned panels connect the levels without occupying paths.
      for (const side of [-1, 1]) {
        const x = side * (width / 2 - .7);
        box('#cbb287', x, y - .7, front + .025, .85, .65, .04);
        rosette(x, y - .7, front + .055, .2, teal);
      }
    })();
    tracked(function upperGardenNursery() {
      // On the top terrace, behind its existing plants and central water channel.
      for (const x of [-1.6, 1.5]) {
        cylinder(clay, x, 4.65, -7.1, .3, .3, .4);
        cylinder('#756447', x, 4.81, -7.1, .34, .02);
        seedling(x, 4.8, -7.1, '#90a46f', .65);
        for (let i = 0; i < 4; i++) bead('#d6b267', x + Math.sin(i * 2) * .2, 5.28, -7.1 + Math.cos(i * 2) * .15, .085, .06, .07);
      }
    })();
  }

  if (id === 'palace') {
    tracked(function palaceDoorAndReliefs() {
      // Thin appliqué stays against the existing palace facade; no extra footprint.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          box('#b69457', side * .43, .48 + i * .55, -3.36, .65, .08, .08);
          bead(brass, side * .21, 1.07, -3.27, .07, .1, .035);
        }
        const x = side * 6;
        box('#c2ac84', x, 1.7, -3.4, 2.8, 1.45, .12);
        bead(brass, x, 1.82, -3.29, .73, .25, .07);
        bead(brass, x + side * .66, 2.06, -3.26, .27, .28, .08);
        bead('#e0c688', x + side * .87, 2.02, -3.22, .13, .12, .06);
        for (const leg of [-.48, .45]) box(brass, x + leg, 1.46, -3.29, .12, .4, .08);
        beam(brass, x - side * .8, 1.86, -3.29, .1, .58, .07, side * -.55);
        bead(darkClay, x + side * .71, 2.14, -3.17, .028, .028, .02);
        for (const dx of [-.94, .94]) rosette(x + dx, 1.2, -3.28, .12, teal);
      }
      for (let i = 0; i < 9; i++) {
        const x = -7.2 + i * 1.8;
        rosette(x, 6.1, -3.37, .2, i % 2 ? brass : teal);
        box('#cbb58c', x, 5.74, -3.42, 1.2, .045, .05);
      }
    })();
    for (const x of [-8, -4, 4, 8]) tracked(function palaceColumnFoot() {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        bead(i % 2 ? '#dec690' : '#8caba0', x + Math.sin(a) * .57, .4, Math.cos(a) * .57, .08, .12, .08);
      }
      cylinder('#e8d3a6', x, .65, 0, .47, .08);
    })();
  }
}
