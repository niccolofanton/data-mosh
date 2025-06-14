import { useEffect, useLayoutEffect, useRef, useMemo } from "react";
import gsap from "gsap";
// import { geistMono, geistSans } from './fonts';

interface ScrollingNumbersProps {
  value: number;
}

const ScrollingNumbers: React.FC<ScrollingNumbersProps> = ({ value }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const numbRef0 = useRef<HTMLDivElement>(null);
  const numbRef1 = useRef<HTMLDivElement>(null);
  const numbRef2 = useRef<HTMLDivElement>(null);
  const numbRefs = useMemo(() => [numbRef0, numbRef1, numbRef2], []);

  const targetValueRef = useRef(value);
  const currentValueRef = useRef(0);
  const duration = 500;

  useLayoutEffect(() => {
    targetValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (currentValueRef.current !== targetValueRef.current) {
        // Increment or decrement towards target
        const diff = targetValueRef.current - currentValueRef.current;

        currentValueRef.current += diff;

        // Convert the current value to a 3-digit string with leading zeros
        const formattedValue = currentValueRef.current
          .toString()
          .padStart(3, "0");

        formattedValue.split("").forEach((digit, index) => {
          let targetPosition = parseInt(digit) * -90;

          if (index === 2 && numbRefs[index].current) {
            targetPosition =
              -90 * numbRefs[index].current.innerText.split(" ").length;
            numbRefs[index].current.innerText += ` ${digit}`;
          }

          gsap.to(numbRefs[index].current, {
            y: targetPosition,
            ease: "power2.inOut",
            duration: duration / 1000,
            delay: 0.05 * index,
          });
        });
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [numbRefs]);

  return (
    // ${geistSans.className}
    <div
      ref={containerRef}
      className={` relative overflow-hidden w-[300px] h-[300px] ml-[-5px]`}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[80px] overflow-hidden flex justify-center text-white font-bold">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="relative h-full w-[33px] overflow-hidden">
            <div
              ref={numbRefs[i]}
              className="text-5xl h-full w-full leading-[90px] text-center"
            >
              0 1 2 3 4 5 6 7 8 9 0
            </div>

            {/* gradient background */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(0deg, #000000 5%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, #000000 95%)`,
              }}
            ></div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScrollingNumbers;
