"use client";
import { useEffect, useState } from "react";
import LoadingScreen from "@/components/scenes/loading-screen/loading-screen";
import { OfficeScene2 } from "@/components/scenes/office-scene/office-scene-2";

export default function Test() {
  const [isContentReady, setIsContentReady] = useState(false);

  useEffect(() => {
    setTimeout(() => setIsContentReady(true), 200);
  }, []);

  return (
    <LoadingScreen skip={true} ready={isContentReady}>
      {/* page */}
      <div className="w-full min-h-[100dvh] relative">
        {/* section scrolling planes */}
        <section
          className="min-h-[100vh]"
          style={{ borderBottom: "2px solid black" }}
        >
          <div className="h-[100vh] m-h-[100vh]">
            <OfficeScene2 />
          </div>
        </section>
      </div>
    </LoadingScreen>
  );
}
