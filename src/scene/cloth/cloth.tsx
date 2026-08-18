import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { shot, Shot } from "@/state/shot";
import { createCheckerTexture } from "../checker-texture";
import { clothSampleGlsl } from "./cloth-glsl";
import {
  CLOTH_EXTENT_KEY,
  CLOTH_POSITIONS_KEY,
  CLOTH_PREVIOUS_KEY,
  CLOTH_SIZE,
  ClothParams,
  ClothSimulation,
  supportsClothSimulation,
} from "./cloth-sim";

/** Size of the sheet in world units. */
const CLOTH_WIDTH = 3.2;
const CLOTH_HEIGHT = 2.2;

/**
 * A checkerboard wall standing behind the sheet.
 *
 * A cloth against an empty sky is one silhouette and nothing else: everything
 * outside it is a smooth gradient, and a smooth gradient gives the macroblocks
 * no edge to catch on, so the melt tears the cloth and leaves the rest of the
 * frame perfectly clean. A regular grid behind it is the opposite - every
 * square is an edge in both directions, and the moment the sheet's silhouette
 * moves across one the effect has something to lift.
 *
 * Cool blues, deliberately, against a warm sheet: the two are opposite in hue
 * as well as in value, so the boundary is a step in the chroma planes too - and
 * chroma is what a codec carries at reduced resolution, so it is what smears
 * furthest.
 */
const BACKDROP_LIGHT = "#6fb7d8";
const BACKDROP_DARK = "#123a52";
const BACKDROP_SIZE = 24;
const BACKDROP_SQUARE = 0.9;
const BACKDROP_Z = -3.2;

const DEFAULT_PARAMS: ClothParams = {
  gravity: 4.5,
  wind: 0.55,
  gustiness: 0.9,
  // Most of the wind is turbulent rather than uniform, which is what makes
  // ripples cross the sheet instead of the whole thing swelling as one piece.
  turbulence: 2.2,
  turbulenceScale: 1.35,
  stiffness: 1.4,
  // Soft bend: stiff bend constraints give sheet metal, and turbulence on sheet
  // metal is invisible. The folds have to be free to be small and many.
  bend: 0.18,
  damping: 0.985,
  // A gather solver propagates a correction by one particle per iteration, so
  // this is literally how far, in particles, the weight of the hem can be felt
  // up the sheet in one frame. At eight the bottom third simply stretched away
  // and hung below the frame. Sixteen 64x64 passes cost almost nothing, and it
  // is the cheapest fix available - the alternative is a long-range attachment
  // pass, which is a lot of machinery to avoid turning a dial.
  iterations: 16,
};

/**
 * A single sheet of cloth, hung from its top edge and moved by wind.
 *
 * The mesh is a plain plane whose vertices are thrown away in the vertex
 * shader: every one of them reads its world position out of the simulation's
 * float texture instead. Nothing about the shape exists on the CPU, which is
 * the point of solving it on the GPU - but it also means two things have to be
 * arranged by hand.
 *
 * Frustum culling is off, because three would test the plane's authored bounds
 * and cull a sheet that has billowed outside them.
 *
 * And the position textures are published on `userData` for the velocity pass,
 * which draws the scene a second time with its own material. That material
 * knows nothing about this one, so without them it would rasterise the flat
 * undisplaced plane and report a motion field belonging to a shape nobody can
 * see - exactly the failure the rigged dancer had before its bone matrices were
 * plumbed through.
 */
