import { CSSProperties, useEffect, useState } from "react";
import ScrollingNumbers from "./scrolling-numbers";

interface LoadingScreenProps {
  children?: React.ReactNode;
  skip?: boolean;
  ready?: boolean;
  onComplete?: () => void;
}

export default function LoadingScreen(props: Readonly<LoadingScreenProps>) {
  const [progress, setProgress] = useState<number>(0);
  const [hidden, setHidden] = useState(props.skip || false);
  const [isCompleted, setIsCompleted] = useState(props.skip || false);
  const { skip, onComplete, ready } = props;

  const initialState: CSSProperties = {
    width: "200px",
    height: "200px",
    borderRadius: "100px",
  };

  const completedState: CSSProperties = {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
    borderRadius: "0px",
  };

  // useEffect(() => {
  //     const startTime = Date.now();
  //     const duration = 1000; // 1 second animation

  //     const timer = setInterval(() => {
  //         const elapsedTime = Date.now() - startTime;
  //         const currentProgress = Math.floor((elapsedTime / 1.6 / duration) * 100);

  //         setProgress(Math.min(currentProgress, 100));

  //         if (currentProgress === 100) {
  //             setTimeout(() => {
  //                 setIsCompleted(true);
  //                 clearInterval(timer);
  //             }, 1500);

  //             if (props.onComplete) {
  //                 setTimeout(() => {
  //                     setCompleted(true);
  //                     props.onComplete!()
  //                 }, 2500)
  //             }
  //         }
  //     }, 100);

  //     return () => clearInterval(timer);
  // }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden"; // standard no-scroll implementation
    document.body.setAttribute("data-lenis-prevent", "true"); // Make sure you pass true

    if (skip === true && onComplete) {
      onComplete();
    }
  }, [skip, onComplete]);

  useEffect(() => {
    setProgress(100);

    // Both handles are cleared on re-run. `ready` flips shortly after mount, so
    // this effect fires twice, and without the cleanup four timers were live at
    // once - two of them firing against a superseded run and calling
    // `onComplete` a second time.
    const reveal = window.setTimeout(() => {
      document.body.removeAttribute("data-lenis-prevent"); // Make sure you pass true as string
      document.body.style.overflow = "auto";
      setIsCompleted(true);
    }, 1500);

    const finish = window.setTimeout(() => {
      setHidden(true);
      onComplete?.();
    }, 2500);

    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(finish);
    };
  }, [ready, onComplete]);

  return (
    <>
      {/* we remove everythig to have a cleaner dom */}
      {!hidden && (
        <>
          {/* ${geistMono.className} */}
          <div
            className={` fixed top-10 left-1/2 transform -translate-x-1/2 duration-150 ease-in-out z-[4]`}
            style={
              isCompleted
                ? {
                    transitionProperty: "opacity",
                    opacity: "0",
                  }
                : {
                    transitionProperty: "opacity",
                  }
            }
          >
            <ScrollingNumbers value={progress} />
          </div>

          <div
            className="fixed z-[2] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_0_9999px_rgba(0,0,0,1)]
                transition-all duration-1000 ease-in-out"
            style={isCompleted ? completedState : initialState}
          ></div>

          <div
            className={`fixed transition-all duration-700 ease-in-out w-full h-full bg-[#fff] z-[1]`}
            style={props.ready || isCompleted ? { opacity: "0" } : {}}
          />
        </>
      )}

      {props.children}
    </>
  );
}
