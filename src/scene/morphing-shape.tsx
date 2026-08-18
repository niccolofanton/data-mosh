import { useState, useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SCENE_CENTRE, Shot, shot } from "@/state/shot";

/**
 * The subject of the room shot: a solid that changes on every cut.
 *
 * The shape changes on a scene cut rather than on a timer. A morph that happens
 * on its own schedule is, for the effect, just one more thing moving in the
 * frame; a morph that happens *on the cut* is part of the edit, and the motion
 * vectors of the new shape get to drag the old one out of the picture.
 *
 * The neon variants exist because of what the effect feeds on: the smear is
 * only visible where there are distinct colour values to stretch, so saturated
 * emissive surfaces against the muted room read far better than the room's own
 * palette. Flat-faced solids give the macroblocks large uniform areas to slide
 * as tiles, and the thin knot gives them fine lines to tear.
 */
export const MorphingShape = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [variantIndex, setVariantIndex] = useState(0);

  // Built once, not per render: switching variant re-renders this component.
  const variants = useMemo(
    () => [
      {
        geometry: new THREE.TorusKnotGeometry(0.4, 0.15, 128, 32),
        color: "#0066ff",
        emissive: 0.3,
      },
      {
        geometry: new THREE.BoxGeometry(1, 1, 1),
        color: "#ff3300",
        emissive: 0.3,
      },
      {
        geometry: new THREE.TorusGeometry(0.5, 0.2, 24, 48),
        color: "#33cc33",
        emissive: 0.3,
      },
      {
        geometry: new THREE.IcosahedronGeometry(0.62, 0),
        color: "#ff00c8",
        emissive: 1.2,
      },
      {
        geometry: new THREE.TorusKnotGeometry(0.36, 0.1, 220, 24, 3, 5),
        color: "#00fff0",
        emissive: 1.2,
      },
      {
        geometry: new THREE.TetrahedronGeometry(0.85, 0),
        color: "#c6ff00",
        emissive: 1.2,
      },
    ],
    [],
  );

  // The geometries are owned here, not by r3f (which only disposes what it
  // created itself), so they have to be released by hand on unmount.
  useEffect(() => {
    return () => {
      for (const variant of variants) {
        variant.geometry.dispose();
      }
    };
  }, [variants]);

  useEffect(() => {
    const show = (current: Shot) => {
      if (meshRef.current !== null) meshRef.current.visible = current === "room";
    };

    show(shot.current);

    return shot.subscribe((current) => {
      show(current);

      // The other two shots replace the subject rather than dressing it, so
      // there is nothing to morph while they are up - and picking a variant the
      // viewer never sees would waste it.
      if (current !== "room") return;

      // Advance by a random amount that is never zero: cycling in order would
      // make the sequence predictable after two gestures, and landing on the
      // shape that is already on screen would waste a cut.
      setVariantIndex(
        (previous) =>
          (previous + 1 + Math.floor(Math.random() * (variants.length - 1))) %
          variants.length,
      );
    });
  }, [variants.length]);

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

  const variant = variants[variantIndex];

  return (
    <mesh ref={meshRef} position={SCENE_CENTRE} geometry={variant.geometry}>
      <meshStandardMaterial
        color={variant.color}
        emissive={variant.color}
        emissiveIntensity={variant.emissive}
        roughness={0.35}
        metalness={0.1}
      />
    </mesh>
  );
};
