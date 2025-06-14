import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, RenderPass } from "postprocessing";
import { useControls } from "leva";
import { BlendFunction } from "postprocessing";
import { DataMoshManager } from "./data-mosh-stuff/DataMoshManager";

/**
 * Component that manages all post-processing effects
 * Configures and applies various effects to the rendered scene
 */
export const DataMoshingPostProcessing = () => {
  const { gl } = useThree();

  // References
  const composerRef = useRef<EffectComposer>();
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const [camera, setCamera] = useState<THREE.Camera | null>(null);

  // Button pressed state
  const [lastButtonReleaseTime, setLastButtonReleaseTime] = useState(-1);
  const [buttonPressed, setButtonPressed] = useState(true);

  const dataMoshManager = useRef<DataMoshManager | null>(null);

  // Controls
  const {
    trailEnabled,
    fadeDuration,
    trailResolutionScale,
    trailBlendFunction,
    debugMode,
  } = useControls("Post Processing/Persistence", {
    trailEnabled: { value: true, label: "Enable Trail" },
    fadeDuration: {
      value: 370,
      min: 1,
      max: 2000,
      step: 1,
      label: "Fade Duration",
    },
    trailResolutionScale: {
      value: 0.5,
      min: 0.1,
      max: 1.0,
      step: 0.1,
      label: "Resolution Scale",
    },
    trailBlendFunction: {
      value: BlendFunction.NORMAL,
      options: {
        SKIP: BlendFunction.SKIP,
        ADD: BlendFunction.ADD,
      },
      label: "Blend Function",
    },
    debugMode: { value: true, label: "Debug Frames" },
  });

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setLastButtonReleaseTime(-1);
        setButtonPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setButtonPressed(false);
        setLastButtonReleaseTime(performance.now());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Initial state setup
    setTimeout(() => {
      setButtonPressed(false);
      setLastButtonReleaseTime(performance.now());
    }, 500);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (composerRef.current) {
        composerRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Update trail effect options
  useEffect(() => {
    if (dataMoshManager.current) {
      dataMoshManager.current.updateOptions({
        fadeDuration: fadeDuration,
        effectEnabled: trailEnabled,
        resolutionScale: trailResolutionScale,
        blendFunction: trailBlendFunction,
        buttonPressed: buttonPressed,
        lastButtonReleaseTime: lastButtonReleaseTime,
        debugMode: debugMode,
      });
    }
  }, [
    fadeDuration,
    trailEnabled,
    trailResolutionScale,
    trailBlendFunction,
    buttonPressed,
    lastButtonReleaseTime,
    debugMode,
  ]);

  // Setup effect composer and passes
  useEffect(() => {
    if (!scene || !camera || !composerRef.current) return;

    const composer = composerRef.current;
    composer.removeAllPasses();

    // Add render pass
    composer.addPass(new RenderPass(scene, camera));

    const options = {
      effectAmount: fadeDuration,
      effectEnabled: trailEnabled,
      resolutionScale: trailResolutionScale,
      blendFunction: trailBlendFunction,
      camera: camera,
      debugMode: debugMode,
    };

    dataMoshManager.current = new DataMoshManager(
      composer,
      gl,
      camera,
      options,
    );
  }, [
    scene,
    camera,
    trailEnabled,
    fadeDuration,
    trailResolutionScale,
    trailBlendFunction,
    gl,
    debugMode,
  ]);

  // Setup frame processing per tutti i tipi di frame
  useEffect(() => {
    return () => {
      dataMoshManager.current?.destroy();
    };
  }, []);

  // Render loop
  useFrame(({ gl, scene: currentScene, camera: currentCamera }) => {
    if (!composerRef.current) {
      composerRef.current = new EffectComposer(gl);
    }

    if (scene !== currentScene) setScene(currentScene);
    if (camera !== currentCamera) setCamera(currentCamera);

    if (composerRef.current) {
      composerRef.current.render();
    }
  }, 1);

  return null;
};
