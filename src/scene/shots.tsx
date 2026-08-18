import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useEnvironment, useFBX } from "@react-three/drei";
import { SkeletonUtils, mergeVertices } from "three-stdlib";
import { sceneCut } from "@/state/scene-cut";
import { shot, Shot } from "@/state/shot";
import { createCheckerTexture } from "./checker-texture";

/**
 * The sky, used both as the room's backdrop and as the scene's lighting.
 *
 * 1k rather than 2k: 1.1 MB instead of 4.4, and nothing in this demo can tell
 * the difference. The lighting comes off a prefiltered version that throws away
 * far more detail than the difference between the two resolutions anyway, and
 * the background is seen through doorways on a picture rendered at 720p and
 * then deliberately degraded.
 */
const HDRI = "/hdri/kloppenheim-puresky-1k.hdr";

/**
 * How far out of focus the sky is behind the room.
 *
 * Cheap lenses on small sensors do not resolve a sky, and a sharp horizon
 * through a doorway is the one thing that reads as "render" in this shot. Costs
 * nothing: it selects a coarser level of the prefiltered environment that has
 * already been computed for the lighting.
 *
 * Two amounts, because the sky is doing two different jobs. Behind the room it
 * is seen through doorways and is the only thing in those holes, so it is kept
 * barely defocused: past about a fifth the cloud structure goes entirely and
 * the openings become flat white panels, which is worse than a sharp sky for
 * this effect - a smear needs edges to drag, and a constant value gives it
 * none. Behind the dancers it is a backdrop and nothing else, with columns and
 * seven figures in front of it supplying all the edges the mosh needs, so it
 * can go properly soft.
 */
const SKY_BLUR = 0.12;
const LIMBO_SKY_BLUR = 0.45;

/**
 * Backdrop and shot director.
 *
 * Two jobs, both of which have to be in the same place. It owns the sky texture,
 * because the background is per shot and drei's `Environment` would insist on
 * being the one to set it; and it is the *only* subscriber to `scene-cut`, from
 * where it advances the shot. Everything else in the scene subscribes to the
 * shot instead, which removes the question of which handler runs first.
 *
 * The sky stays as `scene.environment` in every shot even when it is not the
 * background. It is what lights the dancer, and a figure lit by a sky reads as
 * a figure; the same figure lit only by the point light reads as a cutout, and
 * a cutout gives the mosh nothing to smear but its own outline.
 */
export const ShotStage = () => {
  const scene = useThree((state) => state.scene);
  const environment = useEnvironment({ files: HDRI });

  useEffect(() => {
    scene.environment = environment;

    return () => {
      scene.environment = null;
      scene.backgroundBlurriness = 0;
    };
  }, [scene, environment]);

  useEffect(() => {
    // The sky is the backdrop of both shots now, defocused by different amounts
    // rather than replaced by a flat colour in one of them. It costs nothing -
    // the blur reads a coarser level of the environment map that has already
    // been prefiltered for the lighting - and a soft sky behind the dancers
    // still gives the effect a gradient to work on where a flat fill gave it a
    // single value.
    const apply = (current: Shot) => {
      scene.background = environment;
      scene.backgroundBlurriness =
        current === "room" ? SKY_BLUR : LIMBO_SKY_BLUR;
    };

    apply(shot.current);
    return shot.subscribe(apply);
  }, [scene, environment]);

  useEffect(() => sceneCut.subscribe(() => shot.advance()), []);

  return null;
};

/**
 * Renders its children only in the shots listed.
 *
 * Works on lights as well as on geometry: the renderer stops descending at an
 * invisible group, so a light inside one is left out of the frame's light list
 * entirely rather than merely contributing nothing.
 */
export const OnlyIn = ({
  shots,
  children,
}: {
  shots: readonly Shot[];
  children: React.ReactNode;
}) => {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const apply = (current: Shot) => {
      const group = groupRef.current;
      if (group !== null) group.visible = shots.includes(current);
    };

    apply(shot.current);
    return shot.subscribe(apply);
  }, [shots]);

  return (
    <group ref={groupRef} visible={shots.includes(shot.current)}>
      {children}
    </group>
  );
};

