import {
  Box,
  Briefcase,
  Building2,
  Calendar,
  Car,
  ClipboardList,
  Coffee,
  CreditCard,
  FileText,
  Flag,
  Folder,
  Gift,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Home,
  Key,
  Laptop,
  Layers,
  LifeBuoy,
  Mail,
  MapPin,
  Megaphone,
  Package,
  PenTool,
  Phone,
  PieChart,
  Plane,
  Receipt,
  Rocket,
  ShoppingCart,
  Star,
  Store,
  Tag,
  Target,
  Ticket,
  Trophy,
  Truck,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../shared/lib/utils";
import { dotClass } from "./colors";

// Curated icon set for objects (custom objects pick from it). Names are
// stored in ObjectDef.icon; unknown names fall back to Box.
export const OBJECT_ICONS: Record<string, LucideIcon> = {
  Box,
  Briefcase,
  Building2,
  Calendar,
  Car,
  ClipboardList,
  Coffee,
  CreditCard,
  FileText,
  Flag,
  Folder,
  Gift,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Home,
  Key,
  Laptop,
  Layers,
  LifeBuoy,
  Mail,
  MapPin,
  Megaphone,
  Package,
  PenTool,
  Phone,
  PieChart,
  Plane,
  Receipt,
  Rocket,
  ShoppingCart,
  Star,
  Store,
  Tag,
  Target,
  Ticket,
  Trophy,
  Truck,
  User,
  Users,
  Wrench,
};

export function objectIcon(name: string | undefined): LucideIcon {
  return (name && OBJECT_ICONS[name]) || Box;
}

export function ObjectIcon({ name, color, className, tile }: { name?: string; color?: string; className?: string; tile?: boolean }) {
  const Icon = objectIcon(name);
  if (!tile) return <Icon className={cn("h-4 w-4", className)} />;
  return (
    <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-white", dotClass(color), className)}>
      <Icon className="h-3 w-3" />
    </span>
  );
}
