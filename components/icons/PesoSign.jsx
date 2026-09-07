// Custom Philippine Peso (₱) icon matching Lucide React's SVG style.
const PesoSign = ({ className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M8 20V4" />
    <path d="M8 4h5a4 4 0 0 1 0 8H8" />
    <path d="M5 9h12" />
    <path d="M5 13h12" />
  </svg>
);

export default PesoSign;
