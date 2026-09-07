// Receipt icon with a Philippine peso (₱) glyph instead of Lucide's dollar sign.
// Drop-in replacement for lucide-react's <Receipt />, same 24×24 stroke style.
const PesoReceipt = ({ className, ...props }) => (
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
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M10 17.5V6.5" />
    <path d="M10 6.5h3a2.75 2.75 0 0 1 0 5.5h-3" />
    <path d="M7.5 9.25h8.5" />
    <path d="M7.5 11.75h8.5" />
  </svg>
);

export default PesoReceipt;
