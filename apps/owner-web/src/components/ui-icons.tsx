import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "arrowRight"
  | "bell"
  | "building"
  | "check"
  | "clock"
  | "creditCard"
  | "home"
  | "monitor"
  | "package"
  | "receipt"
  | "rotateBack"
  | "settings"
  | "spark"
  | "transfer"
  | "trophy"
  | "user"
  | "users";

const paths: Record<IconName, string[]> = {
  activity: ["M3 12h4l3-8 4 16 3-8h4"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  building: ["M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16", "M9 21v-5h3v5", "M8 7h1", "M12 7h1", "M8 11h1", "M12 11h1", "M17 9h1a2 2 0 0 1 2 2v10"],
  check: ["M20 6 9 17l-5-5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  creditCard: ["M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z", "M3 10h18"],
  home: ["M3 10.5 12 3l9 7.5", "M5 10v10h14V10", "M9 20v-6h6v6"],
  monitor: ["M4 5h16v11H4z", "M8 21h8", "M12 16v5"],
  package: ["M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z", "M3 7.5 12 12l9-4.5", "M12 12v9"],
  receipt: ["M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3Z", "M9 8h6", "M9 12h6", "M9 16h4"],
  rotateBack: ["M9 7H4V2", "M4.6 7A8 8 0 1 1 4 13"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .3l-.3.2a1.8 1.8 0 0 0-.7 1.8V23h-4v-.3a1.8 1.8 0 0 0-.7-1.8l-.3-.2a1.8 1.8 0 0 0-2-.3l-.2.1-2-3.4.1-.1a1.8 1.8 0 0 0 .4-2v-.4a1.8 1.8 0 0 0-1.5-1.3H4v-4h.3a1.8 1.8 0 0 0 1.5-1.3v-.4a1.8 1.8 0 0 0-.4-2l-.1-.1 2-3.4.2.1a1.8 1.8 0 0 0 2-.3l.3-.2a1.8 1.8 0 0 0 .7-1.8V1h4v.3a1.8 1.8 0 0 0 .7 1.8l.3.2a1.8 1.8 0 0 0 2 .3l.2-.1 2 3.4-.1.1a1.8 1.8 0 0 0-.4 2v.4a1.8 1.8 0 0 0 1.5 1.3h.3v4h-.3a1.8 1.8 0 0 0-1.5 1.3Z"],
  spark: ["M13 2 9 10l-7 2 7 2 4 8 4-8 7-2-7-2-4-8Z"],
  transfer: ["M7 7h11", "M14 3l4 4-4 4", "M17 17H6", "M10 13l-4 4 4 4"],
  trophy: ["M8 4h8v4a4 4 0 0 1-8 0V4Z", "M8 6H5a2 2 0 0 0 2 4h1", "M16 6h3a2 2 0 0 1-2 4h-1", "M12 12v5", "M9 21h6", "M10 17h4"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  users: ["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M2 21a7 7 0 0 1 14 0", "M17 11a3 3 0 1 0 0-6", "M18 21a5.5 5.5 0 0 0-3-4.9"],
};

export function Icon({ name, className = "h-5 w-5", ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
