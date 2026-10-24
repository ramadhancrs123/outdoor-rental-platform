export type FcmDeviceInfo = {
  user_agent?: string;
  app_version?: string;
};

export type FcmTokenResponse = {
  token: string | null;
  source: "android_interface" | "js_bridge" | null;
};
