import { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SCENE_CENTRE, Shot, shot } from "@/state/shot";

/**
 * The subject of the room shot: one emissive knot, turning in place.
 *
 * The colour is doing work here. The smear is only visible where there are
 * distinct colour values to stretch, so a saturated emissive surface against
 * the muted room reads far better than the room's own palette, and the thin
 * knot gives the macroblocks fine lines to tear.
 */
export const MorphingShape = () => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Built once, not per render, and owned here rather than by r3f (which only
  // disposes what it created itself), so it is released by hand on unmount.
  const geometry = useMemo(() => new THREE.TorusKnotGeometry(0.4, 0.15, 128, 32), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const show = (current: Shot) => {
      if (meshRef.current !== null) meshRef.current.visible = current === "room";
    };

    show(shot.current);
    return shot.subscribe(show);
  }, []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (mesh === null) return;

    // One `set` rather than two component writes. Each write to an Euler fires
    // Object3D's change callback, which runs `quaternion.setFromEuler` - six
    // trig calls - so writing x and y separately computed the quaternion twice
    // and threw the first result away. `set` assigns all three and fires once.
    const step = delta * 1.2;
    const rotation = mesh.rotation;
    rotation.set(rotation.x + step, rotation.y + step, rotation.z);
  });

  return (
    <mesh ref={meshRef} position={SCENE_CENTRE} geometry={geometry}>
      <meshStandardMaterial
        color="#0066ff"
        emissive="#0066ff"
        emissiveIntensity={0.3}
        roughness={0.35}
        metalness={0.1}
      />
    </mesh>
  );
};
