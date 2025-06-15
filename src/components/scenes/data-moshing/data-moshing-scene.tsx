import { useState, useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Component for a shape that morphs between different geometries
 */
export const MorphingShape = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [morphState, setMorphState] = useState(0);

  // Create different geometries
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const torusKnotGeometry = new THREE.TorusKnotGeometry(0.4, 0.15, 16, 32);
  const torusGeometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32);

  // Rotate and morph the shape
  useFrame((state, delta) => {
    if (meshRef.current) {
      // Rotate the mesh
      meshRef.current.rotation.x += delta * 1.2;
      meshRef.current.rotation.y += delta * 1.2;

      // Change shape every 3 seconds
      // Change shape every 2 seconds
      if (
        Math.floor(state.clock.elapsedTime / 2) !==
        Math.floor((state.clock.elapsedTime - delta) / 2)
      ) {
        setMorphState((prev) => (prev + 1) % 3);
      }
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={[0, 1.5, 0]}>
        {morphState === 0 && (
          <primitive object={torusKnotGeometry} attach="geometry" />
        )}
        {morphState === 1 && (
          <primitive object={cubeGeometry} attach="geometry" />
        )}
        {morphState === 2 && (
          <primitive object={torusGeometry} attach="geometry" />
        )}
        <meshStandardMaterial
          color={
            morphState === 0
              ? "#0066ff"
              : morphState === 1
                ? "#ff3300"
                : "#33cc33"
          }
        />
      </mesh>
    </>
  );
};

/**
 * Camera controller component that handles camera rotation
 */

interface CameraControllerProps {
  autoRotate?: boolean;
}

export const CameraController = ({ autoRotate = false }: CameraControllerProps) => {
  const { camera } = useThree();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [touchPosition, setTouchPosition] = useState({ x: 0, y: 0 });
  const isMouseMoving = useRef(false);
  const isTouchMoving = useRef(false);
  const isMouseOnScreen = useRef(false);
  const lastMouseMoveTime = useRef(0);
  const mouseIdleTimeout = 2000;
  const centralPoint = useMemo(() => new THREE.Vector3(0, 1.5, 0), []);
  const isInitialized = useRef(false);
  const initializationTime = useRef(0);

  const movement = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });
  const moveSpeed = 0.05;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMousePosition({
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: -(event.clientY / window.innerHeight) * 2 + 1,
      });
      isMouseMoving.current = true;
      isMouseOnScreen.current = true;
      lastMouseMoveTime.current = Date.now();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        setTouchPosition({
          x: (touch.clientX / window.innerWidth) * 2 - 1,
          y: -(touch.clientY / window.innerHeight) * 2 + 1,
        });
        isTouchMoving.current = true;
      }
    };

    const handleTouchStart = () => {
      isTouchMoving.current = true;
    };

    const handleTouchEnd = () => {
      isTouchMoving.current = false;
    };

    const handleMouseEnter = () => {
      isMouseOnScreen.current = true;
    };

    const handleMouseLeave = () => {
      isMouseOnScreen.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
          movement.current.forward = true;
          break;
        case "KeyS":
          movement.current.backward = true;
          break;
        case "KeyA":
          movement.current.left = true;
          break;
        case "KeyD":
          movement.current.right = true;
          break;
        case "Space":
          // Spacebar press logic (could be any action like jump, camera reset, etc.)
          console.log("Spacebar pressed!");
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
          movement.current.forward = false;
          break;
        case "KeyS":
          movement.current.backward = false;
          break;
        case "KeyA":
          movement.current.left = false;
          break;
        case "KeyD":
          movement.current.right = false;
          break;
      }
    };

    // Mouse click handler to simulate spacebar press
    const handleMouseClick = () => {
      const spacebarEvent = new KeyboardEvent("keydown", {
        key: "Space",
        code: "Space",
        keyCode: 32,
        which: 32,
      });
      window.dispatchEvent(spacebarEvent);
    };

    const handleMouseClick2 = () => {
      const spacebarEvent = new KeyboardEvent("keyup", {
        key: "Space",
        code: "Space",
        keyCode: 32,
        which: 32,
      });
      window.dispatchEvent(spacebarEvent);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("mouseenter", handleMouseEnter);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // window.addEventListener('touch', handleKeyDown);
    // window.addEventListener('touchup', handleKeyUp);

    window.addEventListener("mousedown", handleMouseClick); // Add click listener
    window.addEventListener("mouseup", handleMouseClick2); // Add click listener

    window.addEventListener("touchstart", handleMouseClick); // Add click listener
    window.addEventListener("touchend", handleMouseClick2); // Add click listener

    if (camera && !isInitialized.current) {
      // Set initial camera rotation more gently
      const direction = new THREE.Vector3().subVectors(centralPoint, camera.position).normalize();
      camera.lookAt(camera.position.clone().add(direction));
      isInitialized.current = true;
      initializationTime.current = Date.now();
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("mouseenter", handleMouseEnter);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("click", handleMouseClick); // Clean up click listener
    };
  }, [camera, centralPoint]);

  useFrame((state) => {
    if (camera) {
      const currentTime = Date.now();
      const timeSinceInit = currentTime - initializationTime.current;
      
      // Don't start automatic behavior immediately - wait 2 seconds after initialization
      if (timeSinceInit < 2000) {
        return;
      }
      
      if (currentTime - lastMouseMoveTime.current > mouseIdleTimeout) {
        isMouseMoving.current = false;
      }

      const minRotationX = THREE.MathUtils.degToRad(-50);
      const maxRotationX = THREE.MathUtils.degToRad(50);
      const minRotationY = THREE.MathUtils.degToRad(-45);
      const maxRotationY = THREE.MathUtils.degToRad(45);

      let targetRotationX, targetRotationY;

      if (
        autoRotate &&
        !isMouseMoving.current &&
        !isTouchMoving.current
      ) {
        const time = state.clock.elapsedTime;
        const noiseX = Math.sin(time * 0.7) * 0.5 + Math.sin(time * 1.3) * 0.5;
        const noiseY = Math.sin(time * 0.5) * 0.5 + Math.cos(time * 1.1) * 0.5;

        targetRotationX = THREE.MathUtils.lerp(
          minRotationX,
          maxRotationX,
          (noiseX + 1) * 0.5,
        );
        targetRotationY = THREE.MathUtils.lerp(
          minRotationY,
          maxRotationY,
          (noiseY + 1) * 0.5,
        );
      } else if (isMouseMoving.current || isTouchMoving.current) {
        const position = isTouchMoving.current ? touchPosition : mousePosition;
        targetRotationY = position.x * 0.5;
        targetRotationX = -position.y * 0.3;
      } else {
        // Keep current rotation when auto-rotate is disabled and no user input
        targetRotationX = camera.rotation.x;
        targetRotationY = camera.rotation.y;
      }

      camera.rotation.y += (targetRotationY - camera.rotation.y) * 0.05;

      if (
        (isMouseOnScreen.current && isMouseMoving.current) ||
        isTouchMoving.current
      ) {
        camera.rotation.x += (targetRotationX - camera.rotation.x) * 0.05;
      } else {
        camera.rotation.x += (targetRotationX - camera.rotation.x) * 0.03;
      }

      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      direction.y = 0;
      direction.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(camera.up, direction).normalize();

      if (movement.current.forward) {
        camera.position.addScaledVector(direction, moveSpeed);
      }
      if (movement.current.backward) {
        camera.position.addScaledVector(direction, -moveSpeed);
      }
      if (movement.current.left) {
        camera.position.addScaledVector(right, moveSpeed / 2);
      }
      if (movement.current.right) {
        camera.position.addScaledVector(right, -moveSpeed / 2);
      }

      const targetDirection = new THREE.Vector3()
        .subVectors(centralPoint, camera.position)
        .normalize();
      camera.quaternion.slerp(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          targetDirection,
        ),
        0.02,
      );
    }
  });

  // UI Elements
  return null;
};
