/** Decorative icons share the same quiet stroke as the global controls. */
export function ActionIcon({
  name,
}: {
  name: 'steam' | 'arrow' | 'repeat' | 'check' | 'heart' | 'settings' | 'headphones';
}) {
  const paths = {
    steam: 'M6 18c-4-4 4-5 0-10M12 18c-4-4 4-5 0-10M18 18c-4-4 4-5 0-10',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    repeat: 'M20 7h-5m5 0V2M4 17h5m-5 0v5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3',
    check: 'm5 12 4 4L19 6',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
    settings: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4-6v6m0 4v6m4-6v6',
    headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v8H5a2 2 0 0 1-2-2Zm18 0h-4v8h2a2 2 0 0 0 2-2Z',
  };
  return (
    <svg
      className="action-icon"
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
