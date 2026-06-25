import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names with clsx, then resolve Tailwind conflicts with tailwind-merge so a
 * caller-supplied `className` wins over a component default (design-system override ergonomics,
 * e.g. `<Button className="bg-surface-card" />` overrides the default `bg-primary`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