/** Height, in world units, the model is normalised to. */
const DANCER_HEIGHT = 1.75;

/**
 * Where the seven of them stand: x and z, the lead in front and three falling
 * back on each side.
 *
 * A shallow V rather than a straight line, for two reasons. A straight rank
 * seven wide does not fit a lens this close without pushing the camera so far
 * back that the shot stops being about the figures; staggering them backwards
 * lets perspective do the fitting. And it puts nearly two metres of depth in a
 * shot that otherwise had almost none, which is what the effect reads to tell a
 * near arm from a far one - the reason this shot uses a close lens in the first
 * place.
 */
const DANCER_PLACES: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1.1, -0.6],
  [1.1, -0.6],
  [-2.2, -1.2],
  [2.2, -1.2],
  [-3.3, -1.8],
  [3.3, -1.8],
];

/**
 * Columns standing well behind the line, and the only other thing in the shot.
 *
 * Not decoration. A flat backdrop gives the effect one silhouette to work on
 * and nothing else: everything outside the figures is a single value, and a
 * single value has no edges for the macroblocks to catch on, so the melt tears
 * the dancers and leaves the rest of the frame perfectly clean. Vertical
 * uprights at a fixed distance cut the red into bands, put hard edges where the
 * dancers cross them, and give the depth buffer a third plane between the
 * troupe and infinity.
 *
 * Spaced so they land between the figures rather than behind them, except for
 * the middle one, which stands behind the lead.
 */
const COLUMN_X: readonly number[] = [-6.8, -3.4, 0, 3.4, 6.8];
const COLUMN_Z = -5.5;
const COLUMN_RADIUS = 0.35;

/**
 * Long enough to leave the frame at both ends, and centred so it does.
 *
 * At this distance the shot sees roughly nine units of height, so a column that
 * merely stood on y = 0 stopped in mid-air halfway down the picture and read as
 * a cut-off prop. Running it past both edges is what makes it a column.
 */
const COLUMN_HEIGHT = 16;
const COLUMN_CENTRE_Y = 4;

/** Edge of the floor, and how many world units a single square covers. */
const FLOOR_SIZE = 500;
const FLOOR_SQUARE = 1.2;

/**
 * The two tones of the checker.
 *
 * Held well inside the clipping point at the light end. The shot is lit by an
 * outdoor sky with no tone mapping, and a floor that fills the bottom half of
 * the frame is the last thing that can afford to blow out: once it clips it
 * stops being a checker at all near the camera, where the squares are largest
 * and the pattern is doing the most work.
 */
const FLOOR_LIGHT = "#b0aca4";
const FLOOR_DARK = "#3a3b40";

/**
 * Strips the horizontal travel out of a clip, leaving it dancing on the spot.
 *
 * A capture exported with root motion carries the performer's real translation
 * across the floor in the root bone's position track, and over a few seconds of
 * choreography that is metres - enough to walk clean out of the shot. Only x
 * and z are pinned, to the value they hold on the first keyframe: y is the
 * vertical bob, and taking that out would leave the figure gliding.
 *
 * The clip is cloned rather than edited in place because `useFBX` hands out a
 * cached object, and the clips hanging off it are shared with anything else
 * that ever loads the same file.
 */
const pinInPlace = (clips: THREE.AnimationClip[]): THREE.AnimationClip[] =>
  clips.map((source) => {
    const clip = source.clone();

    // Only the root carries travel; every other bone's position, if it is
    // animated at all, is a local offset that has to be left alone.
    const root =
      clip.tracks.find((track) => /hips\.position$/i.test(track.name)) ??
      clip.tracks.find((track) => track.name.endsWith(".position"));

    if (root !== undefined) {
      const values = root.values;
      for (let i = 0; i < values.length; i += 3) {
        values[i] = values[0];
        values[i + 2] = values[2];
      }
    }

    return clip;
  });

/**
 * The dancer: the whole of the middle shot, and nothing else.
 *
 * It belongs to the limbo shot alone. Standing it in the room as well would
 * have made it the one thing the cut does *not* change, and a subject that
 * survives the cut is a subject the effect cannot do anything interesting to -
 * the melt lives on the two shots disagreeing, so the figure has to arrive with
 * the cut and leave with it.
 *
 * The model arrives in whatever units the exporter used and with its origin
 * wherever the rig's root happened to be, so it is measured on load and
 * rescaled to a known height with its feet on y = 0, instead of relying on the
 * usual 0.01 guess for a file authored in centimetres.
 */
