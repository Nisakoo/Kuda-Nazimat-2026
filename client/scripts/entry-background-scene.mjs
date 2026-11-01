import * as T from 'three';

// Original, offline-authored scenery. No UI, game transport, or remote resources.
export function entryBackground(kind, width = 1622, height = 970) {
  if (kind !== 'gates' && kind !== 'street') throw new Error('Unknown entry scenery');
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  const scene = new T.Scene(); scene.background = new T.Color('#f2c2ac'); scene.fog = new T.Fog('#efc8a5', 29, 65);
  const camera = new T.PerspectiveCamera(34, width / height, .1, 120);
  camera.position.set(0, 4.3, 15.5); camera.lookAt(0, 1.4, -3);
  scene.add(new T.HemisphereLight('#fff1dc', '#b7875a', 1.6));
  const sun = new T.DirectionalLight('#fff0d2', 3.5); sun.position.set(-12, 22, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 17, bottom: -15, near: 1, far: 70 });
  sun.shadow.normalBias = .025; sun.shadow.bias = -.0002; sun.shadow.radius = 3; scene.add(sun, sun.target);
  const materials = new Map(); const unit = new T.BoxGeometry(1, 1, 1);
  const material = color => { if (!materials.has(color)) materials.set(color, new T.MeshStandardMaterial({ color, roughness: 1, flatShading: true })); return materials.get(color); };
  function mesh(geometry, color, parent = scene) { const m = new T.Mesh(geometry, material(color)); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  function box(x, y, z, w, h, d, color, parent = scene) { const m = mesh(unit, color, parent); m.position.set(x, y, z); m.scale.set(w, h, d); return m; }
  function triangle(points, color, parent = scene) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3)); g.computeVertexNormals(); return mesh(g, color, parent); }
  function shade(x, z, sx, sz, opacity = .12) {
    const m = new T.Mesh(new T.CircleGeometry(1, 24), new T.MeshBasicMaterial({ color: '#62472f', transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, .032, z); m.scale.set(sx, sz, 1); scene.add(m);
  }
  // A true sky gradient, not a viewport overlay or painted control.
  const skyGeometry = new T.PlaneGeometry(160, 100); const skyColors = [];
  for (const y of [1, 1, 0, 0]) { const c = new T.Color(y ? '#efb6a5' : '#ffe0b8'); skyColors.push(c.r, c.g, c.b); }
  skyGeometry.setAttribute('color', new T.Float32BufferAttribute(skyColors, 3));
  const sky = new T.Mesh(skyGeometry, new T.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false })); sky.position.set(0, 20, -48); scene.add(sky);
  const tileGeometry = new T.BoxGeometry(1.46, .028, 1.46); const tileMaterial = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const tiles = new T.InstancedMesh(tileGeometry, tileMaterial, 26 * 26); const matrix = new T.Matrix4(); let index = 0;
  for (let z = -20; z < 19; z += 1.5) for (let x = -19.5; x < 19.5; x += 1.5) {
    matrix.makeTranslation(x, 0, z); tiles.setMatrixAt(index, matrix);
    tiles.setColorAt(index++, new T.Color(['#f4d5a5', '#ebc18c', '#f0cca0', '#e5b889'][(Math.round(x * 2 + z * 4) % 4 + 4) % 4]));
  }
  tiles.count = index; tiles.receiveShadow = true; scene.add(tiles);
  box(0, -.07, -1, 100, .1, 100, '#e2b783').castShadow = false;

  function frieze(x, y, z, w) {
    box(x, y, z, w, .48, .045, '#c79b48'); const n = Math.round(w / .62), cell = w / n;
    for (let i = 0; i < n; i++) { const a = x - w / 2 + i * cell; triangle([[a, y - .24, z + .026], [a + cell, y - .24, z + .026], [a + cell / 2, y + .24, z + .026]], i % 2 ? '#007579' : '#0b8d8a'); }
  }
  function house(x, z, w, h, d, trim = false) {
    box(x, h / 2, z, w, h, d, '#d6ab78'); box(x, h + .08, z, w + .24, .2, d + .24, '#e9c895');
    box(x, h - .1, z + d / 2 + .016, w, .13, .04, '#b68b5c');
    const front = z + d / 2; box(x + w * .22, h * .45, front + .022, .38, 1.4, .035, '#715743');
    box(x + w * .22 - .22, h * .45, front + .05, .08, 1.58, .12, '#e3bc88');
    box(x + w * .22, h * .45 + .76, front + .05, .5, .08, .12, '#e8c18e');
    if (trim) frieze(x, h - .65, front + .03, w);
  }
  function tower(x) {
    const z = -6, w = 2.55, d = 2.45, h = 7.5;
    box(x, h / 2, z, w, h, d, '#d3a36e'); box(x, 7.4, z, w + .28, .23, d + .28, '#e7c28c');
    for (let i = 0; i < 4; i++) box(x - .98 + i * .65, 7.88, z, .39, .8, d + .12, '#e3bd85');
    const front = z + d / 2; frieze(x, 6.8, front + .035, w);
    box(x, 6.46, z, w + .18, .16, d + .18, '#f0d2a0');
    box(x - .36, 3.5, front + .035, .45, 3.9, .045, '#68513f');
    box(x - .64, 3.5, front + .08, .1, 4.06, .16, '#e4b984');
    box(x - .36, 5.52, front + .08, .64, .12, .16, '#e8c18c');
  }
  if (kind === 'gates') {
    box(0, 2.4, -7.1, 36, 4.8, 1, '#d8ad78');
    for (let x = -17; x <= 17; x += .95) box(x, 5.05, -7.1, .55, .65, 1.1, '#dfb681');
    box(0, 2.55, -6.5, 5.7, 5.1, .1, '#5b4939');
    box(0, 5.7, -6.1, 7.2, 1.7, 1.7, '#d7aa74'); frieze(0, 6.15, -5.22, 7.1);
    box(0, 4.9, -5.17, 6.7, .33, .24, '#eccb98');
    box(-2.84, 2.4, -5.5, .45, 4.8, .8, '#e1b983'); box(2.84, 2.4, -5.5, .45, 4.8, .8, '#c79563');
    tower(-4.75); tower(4.75);
    house(-9.1, -8.1, 2.8, 6.5, 3.2); house(9.4, -8.2, 3.2, 6.2, 3.3);
    house(-12.6, -10, 2.4, 5.2, 3); house(13, -10, 3, 5.4, 3);
  } else {
    for (const [x,z,w,h,d] of [[-6,-9,4,5.2,4],[6,-10,4,5.8,4],[-7,-2,4.2,4.4,4],[7,-2.7,4,4.1,4],[-10,3,3,3.8,4],[10,2,3,4.1,4],[-11,-20,4,5.8,4],[-5,-24,4.2,6.7,4],[8,-21,4.3,6,4]]) house(x,z,w,h,d, z < -5);
    box(0, 1.9, -18, 24, 3.8, 1, '#dbb384'); frieze(0, 3.1, -17.47, 18);
    box(0, 1.6, -17.43, 3, 3.2, .08, '#8e6d50');
    box(-6.5, 5.42, -9, 2.1, .35, 2.4, '#bd775a');
    box(6.4, 6.02, -10, 1.8, .35, 2.1, '#bb7656');
  }

  function palm(x, z, scale = 1, lean = 0) {
    const group = new T.Group(); group.position.set(x, 0, z); group.scale.setScalar(scale); scene.add(group);
    for (let j = 0; j < 9; j++) { const t = j / 9; const trunk = mesh(new T.CylinderGeometry(.15 - t * .03, .185 - t * .025, .53, 7), j % 2 ? '#976536' : '#b17d40', group); trunk.position.set(lean * t * t, .27 + j * .52, 0); trunk.rotation.z = -lean * t * .1; }
    for (let j = 0; j < 8; j++) {
      const leaf = new T.Group(); leaf.position.set(lean, 4.72, 0); leaf.rotation.y = j * Math.PI / 4 + .12; group.add(leaf);
      const points = []; const length = 2.55 + (j % 3) * .13;
      for (let n = 0; n < 5; n++) { const t = n / 4, breadth = Math.sin(Math.PI * t) * .42, yy = .62 * Math.sin(t * Math.PI) - t * t * 1.12; points.push([-breadth, yy, t * length], [0, yy + .1 * Math.sin(Math.PI * t), t * length], [breadth, yy - .035, t * length]); }
      for (let n = 0; n < 4; n++) for (const side of [0,1]) { const a = n * 3 + side, b = (n + 1) * 3 + side; const g = new T.BufferGeometry().setFromPoints([points[a], points[b], points[a+1], points[a+1], points[b], points[b+1]].map(p => new T.Vector3(...p))); g.computeVertexNormals(); const m = mesh(g, ['#4e7431','#73903b','#8ca346'][(j + side) % 3], leaf); m.material.side = T.DoubleSide; }
    }
    shade(x, z, 1.4 * scale, .7 * scale, .08);
  }
  palm(-7.8, -.5, 1, .35); palm(8, -1, .9, -.25);
  if (kind === 'street') { palm(-3.9,-10,.82,.2); palm(4.1,-11,.85,-.2); }

  function crate(x, z, s = 1, yaw = 0) {
    const group = new T.Group(); group.position.set(x, 0, z); group.rotation.y = yaw; group.scale.setScalar(s); scene.add(group);
    box(0,.5,0,1.3,1,1.05,'#966333',group);
    for (const zz of [-.54,.54]) { for (const xx of [-.53,.53]) box(xx,.5,zz,.12,1.06,.07,'#b17b40',group); for (const y of [.07,.5,.93]) box(0,y,zz,1.35,.08,.08,'#bd884a',group); for (const xx of [-.21,.21]) box(xx,.5,zz,.018,.9,.015,'#694728',group); }
    for (const xx of [-.66,.66]) for (const y of [.08,.5,.92]) box(xx,y,0,.07,.07,1.1,'#b47f40',group);
    shade(x,z,.85*s,.6*s);
  }
  function jar(x, y, z, s = 1, color = '#bd7045') {
    const points = [[0,0],[.22,.015],[.34,.15],[.38,.43],[.31,.64],[.145,.87],[.145,1.02],[.19,1.04]].map(([r,h])=>new T.Vector2(r,h));
    const group = new T.Group(); group.position.set(x,y,z); group.scale.setScalar(s); scene.add(group);
    mesh(new T.LatheGeometry(points,9),color,group);
    const rim = mesh(new T.TorusGeometry(.169,.026,4,9),'#db935e',group); rim.rotation.x=Math.PI/2; rim.position.y=1.035;
    const opening=mesh(new T.CylinderGeometry(.14,.14,.015,9),'#653b2a',group);opening.position.y=1.025;
  }
  function stall(x,z,mirror=false) {
    const group=new T.Group(); group.position.set(x,0,z); if(mirror)group.rotation.y=-.13; else group.rotation.y=.1;scene.add(group);
    for(const xx of[-1.7,1.7])for(const zz of[-.75,.75])box(xx,1.35,zz,.085,2.7,.085,'#8f6334',group);
    for(let j=0;j<3;j++) { const left=-1.95+j*1.3,right=left+1.3,color=['#168e98','#f0b342','#e97847'][(j+(mirror?2:0))%3];
      const g=new T.BufferGeometry().setFromPoints([[left,2.76,-1],[left,2.22,1.15],[right,2.76,-1],[right,2.76,-1],[left,2.22,1.15],[right,2.22,1.15]].map(p=>new T.Vector3(...p)));g.computeVertexNormals();const m=mesh(g,color,group);m.material.side=T.DoubleSide;
      box((left+right)/2,2.04,1.14,1.3,.36,.045,color,group);
    }
    box(0,1.04,.14,3.45,.16,1.72,'#aa773f',group);
    for(const xx of[-1.45,1.45])box(xx,.5,.12,.12,1,.12,'#81582e',group);
    jar(x-1.02,1.14,z+.3,.7);jar(x+.18,1.14,z+.52,.52,'#c88250');jar(x+1.05,1.14,z+.1,.82,'#b4603c');
  }
  stall(-7.65,2);stall(7.8,1.4,true);
  crate(-5.8,3.9,.86,.14);jar(-5.82,.88,3.91,.75);
  crate(6.2,4.35,.83,-.1);jar(6.2,.86,4.35,.8);
  crate(-9.4,6,1.03,.18);jar(-9.35,1.06,6,.82);
  crate(9.4,5.8,1.04,-.22);jar(9.4,1.07,5.8,.82,'#ba6841');

  function resident(x,z,s=1,yaw=0,backpack=false) {
    const group=new T.Group();group.position.set(x,.03,z);group.scale.setScalar(s);group.rotation.y=yaw;scene.add(group);
    const skin='#e9af76',cloth=backpack?'#277f7c':'#12866e';
    for(const side of[-1,1]) { box(side*.105,.11,.045,.17,.18,.29,'#765035',group);mesh(new T.CylinderGeometry(.075,.07,.21,7),'#e8d0a5',group).position.set(side*.105,.29,0); }
    mesh(new T.CylinderGeometry(.205,.28,.42,8),cloth,group).position.y=.6;
    mesh(new T.CylinderGeometry(.25,.205,.35,8),cloth,group).position.y=.96;
    mesh(new T.CylinderGeometry(.224,.23,.055,8),'#b98d42',group).position.y=.795;
    for(const side of[-1,1]) { const arm=new T.Group();arm.position.set(side*.245,1.08,0);arm.rotation.z=side*.18;group.add(arm);mesh(new T.CylinderGeometry(.09,.1,.19,7),cloth,arm).position.y=-.09;mesh(new T.CylinderGeometry(.064,.07,.24,7),skin,arm).position.y=-.29;mesh(new T.IcosahedronGeometry(.08,1),skin,arm).position.y=-.43; }
    mesh(new T.CylinderGeometry(.065,.075,.1,7),skin,group).position.y=1.16;
    const outline=new T.Shape();outline.moveTo(-.20,-.24);for(const [xx,yy] of [[.20,-.24],[.24,-.20],[.24,.20],[.20,.24],[-.20,.24],[-.24,.20],[-.24,-.20],[-.20,-.24]])outline.lineTo(xx,yy);
    const headGeometry=new T.ExtrudeGeometry(outline,{depth:.38,steps:1,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:1});headGeometry.translate(0,0,-.19);
    const head=mesh(headGeometry,skin,group);head.scale.set(1.05,.72,1.06);head.position.y=1.37;
    if(backpack) {
      const hair=mesh(new T.SphereGeometry(.26,10,5,0,Math.PI*2,0,Math.PI*.58),'#ad8755',group);hair.position.y=1.42;
      const bagOutline=new T.Shape();bagOutline.moveTo(-.17,-.22);for(const [xx,yy]of[[.17,-.22],[.21,-.17],[.21,.16],[.17,.22],[-.17,.22],[-.21,.16],[-.21,-.17],[-.17,-.22]])bagOutline.lineTo(xx,yy);
      const bagGeometry=new T.ExtrudeGeometry(bagOutline,{depth:.12,steps:1,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:1});bagGeometry.translate(0,.94,-.31);mesh(bagGeometry,'#a97746',group);
      box(0,1.13,-.32,.43,.13,.08,'#b88455',group);box(0,1.025,-.365,.065,.10,.028,'#c49c4e',group);
      for(const side of[-1,1])box(side*.15,1.02,.18,.038,.38,.035,'#bb9158',group);
    }
    mesh(new T.CylinderGeometry(.29,.31,.07,10),'#ead7b2',group).position.y=1.605;mesh(new T.CylinderGeometry(.19,.26,.13,9),'#fff0ce',group).position.y=1.695;
    for(const side of[-1,1]) { const eye=mesh(new T.SphereGeometry(.026,7,5),'#453528',group);eye.position.set(side*.105,1.39,.247);eye.scale.set(1,1.25,.3); }
    box(0,1.32,.26,.055,.07,.055,'#e5a570',group);
    shade(x,z,.32*s,.2*s,.12);
  }
  resident(-3.75,-3.5,.76,.12);resident(3.85,-3.7,.75,-.2);resident(-5.1,3,.77,.13);resident(5.35,1.6,.78,-.28);
  function bush(x,z,s=1) {
    for(let j=0;j<7;j++) { const a=j*Math.PI*2/7,dx=Math.sin(a),dz=Math.cos(a),base=[x,.03,z],tip=[x+dx*.65*s,1.15*s,z+dz*.65*s],left=[x+dx*.35*s-dz*.22*s,.5*s,z+dz*.35*s+dx*.22*s],right=[x+dx*.35*s+dz*.22*s,.5*s,z+dz*.35*s-dx*.22*s];const m=triangle([base,left,tip,base,tip,right],j%2?'#7c963a':'#547a30');m.material.side=T.DoubleSide; }
  }
  bush(-3.5,7.5,1.3);bush(3.5,4.5,.85);
  for(let j=0;j<3;j++)box(9.4,.15+j*.15,4.4-j,4.5,.3+j*.3,1.4,'#e9c797');
  if(kind==='street') {
    resident(-2.7,5.8,1.08,Math.PI,true);
    box(.15,2.4,4.9,.8,4.8,.65,'#9f6435');
    const cap=mesh(new T.ConeGeometry(.57,.4,4),'#ab713d');cap.rotation.y=Math.PI/4;cap.position.set(.15,5,4.9);
  }
  renderer.render(scene,camera);
  function dispose() {
    const geometries=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))mats.add(m);});
    for(const g of geometries)g.dispose();for(const m of mats)m.dispose();sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();
  }
  return { renderer,scene,camera,dispose };
}
