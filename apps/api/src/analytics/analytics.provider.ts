export const ANALYTICS_PROVIDER = 'ANALYTICS_PROVIDER';

// One structured product-analytics event, already normalized by AnalyticsService --
// providers never see the caller's raw (event, properties, context) arguments
// separately, only this one shape.
export interface AnalyticsEvent {
  name: string;
  properties: Record<string, unknown>;
  // Optional: not every event has an authenticated actor (e.g. a manual booking
  // created by a salon owner on behalf of a not-yet-resolved customer) or a
  // request-scoped id to correlate against.
  userId?: string;
  requestId?: string;
  timestamp: Date;
}

/**
 * Vendor seam for product-analytics events (Mixpanel/Amplitude/PostHog/etc.), the
 * exact same shape SmsProvider/PushProvider/PaymentGateway already use elsewhere in
 * this codebase: one small interface, one injection token (ANALYTICS_PROVIDER), and
 * AnalyticsModule picks the concrete implementation.
 *
 * No real third-party analytics vendor (Mixpanel/Amplitude/PostHog) account exists in
 * this environment, so the real implementation today is PostgresAnalyticsProvider,
 * which persists each event as a row in `analytics_events` -- see its own doc comment
 * and `analytics.module.ts`. ConsoleAnalyticsProvider (logs each event as structured
 * JSON via Nest's Logger) still exists as an opt-in fallback (`ANALYTICS_PROVIDER=console`)
 * but is no longer the default. Swapping to a real vendor later means writing ONE class
 * that implements this interface (e.g. MixpanelAnalyticsProvider, calling the vendor
 * SDK's own track call from track() below) and pointing AnalyticsModule's provider
 * registration at it -- nothing else in the app changes, because every call site talks
 * to AnalyticsService, never to a provider or a vendor SDK directly.
 */
export interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
}