export const Dancer = () => {
  const groupRef = useRef<THREE.Group>(null);
  const fbx = useFBX("/models/thriller.fbx");
  const clips = useMemo(() => pinInPlace(fbx.animations), [fbx]);

  // A near-black figure against a mid grey backdrop: the hardest luma step the
  // frame can hold, which is exactly what the macroblocks tear along.
  //
  // `envMapIntensity` is the load-bearing setting. The scene is lit by an
  // outdoor sky and rendered without tone mapping, so its irradiance runs
  // several times over white - left at 1 it washes a 7% albedo up past 200 and
  // there is no silhouette left at all.
  //
  // The sky is now the *only* thing lighting this shot, the point light having
  // been taken out of it: a point light falls off with distance, so it lit the
  // lead dancer visibly harder than the ones at the ends of the line. An
  // environment is infinitely far away and lights all seven identically, which
  // is the whole reason the shot is left to it.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1c1c22",
        roughness: 0.6,
        metalness: 0,
        envMapIntensity: 0.9,
      }),
    [],
  );

  // Pale enough to separate from the near-black figures in front of them, dark
  // enough not to clip: at this albedo the lit side lands around 0.7 of full
  // scale, so the columns keep three distinguishable faces instead of becoming
  // one white shape.
  const columnMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#b8ada0",
        roughness: 0.8,
        metalness: 0,
        envMapIntensity: 0.25,
      }),
    [],
  );

  const columnGeometry = useMemo(
    // Twelve sided rather than smooth: flat facets give the macroblocks a set
    // of constant-value patches to lift, which is what makes them legible.
    () =>
      new THREE.CylinderGeometry(
        COLUMN_RADIUS,
        COLUMN_RADIUS,
        COLUMN_HEIGHT,
        12,
      ),
    [],
  );

  const maxAnisotropy = useThree(
    (state) => state.gl.capabilities.getMaxAnisotropy(),
  );

  const floor = useMemo(() => {
    const map = createCheckerTexture({
      light: FLOOR_LIGHT,
      dark: FLOOR_DARK,
      repeat: FLOOR_SIZE / (FLOOR_SQUARE * 2),
      anisotropy: Math.min(8, maxAnisotropy),
    });

    return {
      map,
      geometry: new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
      material: new THREE.MeshStandardMaterial({
        map,
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: 0.25,
      }),
    };
  }, [maxAnisotropy]);

  useEffect(() => {
    return () => {
      columnGeometry.dispose();
      columnMaterial.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      floor.map.dispose();
    };
  }, [columnGeometry, columnMaterial, floor]);

  const model = useMemo(() => {
    // `useFBX` caches the parsed object and hands out the same instance, so
    // this runs against something a previous mount may already have resized -
    // and in StrictMode it runs twice on the first mount alone. Measuring an
    // already normalised model yields a scale of 1, which is how a figure ends
    // up back at its authored size of about 170 units with the camera inside
    // it. Resetting first makes the whole block idempotent.
    fbx.scale.setScalar(1);
    fbx.position.set(0, 0, 0);
    fbx.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(fbx);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = size.y > 1e-4 ? DANCER_HEIGHT / size.y : 1;

    fbx.scale.setScalar(scale);
    fbx.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale,
    );

    fbx.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.material = material;
      // A rig whose bounding sphere was computed in bind pose culls itself the
      // moment a limb swings outside it.
      mesh.frustumCulled = false;

      // The exporter wrote every triangle out with three vertices of its own,
      // so the rig arrives with no index buffer and each vertex is skinned
      // three times over - 84,816 vertices for 28,272 triangles on the body
      // mesh alone, and every one of those invocations is sixteen fetches into
      // the bone texture. Across seven dancers that is a million vertex shader
      // runs per pass, doubled while the velocity pass is measuring.
      //
      // The uv attribute goes first because nothing samples it: the material
      // below carries no map of any kind, so `USE_UV` is never defined and the
      // vertex shader does not even declare it. Dropping it also stops it
      // acting as a discriminator in the weld.
      //
      // `mergeVertices` at 1e-6 joins only vertices that are bit-identical in
      // every remaining attribute, so the triangles it emits are the same
      // triangles in the same order - it just stops shading each of them three
      // times. `useFBX` hands out a cached object, hence the index guard: this
      // has to be idempotent across remounts and StrictMode's double call.
      if (mesh.geometry.index === null) {
        mesh.geometry.deleteAttribute("uv");
        const indexed = mergeVertices(mesh.geometry, 1e-6);
        mesh.geometry.dispose();
        mesh.geometry = indexed;
      }
    });

    return fbx;
  }, [fbx, material]);

  // No disposal of the material on unmount, deliberately. It is attached to the
  // meshes of an object that `useFBX` keeps in a module-level cache for the
  // lifetime of the page, so it outlives this component by design; releasing it
  // here would free the GPU program of a model that is still going to be drawn
  // the moment the component comes back - and in StrictMode that happens on the
  // very first mount.

  /**
   * One rig per place in the line, each with its own mixer.
   *
   * The clones have to come from `SkeletonUtils`: a plain `Object3D.clone` copies
   * the meshes but leaves every one of them bound to the *original* skeleton, so
   * seven dancers would move as one. And there has to be a mixer each, because a
   * clip addresses its tracks by bone name and a single mixer over all seven
   * would resolve every track to whichever copy it found first.
   *
   * The materials are shared by reference, which is what `SkeletonUtils` does
   * anyway: seven identical figures is the point, and one material means one
   * shader program.
   */
  const troupe = useMemo(() => {
    const clip = clips[0];

    return DANCER_PLACES.map((place) => {
      const rig = SkeletonUtils.clone(model);
      const mixer = new THREE.AnimationMixer(rig);

      if (clip !== undefined) {
        mixer
          .clipAction(clip)
          // Ping-pong, not repeat. The clip is a segment lifted out of a longer
          // routine, so its last pose has nothing to do with its first and
          // restarting from the top jumps. Playing it back the other way makes
          // the turn exact by construction: the frame before the reversal and
          // the frame after it are the same pose, so there is no seam to hide.
          //
          // It costs a sign flip in the motion field at each end, which is a
          // discontinuity in velocity but not in position - the only thing the
          // velocity pass measures - so the effect sees a change of direction
          // rather than a teleport.
          .setLoop(THREE.LoopPingPong, Infinity)
          .play();
      }

      return { rig, mixer, place };
    });
  }, [model, clips]);

  useEffect(() => {
    return () => {
      for (const dancer of troupe) {
        dancer.mixer.stopAllAction();
        dancer.mixer.uncacheRoot(dancer.rig);
      }
    };
  }, [troupe]);

  useEffect(() => {
    const apply = (current: Shot) => {
      const group = groupRef.current;
      if (group !== null) group.visible = current === "dancer";
    };

    apply(shot.current);
    return shot.subscribe(apply);
  }, []);

  useFrame((_, delta) => {
    // Nothing to advance while the shot is off screen, and freezing the rigs
    // there is harmless: the velocity pass re-records the bone matrices every
    // frame regardless, so the poses it compares are still consecutive when the
    // cut brings the shot back.
    if (groupRef.current?.visible !== true) return;

    for (const dancer of troupe) {
      dancer.mixer.update(delta);
    }
  });

  return (
    <group ref={groupRef} visible={shot.current === "dancer"}>
      {/*
        The floor the whole shot stands on. It runs to the camera's far plane
        so its edge falls on the horizon rather than showing as a line of sky
        across the middle of the frame, and it hides the length of column that
        continues below y = 0.
      */}
      <mesh
        geometry={floor.geometry}
        material={floor.material}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {COLUMN_X.map((x) => (
        <mesh
          key={x}
          geometry={columnGeometry}
          material={columnMaterial}
          position={[x, COLUMN_CENTRE_Y, COLUMN_Z]}
        />
      ))}

      {troupe.map(({ rig, place }, index) => (
        <group key={index} position={[place[0], 0, place[1]]}>
          <primitive object={rig} />
        </group>
      ))}
    </group>
  );
};
