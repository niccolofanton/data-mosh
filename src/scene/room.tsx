import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { GLTF } from "three-stdlib";
import { SCENE_CENTRE, shot } from "@/state/shot";

/**
 * Baked room, exported with `npx gltfjsx@6.5.3 backroom.glb -T -R 2048 -f png -t`.
 *
 * Every mesh in the file sits at the same offset, so the offset lives on the
 * group and the meshes are a plain node -> material table. The generated
 * component listed all seven inline with the offset repeated on each one.
 */
const MODEL_URL = "/models/backroom-transformed.glb";
const MODEL_OFFSET: [number, number, number] = [-8.981, 4.681, -8.96];

const PARTS: readonly (readonly [node: string, material: string])[] = [
  ["ligths", "Material.058"],
  ["ligths001", "Material.059"],
  ["ligths003", "Material.060"],
  ["walls003_Baked", "walls.003_Baked"],
  ["roof_grid_Baked", "roof grid_Baked"],
  ["roof003_Baked", "roof.003_Baked"],
  ["floor004_Baked", "floor.004_Baked"],
];

type RoomGLTF = GLTF & {
  nodes: Record<string, THREE.Mesh>;
  materials: Record<string, THREE.Material>;
};

/**
 * The room, resized by a scene cut.
 *
 * Changing the scale of the room changes every wall, edge and light panel in
 * frame at once, which is a far bigger disagreement between the two shots than
 * a camera move alone can produce - and the melt lives on that disagreement.
 *
 * Two details matter. The scale is applied about the centre of the scene rather
 * than about the model's own origin, because the room's meshes sit at a large
 * offset inside the file and scaling from there would slide the whole room
 * sideways instead of resizing it around the viewer. And it is written straight
 * to the object with the world matrix refreshed on the spot: going through
 * React state would land a frame later, after the pipeline has already
 * re-captured the previous transforms, and every wall would register as one
 * huge motion vector.
 */
export const Room = () => {
  const groupRef = useRef<THREE.Group>(null);
  const { nodes, materials } = useGLTF(MODEL_URL) as RoomGLTF;

  useEffect(() => {
    if (groupRef.current !== null) {
      groupRef.current.visible = shot.current === "room";
    }

    return shot.subscribe((current) => {
      const group = groupRef.current;
      if (group === null) return;

      // The red and grey shots are limbos: the room is not dressed
      // differently in them, it is simply not there.
      group.visible = current === "room";
      if (current !== "room") return;

      // Deliberately narrow. The camera orbits the centre out to 2.8 units on a
      // cut, so shrinking the room much further would start putting walls
      // between it and the subject.
      const scale = 0.9 + Math.random() * 0.4;

      group.scale.setScalar(scale);
      group.position.copy(SCENE_CENTRE).multiplyScalar(1 - scale);
      group.updateMatrixWorld(true);
    });
  }, []);

  return (
    <group ref={groupRef}>
      <group position={MODEL_OFFSET} dispose={null}>
        {PARTS.map(([node, material]) => (
          <mesh
            key={node}
            geometry={nodes[node].geometry}
            material={materials[material]}
          />
        ))}
      </group>
    </group>
  );
};

useGLTF.preload(MODEL_URL);