export const Cloth = () => {
  const gl = useThree((state) => state.gl);
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const simulation = useMemo(() => {
    if (!supportsClothSimulation(gl)) {
      console.warn(
        "[Cloth] No float colour buffer available, the cloth will not run.",
      );
      return null;
    }
    return new ClothSimulation(CLOTH_WIDTH, CLOTH_HEIGHT);
  }, [gl]);

  const uniforms = useMemo(
    () => ({
      uClothPositions: { value: null as THREE.Texture | null },
      uClothExtent: {
        value: new THREE.Vector2(CLOTH_WIDTH, CLOTH_HEIGHT),
      },
      uClothSize: { value: CLOTH_SIZE },
    }),
    [],
  );

  const material = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: "#c8462e",
      roughness: 0.72,
      metalness: 0,
      envMapIntensity: 0.45,
      // Both faces, and the lighting flipped for the back one: a sheet has no
      // inside, and a single-sided one disappears every time the wind turns it
      // over.
      side: THREE.DoubleSide,
    });

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform sampler2D uClothPositions;
           uniform vec2 uClothExtent;
           uniform float uClothSize;
           ${clothSampleGlsl}`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `vec2 clothUv = clothTexel(position);
           vec3 objectNormal = clothNormal(uClothPositions, clothUv);
           #ifdef USE_TANGENT
             vec3 objectTangent = vec3(tangent.xyz);
           #endif`,
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = clothPosition(uClothPositions, clothUv);`,
        );
    };

    return material;
  }, [uniforms]);

  const geometry = useMemo(
    () =>
      new THREE.PlaneGeometry(
        CLOTH_WIDTH,
        CLOTH_HEIGHT,
        CLOTH_SIZE - 1,
        CLOTH_SIZE - 1,
      ),
    [],
  );

  const maxAnisotropy = useThree((state) =>
    state.gl.capabilities.getMaxAnisotropy(),
  );

  const backdrop = useMemo(() => {
    const map = createCheckerTexture({
      light: BACKDROP_LIGHT,
      dark: BACKDROP_DARK,
      repeat: BACKDROP_SIZE / (BACKDROP_SQUARE * 2),
      anisotropy: Math.min(8, maxAnisotropy),
    });

    return {
      map,
      geometry: new THREE.PlaneGeometry(BACKDROP_SIZE, BACKDROP_SIZE),
      material: new THREE.MeshStandardMaterial({
        map,
        roughness: 0.9,
        metalness: 0,
        // Held down hard: the scene is lit by an outdoor sky with no tone
        // mapping, and a wall filling the frame is the last thing that can
        // afford to clip - once the light squares reach white the checker stops
        // being a checker.
        envMapIntensity: 0.2,
      }),
    };
  }, [maxAnisotropy]);

  useEffect(() => {
    return () => {
      simulation?.dispose();
      material.dispose();
      geometry.dispose();
      backdrop.geometry.dispose();
      backdrop.material.dispose();
      backdrop.map.dispose();
    };
  }, [simulation, material, geometry, backdrop]);

  useEffect(() => {
    if (simulation !== null) simulation.reset(gl);
  }, [simulation, gl]);

  useEffect(() => {
    const apply = (current: Shot) => {
      const group = groupRef.current;
      if (group !== null) group.visible = current === "cloth";
    };

    apply(shot.current);
    return shot.subscribe(apply);
  }, []);

  // Scratch for turning the pointer into a world position on the cloth's plane.
  const scratch = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      hit: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (simulation === null || group === null || mesh === null) return;
    if (!group.visible) return;

    scratch.raycaster.setFromCamera(state.pointer, state.camera);
    const pointer = scratch.raycaster.ray.intersectPlane(
      scratch.plane,
      scratch.hit,
    );

    // Clamped rather than passed through: a tab that was in the background
    // hands back a delta of several seconds, and a fixed-step solver given one
    // enormous frame is a solver that explodes.
    simulation.step(gl, Math.min(delta, 1 / 30), DEFAULT_PARAMS, pointer);

    uniforms.uClothPositions.value = simulation.positions;
    mesh.userData[CLOTH_POSITIONS_KEY] = simulation.positions;
    mesh.userData[CLOTH_PREVIOUS_KEY] = simulation.previousPositions;
  });

  return (
    <group ref={groupRef} visible={shot.current === "cloth"}>
      <mesh
        geometry={backdrop.geometry}
        material={backdrop.material}
        position={[0, 0, BACKDROP_Z]}
      />

      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        userData={{ [CLOTH_EXTENT_KEY]: [CLOTH_WIDTH, CLOTH_HEIGHT] }}
      />
    </group>
  );
};
