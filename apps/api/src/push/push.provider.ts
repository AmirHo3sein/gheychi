export const PUSH_PROVIDER = 'PUSH_PROVIDER';

export interface PushPayload {
  title: string;
  body: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushProvider {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}
