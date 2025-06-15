import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, RenderPass } from "postprocessing";
import { useControls } from "leva";
import { DataMoshManager } from "./data-mosh-stuff/DataMoshManager";
import { BlendFunction } from "postprocessing";

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
  const [buttonPressed, setButtonPressed] = useState(false);

  const dataMoshManager = useRef<DataMoshManager | null>(null);

  // Controls
  const {
    fadeDuration,
  } = useControls("🎥 Trail Effect", {
    fadeDuration: {
      value: 370,
      min: 1,
      max: 2000,
      step: 1,
      label: "Fade Duration (ms)",
    },
  });

  // Corruption controls
  const {
    enableDataCorruption,
    corruptionChunkCount,
    corruptionStrength,
    corruptionSpeed,
    corruptionSets,
  } = useControls("💥 Data Corruption", {
    enableDataCorruption: {
      value: true,
      label: "Enable Data Corruption",
    },
    corruptionChunkCount: {
      value: 5,
      min: 1,
      max: 200,
      step: 1,
      label: "Corruption Areas",
    },
    corruptionStrength: {
      value: 1.1,
      min: 0.0,
      max: 2.0,
      step: 0.1,
      label: "Intensity",
    },
    corruptionSpeed: {
      value: 200.0,
      min: 1.0,
      max: 1000.0,
      step: 1.0,
      label: "Animation Speed",
    },
    corruptionSets: {
      value: 30.0,
      min: 1.0,
      max: 150.0,
      step: 1.0,
      label: "Pattern Variety",
    },
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
        effectEnabled: true,
        resolutionScale: 0.5,
        blendFunction: BlendFunction.NORMAL,
        buttonPressed: buttonPressed,
        lastButtonReleaseTime: lastButtonReleaseTime,
        debugMode: false,
        corruptionChunkCount: enableDataCorruption ? corruptionChunkCount : 0,
        corruptionStrength: enableDataCorruption ? corruptionStrength : 0.0,
        corruptionSpeed: corruptionSpeed,
        corruptionSets: corruptionSets,
      });
    }
  }, [
    fadeDuration,
    buttonPressed,
    lastButtonReleaseTime,
    enableDataCorruption,
    corruptionChunkCount,
    corruptionStrength,
    corruptionSpeed,
    corruptionSets,
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
      effectEnabled: true,
      resolutionScale: 0.5,
      blendFunction: BlendFunction.NORMAL,
      camera: camera,
      debugMode: false,
      corruptionChunkCount: enableDataCorruption ? corruptionChunkCount : 0,
      corruptionStrength: enableDataCorruption ? corruptionStrength : 0.0,
      corruptionSpeed: corruptionSpeed,
      corruptionSets: corruptionSets,
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
    fadeDuration,
    gl,
    enableDataCorruption,
    corruptionChunkCount,
    corruptionStrength,
    corruptionSpeed,
    corruptionSets,
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

    // Process frames using the DataMoshManager with current time
    if (dataMoshManager.current) {
      dataMoshManager.current.processFrames(performance.now());
    }
  }, 1);

  return null;
};
