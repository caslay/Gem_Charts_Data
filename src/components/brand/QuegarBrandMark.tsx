import * as React from "react";

export interface QuegarBrandMarkProps extends React.SVGProps<SVGSVGElement> {
  /** Size in pixels or CSS units (default: 28) */
  size?: number | string;
  /** Primary containment loop color (default: 'currentColor' or '#F8FAFC') */
  primaryColor?: string;
  /** Secondary vector / accumulation accent color (default: '#00F0FF') */
  accentColor?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Quegar Institutional Brand Mark Component — "Apex Accumulator"
 * 
 * QUEGAR = Quant Engine Continuous Accumulation & Resilience
 * 
 * Synthesizes an institutional containment ring (Q) with an internal
 * vertical continuous accumulation needle rising to the core (50, 50)
 * and flaring into a grounded, resilient 45° execution tail.
 */
export const QuegarBrandMark: React.FC<QuegarBrandMarkProps> = ({
  size = 28,
  primaryColor = "currentColor",
  accentColor = "#00F0FF",
  className = "",
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Quegar"
      className={`inline-block select-none shrink-0 ${className}`}
      {...props}
    >
      {/* Institutional Q Containment Loop (White/CurrentColor) */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="
          M 50 8
          C 72.09 8 90 25.91 90 48
          C 90 58.4 86.2 67.8 79.8 74.8
          L 69.2 64.2
          C 72.8 59.6 75 53.9 75 48
          C 75 34.2 63.8 23 50 23
          C 36.2 23 25 34.2 25 48
          C 25 61.8 36.2 73 50 73
          C 50.8 73 51.5 72.9 52.2 72.8
          V 87.8
          C 28.5 87.8 11 70.3 11 48
          C 11 25.7 28.5 8 50 8
          Z
        "
        fill={primaryColor}
      />
      {/* Kinetic Accumulation Needle & Tail Thrust (Signal Cyan) */}
      <path
        d="
          M 50 88
          V 48
          L 77.5 75.5
          L 92 88
          H 66
          L 50 72
          V 88
          Z
        "
        fill={accentColor}
      />
    </svg>
  );
};

export default QuegarBrandMark;
