// Route skeleton for the Pet Tag roster (P3-t t-5, spec §03: loading is a skeleton, not a spinner). Mirrors
// the header + filter chips + table shape. Decorative (aria-hidden); the pulse stops under
// prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-11 w-28 animate-pulse rounded-pill bg-surface-sunken motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
    </div>
  );
}
