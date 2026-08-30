<!-- apps/admin-panel/src/components/ui/AppIcon.vue -->
<!-- Thin wrapper around @lucide/vue -- keeps the same semantic `name` API used across the
     app (sidebar nav, status actions, category glyphs, etc.) so call sites never reference
     Lucide's own component names directly and can't drift if the icon set changes again. -->
<script setup lang="ts">
import { computed } from 'vue'
import {
  LayoutDashboard, Store, Star, Grid2x2, Users, Settings2, LogOut,
  Check, X, ChevronLeft, ChevronRight, Search, CircleUser, Building2, TriangleAlert,
  Plus, Pencil, Scissors, Palette, Droplet, Gem, Sparkles, Paintbrush,
  Eye, Zap, Tag, Phone, Calendar, Lock, Sun, Moon, RotateCcw,
  History, Flag, Bell, Newspaper, TicketPercent, UserCog, Wallet, Gift, UserPlus, LoaderCircle, Receipt, BarChart3,
  ToggleRight, Layers,
} from '@lucide/vue'

export type IconName =
  | 'dashboard' | 'salons' | 'reviews' | 'categories' | 'users' | 'config' | 'logout'
  | 'check' | 'x' | 'chevron-left' | 'chevron-right' | 'search' | 'star' | 'user-circle' | 'building'
  | 'warning' | 'plus' | 'pencil' | 'scissors' | 'palette' | 'droplet' | 'nail'
  | 'sparkles' | 'brush' | 'eye' | 'razor' | 'tag' | 'phone' | 'calendar' | 'lock'
  | 'sun' | 'moon' | 'reset' | 'history' | 'flag' | 'bell' | 'newspaper' | 'coupon' | 'worker-ratings' | 'wallet'
  | 'gift' | 'user-plus' | 'spinner' | 'invoice' | 'chart' | 'toggle' | 'plan'

const ICONS = {
  dashboard: LayoutDashboard,
  salons: Store,
  reviews: Star,
  categories: Grid2x2,
  users: Users,
  config: Settings2,
  logout: LogOut,
  check: Check,
  x: X,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  search: Search,
  star: Star,
  'user-circle': CircleUser,
  building: Building2,
  warning: TriangleAlert,
  plus: Plus,
  pencil: Pencil,
  scissors: Scissors,
  palette: Palette,
  droplet: Droplet,
  nail: Gem,
  sparkles: Sparkles,
  brush: Paintbrush,
  eye: Eye,
  razor: Zap,
  tag: Tag,
  phone: Phone,
  calendar: Calendar,
  lock: Lock,
  sun: Sun,
  moon: Moon,
  reset: RotateCcw,
  history: History,
  flag: Flag,
  bell: Bell,
  newspaper: Newspaper,
  coupon: TicketPercent,
  'worker-ratings': UserCog,
  wallet: Wallet,
  gift: Gift,
  'user-plus': UserPlus,
  spinner: LoaderCircle,
  invoice: Receipt,
  chart: BarChart3,
  toggle: ToggleRight,
  plan: Layers,
} as const

const props = defineProps<{ name: IconName; size?: number }>()

const component = computed(() => ICONS[props.name] ?? Tag)
</script>

<template>
  <component :is="component" :size="size ?? 20" :stroke-width="1.75" />
</template>
