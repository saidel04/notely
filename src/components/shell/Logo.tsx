import logo from "../../assets/logo.png";

/** The Notely mark. Monochrome, so dark mode simply inverts it. */
export function Logo({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <img src={logo} alt="Notely" width={size} height={size} draggable={false} className={`app-logo select-none ${className}`} />;
}
