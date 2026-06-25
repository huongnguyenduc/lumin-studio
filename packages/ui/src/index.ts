// @lumin/ui — design-system primitives rebuilt from design-system.md on the @lumin/tokens preset.
// Visual values map to semantic token utilities (bg-primary, rounded-pill, shadow-pop …); money is
// formatted ONLY via @lumin/core (no Intl here — ESLint enforces, ADR-019).
export { cn } from './lib/cn';

export { Button, type ButtonProps } from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Tag, type TagProps } from './Tag';
export { Avatar, type AvatarProps } from './Avatar';
export { Card, type CardProps } from './Card';
export { Input, type InputProps } from './Input';
export { Switch, type SwitchProps } from './Switch';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { QuantityStepper, type QuantityStepperProps } from './QuantityStepper';
export { Rating, type RatingProps } from './Rating';
export { PriceTag, type PriceTagProps } from './PriceTag';
export { ProductCard, type ProductCardProps } from './ProductCard';
