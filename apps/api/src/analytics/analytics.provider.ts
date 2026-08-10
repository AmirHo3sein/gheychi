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
 * No real analytics vendor account exists in this environment, so today the only
 * implementation is ConsoleAnalyticsProvider, which logs each event as structured
 * JSON via Nest's Logger -- see its own doc comment. Swapping to a real vendor later
 * means writing ONE class that implements this interface (e.g.
 * MixpanelAnalyticsProvider, calling the vendor SDK's own track call from track()
 * below) and pointing AnalyticsModule's provider registration at it -- nothing else
 * in the app changes, because every call site talks to AnalyticsService, never to a
 * provider or a vendor SDK directly.
 */
export interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
}
