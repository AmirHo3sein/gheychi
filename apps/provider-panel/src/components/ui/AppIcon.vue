<script setup lang="ts">
import { computed } from 'vue'
import {
  LayoutDashboard, CalendarClock, Tag, Star, Wallet, Settings2, LogOut, Check, X, ChevronLeft, ChevronRight,
  CircleUser, Building2, TriangleAlert, Plus, Pencil, Trash2, Scissors, Palette, Droplet, Gem, Sparkles,
  Paintbrush, Eye, Zap, Phone, Lock, Sun, Moon, RotateCcw, Images, Clock, MapPin, Upload, ImageOff, Store,
  CircleFadingPlus, GalleryHorizontalEnd, ChevronUp, ChevronDown, Percent, Users, LoaderCircle,
} from '@lucide/vue'

const ICONS = {
  dashboard: LayoutDashboard,
  bookings: CalendarClock,
  services: Tag,
  hours: Clock,
  photos: Images,
  reviews: Star,
  earnings: Wallet,
  settings: Settings2,
  logout: LogOut,
  check: Check,
  x: X,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  stories: CircleFadingPlus,
  portfolio: GalleryHorizontalEnd,
  star: Star,
  'user-circle': CircleUser,
  building: Building2,
  warning: TriangleAlert,
  plus: Plus,
  pencil: Pencil,
  trash: Trash2,
  scissors: Scissors,
  palette: Palette,
  droplet: Droplet,
  nail: Gem,
  sparkles: Sparkles,
  brush: Paintbrush,
  eye: Eye,
  razor: Zap,
  phone: Phone,
  lock: Lock,
  sun: Sun,
  moon: Moon,
  reset: RotateCcw,
  upload: Upload,
  'image-off': ImageOff,
  'map-pin': MapPin,
  store: Store,
  coupons: Percent,
  team: Users,
  spinner: LoaderCircle,
} as const

export type IconName = keyof typeof ICONS

const props = defineProps<{ name: IconName; size?: number }>()

const component = computed(() => ICONS[props.name] ?? Tag)
</script>

<template>
  <component :is="component" :size="size ?? 20" :stroke-width="1.75" />
</template>
