export default function AreaSelectIcon({ active = false, size = 18 }) {
  const color = active ? "#1e2a22" : "#efe7d2";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7 L17 4 L20 16 L7 20 Z" />
      <circle cx="4" cy="7" r="1.4" fill={color} />
      <circle cx="17" cy="4" r="1.4" fill={color} />
      <circle cx="20" cy="16" r="1.4" fill={color} />
      <circle cx="7" cy="20" r="1.4" fill={color} />
    </svg>
  );
}