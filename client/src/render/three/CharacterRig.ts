import { Group } from 'three';
import type { SceneAssets } from './SceneAssets';
import { footTarget, legAngles } from './CharacterMotion';

export interface CharacterRig {
  readonly root: Group;
  pose(phase: number, weight: number, elapsed: number, turn: number): void;
}

/** Original Babylonian traveller. All attachments share their parent's joint transform. */
export function createCharacter(assets: SceneAssets, color: string, market: boolean, seed: number): CharacterRig {
  const root = new Group(); root.name = 'character-rig';
  const torso = new Group(); torso.name = 'torso'; torso.position.y = .85; root.add(torso);
  const skin = market ? '#c9926d' : '#e4b78d';
  const cloth = market ? '#eee0bd' : '#ebcf9d';
  const accent = '#d7ad58';
  const add = (parent: Group, shape: Parameters<SceneAssets['mesh']>[0], tint: string, position: readonly number[], scale: readonly number[]) => {
    const mesh = assets.mesh(shape, tint); mesh.position.set(position[0]!, position[1]!, position[2]!); mesh.scale.set(scale[0]!, scale[1]!, scale[2]!); parent.add(mesh); return mesh;
  };
  // Continuous tapered tunic; no flat shawl intersecting the chest.
  add(torso, 'robe', color, [0,.23,0], [.9,.68,.72]);
  add(torso, 'cylinder', accent, [0,.18,0], [.34,.065,.28]);
  add(torso, 'roundedBox', accent, [0,.18,.294], [.12,.10,.045]);
  add(torso, 'sphere', skin, [0,.66,0], [.115,.17,.11]);
  const head = new Group(); head.name = 'head'; head.position.y = .91; torso.add(head);
  add(head, 'sphere', skin, [0,0,0], [.31,.35,.29]);
  for (const side of [-1,1]) {
    add(head, 'sphere', skin, [side*.302,-.015,0], [.055,.09,.06]);
    add(head, 'sphere', '#392b25', [side*.108,.025,.269], [.027,.037,.018]);
    const brow = add(head, 'roundedBox', '#5d4030', [side*.108,.105,.271], [.065,.014,.025]); brow.rotation.z = side*.10;
  }
  add(head, 'sphere', skin, [0,-.045,.287], [.052,.064,.054]);
  add(head, 'sphere', '#a4664d', [0,-.145,.263], [.055,.014,.012]);
  // Rounded cap plus rear drape, contained outside the back of the head.
  add(head, 'sphere', cloth, [0,.20,-.035], [.33,.19,.30]);
  add(head, 'roundedBox', cloth, [0,-.10,-.24], [.51,.52,.16]);
  add(head, 'cylinder', accent, [0,.205,-.035], [.34,.045,.312]);
  const arms = [-1,1].map(side => {
    const shoulder = new Group(); shoulder.name = side < 0 ? 'shoulder-left' : 'shoulder-right'; shoulder.position.set(side*.3,.48,0); torso.add(shoulder);
    add(shoulder, 'sphere', color, [side*.025,-.015,0], [.14,.15,.14]);
    add(shoulder, 'capsule', color, [0,-.15,0], [.39,.31,.39]);
    const elbow = new Group(); elbow.name = 'elbow'; elbow.position.y = -.3; shoulder.add(elbow);
    add(elbow, 'capsule', skin, [0,-.12,0], [.25,.25,.25]);
    add(elbow, 'sphere', skin, [0,-.265,0], [.083,.10,.075]);
    shoulder.rotation.z = side*.10;
    return { shoulder, elbow, side };
  });
  const legs = [-1,1].map(side => {
    const hip = new Group(); hip.name = side < 0 ? 'hip-left' : 'hip-right'; hip.position.set(side*.145,.85,0); root.add(hip);
    add(hip, 'capsule', cloth, [0,-.19,0], [.34,.36,.34]);
    const knee = new Group(); knee.name = 'knee'; knee.position.y = -.38; hip.add(knee);
    add(knee, 'capsule', skin, [0,-.19,0], [.26,.35,.26]);
    const ankle = new Group(); ankle.name = 'ankle'; ankle.position.y = -.38; knee.add(ankle);
    add(ankle, 'sphere', '#6d4c34', [0,-.025,.065], [.105,.075,.19]);
    add(ankle, 'roundedBox', accent, [0,.025,.09], [.20,.045,.075]);
    return { hip, knee, ankle, side };
  });
  return {
    root,
    pose: (phase, weight, elapsed, turn) => {
      const breath = Math.sin(elapsed*1.8+seed)*.008*(1-weight);
      torso.position.y = .85 - weight*.06 + breath;
      torso.rotation.x = weight*.035;
      torso.rotation.z = Math.sin(phase)*weight*.025 - Math.max(-.07,Math.min(.07,turn*.035));
      head.rotation.y = Math.sin(elapsed*.7+seed)*.035*(1-weight);
      for (const { shoulder, elbow, side } of arms) {
        shoulder.rotation.x = Math.sin(phase+(side<0?0:Math.PI))*.42*weight;
        shoulder.rotation.z = side*(.10+Math.sin(elapsed*1.8+seed)*.012*(1-weight));
        elbow.rotation.x = -.12 - weight*.20;
      }
      for (const { hip, knee, ankle, side } of legs) {
        const foot = footTarget(phase+(side<0?0:Math.PI),weight);
        hip.position.y = .85 - weight*.06;
        const angles = legAngles(foot.forward,.75-weight*.06-foot.lift);
        hip.rotation.x = angles.hip; knee.rotation.x = angles.knee; ankle.rotation.x = angles.ankle;
      }
    },
  };
}
